// Protocol types
export {
  type ClientMessage,
  type ServerMessage,
  type InitMessage,
  type PromptMessage,
  type SteerMessage,
  type AbortMessage,
  type ToolResultClientMessage,
  type SessionReadyMessage,
  type AgentEventMessage,
  type ToolRequestMessage,
  type ErrorMessage,
  type SerializedAgentEvent,
  type ErrorCodeType,
  ErrorCode,
  serializeClientMessage,
  parseClientMessage,
  serializeServerMessage,
  parseServerMessage,
} from "./protocol.js";

// Bridge client
export {
  BridgeClient,
  type BridgeClientOptions,
  type BridgeClientState,
  type BridgeClientEvents,
  type ToolHandler,
} from "./bridge-client.js";

// Re-exported agent types for add-in convenience
export type { TextContent, AgentEvent } from "@agentik/agent";

// Context
export { type OfficeContextInfo } from "./context.js";

// UI components
export { ChatPanel } from "./ui/ChatPanel.js";
export { MessageBubble } from "./ui/MessageBubble.js";
export { SettingsPanel } from "./ui/SettingsPanel.js";
export { ToolCallCard } from "./ui/ToolCallCard.js";
export { StatusBar } from "./ui/StatusBar.js";

// Hooks
export { useBridge } from "./hooks/useBridge.js";
export { useChat } from "./hooks/useChat.js";
