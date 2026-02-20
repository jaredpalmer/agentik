import { appendFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import type { AgentToolDefinition } from "@jaredpalmer/agentik";
import type { AgentikSettings } from "./repo-scaffold";

export type CliRunMode = "interactive" | "print";

export function isDeniedPath(path: string, denyPatterns: string[]): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");

  return denyPatterns.some((pattern) => {
    if (pattern === "**/.env") {
      return normalized === ".env" || normalized.endsWith("/.env");
    }
    if (pattern === "**/.env.*") {
      return normalized.startsWith(".env.") || normalized.includes("/.env.");
    }
    if (pattern === "**/secrets/**") {
      return (
        normalized === "secrets" ||
        normalized.startsWith("secrets/") ||
        normalized.includes("/secrets/")
      );
    }
    if (pattern === "**/*.pem") {
      return normalized.endsWith(".pem");
    }
    if (pattern === "**/*.key") {
      return normalized.endsWith(".key");
    }
    return false;
  });
}

export type SessionLogger = {
  log: (event: unknown) => Promise<void>;
  path: string;
};

export async function createSessionLogger(options: {
  cwd: string;
  settings: AgentikSettings;
}): Promise<SessionLogger | undefined> {
  if (!options.settings.sessions.persist) {
    return undefined;
  }

  const sessionDir = resolve(options.cwd, options.settings.sessions.dir);
  await mkdir(sessionDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const path = resolve(sessionDir, `${timestamp}.jsonl`);

  return {
    path,
    log: async (event) => {
      await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

export function withPolicyGuards(options: {
  tools: AgentToolDefinition[];
  settings: AgentikSettings;
  mode: CliRunMode;
  sessionLogger?: SessionLogger;
}): AgentToolDefinition[] {
  return options.tools.map((tool) => {
    if (!tool.execute) {
      return tool;
    }

    const wrapped: AgentToolDefinition = {
      ...tool,
      execute: async (input, runtimeOptions) => {
        await options.sessionLogger?.log({
          type: "tool_call_start",
          toolName: tool.name,
          input,
          timestamp: new Date().toISOString(),
        });

        const maybePath = getPathFromToolInput(tool.name, input as Record<string, unknown>);
        if (maybePath && isDeniedPath(maybePath, options.settings.policy.denyPaths)) {
          const message = `Access denied by policy for path: ${maybePath}`;
          await options.sessionLogger?.log({
            type: "tool_call_end",
            toolName: tool.name,
            isError: true,
            error: message,
            timestamp: new Date().toISOString(),
          });
          throw new Error(message);
        }

        if (requiresApproval(tool.name, options.settings)) {
          if (options.mode === "print") {
            const message = `Tool '${tool.name}' requires approval and is not allowed in --print mode.`;
            await options.sessionLogger?.log({
              type: "tool_call_end",
              toolName: tool.name,
              isError: true,
              error: message,
              timestamp: new Date().toISOString(),
            });
            throw new Error(message);
          }

          const approved = await askForApproval(tool.name, input);
          if (!approved) {
            const message = `Tool '${tool.name}' denied by user.`;
            await options.sessionLogger?.log({
              type: "tool_call_end",
              toolName: tool.name,
              isError: true,
              error: message,
              timestamp: new Date().toISOString(),
            });
            throw new Error(message);
          }
        }

        try {
          const result = tool.execute(input, runtimeOptions);
          if (isAsyncIterable(result)) {
            throw new Error(
              `Tool '${tool.name}' streaming output is not supported with policy guards.`
            );
          }

          const resolved = await result;
          await options.sessionLogger?.log({
            type: "tool_call_end",
            toolName: tool.name,
            isError: false,
            result: resolved,
            timestamp: new Date().toISOString(),
          });
          return resolved;
        } catch (error) {
          await options.sessionLogger?.log({
            type: "tool_call_end",
            toolName: tool.name,
            isError: true,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
    };

    return wrapped;
  });
}

function getPathFromToolInput(
  toolName: string,
  input: Record<string, unknown>
): string | undefined {
  if (toolName === "read" || toolName === "write" || toolName === "edit" || toolName === "update") {
    return typeof input.path === "string" ? input.path : undefined;
  }
  return undefined;
}

function requiresApproval(toolName: string, settings: AgentikSettings): boolean {
  if (toolName === "write") {
    return settings.policy.requireApproval.write;
  }
  if (toolName === "edit") {
    return settings.policy.requireApproval.edit;
  }
  if (toolName === "bash") {
    return settings.policy.requireApproval.bash;
  }
  return false;
}

async function askForApproval(toolName: string, input: unknown): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `Approve tool '${toolName}' with input ${JSON.stringify(input)}? [y/N]: `
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in (value as Record<PropertyKey, unknown>)
  );
}
