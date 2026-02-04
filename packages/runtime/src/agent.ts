import { randomUUID } from "node:crypto";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type {
  AgentCallOptions,
  AgentConfig,
  AgentEvent,
  AgentMessage,
  QueueMode,
  SessionMessageEntry,
  SessionTree,
  ThinkingBudgets,
  ThinkingLevel,
} from "./types";
import { AgentRuntime } from "./agent-runtime";
import type { SessionStore } from "./session-store";

export type AgentOptions<CALL_OPTIONS = never> = AgentConfig<CALL_OPTIONS> & {
  sessionStore?: SessionStore;
};

export class Agent<CALL_OPTIONS = never> {
  private runtime: AgentRuntime<CALL_OPTIONS>;
  private store?: SessionStore;
  private lastEntryId?: string;
  private unsubscribe?: () => void;
  private runningPrompt?: Promise<void>;

  constructor(options: AgentOptions<CALL_OPTIONS>) {
    const { sessionStore, ...runtimeOptions } = options;
    this.runtime = new AgentRuntime<CALL_OPTIONS>(runtimeOptions);
    this.store = sessionStore;
    if (this.store) {
      this.startRecording();
    }
  }

  get state() {
    return this.runtime.state;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.runtime.subscribe(listener);
  }

  setInstructions(instructions: AgentConfig["instructions"]): void {
    this.runtime.setInstructions(instructions);
  }

  setModel(model: AgentConfig["model"]): void {
    this.runtime.setModel(model);
  }

  setTools(tools: AgentConfig["tools"]): void {
    this.runtime.setTools(tools);
  }

  setToolChoice(choice: AgentConfig["toolChoice"]): void {
    this.runtime.setToolChoice(choice);
  }

  setThinkingLevel(level?: ThinkingLevel): void {
    this.runtime.setThinkingLevel(level);
  }

  setThinkingBudgets(budgets?: ThinkingBudgets): void {
    this.runtime.setThinkingBudgets(budgets);
  }

  setSessionId(sessionId?: string): void {
    this.runtime.setSessionId(sessionId);
  }

  setTransform(transform: AgentConfig["transformContext"]): void {
    this.runtime.setTransform(transform);
  }

  setConvertToModelMessages(convert: AgentConfig["convertToModelMessages"]): void {
    this.runtime.setConvertToModelMessages(convert);
  }

  replaceMessages(messages: AgentMessage[]): void {
    this.runtime.replaceMessages(messages);
  }

  appendMessage(message: AgentMessage): void {
    this.runtime.appendMessage(message);
  }

  clearMessages(): void {
    this.runtime.clearMessages();
  }

  getSteeringMode(): QueueMode {
    return this.runtime.getSteeringMode();
  }

  setSteeringMode(mode: QueueMode): void {
    this.runtime.setSteeringMode(mode);
  }

  getFollowUpMode(): QueueMode {
    return this.runtime.getFollowUpMode();
  }

  setFollowUpMode(mode: QueueMode): void {
    this.runtime.setFollowUpMode(mode);
  }

  getQueueCounts(): { steering: number; followUp: number } {
    return this.runtime.getQueueCounts();
  }

  enqueueSteeringMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.runtime.enqueueSteeringMessage(input);
  }

  enqueueFollowUpMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.runtime.enqueueFollowUpMessage(input);
  }

  steer(message: string | AgentMessage): void {
    this.enqueueSteeringMessage(message);
  }

  followUp(message: string | AgentMessage): void {
    this.enqueueFollowUpMessage(message);
  }

  dequeueLastSteeringMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastSteeringMessage();
  }

  dequeueLastFollowUpMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastFollowUpMessage();
  }

  clearSteeringQueue(): void {
    this.runtime.clearSteeringQueue();
  }

  clearFollowUpQueue(): void {
    this.runtime.clearFollowUpQueue();
  }

  clearAllQueues(): void {
    this.runtime.clearAllQueues();
  }

  abort(): void {
    this.runtime.abort();
  }

  waitForIdle(): Promise<void> {
    return this.runningPrompt ?? Promise.resolve();
  }

  reset(): void {
    this.runtime.reset();
  }

  async prompt(
    input: string | ModelMessage[],
    options: AgentCallOptions<CALL_OPTIONS> = {}
  ): Promise<void> {
    const run = this.runtime.prompt(input, options);
    this.runningPrompt = run;
    try {
      await run;
    } finally {
      if (this.runningPrompt === run) {
        this.runningPrompt = undefined;
      }
    }
  }

  async continue(options: AgentCallOptions<CALL_OPTIONS> = {}): Promise<void> {
    const run = this.runtime.continue(options);
    this.runningPrompt = run;
    try {
      await run;
    } finally {
      if (this.runningPrompt === run) {
        this.runningPrompt = undefined;
      }
    }
  }

  async loadSession(): Promise<SessionTree> {
    if (!this.store) {
      return { version: 1, entries: [] };
    }
    return this.store.load();
  }

  startRecording(): void {
    if (!this.store || this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.runtime.subscribe((event) => {
      if (event.type !== "message_end") {
        return;
      }
      void this.recordMessage(event.message);
    });
  }

  stopRecording(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async recordMessage(message: AgentMessage): Promise<void> {
    if (!this.store) {
      return;
    }
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
