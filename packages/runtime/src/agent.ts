import { randomUUID } from "node:crypto";
import {
  agentLoop,
  agentLoopContinue,
  type AgentLoopConfig,
  type AgentLoopContext,
} from "./agent-loop";
import { convertToModelMessages } from "./convert-messages";
import { HookRunner } from "./hooks";
import type { UserMessage } from "./messages";
import type { SessionStore } from "./session-store";
import type {
  AgentCallOptions,
  AgentConfig,
  AgentEvent,
  AgentMessage,
  AgentState,
  QueueMode,
  SessionMessageEntry,
  SessionTree,
  ThinkingBudgets,
  ThinkingLevel,
} from "./types";

export type AgentOptions = AgentConfig & {
  sessionStore?: SessionStore;
};

export class Agent {
  // State
  private _state: AgentState;
  private convertToModelMessagesFn: AgentLoopConfig["convertToModelMessages"];
  private transformContext: AgentConfig["transformContext"];
  private hookRunner?: HookRunner;
  private toolChoice: AgentConfig["toolChoice"];
  private providerOptions: AgentConfig["providerOptions"];
  private callSettings: AgentConfig["callSettings"];
  private maxSteps: AgentConfig["maxSteps"];
  private resolveModel: AgentConfig["resolveModel"];
  private thinkingAdapter: AgentConfig["thinkingAdapter"];
  private getApiKey: AgentConfig["getApiKey"];
  private apiKeyHeaders: AgentConfig["apiKeyHeaders"];
  private onEvent: AgentConfig["onEvent"];

  // Queues
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private steeringMode: QueueMode = "one-at-a-time";
  private followUpMode: QueueMode = "one-at-a-time";

  // Run state
  private listeners = new Set<(event: AgentEvent) => void>();
  private abortController?: AbortController;
  private runningPrompt?: Promise<void>;

  // Session recording
  private store?: SessionStore;
  private lastEntryId?: string;
  private recordingUnsub?: () => void;

  constructor(config: AgentConfig & { sessionStore?: SessionStore }) {
    const { sessionStore, ...cfg } = config;

    this._state = {
      model: cfg.model,
      instructions: cfg.instructions,
      tools: cfg.tools ?? [],
      thinkingLevel: cfg.thinkingLevel,
      thinkingBudgets: cfg.thinkingBudgets,
      sessionId: cfg.sessionId,
      messages: [],
      streamMessage: null,
      pendingToolCalls: new Set<string>(),
      isStreaming: false,
    };

    this.convertToModelMessagesFn = cfg.convertToModelMessages ?? convertToModelMessages;
    this.transformContext = cfg.transformContext;
    this.toolChoice = cfg.toolChoice;
    this.providerOptions = cfg.providerOptions;
    this.callSettings = cfg.callSettings;
    this.maxSteps = cfg.maxSteps;
    this.resolveModel = cfg.resolveModel;
    this.thinkingAdapter = cfg.thinkingAdapter;
    this.getApiKey = cfg.getApiKey;
    this.apiKeyHeaders = cfg.apiKeyHeaders;
    this.onEvent = cfg.onEvent;
    this.steeringMode = cfg.steeringMode ?? "one-at-a-time";
    this.followUpMode = cfg.followUpMode ?? "one-at-a-time";

    if (cfg.hooks) {
      this.hookRunner = new HookRunner(cfg.hooks);
    }

    this.store = sessionStore;
    if (this.store) {
      this.startRecording();
    }
  }

  get state(): AgentState {
    return this._state;
  }

  // ── Subscriptions ────────────────────────────────────────────────────

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
    this.onEvent?.(event);
  }

  // ── Setters ──────────────────────────────────────────────────────────

  setInstructions(instructions: AgentConfig["instructions"]): void {
    this._state.instructions = instructions;
  }
  setModel(model: AgentConfig["model"]): void {
    this._state.model = model;
  }
  setTools(tools: AgentConfig["tools"]): void {
    this._state.tools = tools ?? [];
  }
  setToolChoice(choice: AgentConfig["toolChoice"]): void {
    this.toolChoice = choice;
  }
  setThinkingLevel(level?: ThinkingLevel): void {
    this._state.thinkingLevel = level;
  }
  setThinkingBudgets(budgets?: ThinkingBudgets): void {
    this._state.thinkingBudgets = budgets;
  }
  setSessionId(sessionId?: string): void {
    this._state.sessionId = sessionId;
  }
  setTransform(transform: AgentConfig["transformContext"]): void {
    this.transformContext = transform;
  }
  setConvertToModelMessages(convert: AgentConfig["convertToModelMessages"]): void {
    this.convertToModelMessagesFn = convert ?? convertToModelMessages;
  }

  // ── Message management ───────────────────────────────────────────────

  replaceMessages(messages: AgentMessage[]): void {
    this._state.messages = messages.slice();
  }
  appendMessage(message: AgentMessage): void {
    this._state.messages = [...this._state.messages, message];
  }
  clearMessages(): void {
    this._state.messages = [];
  }

  // ── Queue management ─────────────────────────────────────────────────

  getSteeringMode(): QueueMode {
    return this.steeringMode;
  }
  setSteeringMode(mode: QueueMode): void {
    this.steeringMode = mode;
  }
  getFollowUpMode(): QueueMode {
    return this.followUpMode;
  }
  setFollowUpMode(mode: QueueMode): void {
    this.followUpMode = mode;
  }
  getQueueCounts(): { steering: number; followUp: number } {
    return { steering: this.steeringQueue.length, followUp: this.followUpQueue.length };
  }

  steer(message: string | AgentMessage): void {
    this.enqueueSteeringMessage(message);
  }
  followUp(message: string | AgentMessage): void {
    this.enqueueFollowUpMessage(message);
  }

  enqueueSteeringMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    for (const item of Array.isArray(input) ? input : [input]) {
      this.steeringQueue.push(toUserMessage(item));
    }
  }
  enqueueFollowUpMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    for (const item of Array.isArray(input) ? input : [input]) {
      this.followUpQueue.push(toUserMessage(item));
    }
  }

  dequeueLastSteeringMessage(): AgentMessage | undefined {
    return this.steeringQueue.pop();
  }
  dequeueLastFollowUpMessage(): AgentMessage | undefined {
    return this.followUpQueue.pop();
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

  // ── Lifecycle ────────────────────────────────────────────────────────

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

  // ── Prompt / Continue ────────────────────────────────────────────────

  async prompt(input: string | AgentMessage[], options: AgentCallOptions = {}): Promise<void> {
    const prompts: AgentMessage[] = Array.isArray(input) ? input : [toUserMessage(input)];
    const run = this.runLoop(prompts, options);
    this.runningPrompt = run;
    try {
      await run;
    } finally {
      if (this.runningPrompt === run) this.runningPrompt = undefined;
    }
  }

  async continue(options: AgentCallOptions = {}): Promise<void> {
    const run = this.runLoop(undefined, options);
    this.runningPrompt = run;
    try {
      await run;
    } finally {
      if (this.runningPrompt === run) this.runningPrompt = undefined;
    }
  }

  // ── Core loop ────────────────────────────────────────────────────────

  private async runLoop(
    prompts: AgentMessage[] | undefined,
    options: AgentCallOptions
  ): Promise<void> {
    this.abortController = new AbortController();
    const signal = options.abortSignal
      ? composeSignals(options.abortSignal, this.abortController.signal)
      : this.abortController.signal;

    this._state.isStreaming = true;
    this._state.streamMessage = null;
    this._state.error = undefined;

    const context: AgentLoopContext = {
      instructions: this._state.instructions,
      messages: this._state.messages.slice(),
      tools: this._state.tools,
    };

    const config = this.buildLoopConfig();

    try {
      const stream = prompts
        ? agentLoop(prompts, context, config, signal)
        : agentLoopContinue(context, config, signal);

      for await (const event of stream) {
        this.processEvent(event);
        this.emit(event);
      }
    } catch (err: unknown) {
      this._state.error = err instanceof Error ? err.message : String(err);
    } finally {
      this._state.isStreaming = false;
      this._state.streamMessage = null;
      this._state.pendingToolCalls = new Set<string>();
      this.abortController = undefined;
    }
  }

  private buildLoopConfig(): AgentLoopConfig {
    return {
      model: this._state.model,
      convertToModelMessages: this.convertToModelMessagesFn,
      transformContext: this.transformContext,
      hookRunner: this.hookRunner,
      thinkingLevel: this._state.thinkingLevel,
      thinkingBudgets: this._state.thinkingBudgets,
      thinkingAdapter: this.thinkingAdapter,
      resolveModel: this.resolveModel
        ? () => this.resolveModel!({ model: this._state.model, sessionId: this._state.sessionId })
        : undefined,
      getApiKey: this.getApiKey,
      apiKeyHeaders: this.apiKeyHeaders,
      providerOptions: this.providerOptions,
      callSettings: this.callSettings,
      toolChoice: this.toolChoice,
      maxSteps: this.maxSteps,
      sessionId: this._state.sessionId,
      getSteeringMessages: async () => this.drainQueue(this.steeringQueue, this.steeringMode),
      getFollowUpMessages: async () => this.drainQueue(this.followUpQueue, this.followUpMode),
    };
  }

  private drainQueue(queue: AgentMessage[], mode: QueueMode): AgentMessage[] | null {
    if (queue.length === 0) return null;
    if (mode === "one-at-a-time") {
      return [queue.shift()!];
    }
    const all = queue.slice();
    queue.length = 0;
    return all;
  }

  private processEvent(event: AgentEvent): void {
    switch (event.type) {
      case "message_start":
        this._state.streamMessage = event.message;
        break;
      case "message_update":
        this._state.streamMessage = event.message;
        break;
      case "message_end":
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
      case "agent_end":
        this._state.isStreaming = false;
        this._state.streamMessage = null;
        break;
    }
  }

  // ── Session recording ────────────────────────────────────────────────

  async loadSession(): Promise<SessionTree> {
    if (!this.store) return { version: 1, entries: [] };
    return this.store.load();
  }

  startRecording(): void {
    if (!this.store || this.recordingUnsub) return;
    this.recordingUnsub = this.subscribe((event) => {
      if (event.type === "message_end") {
        void this.recordMessage(event.message);
      }
    });
  }

  stopRecording(): void {
    this.recordingUnsub?.();
    this.recordingUnsub = undefined;
  }

  private async recordMessage(message: AgentMessage): Promise<void> {
    if (!this.store) return;
    const entry: SessionMessageEntry = {
      type: "message",
      id: randomUUID(),
      parentId: this.lastEntryId ?? null,
      message,
      timestamp: new Date().toISOString(),
    };
    this.lastEntryId = entry.id;
    await this.store.append(entry);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toUserMessage(input: string | AgentMessage): AgentMessage {
  if (typeof input === "string") {
    return {
      role: "user",
      content: [{ type: "text", text: input }],
      timestamp: Date.now(),
    } as UserMessage;
  }
  return input;
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
