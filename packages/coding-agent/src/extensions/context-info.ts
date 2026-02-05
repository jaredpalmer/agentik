import type { Extension } from "@agentik/agent";
import { execFileSync } from "node:child_process";

export interface ContextInfoOptions {
  cwd?: string;
}

function getGitBranch(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

export function contextInfo(opts?: ContextInfoOptions): Extension {
  return (api) => {
    api.on("transformContext", async (messages) => {
      const cwd = opts?.cwd ?? process.cwd();
      const branch = getGitBranch(cwd);
      const timestamp = new Date().toISOString();

      const lines = [
        `[context-info]`,
        `Working directory: ${cwd}`,
        branch ? `Git branch: ${branch}` : null,
        `Timestamp: ${timestamp}`,
      ]
        .filter(Boolean)
        .join("\n");

      const infoMessage = {
        role: "user" as const,
        content: lines,
        timestamp: Date.now(),
      };

      return [infoMessage, ...messages];
    });
  };
}
