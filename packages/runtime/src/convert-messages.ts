import type { ModelMessage, ToolCallPart, ToolResultPart } from "@ai-sdk/provider-utils";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ContentPart,
} from "./messages";
import type { AgentMessage } from "./types";
import { isModelMessage } from "./message-utils";

/**
 * Type guard: is this one of our own message types (vs a ModelMessage or custom message)?
 *
 * Own messages always carry a `timestamp` field and use one of our three role values.
 */
export function isOwnMessage(msg: unknown): msg is Message {
  if (msg == null || typeof msg !== "object") {
    return false;
  }
  const m = msg as Record<string, unknown>;
  return (
    typeof m.timestamp === "number" &&
    (m.role === "user" || m.role === "assistant" || m.role === "toolResult")
  );
}

/**
 * Convert an array of AgentMessage (own Message | ModelMessage | custom) to
 * ModelMessage[] suitable for the AI SDK.
 *
 * - UserMessage → `{ role: "user", content }` (string or parts[])
 * - AssistantMessage → `{ role: "assistant", content }` (text + tool-call parts; thinking is stripped)
 * - ToolResultMessage → `{ role: "tool", content }` (tool-result parts)
 * - ModelMessage → passed through unchanged
 * - Anything else → filtered out
 */
export function convertToModelMessages(messages: AgentMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (isOwnMessage(msg)) {
      const converted = convertOwnMessage(msg);
      if (converted) {
        result.push(converted);
      }
    } else if (isModelMessage(msg)) {
      result.push(msg);
    }
    // custom / unknown messages are filtered out
  }

  return result;
}

function convertOwnMessage(msg: Message): ModelMessage | undefined {
  switch (msg.role) {
    case "user":
      return convertUserMessage(msg);
    case "assistant":
      return convertAssistantMessage(msg);
    case "toolResult":
      return convertToolResultMessage(msg);
  }
}

function convertUserMessage(msg: UserMessage): ModelMessage {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }

  const parts = msg.content.map((c: ContentPart) => {
    if (c.type === "text") {
      return { type: "text" as const, text: c.text };
    }
    // ImageContent → file part with base64 data
    return {
      type: "file" as const,
      data: c.data,
      mediaType: c.mimeType,
    };
  });

  return { role: "user", content: parts };
}

function convertAssistantMessage(msg: AssistantMessage): ModelMessage | undefined {
  const parts: ({ type: "text"; text: string } | ToolCallPart)[] = [];

  for (const c of msg.content) {
    if (c.type === "text") {
      parts.push({ type: "text", text: c.text });
    } else if (c.type === "toolCall") {
      parts.push({
        type: "tool-call",
        toolCallId: c.id,
        toolName: c.name,
        input: c.arguments,
      });
    }
    // ThinkingContent is not sent back to the LLM
  }

  if (parts.length === 0) {
    return undefined;
  }

  return { role: "assistant", content: parts };
}

function convertToolResultMessage(msg: ToolResultMessage): ModelMessage {
  const toolParts: ToolResultPart[] = [
    {
      type: "tool-result",
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      output: {
        type: "text",
        value: msg.content
          .map((c) => (c.type === "text" ? c.text : `[image: ${c.mimeType}]`))
          .join("\n"),
      },
    },
  ];

  return { role: "tool", content: toolParts };
}
