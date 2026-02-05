import { z } from "zod";
import type { AgentTool } from "@agentik/agent";
import { execFile } from "node:child_process";

const parameters = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
});

type BashParams = z.infer<typeof parameters>;

export const bashTool: AgentTool<BashParams, { exitCode: number }> = {
  name: "bash",
  label: "Bash",
  description: "Execute a bash command and return its output",
  parameters,
  async execute(_toolCallId, params, signal) {
    const timeout = params.timeout ?? 30000;

    return new Promise((resolve) => {
      const proc = execFile("/bin/bash", ["-c", params.command], {
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: string) => {
        stdout += data;
      });

      proc.stderr?.on("data", (data: string) => {
        stderr += data;
      });

      signal?.addEventListener("abort", () => {
        proc.kill("SIGTERM");
      });

      proc.on("close", (code) => {
        const exitCode = code ?? 1;
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

        resolve({
          content: [{ type: "text", text: output || "(no output)" }],
          details: { exitCode },
        });
      });

      proc.on("error", (err) => {
        resolve({
          content: [{ type: "text", text: `Error: ${err.message}` }],
          details: { exitCode: 1 },
        });
      });
    });
  },
};
