import type { SessionEntry, SessionTree } from "@openagent/agent-core";

export interface SessionStore {
  load(): Promise<SessionTree>;
  append(entry: SessionEntry): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private tree: SessionTree;

  constructor(initial?: SessionTree) {
    this.tree = initial ?? { version: 1, entries: [] };
  }

  async load(): Promise<SessionTree> {
    return this.tree;
  }

  async append(entry: SessionEntry): Promise<void> {
    this.tree.entries.push(entry);
  }
}
