import { Agent } from "@agentik/agent";
import type { AgentEvent, TextContent } from "@agentik/agent";
import { ErrorCode, type ServerMessage, serializeServerMessage } from "@agentik/office-common";
import { createModelFromKey } from "./auth.js";
import { type PendingToolCall, createRemoteTool, resolveToolCall } from "./remote-tool.js";
import { getSystemPrompt, getToolDefinitions } from "./tool-registry.js";

export class BridgeSession {
  readonly sessionId: string;
  private ws: { send(data: string): void; close(): void };
  private agent: Agent | null = null;
  private pendingTools = new Map<string, PendingToolCall>();
  private unsubscribe: (() => void) | null = null;
  private initialized = false;

  constructor(ws: { send(data: string): void; close(): void }, sessionId: string) {
    this.ws = ws;
    this.sessionId = sessionId;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  init(
    apiKey: string,
    provider?: string,
    model?: string,
    appType?: "excel" | "powerpoint" | "outlook"
  ): void {
    if (this.initialized) {
      this.sendError(ErrorCode.ALREADY_INITIALIZED, "Session already initialized");
      return;
    }

    let languageModel;
    try {
      languageModel = createModelFromKey(apiKey, provider, model);
    } catch (err) {
      this.sendError(
        ErrorCode.INVALID_API_KEY,
        `Failed to create model: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const agent = new Agent();
    agent.setModel(languageModel);

    const resolvedAppType = appType ?? "excel";
    agent.setSystemPrompt(getSystemPrompt(resolvedAppType));

    const toolDefs = getToolDefinitions(resolvedAppType);
    const remoteTools = toolDefs.map((def) =>
      createRemoteTool(
        def,
        (toolCallId, toolName, params) => {
          this.send({
            type: "tool_request",
            toolCallId,
            toolName,
            params,
          });
        },
        this.pendingTools
      )
    );
    agent.setTools(remoteTools);

    this.unsubscribe = agent.subscribe((event: AgentEvent) => {
      this.send({ type: "agent_event", event });
    });

    this.agent = agent;
    this.initialized = true;

    this.send({ type: "session_ready", sessionId: this.sessionId });
  }

  async handlePrompt(content: string): Promise<void> {
    if (!this.agent) {
      this.sendError(ErrorCode.NOT_INITIALIZED, "Session not initialized");
      return;
    }

    try {
      await this.agent.prompt(content);
    } catch (err) {
      this.sendError(
        ErrorCode.AGENT_ERROR,
        `Agent error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  handleSteer(content: string): void {
    if (!this.agent) {
      this.sendError(ErrorCode.NOT_INITIALIZED, "Session not initialized");
      return;
    }

    this.agent.steer({
      role: "user",
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    });
  }

  handleAbort(): void {
    this.agent?.abort();
  }

  handleToolResult(toolCallId: string, content: TextContent[], isError: boolean): void {
    const resolved = resolveToolCall(this.pendingTools, toolCallId, content, isError);
    if (!resolved) {
      this.sendError(ErrorCode.TOOL_ERROR, `No pending tool call for id: ${toolCallId}`);
    }
  }

  dispose(): void {
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;

    for (const [_id, pending] of this.pendingTools) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Session disposed"));
    }
    this.pendingTools.clear();

    this.agent = null;
    this.initialized = false;
  }

  private send(msg: ServerMessage): void {
    try {
      this.ws.send(serializeServerMessage(msg));
    } catch {
      // WebSocket may be closed
    }
  }

  private sendError(code: string, message: string): void {
    this.send({ type: "error", code, message });
  }
}
