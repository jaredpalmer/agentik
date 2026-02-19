import { describe, expect, it } from "bun:test";
import { isOwnMessage, convertToModelMessages } from "../src/convert-messages";
import type { UserMessage, AssistantMessage, ToolResultMessage } from "../src/messages";
import type { ModelMessage } from "@ai-sdk/provider-utils";

describe("isOwnMessage", () => {
  it("returns false for null/undefined/primitives", () => {
    expect(isOwnMessage(null)).toBe(false);
    expect(isOwnMessage(undefined)).toBe(false);
    expect(isOwnMessage("hello")).toBe(false);
    expect(isOwnMessage(42)).toBe(false);
  });

  it("returns false for objects without timestamp", () => {
    expect(isOwnMessage({ role: "user" })).toBe(false);
  });

  it("returns false for objects with wrong role", () => {
    expect(isOwnMessage({ role: "system", timestamp: 1 })).toBe(false);
  });

  it("returns true for UserMessage", () => {
    const msg: UserMessage = { role: "user", content: "hi", timestamp: Date.now() };
    expect(isOwnMessage(msg)).toBe(true);
  });

  it("returns true for AssistantMessage", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      model: "gpt-4",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    expect(isOwnMessage(msg)).toBe(true);
  });

  it("returns true for ToolResultMessage", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    };
    expect(isOwnMessage(msg)).toBe(true);
  });
});

describe("convertToModelMessages", () => {
  it("converts UserMessage with string content", () => {
    const msg: UserMessage = { role: "user", content: "hello", timestamp: Date.now() };
    const result = convertToModelMessages([msg]);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts UserMessage with text parts", () => {
    const msg: UserMessage = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });

  it("converts ImageContent to file part", () => {
    const msg: UserMessage = {
      role: "user",
      content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    expect(result).toEqual([
      {
        role: "user",
        content: [{ type: "file", data: "base64data", mediaType: "image/png" }],
      },
    ]);
  });

  it("converts AssistantMessage with text and tool calls", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "I will read the file" },
        { type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/tmp" } },
      ],
      model: "gpt-4",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");

    const content = (result[0] as { role: string; content: unknown[] }).content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "I will read the file" });
    expect(content[1]).toEqual({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "read",
      input: { path: "/tmp" },
    });
  });

  it("strips ThinkingContent from AssistantMessage", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me think..." },
        { type: "text", text: "answer" },
      ],
      model: "gpt-4",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    const content = (result[0] as { role: string; content: unknown[] }).content;
    expect(content).toEqual([{ type: "text", text: "answer" }]);
  });

  it("filters out AssistantMessage with only thinking content", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "hmm" }],
      model: "gpt-4",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    expect(result).toHaveLength(0);
  });

  it("converts ToolResultMessage", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: Date.now(),
    };
    const result = convertToModelMessages([msg]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");

    const content = (result[0] as { role: string; content: unknown[] }).content;
    expect(content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "tc-1",
      toolName: "read",
    });
  });

  it("passes through ModelMessage unchanged", () => {
    const modelMsg: ModelMessage = { role: "user", content: "direct model message" };
    const result = convertToModelMessages([modelMsg]);
    expect(result).toEqual([modelMsg]);
  });

  it("handles mixed own + ModelMessage input", () => {
    const ownMsg: UserMessage = { role: "user", content: "own", timestamp: Date.now() };
    const modelMsg: ModelMessage = { role: "assistant", content: "model" };
    const result = convertToModelMessages([ownMsg, modelMsg]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "own" });
    expect(result[1]).toBe(modelMsg);
  });

  it("filters out unknown message types", () => {
    const unknown = { kind: "custom", data: 123 } as never;
    const result = convertToModelMessages([unknown]);
    expect(result).toHaveLength(0);
  });
});
