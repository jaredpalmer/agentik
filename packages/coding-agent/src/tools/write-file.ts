import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const parameters = z.object({
  path: z.string().describe("Absolute or relative path to the file to write"),
  content: z.string().describe("The content to write to the file"),
});

type WriteFileParams = z.infer<typeof parameters>;

export const writeFileTool: AgentTool<WriteFileParams, { bytesWritten: number }> = {
  name: "write_file",
  label: "Write File",
  description: "Write content to a file, creating directories as needed.",
  parameters,
  async execute(_toolCallId, params) {
    try {
      await mkdir(dirname(params.path), { recursive: true });
      await writeFile(params.path, params.content, "utf-8");

      return {
        content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` }],
        details: { bytesWritten: params.content.length },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error writing file: ${(err as Error).message}` }],
        details: { bytesWritten: 0 },
      };
    }
  },
};
