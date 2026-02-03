import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentRuntime, SessionEntry, SessionTree } from "@agentik/runtime";
import type { SessionStore } from "./session-store";

export type AgentSessionOptions = {
  store?: SessionStore;
};

export class AgentSession {
  readonly runtime: AgentRuntime;
  readonly store?: SessionStore;
  private lastEntryId?: string;
  private unsubscribe?: () => void;

  constructor(runtime: AgentRuntime, options: AgentSessionOptions = {}) {
    this.runtime = runtime;
    this.store = options.store;
  }

  async load(): Promise<SessionTree> {
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

  enqueueSteeringMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.runtime.enqueueSteeringMessage(input);
  }

  enqueueFollowUpMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.runtime.enqueueFollowUpMessage(input);
  }

  getQueueCounts(): { steering: number; followUp: number } {
    return this.runtime.getQueueCounts();
  }

  dequeueLastSteeringMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastSteeringMessage();
  }

  dequeueLastFollowUpMessage(): AgentMessage | undefined {
    return this.runtime.dequeueLastFollowUpMessage();
  }

  setSteeringMode(mode: "one-at-a-time" | "all"): void {
    this.runtime.setSteeringMode(mode);
  }

  setFollowUpMode(mode: "one-at-a-time" | "all"): void {
    this.runtime.setFollowUpMode(mode);
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
