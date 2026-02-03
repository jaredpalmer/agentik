import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentRuntime, SessionEntry, SessionTree } from "@agentik/agent-core";
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
