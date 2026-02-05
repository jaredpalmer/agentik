import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { Glob } from "bun";

const parameters = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.js')"),
  cwd: z
    .string()
    .optional()
    .describe("Directory to search in (default: current working directory)"),
});

type GlobParams = z.infer<typeof parameters>;

export const globTool: AgentTool<GlobParams, { count: number }> = {
  name: "glob",
  label: "Glob",
  description: "Find files matching a glob pattern. Returns a list of matching file paths.",
  parameters,
  async execute(_toolCallId, params) {
    try {
      const glob = new Glob(params.pattern);
      const cwd = params.cwd ?? process.cwd();
      const matches: string[] = [];

      for await (const file of glob.scan({ cwd, absolute: true })) {
        matches.push(file);
        if (matches.length >= 1000) break; // Safety limit
      }

      matches.sort();

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "No files found" }],
          details: { count: 0 },
        };
      }

      return {
        content: [{ type: "text", text: matches.join("\n") }],
        details: { count: matches.length },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        details: { count: 0 },
      };
    }
  },
};
