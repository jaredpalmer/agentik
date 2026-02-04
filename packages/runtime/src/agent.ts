import { randomUUID } from "node:crypto";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import type {
  AgentCallOptions,
  AgentEvent,
  AgentMessage,
  AgentRuntimeOptions,
  QueueMode,
  SessionEntry,
  SessionTree,
} from "./types";
import { AgentRuntime } from "./agent-runtime";
import type { SessionStore } from "./session-store";

export type AgentOptions = AgentRuntimeOptions & {
  sessionStore?: SessionStore;
};

export class Agent<CALL_OPTIONS = never> {
  private runtime: AgentRuntime<CALL_OPTIONS>;
  private store?: SessionStore;
  private lastEntryId?: string;
  private unsubscribe?: () => void;

  constructor(options: AgentOptions) {
    const { sessionStore, ...runtimeOptions } = options;
    this.runtime = new AgentRuntime(runtimeOptions);
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

  setInstructions(instructions: AgentRuntimeOptions["instructions"]): void {
    this.runtime.setInstructions(instructions);
  }

  setModel(model: AgentRuntimeOptions["model"]): void {
    this.runtime.setModel(model);
  }

  setTools(tools: AgentRuntimeOptions["tools"]): void {
    this.runtime.setTools(tools);
  }

  setToolChoice(choice: AgentRuntimeOptions["toolChoice"]): void {
    this.runtime.setToolChoice(choice);
  }

  setTransform(transform: AgentRuntimeOptions["transformContext"]): void {
    this.runtime.setTransform(transform);
  }

  setConvertToModelMessages(convert: AgentRuntimeOptions["convertToModelMessages"]): void {
    this.runtime.setConvertToModelMessages(convert);
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

  dequeueLastSteeringMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastSteeringMessage();
  }

  dequeueLastFollowUpMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastFollowUpMessage();
  }

  async prompt(
    input: string | ModelMessage[],
    options: AgentCallOptions<CALL_OPTIONS> = {}
  ): Promise<void> {
    await this.runtime.prompt(input, options);
  }

  async continue(options: AgentCallOptions<CALL_OPTIONS> = {}): Promise<void> {
    await this.runtime.continue(options);
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
      void this.appendMessage(event.message);
    });
  }

  stopRecording(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async appendMessage(message: AgentMessage): Promise<void> {
    if (!this.store) {
      return;
    }
    const entry: SessionEntry = {
      id: randomUUID(),
      parentId: this.lastEntryId,
      message,
      createdAt: new Date().toISOString(),
    };
    this.lastEntryId = entry.id;
    await this.store.append(entry);
  }
}
