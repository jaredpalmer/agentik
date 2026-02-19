export type TextContent = { type: "text"; text: string };
export type ThinkingContent = { type: "thinking"; thinking: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };
export type ToolCall = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
export type ContentPart = TextContent | ImageContent;

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type UserMessage = {
  role: "user";
  content: string | ContentPart[];
  timestamp: number;
};

export type AssistantMessage = {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
};

export type ToolResultMessage<TDetails = unknown> = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentPart[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
};

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
