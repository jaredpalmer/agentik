import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";

const parameters = z.object({
  path: z.string().optional().describe("Directory to list (default: current directory)"),
  limit: z.number().optional().describe("Maximum number of entries to return (default: 500)"),
});

type LsParams = z.infer<typeof parameters>;

const DEFAULT_LIMIT = 500;

interface LsToolDetails {
  entryLimitReached?: number;
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export const lsTool: AgentTool<LsParams, LsToolDetails | undefined> = {
  name: "ls",
  label: "LS",
  description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output truncated to ${DEFAULT_LIMIT} entries.`,
  parameters,
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) throw new Error("Operation aborted");

    const dirPath = resolvePath(params.path || ".");
    const effectiveLimit = params.limit ?? DEFAULT_LIMIT;

    // Check path exists and is a directory
    let dirStat;
    try {
      dirStat = await stat(dirPath);
    } catch {
      throw new Error(`Path not found: ${dirPath}`);
    }

    if (!dirStat.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    // Read entries
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch (e) {
      throw new Error(`Cannot read directory: ${(e as Error).message}`);
    }

    // Sort case-insensitively
    entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    // Format with directory indicators
    const results: string[] = [];
    let entryLimitReached = false;

    for (const entry of entries) {
      if (results.length >= effectiveLimit) {
        entryLimitReached = true;
        break;
      }

      const fullPath = join(dirPath, entry);
      let suffix = "";
      try {
        const entryStat = await stat(fullPath);
        if (entryStat.isDirectory()) suffix = "/";
      } catch {
        continue;
      }

      results.push(entry + suffix);
    }

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: "(empty directory)" }],
        details: undefined,
      };
    }

    let output = results.join("\n");
    const details: LsToolDetails = {};

    if (entryLimitReached) {
      output += `\n\n[${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more]`;
      details.entryLimitReached = effectiveLimit;
    }

    return {
      content: [{ type: "text", text: output }],
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  },
};
