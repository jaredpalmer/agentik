/**
 * Agent class - stateful wrapper around the agent loop.
 * Manages conversation state, event subscriptions, and message queuing.
 */

import type { LanguageModel } from "ai";
import { agentLoop, agentLoopContinue } from "./agent-loop.js";
import type {
  AfterToolResultHook,
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
  BeforeToolCallHook,
  Extension,
  ExtensionAPI,
  ImageContent,
  Message,
  TextContent,
  ThinkingBudgets,
  ThinkingLevel,
  ToolCall,
  ToolResultMessage,
  TransformContextHook,
} from "./types.js";

/**
 * Default convertToLlm: Keep only LLM-compatible messages.
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"
  ) as Message[];
}

export interface AgentOptions {
  initialState?: Partial<AgentState>;

  /**
   * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
   * Default filters to user/assistant/toolResult.
   */
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * Optional transform applied to context before convertToLlm.
   * Use for context pruning, injecting external context, etc.
   */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  /**
   * Steering mode: "all" = send all steering messages at once, "one-at-a-time" = one per turn
   */
  steeringMode?: "all" | "one-at-a-time";

  /**
   * Follow-up mode: "all" = send all follow-up messages at once, "one-at-a-time" = one per turn
   */
  followUpMode?: "all" | "one-at-a-time";

  /** Max tokens for LLM response */
  maxTokens?: number;

  /** Temperature for LLM response */
  temperature?: number;

  /** Provider-specific options passed through to AI SDK */
  providerOptions?: Record<string, unknown>;

  /** Custom thinking budget token limits per level */
  thinkingBudgets?: ThinkingBudgets;
}

export class Agent {
  private _state: AgentState;
  private listeners = new Set<(e: AgentEvent) => void>();
  private abortController?: AbortController;
  private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  private transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private steeringMode: "all" | "one-at-a-time";
  private followUpMode: "all" | "one-at-a-time";
  private runningPrompt?: Promise<void>;
  private resolveRunningPrompt?: () => void;
  private _maxTokens?: number;
  private _temperature?: number;
  private _providerOptions?: Record<string, unknown>;
  private _thinkingBudgets?: ThinkingBudgets;

  // Extension hook storage
  private transformContextHooks: TransformContextHook[] = [];
  private beforeToolCallHooks: BeforeToolCallHook[] = [];
  private afterToolResultHooks: AfterToolResultHook[] = [];
  private extensionCleanups: Array<() => void> = [];

  constructor(opts: AgentOptions = {}) {
    // We must have a model - if none provided, we'll create a placeholder that throws on use
    this._state = {
      systemPrompt: "",
      model: opts.initialState?.model ?? (null as unknown as LanguageModel),
      thinkingLevel: "off",
      tools: [],
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set<string>(),
      error: undefined,
      ...opts.initialState,
    };
    this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
    this.transformContext = opts.transformContext;
    this.steeringMode = opts.steeringMode || "one-at-a-time";
    this.followUpMode = opts.followUpMode || "one-at-a-time";
    this._maxTokens = opts.maxTokens;
    this._temperature = opts.temperature;
    this._providerOptions = opts.providerOptions;
    this._thinkingBudgets = opts.thinkingBudgets;
  }

  get thinkingBudgets(): ThinkingBudgets | undefined {
    return this._thinkingBudgets;
  }

  set thinkingBudgets(budgets: ThinkingBudgets | undefined) {
    this._thinkingBudgets = budgets;
  }

  get state(): AgentState {
    return this._state;
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // State mutators
  setSystemPrompt(v: string): void {
    this._state.systemPrompt = v;
  }

  setModel(m: LanguageModel): void {
    this._state.model = m;
  }

  setThinkingLevel(l: ThinkingLevel): void {
    this._state.thinkingLevel = l;
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.steeringMode = mode;
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.steeringMode;
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.followUpMode = mode;
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.followUpMode;
  }

  setTools(t: AgentTool[]): void {
    this._state.tools = t;
  }

  replaceMessages(ms: AgentMessage[]): void {
    this._state.messages = ms.slice();
  }

  appendMessage(m: AgentMessage): void {
    this._state.messages = [...this._state.messages, m];
  }

  /**
   * Queue a steering message to interrupt the agent mid-run.
   * Delivered after current tool execution, skips remaining tools.
   */
  steer(m: AgentMessage): void {
    this.steeringQueue.push(m);
  }

  /**
   * Queue a follow-up message to be processed after the agent finishes.
   */
  followUp(m: AgentMessage): void {
    this.followUpQueue.push(m);
  }

  clearSteeringQueue(): void {
    this.steeringQueue = [];
  }

  clearFollowUpQueue(): void {
    this.followUpQueue = [];
  }

  clearAllQueues(): void {
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  clearMessages(): void {
    this._state.messages = [];
  }

  abort(): void {
    this.abortController?.abort();
  }

  waitForIdle(): Promise<void> {
    return this.runningPrompt ?? Promise.resolve();
  }

  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamMessage = null;
    this._state.pendingToolCalls = new Set<string>();
    this._state.error = undefined;
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  /**
   * Register an extension. Returns a cleanup function that removes all hooks
   * and tools registered by this extension.
   */
  use(extension: Extension): () => void {
    // Track hooks registered by this extension for cleanup
    const registeredTransformContext: TransformContextHook[] = [];
    const registeredBeforeToolCall: BeforeToolCallHook[] = [];
    const registeredAfterToolResult: AfterToolResultHook[] = [];
    const registeredEventListeners: Array<(e: AgentEvent) => void> = [];
    const registeredToolNames: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const api = {
      get state() {
        return self._state;
      },

      registerTool: (tool: AgentTool): (() => void) => {
        this._state.tools = [...this._state.tools, tool];
        registeredToolNames.push(tool.name);
        return () => this.unregisterTool(tool.name);
      },

      unregisterTool: (name: string): boolean => {
        return this.unregisterTool(name);
      },

      on: ((event: string, hook: unknown): (() => void) => {
        switch (event) {
          case "transformContext": {
            const h = hook as TransformContextHook;
            this.transformContextHooks.push(h);
            registeredTransformContext.push(h);
            return () => {
              this.transformContextHooks = this.transformContextHooks.filter((x) => x !== h);
            };
          }
          case "beforeToolCall": {
            const h = hook as BeforeToolCallHook;
            this.beforeToolCallHooks.push(h);
            registeredBeforeToolCall.push(h);
            return () => {
              this.beforeToolCallHooks = this.beforeToolCallHooks.filter((x) => x !== h);
            };
          }
          case "afterToolResult": {
            const h = hook as AfterToolResultHook;
            this.afterToolResultHooks.push(h);
            registeredAfterToolResult.push(h);
            return () => {
              this.afterToolResultHooks = this.afterToolResultHooks.filter((x) => x !== h);
            };
          }
          case "event": {
            const listener = hook as (e: AgentEvent) => void;
            this.listeners.add(listener);
            registeredEventListeners.push(listener);
            return () => {
              this.listeners.delete(listener);
            };
          }
          default:
            throw new Error(`Unknown event: ${event}`);
        }
      }) as ExtensionAPI["on"],

      steer: (message: AgentMessage): void => {
        this.steer(message);
      },

      followUp: (message: AgentMessage): void => {
        this.followUp(message);
      },
    } as ExtensionAPI;

    const cleanup = extension(api);

    const dispose = () => {
      // Remove all hooks registered by this extension
      for (const h of registeredTransformContext) {
        this.transformContextHooks = this.transformContextHooks.filter((x) => x !== h);
      }
      for (const h of registeredBeforeToolCall) {
        this.beforeToolCallHooks = this.beforeToolCallHooks.filter((x) => x !== h);
      }
      for (const h of registeredAfterToolResult) {
        this.afterToolResultHooks = this.afterToolResultHooks.filter((x) => x !== h);
      }
      for (const listener of registeredEventListeners) {
        this.listeners.delete(listener);
      }
      for (const name of registeredToolNames) {
        this.unregisterTool(name);
      }
      // Call extension's own cleanup if provided
      cleanup?.();
      // Remove this dispose from the list
      this.extensionCleanups = this.extensionCleanups.filter((c) => c !== dispose);
    };

    this.extensionCleanups.push(dispose);
    return dispose;
  }

  registerTool(tool: AgentTool): () => void {
    this._state.tools = [...this._state.tools, tool];
    return () => this.unregisterTool(tool.name);
  }

  unregisterTool(name: string): boolean {
    const before = this._state.tools.length;
    this._state.tools = this._state.tools.filter((t) => t.name !== name);
    return this._state.tools.length < before;
  }

  /** Send a prompt with an AgentMessage */
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[]
  ): Promise<void> {
    if (this._state.isStreaming) {
      throw new Error(
        "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."
      );
    }

    const model = this._state.model;
    if (!model) throw new Error("No model configured");

    let msgs: AgentMessage[];

    if (Array.isArray(input)) {
      msgs = input;
    } else if (typeof input === "string") {
      const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
      if (images && images.length > 0) {
        content.push(...images);
      }
      msgs = [
        {
          role: "user",
          content,
          timestamp: Date.now(),
        },
      ];
    } else {
      msgs = [input];
    }

    await this._runLoop(msgs);
  }

  /** Continue from current context (for retry after overflow) */
  async continue(): Promise<void> {
    if (this._state.isStreaming) {
      throw new Error("Agent is already processing. Wait for completion before continuing.");
    }

    const messages = this._state.messages;
    if (messages.length === 0) {
      throw new Error("No messages to continue from");
    }
    if (messages[messages.length - 1].role === "assistant") {
      throw new Error("Cannot continue from message role: assistant");
    }

    await this._runLoop(undefined);
  }

  private async _runLoop(messages?: AgentMessage[]): Promise<void> {
    const model = this._state.model;
    if (!model) throw new Error("No model configured");

    this.runningPrompt = new Promise<void>((resolve) => {
      this.resolveRunningPrompt = resolve;
    });

    this.abortController = new AbortController();
    this._state.isStreaming = true;
    this._state.streamMessage = null;
    this._state.error = undefined;

    const reasoning = this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel;

    const context: AgentContext = {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools,
    };

    // Build chained transformContext
    let chainedTransformContext = this.transformContext;
    if (this.transformContextHooks.length > 0) {
      const baseTransform = this.transformContext;
      const hooks = [...this.transformContextHooks];
      chainedTransformContext = async (messages: AgentMessage[], signal?: AbortSignal) => {
        let result = baseTransform ? await baseTransform(messages, signal) : messages;
        for (const hook of hooks) {
          result = await hook(result, signal);
        }
        return result;
      };
    }

    // Build chained beforeToolCall
    let chainedBeforeToolCall: BeforeToolCallHook | undefined;
    if (this.beforeToolCallHooks.length > 0) {
      const hooks = [...this.beforeToolCallHooks];
      chainedBeforeToolCall = async (toolCall: ToolCall, tool: AgentTool) => {
        let currentToolCall = toolCall;
        for (const hook of hooks) {
          const hookResult = await hook(currentToolCall, tool);
          if (hookResult.action === "block") {
            return hookResult;
          }
          if (hookResult.toolCall) {
            currentToolCall = hookResult.toolCall;
          }
        }
        return { action: "continue" as const, toolCall: currentToolCall };
      };
    }

    // Build chained afterToolResult
    let chainedAfterToolResult: AfterToolResultHook | undefined;
    if (this.afterToolResultHooks.length > 0) {
      const hooks = [...this.afterToolResultHooks];
      chainedAfterToolResult = async (toolCall: ToolCall, result: ToolResultMessage) => {
        let current = result;
        for (const hook of hooks) {
          current = await hook(toolCall, current);
        }
        return current;
      };
    }

    const config: AgentLoopConfig = {
      model,
      reasoning,
      thinkingBudgets: this._thinkingBudgets,
      maxTokens: this._maxTokens,
      temperature: this._temperature,
      providerOptions: this._providerOptions,
      convertToLlm: this.convertToLlm,
      transformContext: chainedTransformContext,
      beforeToolCall: chainedBeforeToolCall,
      afterToolResult: chainedAfterToolResult,
      getSteeringMessages: async () => {
        if (this.steeringMode === "one-at-a-time") {
          if (this.steeringQueue.length > 0) {
            const first = this.steeringQueue[0];
            this.steeringQueue = this.steeringQueue.slice(1);
            return [first];
          }
          return [];
        } else {
          const steering = this.steeringQueue.slice();
          this.steeringQueue = [];
          return steering;
        }
      },
      getFollowUpMessages: async () => {
        if (this.followUpMode === "one-at-a-time") {
          if (this.followUpQueue.length > 0) {
            const first = this.followUpQueue[0];
            this.followUpQueue = this.followUpQueue.slice(1);
            return [first];
          }
          return [];
        } else {
          const followUp = this.followUpQueue.slice();
          this.followUpQueue = [];
          return followUp;
        }
      },
    };

    let partial: AgentMessage | null = null;

    try {
      const stream = messages
        ? agentLoop(messages, context, config, this.abortController.signal)
        : agentLoopContinue(context, config, this.abortController.signal);

      for await (const event of stream) {
        switch (event.type) {
          case "message_start":
            partial = event.message;
            this._state.streamMessage = event.message;
            break;

          case "message_update":
            partial = event.message;
            this._state.streamMessage = event.message;
            break;

          case "message_end":
            partial = null;
            this._state.streamMessage = null;
            this.appendMessage(event.message);
            break;

          case "tool_execution_start": {
            const s = new Set(this._state.pendingToolCalls);
            s.add(event.toolCallId);
            this._state.pendingToolCalls = s;
            break;
          }

          case "tool_execution_end": {
            const s = new Set(this._state.pendingToolCalls);
            s.delete(event.toolCallId);
            this._state.pendingToolCalls = s;
            break;
          }

          case "turn_end":
            if (
              event.message.role === "assistant" &&
              (event.message as { errorMessage?: string }).errorMessage
            ) {
              this._state.error = (event.message as { errorMessage?: string }).errorMessage;
            }
            break;

          case "agent_end":
            this._state.isStreaming = false;
            this._state.streamMessage = null;
            break;
        }

        this.emit(event);
      }

      // Handle any remaining partial message
      if (partial && partial.role === "assistant") {
        const assistantMsg = partial as {
          content: Array<{ type: string; text?: string; thinking?: string; name?: string }>;
        };
        if (assistantMsg.content.length > 0) {
          const onlyEmpty = !assistantMsg.content.some(
            (c) =>
              (c.type === "thinking" && c.thinking && c.thinking.trim().length > 0) ||
              (c.type === "text" && c.text && c.text.trim().length > 0) ||
              (c.type === "toolCall" && c.name && c.name.trim().length > 0)
          );
          if (!onlyEmpty) {
            this.appendMessage(partial);
          } else {
            if (this.abortController?.signal.aborted) {
              throw new Error("Request was aborted");
            }
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg: AgentMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        model: typeof model === "string" ? model : model.modelId,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };

      this.appendMessage(errorMsg);
      this._state.error = err instanceof Error ? err.message : String(err);
      this.emit({ type: "agent_end", messages: [errorMsg] });
    } finally {
      this._state.isStreaming = false;
      this._state.streamMessage = null;
      this._state.pendingToolCalls = new Set<string>();
      this.abortController = undefined;
      this.resolveRunningPrompt?.();
      this.runningPrompt = undefined;
      this.resolveRunningPrompt = undefined;
    }
  }

  private emit(e: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(e);
    }
  }
}
