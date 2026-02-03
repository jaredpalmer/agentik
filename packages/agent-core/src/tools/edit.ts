import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { resolveToCwd } from "./path-utils";

export type EditToolInput = {
  path: string;
  oldText: string;
  newText: string;
};

const editSchema = jsonSchema<EditToolInput>({
  type: "object",
  properties: {
    path: { type: "string", description: "Path to the file to edit." },
    oldText: { type: "string", description: "Exact text to replace." },
    newText: { type: "string", description: "Replacement text." },
  },
  required: ["path", "oldText", "newText"],
  additionalProperties: false,
});

export type EditOperations = {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
};

const defaultEditOperations: EditOperations = {
  readFile: (path) => readFile(path),
  writeFile: (path, content) => writeFile(path, content, "utf-8"),
  access: (path) => access(path, constants.R_OK | constants.W_OK),
};

export type EditToolOptions = {
  operations?: EditOperations;
};

export function createEditTool(
  cwd: string,
  options: EditToolOptions = {}
): AgentToolDefinition<EditToolInput, string> {
  const ops = options.operations ?? defaultEditOperations;

  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by replacing exact text. The oldText must match exactly.",
    inputSchema: editSchema,
    execute: async (input) => {
      const absolutePath = resolveToCwd(input.path, cwd);
      await ops.access(absolutePath);

      const raw = await ops.readFile(absolutePath);
      const content = raw.toString("utf-8");

      const firstIndex = content.indexOf(input.oldText);
      if (firstIndex === -1) {
        throw new Error(`oldText not found in ${input.path}.`);
      }
      const secondIndex = content.indexOf(input.oldText, firstIndex + input.oldText.length);
      if (secondIndex !== -1) {
        throw new Error(`oldText occurs multiple times in ${input.path}. Provide a unique match.`);
      }

      const updated =
        content.slice(0, firstIndex) +
        input.newText +
        content.slice(firstIndex + input.oldText.length);

      await ops.writeFile(absolutePath, updated);
      return { output: `Updated ${input.path}.` };
    },
  };
}

export const editTool = createEditTool(process.cwd());
