import { describe, expect, it } from "bun:test";
import type { AgentToolDefinition } from "@jaredpalmer/agentik";
import { isDeniedPath, withPolicyGuards } from "../src/policy";
import type { AgentikSettings } from "../src/repo-scaffold";

const settings: AgentikSettings = {
  context: {
    agentFile: "AGENTIK.md",
    projectStateFile: "PROJECT_STATE.md",
    rulesGlob: ".agentik/rules/**/*.md",
  },
  policy: {
    denyPaths: ["**/.env", "**/.env.*", "**/secrets/**", "**/*.pem", "**/*.key"],
    requireApproval: {
      write: true,
      edit: true,
      bash: true,
    },
  },
  sessions: {
    persist: false,
    dir: ".agentik/sessions",
  },
  qualityGates: {
    requireTestsPassing: false,
  },
};

describe("policy guards", () => {
  it("blocks deny-listed .env paths", () => {
    expect(isDeniedPath(".env", settings.policy.denyPaths)).toBe(true);
    expect(isDeniedPath("config/.env.local", settings.policy.denyPaths)).toBe(true);
    expect(isDeniedPath("src/index.ts", settings.policy.denyPaths)).toBe(false);
  });

  it("blocks approval-required tools in print mode", async () => {
    const writeTool: AgentToolDefinition<{ path: string; content: string }, string> = {
      name: "write",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      } as never,
      execute: async () => ({ output: "ok" }),
    };

    const [guarded] = withPolicyGuards({
      tools: [writeTool],
      settings,
      mode: "print",
    });

    expect(guarded.execute).toBeDefined();

    try {
      await Promise.resolve(
        guarded.execute?.({ path: "README.md", content: "x" }, { toolCallId: "1", messages: [] })
      );
      throw new Error("Expected guarded tool execution to throw");
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "requires approval and is not allowed in --print mode"
      );
    }
  });
});
