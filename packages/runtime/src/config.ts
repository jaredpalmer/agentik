import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CONFIG_DIR_NAME = ".agentik";
export const ENV_AGENT_DIR = "AGENTIK_AGENT_DIR";
export const ENV_SESSION_DIR = "AGENTIK_SESSION_DIR";

function expandHomePath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function getAgentDir(): string {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    return expandHomePath(envDir);
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function encodeCwd(cwd: string): string {
  const normalized = resolve(cwd);
  return Buffer.from(normalized).toString("base64url");
}

export function getSessionsDir(cwd?: string): string {
  const baseDir = process.env[ENV_SESSION_DIR]
    ? expandHomePath(process.env[ENV_SESSION_DIR])
    : join(getAgentDir(), "sessions");

  if (!cwd) {
    return baseDir;
  }

  return join(baseDir, encodeCwd(cwd));
}
