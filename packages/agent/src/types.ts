import type { LanguageModel } from "ai";
import type { z } from "zod";

// ============================================================================
// Content Types
// ============================================================================

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// Usage & Cost Tracking
// ============================================================================

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ============================================================================
// Message Types
// ============================================================================

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ============================================================================
// Custom Messages (extensible via declaration merging)
// ============================================================================

/**
 * Extensible interface for custom app messages.
 * Apps can extend via declaration merging:
 *
 * @example
 * ```typescript
 * declare module "@agentik/agent" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomAgentMessages {}

// eslint-disable-next-line typescript-eslint/no-redundant-type-constituents -- intentional for declaration merging
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// ============================================================================
// Thinking Level
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Custom budget token limits per thinking level.
 * If provided, these override the default budgets.
 */
export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
  xhigh?: number;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}

export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AgentTool<TParams = any, TDetails = any> {
  name: string;
  label: string;
  description: string;
  parameters: z.ZodType<TParams>;
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: z.ZodType;
}

// ============================================================================
// Agent Context
// ============================================================================

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool[];
}

// ============================================================================
// Agent Events
// ============================================================================

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      message: AssistantMessage;
    }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };

// ============================================================================
// Extension Types
// ============================================================================

export type TransformContextHook = (
  messages: AgentMessage[],
  signal?: AbortSignal
) => Promise<AgentMessage[]>;

export type BeforeToolCallHook = (
  toolCall: ToolCall,
  tool: AgentTool
) => Promise<
  | { action: "continue"; toolCall?: ToolCall }
  | { action: "block"; result: AgentToolResult<unknown> }
>;

export type AfterToolResultHook = (
  toolCall: ToolCall,
  result: ToolResultMessage
) => Promise<ToolResultMessage>;

// ============================================================================
// Typed Extension Event Types
// ============================================================================

export interface AgentStartEvent {
  type: "agent_start";
}

export interface AgentEndEvent {
  type: "agent_end";
  messages: AgentMessage[];
}

export interface TurnStartEvent {
  type: "turn_start";
}

export interface TurnEndEvent {
  type: "turn_end";
  message: AgentMessage;
  toolResults: ToolResultMessage[];
}

export interface MessageStartEvent {
  type: "message_start";
  message: AgentMessage;
}

export interface MessageEndEvent {
  type: "message_end";
  message: AgentMessage;
}

export interface ToolExecStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

// ============================================================================
// Input Hook Types
// ============================================================================

export type InputHookResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: ImageContent[] }
  | { action: "handled" };

export type InputHook = (
  text: string,
  images?: ImageContent[]
) => Promise<InputHookResult> | InputHookResult;

// ============================================================================
// Extension API
// ============================================================================

export interface ExtensionAPI {
  readonly state: AgentState;

  // Tool management
  registerTool(tool: AgentTool): () => void;
  unregisterTool(name: string): boolean;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  setActiveTools(names: string[]): void;

  // Existing hooks
  on(event: "transformContext", hook: TransformContextHook): () => void;
  on(event: "beforeToolCall", hook: BeforeToolCallHook): () => void;
  on(event: "afterToolResult", hook: AfterToolResultHook): () => void;

  // Raw event listener (all events)
  on(event: "event", listener: (e: AgentEvent) => void): () => void;

  // Typed event subscriptions
  on(event: "agent_start", handler: (e: AgentStartEvent) => void): () => void;
  on(event: "agent_end", handler: (e: AgentEndEvent) => void): () => void;
  on(event: "turn_start", handler: (e: TurnStartEvent) => void): () => void;
  on(event: "turn_end", handler: (e: TurnEndEvent) => void): () => void;
  on(event: "message_start", handler: (e: MessageStartEvent) => void): () => void;
  on(event: "message_end", handler: (e: MessageEndEvent) => void): () => void;
  on(event: "tool_execution_start", handler: (e: ToolExecStartEvent) => void): () => void;
  on(event: "tool_execution_end", handler: (e: ToolExecEndEvent) => void): () => void;

  // Input hook
  on(event: "input", handler: InputHook): () => void;

  // Message delivery
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp" }
  ): void;

  // Model and thinking
  setModel(model: LanguageModel): void;
  getThinkingLevel(): ThinkingLevel;
  setThinkingLevel(level: ThinkingLevel): void;
}

export type Extension = (api: ExtensionAPI) => void | (() => void);

// ============================================================================
// Agent Loop Config
// ============================================================================

export interface AgentLoopConfig {
  model: LanguageModel;

  /**
   * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
   * Each AgentMessage must be converted to a message the LLM can understand.
   * Messages that cannot be converted (e.g., UI-only) should be filtered out.
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * Optional transform applied to the context before `convertToLlm`.
   * Use for context pruning, injecting external context, etc.
   */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  /**
   * Returns steering messages to inject into the conversation mid-run.
   * Called after each tool execution to check for user interruptions.
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * Returns follow-up messages to process after the agent would otherwise stop.
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /** Thinking/reasoning level */
  reasoning?: ThinkingLevel;

  /** Custom budget token limits per thinking level */
  thinkingBudgets?: ThinkingBudgets;

  /** Max tokens for LLM response */
  maxTokens?: number;

  /** Temperature for LLM response */
  temperature?: number;

  /** Abort signal */
  signal?: AbortSignal;

  /** Provider-specific options passed through to AI SDK */
  providerOptions?: Record<string, unknown>;

  /** Hook called before each tool execution. Can block or modify tool calls. */
  beforeToolCall?: BeforeToolCallHook;

  /** Hook called after each tool execution. Can modify the result. */
  afterToolResult?: AfterToolResultHook;
}

// ============================================================================
// Agent State
// ============================================================================

export interface AgentState {
  systemPrompt: string;
  model: LanguageModel;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  error?: string;
}
