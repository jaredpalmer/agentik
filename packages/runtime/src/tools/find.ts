import { glob } from "glob";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { resolveToCwd } from "./path-utils";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "./truncate";

export type FindToolInput = {
  pattern: string;
  path?: string;
  limit?: number;
};

const findSchema = jsonSchema<FindToolInput>({
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "Glob pattern to match files, e.g. '*.ts' or 'src/**/*.spec.ts'.",
    },
    path: { type: "string", description: "Directory to search." },
    limit: { type: "number", description: "Maximum number of results." },
  },
  required: ["pattern"],
  additionalProperties: false,
});

const DEFAULT_LIMIT = 1000;

export type FindToolOptions = {
  ignore?: string[];
};

export function createFindTool(
  cwd: string,
  options: FindToolOptions = {}
): AgentToolDefinition<FindToolInput, string> {
  const ignore = options.ignore ?? ["**/node_modules/**", "**/.git/**"];

  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Output is truncated to ${formatSize(
      DEFAULT_MAX_BYTES
    )} or ${DEFAULT_LIMIT} results.`,
    inputSchema: findSchema,
    execute: async (input) => {
      const searchPath = resolveToCwd(input.path ?? ".", cwd);
      const limit = input.limit ?? DEFAULT_LIMIT;

      const matches = await glob(input.pattern, {
        cwd: searchPath,
        dot: true,
        ignore,
        nodir: false,
      });

      matches.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const limited = matches.slice(0, limit);

      if (limited.length === 0) {
        return { output: "No files found." };
      }

      const rawOutput = limited.join("\n");
      const truncation = truncateHead(rawOutput, {
        maxLines: Number.MAX_SAFE_INTEGER,
      });

      let output = truncation.content;

      if (matches.length > limit) {
        output += `\n\n[${limit} results limit reached. Use limit=${limit * 2} for more.]`;
      }
      if (truncation.truncated) {
        output += `\n\n[Output truncated at ${formatSize(DEFAULT_MAX_BYTES)}.]`;
      }

      return { output };
    },
  };
}

export const findTool = createFindTool(process.cwd());
