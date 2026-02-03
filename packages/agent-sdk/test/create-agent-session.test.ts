import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import { createAgentSession } from "../src/create-agent-session";

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

describe("createAgentSession", () => {
  it("creates a session and records messages", async () => {
    const entries: Array<{ id: string }> = [];
    const store = {
      async load() {
        return { version: 1, entries: [] };
      },
      async append(entry: { id: string }) {
        entries.push(entry);
      },
    };

    const { session } = await createAgentSession({
      model: createMockModel("Hello"),
      sessionStore: store,
    });

    await session.runtime.prompt("Hi");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});
