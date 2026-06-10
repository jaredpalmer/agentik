import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import { Agent } from "../src/agent";
import { SharedMemoryStore, SubagentRegistry, createSubagentTool } from "../src/subagents";
import type { AgentEvent, AgentToolDefinition } from "../src/types";

function createBaseOptions() {
  return {
    model: new MockLanguageModelV3(),
    tools: [],
  } as const;
}

describe("subagents", () => {
  it("manages shared memory", () => {
    const store = new SharedMemoryStore();
    store.set("key", "value");
    expect(store.get("key")).toBe("value");

    store.delete("key");
    expect(store.get("key")).toBeUndefined();
    expect(store.snapshot()).toEqual({});
  });

  it("registers and removes subagents", () => {
    const registry = new SubagentRegistry();
    const spec = registry.register({ id: "alpha", config: createBaseOptions() });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("alpha")).toBe(spec);
    expect(registry.remove("alpha")).toBe(true);
    expect(registry.get("alpha")).toBeUndefined();
  });

  it("emits subagent lifecycle events when a subagent tool runs", async () => {
    const finishUsage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };

    const subagentModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] } as const,
          { type: "text-start", id: "text-1" } as const,
          { type: "text-delta", id: "text-1", delta: "Subagent says hi." } as const,
          { type: "text-end", id: "text-1" } as const,
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: finishUsage,
          } as const,
        ]),
      }),
    });

    let call = 0;
    const parentModel = new MockLanguageModelV3({
      doStream: async () => {
        call += 1;
        const parts =
          call === 1
            ? [
                { type: "stream-start", warnings: [] } as const,
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "explorer",
                  input: JSON.stringify({ prompt: "Go explore." }),
                } as const,
                {
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool-calls" },
                  usage: finishUsage,
                } as const,
              ]
            : [
                { type: "stream-start", warnings: [] } as const,
                { type: "text-start", id: "text-1" } as const,
                { type: "text-delta", id: "text-1", delta: "Done." } as const,
                { type: "text-end", id: "text-1" } as const,
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: finishUsage,
                } as const,
              ];
        return { stream: convertArrayToReadableStream(parts) };
      },
    });

    const registry = new SubagentRegistry();
    registry.register({ id: "explorer", config: { model: subagentModel } });

    const agent = new Agent({
      model: parentModel,
      tools: [createSubagentTool({ id: "explorer", registry })] as AgentToolDefinition[],
    });

    const events: AgentEvent[] = [];
    agent.subscribe((event) => events.push(event));

    await agent.prompt("Delegate to explorer.");

    const start = events.find((e) => e.type === "subagent_start");
    const updates = events.filter((e) => e.type === "subagent_update");
    const end = events.find((e) => e.type === "subagent_end");

    expect(start).toMatchObject({ subagentId: "explorer", prompt: "Go explore." });
    expect(updates.length).toBeGreaterThan(0);
    expect(end).toMatchObject({
      subagentId: "explorer",
      output: "Subagent says hi.",
      isError: false,
    });
  });
});
