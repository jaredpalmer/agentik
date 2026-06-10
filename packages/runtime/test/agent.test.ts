import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { jsonSchema } from "@ai-sdk/provider-utils";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import { Agent } from "../src/agent";
import { InMemorySessionStore } from "../src/session-store";
import type { AgentToolDefinition } from "../src/types";

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

  it("does not let a throwing listener break the run", async () => {
    const agent = new Agent({
      model: createMockModel("Hello"),
    });
    agent.subscribe(() => {
      throw new Error("listener boom");
    });

    await agent.prompt("Hi");

    expect(agent.state.error).toBeUndefined();
    const assistant = agent.state.messages.filter(
      (m) => typeof m === "object" && m != null && "role" in m && m.role === "assistant"
    );
    expect(assistant.length).toBe(1);
  });

  it("emits an error event when the run fails", async () => {
    const agent = new Agent({
      model: createMockModel("Hello"),
      transformContext: async () => {
        throw new Error("transform boom");
      },
    });

    const errors: unknown[] = [];
    agent.subscribe((event) => {
      if (event.type === "error") {
        errors.push(event.error);
      }
    });

    await agent.prompt("Hi");

    expect(agent.state.error).toBe("transform boom");
    expect(errors.length).toBe(1);
  });

  it("respects an already-aborted abort signal", async () => {
    const agent = new Agent({
      model: createMockModel("Hello"),
    });
    const controller = new AbortController();
    controller.abort();

    await agent.prompt("Hi", { abortSignal: controller.signal });

    const assistant = agent.state.messages.filter(
      (m) => typeof m === "object" && m != null && "role" in m && m.role === "assistant"
    );
    expect(assistant.length).toBe(0);
  });

  it("passes sessionId to tool-use hooks", async () => {
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        call += 1;
        const parts =
          call === 1
            ? [
                { type: "stream-start", warnings: [] } as const,
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "echo",
                  input: JSON.stringify({ text: "hi" }),
                } as const,
                {
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool-calls" },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: { total: 1, text: 1, reasoning: undefined },
                  },
                } as const,
              ]
            : [
                { type: "stream-start", warnings: [] } as const,
                { type: "text-start", id: "text-1" } as const,
                { type: "text-delta", id: "text-1", delta: "done" } as const,
                { type: "text-end", id: "text-1" } as const,
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
                    outputTokens: { total: 1, text: 1, reasoning: undefined },
                  },
                } as const,
              ];
        return { stream: convertArrayToReadableStream(parts) };
      },
    });

    const seenSessionIds: Array<string | undefined> = [];
    const agent = new Agent({
      model,
      sessionId: "session-123",
      tools: [
        {
          name: "echo",
          description: "Echo text back.",
          inputSchema: jsonSchema<{ text: string }>({
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          }),
          execute: async ({ text }) => ({ output: text }),
        } as AgentToolDefinition,
      ],
      hooks: {
        PreToolUse: [
          {
            hooks: [
              (_input, _toolUseId, context) => {
                seenSessionIds.push(context.sessionId);
                return {};
              },
            ],
          },
        ],
      },
    });

    await agent.prompt("Use the echo tool.");

    expect(seenSessionIds).toEqual(["session-123"]);
  });

  it("sends dynamic auth headers resolved via getApiKey", async () => {
    let captured: Record<string, string | undefined> | undefined;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        captured = options.headers;
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "ok" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ]),
        };
      },
    });

    const agent = new Agent({
      model,
      getApiKey: async () => "secret-token",
    });

    await agent.prompt("Hi");

    expect(captured?.Authorization ?? captured?.authorization).toBe("Bearer secret-token");
  });
});
