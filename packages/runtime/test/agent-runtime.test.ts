import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import { AgentRuntime } from "../src/agent-runtime";

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

describe("AgentRuntime", () => {
  it("emits events and updates state during streaming", async () => {
    const events: string[] = [];
    const model = createMockModel("Hello");
    const runtime = new AgentRuntime({
      model,
      onEvent: (event) => events.push(event.type),
    });

    await runtime.prompt("Hi");

    expect(events).toContain("agent_start");
    expect(events).toContain("agent_end");
    expect(events).toContain("message_start");
    expect(events).toContain("message_update");
    expect(events).toContain("message_end");

    const messages = runtime.state.messages;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const lastMessage = messages[messages.length - 1] as {
      role?: string;
      content?: unknown;
    };
    expect(lastMessage.role).toBe("assistant");
    if (typeof lastMessage.content === "string") {
      expect(lastMessage.content).toBe("Hello");
    } else if (Array.isArray(lastMessage.content)) {
      const [first] = lastMessage.content as Array<{ type?: string; text?: string }>;
      expect(first?.type).toBe("text");
      expect(first?.text).toBe("Hello");
    } else {
      throw new Error("Unexpected assistant message content.");
    }
  });
});
