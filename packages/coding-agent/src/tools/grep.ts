import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, isAbsolute, relative, basename } from "node:path";
import { requireToolBinary } from "./tool-binary.js";

const parameters = z.object({
  pattern: z.string().describe("Search pattern (regex or literal string)"),
  path: z.string().optional().describe("Directory or file to search (default: current directory)"),
  glob: z
    .string()
    .optional()
    .describe("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
  ignoreCase: z.boolean().optional().describe("Case-insensitive search (default: false)"),
  literal: z
    .boolean()
    .optional()
    .describe("Treat pattern as literal string instead of regex (default: false)"),
  context: z
    .number()
    .optional()
    .describe("Number of lines to show before and after each match (default: 0)"),
  limit: z.number().optional().describe("Maximum number of matches to return (default: 100)"),
});

type GrepParams = z.infer<typeof parameters>;

const DEFAULT_LIMIT = 100;
const MAX_LINE_LENGTH = 250;
const MAX_BYTES = 256 * 1024;

interface GrepToolDetails {
  matchLimitReached?: number;
  linesTruncated?: boolean;
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function truncateLine(line: string): { text: string; wasTruncated: boolean } {
  if (line.length <= MAX_LINE_LENGTH) return { text: line, wasTruncated: false };
  return { text: line.slice(0, MAX_LINE_LENGTH) + "...", wasTruncated: true };
}

export const grepTool: AgentTool<GrepParams, GrepToolDetails | undefined> = {
  name: "grep",
  label: "Grep",
  description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output truncated to ${DEFAULT_LIMIT} matches or ${MAX_BYTES / 1024}KB. Long lines truncated to ${MAX_LINE_LENGTH} chars.`,
  parameters,
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) throw new Error("Operation aborted");

    const searchPath = resolvePath(params.path || ".");
    const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
    const contextValue = params.context && params.context > 0 ? params.context : 0;

    // Check path exists
    let isDirectory = false;
    try {
      const s = await stat(searchPath);
      isDirectory = s.isDirectory();
    } catch {
      throw new Error(`Path not found: ${searchPath}`);
    }

    const formatPath = (filePath: string): string => {
      if (isDirectory) {
        const rel = relative(searchPath, filePath);
        if (rel && !rel.startsWith("..")) {
          return rel.replace(/\\/g, "/");
        }
      }
      return basename(filePath);
    };
    const rgBinary = requireToolBinary("rg");

    return new Promise((resolve, reject) => {
      const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];

      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (params.glob) args.push("--glob", params.glob);
      args.push(params.pattern, searchPath);

      const child = spawn(rgBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let matchCount = 0;
      let matchLimitReached = false;
      let linesTruncated = false;
      let killedDueToLimit = false;

      const matches: Array<{ filePath: string; lineNumber: number }> = [];

      const onAbort = () => {
        if (!child.killed) child.kill();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      let buffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim() || matchCount >= effectiveLimit) continue;

          let event: { type?: string; data?: { path?: { text?: string }; line_number?: number } };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "match") {
            matchCount++;
            const filePath = event.data?.path?.text;
            const lineNumber = event.data?.line_number;

            if (filePath && typeof lineNumber === "number") {
              matches.push({ filePath, lineNumber });
            }

            if (matchCount >= effectiveLimit) {
              matchLimitReached = true;
              killedDueToLimit = true;
              if (!child.killed) child.kill();
            }
          }
        }
      });

      child.on("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`Failed to run ripgrep: ${error.message}`));
      });

      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);

        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        if (!killedDueToLimit && code !== 0 && code !== 1) {
          const errorMsg = stderr.trim() || `ripgrep exited with code ${code}`;
          reject(new Error(errorMsg));
          return;
        }

        if (matchCount === 0) {
          resolve({
            content: [{ type: "text", text: "No matches found" }],
            details: undefined,
          });
          return;
        }

        // Format matches with context
        const fileCache = new Map<string, string[]>();
        const getFileLines = (filePath: string): string[] => {
          let lines = fileCache.get(filePath);
          if (!lines) {
            try {
              const content = readFileSync(filePath, "utf-8");
              lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
            } catch {
              lines = [];
            }
            fileCache.set(filePath, lines);
          }
          return lines;
        };

        const outputLines: string[] = [];
        for (const match of matches) {
          const relativePath = formatPath(match.filePath);
          const lines = getFileLines(match.filePath);

          if (!lines.length) {
            outputLines.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
            continue;
          }

          const start =
            contextValue > 0 ? Math.max(1, match.lineNumber - contextValue) : match.lineNumber;
          const end =
            contextValue > 0
              ? Math.min(lines.length, match.lineNumber + contextValue)
              : match.lineNumber;

          for (let current = start; current <= end; current++) {
            const lineText = (lines[current - 1] ?? "").replace(/\r/g, "");
            const { text: truncatedText, wasTruncated } = truncateLine(lineText);
            if (wasTruncated) linesTruncated = true;

            if (current === match.lineNumber) {
              outputLines.push(`${relativePath}:${current}: ${truncatedText}`);
            } else {
              outputLines.push(`${relativePath}-${current}- ${truncatedText}`);
            }
          }
        }

        let output = outputLines.join("\n");

        // Truncate by bytes
        if (new TextEncoder().encode(output).length > MAX_BYTES) {
          const lines = output.split("\n");
          let totalBytes = 0;
          let lastLine = 0;
          for (let i = 0; i < lines.length; i++) {
            totalBytes += new TextEncoder().encode(lines[i] + "\n").length;
            if (totalBytes > MAX_BYTES) break;
            lastLine = i;
          }
          output = lines.slice(0, lastLine + 1).join("\n");
        }

        const details: GrepToolDetails = {};
        const notices: string[] = [];

        if (matchLimitReached) {
          notices.push(
            `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`
          );
          details.matchLimitReached = effectiveLimit;
        }

        if (linesTruncated) {
          notices.push(
            `Some lines truncated to ${MAX_LINE_LENGTH} chars. Use read tool to see full lines`
          );
          details.linesTruncated = true;
        }

        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }

        resolve({
          content: [{ type: "text", text: output }],
          details: Object.keys(details).length > 0 ? details : undefined,
        });
      });
    });
  },
};
