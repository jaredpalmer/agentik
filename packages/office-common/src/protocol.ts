import type { AgentEvent, TextContent } from "@agentik/agent";

// ============================================================================
// Client → Server Messages
// ============================================================================

export interface InitMessage {
  type: "init";
  apiKey?: string;
  provider?: string;
  model?: string;
  appType?: "excel" | "powerpoint" | "outlook";
}

export interface PromptMessage {
  type: "prompt";
  content: string;
}

export interface SteerMessage {
  type: "steer";
  content: string;
}

export interface AbortMessage {
  type: "abort";
}

export interface ToolResultClientMessage {
  type: "tool_result";
  toolCallId: string;
  content: TextContent[];
  isError: boolean;
}

export type ClientMessage =
  | InitMessage
  | PromptMessage
  | SteerMessage
  | AbortMessage
  | ToolResultClientMessage;

// ============================================================================
// Server → Client Messages
// ============================================================================

export interface SessionReadyMessage {
  type: "session_ready";
  sessionId: string;
}

export interface AgentEventMessage {
  type: "agent_event";
  event: SerializedAgentEvent;
}

export interface ToolRequestMessage {
  type: "tool_request";
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | SessionReadyMessage
  | AgentEventMessage
  | ToolRequestMessage
  | ErrorMessage;

// ============================================================================
// Serialized Agent Event
// ============================================================================

/**
 * Agent events serialized for WebSocket transport.
 * Same structure as AgentEvent but JSON-safe (no Sets, class instances, etc.)
 */
export type SerializedAgentEvent = AgentEvent;

// ============================================================================
// Helpers
// ============================================================================

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data) as ClientMessage;
    if (typeof parsed !== "object" || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(data) as ServerMessage;
    if (typeof parsed !== "object" || !parsed.type) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Error codes for ErrorMessage */
export const ErrorCode = {
  INVALID_MESSAGE: "INVALID_MESSAGE",
  NOT_INITIALIZED: "NOT_INITIALIZED",
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  INVALID_API_KEY: "INVALID_API_KEY",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  TOOL_ERROR: "TOOL_ERROR",
  AGENT_ERROR: "AGENT_ERROR",
  SESSION_ERROR: "SESSION_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
