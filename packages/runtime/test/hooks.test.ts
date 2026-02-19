import { describe, expect, it } from "bun:test";
import { HookRunner, type HookConfig, type HookInput, type HookContext } from "../src/hooks";

function makeInput(toolName = "file_read"): HookInput {
  return { toolName, toolInput: { path: "/tmp" }, toolCallId: "call-1" };
}

const emptyContext: HookContext = { messages: [] };

describe("HookRunner", () => {
  describe("PreToolUse", () => {
    it("returns allow by default when no hooks match", async () => {
      const runner = new HookRunner({});
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("allow");
    });

    it("returns allow decision", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "allow",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("allow");
    });

    it("returns deny decision", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: "not allowed",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("not allowed");
    });

    it("deny wins over ask", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "ask",
                },
              }),
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("deny");
    });

    it("ask wins over allow", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "allow",
                },
              }),
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "ask",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("ask");
    });

    it("returns updatedInput from hook", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "allow",
                  updatedInput: { path: "/safe" },
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.updatedInput).toEqual({ path: "/safe" });
    });
  });

  describe("PostToolUse", () => {
    it("collects system messages", async () => {
      const config: HookConfig = {
        PostToolUse: [
          {
            hooks: [
              () => ({ systemMessage: "Remember to be careful" }),
              () => ({ systemMessage: "Check the output" }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPostToolUse(makeInput(), "output", emptyContext);
      expect(result.systemMessages).toEqual(["Remember to be careful", "Check the output"]);
    });

    it("returns empty when no system messages", async () => {
      const config: HookConfig = {
        PostToolUse: [{ hooks: [() => ({})] }],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPostToolUse(makeInput(), "output", emptyContext);
      expect(result.systemMessages).toBeUndefined();
    });
  });

  describe("Stop", () => {
    it("allows stop by default", async () => {
      const runner = new HookRunner({});
      const result = await runner.runStop(emptyContext);
      expect(result.preventStop).toBeUndefined();
    });

    it("prevents stop when hook sets continue", async () => {
      const config: HookConfig = {
        Stop: [{ hooks: [() => ({ continue: true })] }],
      };
      const runner = new HookRunner(config);
      const result = await runner.runStop(emptyContext);
      expect(result.preventStop).toBe(true);
    });
  });

  describe("matcher", () => {
    it("matches tool names with regex", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            matcher: "^file_",
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);

      const denied = await runner.runPreToolUse(makeInput("file_read"), emptyContext);
      expect(denied.decision).toBe("deny");

      const allowed = await runner.runPreToolUse(makeInput("shell_exec"), emptyContext);
      expect(allowed.decision).toBe("allow");
    });

    it("runs hooks without matcher on all tools", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "ask",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      const result = await runner.runPreToolUse(makeInput("anything"), emptyContext);
      expect(result.decision).toBe("ask");
    });

    it("handles invalid regex gracefully", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            matcher: "[invalid",
            hooks: [
              () => ({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                },
              }),
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      // Invalid regex should not match, so decision remains allow
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("allow");
    });
  });

  describe("timeout", () => {
    it("times out slow hooks", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            timeout: 10,
            hooks: [
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 500));
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny" as const,
                  },
                };
              },
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      // Should not throw, error is caught internally; decision defaults to allow
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("allow");
    });
  });

  describe("error handling", () => {
    it("catches errors in hook callbacks", async () => {
      const config: HookConfig = {
        PreToolUse: [
          {
            hooks: [
              () => {
                throw new Error("boom");
              },
            ],
          },
        ],
      };
      const runner = new HookRunner(config);
      // Should not throw, error is caught internally
      const result = await runner.runPreToolUse(makeInput(), emptyContext);
      expect(result.decision).toBe("allow");
    });
  });

  describe("SessionStart / SessionEnd", () => {
    it("runs session hooks without error", async () => {
      const calls: string[] = [];
      const config: HookConfig = {
        SessionStart: [{ hooks: [() => (calls.push("start"), {})] }],
        SessionEnd: [{ hooks: [() => (calls.push("end"), {})] }],
      };
      const runner = new HookRunner(config);
      await runner.runSessionStart(emptyContext);
      await runner.runSessionEnd(emptyContext);
      expect(calls).toEqual(["start", "end"]);
    });
  });
});
