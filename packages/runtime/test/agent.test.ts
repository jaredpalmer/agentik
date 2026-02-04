import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import { Agent } from "../src/agent";
import { InMemorySessionStore } from "../src/session-store";

function createMockModel(responseText: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        {
          type: "response-metadata",
          id: "id-0",
          modelId: "mock-model-id",
          timestamp: new Date(0),
        },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: responseText },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: 1,
              text: 1,
              reasoning: undefined,
            },
          },
        },
      ]),
    }),
  });
}

describe("Agent", () => {
  it("auto-records messages when a session store is provided", async () => {
    const store = new InMemorySessionStore();
    const agent = new Agent({
      model: createMockModel("Hello"),
      sessionStore: store,
    });

    await agent.prompt("Hi");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tree = await store.load();
    expect(tree.entries.length).toBeGreaterThanOrEqual(2);
    expect(tree.entries[1]?.parentId).toBe(tree.entries[0]?.id);
  });

  it("stops recording when stopRecording is called", async () => {
    const store = new InMemorySessionStore();
    const agent = new Agent({
      model: createMockModel("Hello"),
      sessionStore: store,
    });

    agent.stopRecording();
    await agent.prompt("Hi");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tree = await store.load();
    expect(tree.entries.length).toBe(0);
  });

  it("loads an empty session tree when no store is configured", async () => {
    const agent = new Agent({
      model: createMockModel("Hello"),
    });

    const tree = await agent.loadSession();
    expect(tree.entries.length).toBe(0);
  });
});
