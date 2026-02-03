import { spawn } from "node:child_process";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "../types";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "./truncate";

export type BashToolInput = {
  command: string;
  timeout?: number;
};

const bashSchema = jsonSchema<BashToolInput>({
  type: "object",
  properties: {
    command: { type: "string", description: "Shell command to execute." },
    timeout: { type: "number", description: "Timeout in seconds." },
  },
  required: ["command"],
  additionalProperties: false,
});

export type BashToolOptions = {
  env?: NodeJS.ProcessEnv;
};

export function createBashTool(
  cwd: string,
  options: BashToolOptions = {}
): AgentToolDefinition<BashToolInput, string> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a shell command. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    inputSchema: bashSchema,
    execute: async (input) => {
      return new Promise((resolve, reject) => {
        const child = spawn(input.command, {
          cwd,
          env: { ...process.env, ...options.env },
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const onData = (data: Buffer) => {
          totalBytes += data.length;
          chunks.push(data);
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        let timeoutId: NodeJS.Timeout | undefined;
        if (input.timeout && input.timeout > 0) {
          timeoutId = setTimeout(() => {
            child.kill("SIGKILL");
          }, input.timeout * 1000);
        }

        child.on("error", (error) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          reject(error);
        });

        child.on("close", (code) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          const output = Buffer.concat(chunks).toString("utf-8");
          const truncation = truncateTail(output, {
            maxLines: DEFAULT_MAX_LINES,
            maxBytes: DEFAULT_MAX_BYTES,
          });
          let text = truncation.content;

          if (truncation.truncated) {
            text += `\n\n[Output truncated at ${formatSize(DEFAULT_MAX_BYTES)}.]`;
          }

          text = `Exit code: ${code ?? "unknown"}\n\n${text}`.trim();
          resolve({ output: text });
        });
      });
    },
  };
}

export const bashTool = createBashTool(process.cwd());
