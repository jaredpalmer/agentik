import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { type PendingToolCall, createRemoteTool, resolveToolCall } from "../src/remote-tool.js";

describe("createRemoteTool", () => {
  const definition = {
    name: "test_tool",
    label: "Test Tool",
    description: "A test tool",
    parameters: z.object({ input: z.string() }),
  };

  it("returns a valid AgentTool", () => {
    const pendingTools = new Map<string, PendingToolCall>();
    const tool = createRemoteTool(definition, () => {}, pendingTools);

    expect(tool.name).toBe("test_tool");
    expect(tool.label).toBe("Test Tool");
    expect(tool.description).toBe("A test tool");
    expect(typeof tool.execute).toBe("function");
  });

  it("sends tool_request and resolves on tool_result", async () => {
    const pendingTools = new Map<string, PendingToolCall>();
    const sent: Array<{ toolCallId: string; toolName: string; params: unknown }> = [];

    const tool = createRemoteTool(
      definition,
      (toolCallId, toolName, params) => {
        sent.push({ toolCallId, toolName, params });
      },
      pendingTools
    );

    const resultPromise = tool.execute("call-1", { input: "hello" });

    expect(sent).toHaveLength(1);
    expect(sent[0].toolCallId).toBe("call-1");
    expect(sent[0].toolName).toBe("test_tool");

    const resolved = resolveToolCall(
      pendingTools,
      "call-1",
      [{ type: "text", text: "result" }],
      false
    );
    expect(resolved).toBe(true);

    const result = await resultPromise;
    expect(result.content).toEqual([{ type: "text", text: "result" }]);
  });

  it("rejects on timeout", async () => {
    const pendingTools = new Map<string, PendingToolCall>();
    const tool = createRemoteTool(definition, () => {}, pendingTools, 50);

    try {
      await tool.execute("call-2", { input: "hello" });
      throw new Error("Expected rejection");
    } catch (err) {
      expect((err as Error).message).toContain("timed out");
    }
  });

  it("rejects on abort signal", async () => {
    const pendingTools = new Map<string, PendingToolCall>();
    const tool = createRemoteTool(definition, () => {}, pendingTools);

    const controller = new AbortController();
    const resultPromise = tool.execute("call-3", { input: "hello" }, controller.signal);

    controller.abort();

    try {
      await resultPromise;
      throw new Error("Expected rejection");
    } catch (err) {
      expect((err as Error).message).toContain("aborted");
    }
  });

  it("resolveToolCall returns false for unknown id", () => {
    const pendingTools = new Map<string, PendingToolCall>();
    const resolved = resolveToolCall(pendingTools, "unknown", [{ type: "text", text: "x" }], false);
    expect(resolved).toBe(false);
  });
});
