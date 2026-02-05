import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { readFile } from "node:fs/promises";

const parameters = z.object({
  path: z.string().describe("Absolute or relative path to the file to read"),
  offset: z.number().optional().describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Maximum number of lines to read"),
});

type ReadFileParams = z.infer<typeof parameters>;

export const readFileTool: AgentTool<ReadFileParams, { lineCount: number }> = {
  name: "read_file",
  label: "Read File",
  description: "Read the contents of a file. Returns the file content with line numbers.",
  parameters,
  async execute(_toolCallId, params) {
    try {
      const content = await readFile(params.path, "utf-8");
      const lines = content.split("\n");

      const startLine = (params.offset ?? 1) - 1;
      const endLine = params.limit ? startLine + params.limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(6)}│${line}`)
        .join("\n");

      return {
        content: [{ type: "text", text: numbered }],
        details: { lineCount: selectedLines.length },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading file: ${(err as Error).message}` }],
        details: { lineCount: 0 },
      };
    }
  },
};
