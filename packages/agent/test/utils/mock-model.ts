/**
 * Mock LanguageModelV3 for testing the agent loop without hitting a real LLM.
 */
import type { LanguageModel } from "ai";

type StreamPart =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  | { type: "finish"; finishReason: string; usage: MockUsage }
  | { type: "stream-start"; warnings: [] };

interface MockUsage {
  inputTokens: { total: number; noCache: undefined; cacheRead: undefined; cacheWrite: undefined };
  outputTokens: { total: number; text: undefined; reasoning: undefined };
}

function createMockUsage(input = 10, output = 20): MockUsage {
  return {
    inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: undefined, reasoning: undefined },
  };
}

export interface MockResponse {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  finishReason?: string;
}

/**
 * Create a mock LanguageModel that returns predetermined responses.
 * Responses are consumed in order - each call to doStream pops the first response.
 */
export function createMockModel(responses: MockResponse[]): LanguageModel {
  let callIndex = 0;

  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},

    doGenerate() {
      throw new Error("doGenerate not implemented in mock");
    },

    doStream() {
      const response = responses[callIndex++];
      if (!response) {
        throw new Error("No more mock responses available");
      }

      const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];

      if (response.text) {
        const id = `text-${callIndex}`;
        parts.push({ type: "text-start", id });
        parts.push({ type: "text-delta", id, delta: response.text });
        parts.push({ type: "text-end", id });
      }

      if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          const jsonStr = JSON.stringify(tc.args);
          parts.push({
            type: "tool-input-start",
            id: tc.id,
            toolName: tc.name,
          });
          parts.push({
            type: "tool-input-delta",
            id: tc.id,
            delta: jsonStr,
          });
          parts.push({ type: "tool-input-end", id: tc.id });
          parts.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            input: jsonStr,
          });
        }
      }

      const finishReason = response.finishReason ?? (response.toolCalls ? "tool-calls" : "stop");
      parts.push({
        type: "finish",
        finishReason,
        usage: createMockUsage(),
      });

      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part);
          }
          controller.close();
        },
      });

      return Promise.resolve({ stream });
    },
  } as unknown as LanguageModel;
}
