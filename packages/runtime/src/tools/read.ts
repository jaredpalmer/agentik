import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { resolveToCwd } from "./path-utils";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate";

export type ReadToolInput = {
  path: string;
  offset?: number;
  limit?: number;
};

const readSchema = jsonSchema<ReadToolInput>({
  type: "object",
  properties: {
    path: { type: "string", description: "Path to the file to read." },
    offset: {
      type: "number",
      description: "Line number to start reading from (1-indexed).",
    },
    limit: {
      type: "number",
      description: "Maximum number of lines to read.",
    },
  },
  required: ["path"],
  additionalProperties: false,
});

export type ReadOperations = {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
};

const defaultReadOperations: ReadOperations = {
  readFile: (path) => readFile(path),
  access: (path) => access(path, constants.R_OK),
};

export type ReadToolOptions = {
  operations?: ReadOperations;
};

export function createReadTool(
  cwd: string,
  options: ReadToolOptions = {}
): AgentToolDefinition<ReadToolInput, string> {
  const ops = options.operations ?? defaultReadOperations;

  return {
    name: "read",
    label: "read",
    description: `Read a text file. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    inputSchema: readSchema,
    execute: async (input) => {
      const absolutePath = resolveToCwd(input.path, cwd);
      await ops.access(absolutePath);

      const raw = await ops.readFile(absolutePath);
      const text = raw.toString("utf-8");
      const lines = text.split("\n");
      const totalLines = lines.length;

      const startLine = input.offset ? Math.max(0, input.offset - 1) : 0;
      if (startLine >= totalLines) {
        throw new Error(`Offset ${input.offset ?? 0} is beyond end of file (${totalLines} lines).`);
      }

      const endLine =
        input.limit != null ? Math.min(startLine + input.limit, totalLines) : totalLines;
      const selected = lines.slice(startLine, endLine).join("\n");

      const truncation = truncateHead(selected);
      let output = truncation.content;

      if (truncation.truncated) {
        const shownStart = startLine + 1;
        const shownEnd = startLine + truncation.outputLines;
        const nextOffset = shownEnd + 1;
        output += `\n\n[Showing lines ${shownStart}-${shownEnd} of ${totalLines}. Use offset=${nextOffset} to continue.]`;
      } else if (endLine < totalLines) {
        output += `\n\n[${totalLines - endLine} more lines. Use offset=${endLine + 1} to continue.]`;
      }

      return { output };
    },
  };
}

export const readTool = createReadTool(process.cwd());
