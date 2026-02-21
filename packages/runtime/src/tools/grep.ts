import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { glob } from "glob";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { resolveToCwd } from "./path-utils";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  truncateHead,
  truncateLine,
} from "./truncate";

export type GrepToolInput = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
};

const grepSchema = jsonSchema<GrepToolInput>({
  type: "object",
  properties: {
    pattern: { type: "string", description: "Search pattern (regex or literal string)." },
    path: { type: "string", description: "Directory or file to search." },
    glob: { type: "string", description: "Filter files by glob pattern." },
    ignoreCase: { type: "boolean", description: "Case-insensitive search." },
    literal: { type: "boolean", description: "Treat pattern as literal string." },
    context: { type: "number", description: "Lines of context before/after each match." },
    limit: { type: "number", description: "Maximum number of matches to return." },
  },
  required: ["pattern"],
  additionalProperties: false,
});

const DEFAULT_LIMIT = 100;

export type GrepToolOptions = {
  ignore?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createGrepTool(
  cwd: string,
  options: GrepToolOptions = {}
): AgentToolDefinition<GrepToolInput, string> {
  const ignore = options.ignore ?? ["**/node_modules/**", "**/.git/**"];

  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Output is truncated to ${formatSize(
      DEFAULT_MAX_BYTES
    )} or ${DEFAULT_LIMIT} matches. Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    inputSchema: grepSchema,
    execute: async (input) => {
      const searchPath = resolveToCwd(input.path ?? ".", cwd);
      const limit = Math.max(1, input.limit ?? DEFAULT_LIMIT);
      const contextLines = Math.max(0, input.context ?? 0);

      let matcher: RegExp;
      try {
        matcher = new RegExp(
          input.literal ? escapeRegExp(input.pattern) : input.pattern,
          input.ignoreCase ? "i" : undefined
        );
      } catch (error) {
        throw new Error(
          `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const stats = await stat(searchPath);
      const files: string[] = [];

      if (stats.isFile()) {
        files.push(searchPath);
      } else {
        const pattern = input.glob ?? "**/*";
        const matches = await glob(pattern, {
          cwd: searchPath,
          dot: true,
          ignore,
          nodir: true,
        });
        for (const match of matches) {
          files.push(join(searchPath, match));
        }
      }

      const outputLines: string[] = [];
      let matchCount = 0;
      let matchLimitReached = false;

      for (const filePath of files) {
        if (matchCount >= limit) {
          matchLimitReached = true;
          break;
        }

        let content: string;
        try {
          content = await readFile(filePath, "utf-8");
        } catch {
          continue;
        }

        const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        const emitted = new Set<number>();
        const relativePath = stats.isFile()
          ? relative(cwd, filePath)
          : relative(searchPath, filePath);

        for (let index = 0; index < lines.length; index += 1) {
          if (matchCount >= limit) {
            matchLimitReached = true;
            break;
          }

          const line = lines[index];
          if (!matcher.test(line)) {
            continue;
          }

          matchCount += 1;

          const start = Math.max(0, index - contextLines);
          const end = Math.min(lines.length - 1, index + contextLines);

          for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
            if (emitted.has(lineIndex)) {
              continue;
            }

            const lineText = truncateLine(lines[lineIndex], GREP_MAX_LINE_LENGTH);
            outputLines.push(`${relativePath}:${lineIndex + 1}: ${lineText}`);
            emitted.add(lineIndex);
          }
        }
      }

      if (outputLines.length === 0) {
        return { output: "No matches found." };
      }

      const rawOutput = outputLines.join("\n");
      const truncation = truncateHead(rawOutput, {
        maxLines: Number.MAX_SAFE_INTEGER,
      });

      let output = truncation.content;
      const notices: string[] = [];

      if (matchLimitReached) {
        notices.push(`${limit} matches limit reached`);
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
      }

      if (notices.length > 0) {
        output += `\n\n[${notices.join(". ")}]`;
      }

      return { output };
    },
  };
}

export const grepTool = createGrepTool(process.cwd());
