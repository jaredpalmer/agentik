import type { AgentEvent, TextContent } from "@agentik/agent";
import {
  type ClientMessage,
  type ServerMessage,
  type ToolRequestMessage,
  parseServerMessage,
  serializeClientMessage,
} from "./protocol.js";

// ============================================================================
// Types
// ============================================================================

export type BridgeClientState = "disconnected" | "connecting" | "connected" | "ready";

export type ToolHandler = (
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>
) => Promise<{ content: TextContent[]; isError: boolean }>;

export interface BridgeClientOptions {
  url: string;
  apiKey: string;
  provider?: string;
  model?: string;
  appType?: "excel" | "powerpoint" | "outlook";
  /** Max reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  reconnectBaseDelay?: number;
}

export interface BridgeClientEvents {
  stateChange: (state: BridgeClientState) => void;
  sessionReady: (sessionId: string) => void;
  agentEvent: (event: AgentEvent) => void;
  toolRequest: (request: ToolRequestMessage) => void;
  error: (code: string, message: string) => void;
}

type EventKey = keyof BridgeClientEvents;

// ============================================================================
// BridgeClient
// ============================================================================

export class BridgeClient {
  private ws: WebSocket | null = null;
  private _state: BridgeClientState = "disconnected";
  private _sessionId: string | null = null;
  private options: BridgeClientOptions;
  private listeners = new Map<EventKey, Set<(...args: unknown[]) => void>>();
  private toolHandlers = new Map<string, ToolHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: BridgeClientOptions) {
    this.options = options;
  }

  get state(): BridgeClientState {
    return this._state;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  // --------------------------------------------------------------------------
  // Event Emitter
  // --------------------------------------------------------------------------

  on<K extends EventKey>(event: K, handler: BridgeClientEvents[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handler_ = handler as (...args: unknown[]) => void;
    this.listeners.get(event)!.add(handler_);
    return () => {
      this.listeners.get(event)?.delete(handler_);
    };
  }

  private emit<K extends EventKey>(event: K, ...args: Parameters<BridgeClientEvents[K]>): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`BridgeClient event handler error (${event}):`, err);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Tool Handler Registration
  // --------------------------------------------------------------------------

  registerToolHandler(toolName: string, handler: ToolHandler): () => void {
    this.toolHandlers.set(toolName, handler);
    return () => {
      this.toolHandlers.delete(toolName);
    };
  }

  // --------------------------------------------------------------------------
  // Connection
  // --------------------------------------------------------------------------

  connect(): void {
    if (this._state === "connecting" || this._state === "ready") return;

    this.setState("connecting");
    this.abortController = new AbortController();

    const ws = new WebSocket(this.options.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.send({
        type: "init",
        apiKey: this.options.apiKey,
        provider: this.options.provider,
        model: this.options.model,
        appType: this.options.appType,
      });
    };

    ws.onmessage = (event) => {
      const msg = parseServerMessage(typeof event.data === "string" ? event.data : "");
      if (!msg) return;
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      this._sessionId = null;
      this.setState("disconnected");
      this.maybeReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = Infinity; // prevent reconnection
    this.ws?.close();
    this.ws = null;
    this._sessionId = null;
    this.setState("disconnected");
  }

  // --------------------------------------------------------------------------
  // Sending
  // --------------------------------------------------------------------------

  sendPrompt(content: string): void {
    this.send({ type: "prompt", content });
  }

  sendSteer(content: string): void {
    this.send({ type: "steer", content });
  }

  sendAbort(): void {
    this.send({ type: "abort" });
  }

  sendToolResult(toolCallId: string, content: TextContent[], isError: boolean): void {
    this.send({ type: "tool_result", toolCallId, content, isError });
  }

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("BridgeClient: cannot send, WebSocket not open");
      return;
    }
    this.ws.send(serializeClientMessage(msg));
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "session_ready":
        this._sessionId = msg.sessionId;
        this.setState("ready");
        this.emit("sessionReady", msg.sessionId);
        break;

      case "agent_event":
        this.emit("agentEvent", msg.event);
        break;

      case "tool_request":
        this.emit("toolRequest", msg);
        void this.handleToolRequest(msg);
        break;

      case "error":
        this.emit("error", msg.code, msg.message);
        break;
    }
  }

  private async handleToolRequest(request: ToolRequestMessage): Promise<void> {
    const handler = this.toolHandlers.get(request.toolName);
    if (!handler) {
      this.sendToolResult(
        request.toolCallId,
        [{ type: "text", text: `No handler registered for tool: ${request.toolName}` }],
        true
      );
      return;
    }

    try {
      const result = await handler(request.toolCallId, request.toolName, request.params);
      this.sendToolResult(request.toolCallId, result.content, result.isError);
    } catch (err) {
      this.sendToolResult(
        request.toolCallId,
        [
          {
            type: "text",
            text: `Tool handler error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        true
      );
    }
  }

  // --------------------------------------------------------------------------
  // Reconnection
  // --------------------------------------------------------------------------

  private maybeReconnect(): void {
    const maxAttempts = this.options.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= maxAttempts) return;

    const baseDelay = this.options.reconnectBaseDelay ?? 1000;
    const delay = baseDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  private setState(state: BridgeClientState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit("stateChange", state);
  }
}
