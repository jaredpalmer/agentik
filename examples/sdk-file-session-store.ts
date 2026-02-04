import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Agent, type SessionEntry, type SessionStore, type SessionTree } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Simple file-backed SessionStore to persist a SessionTree as JSON.
class FileSessionStore implements SessionStore {
  constructor(private filePath: string) {}

  async load(): Promise<SessionTree> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      return JSON.parse(data) as SessionTree;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  async append(entry: SessionEntry): Promise<void> {
    const tree = await this.load();
    tree.entries.push(entry);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(tree, null, 2));
  }
}

const filePath = resolve(".agentik-example/session.json");
const store = new FileSessionStore(filePath);

const agent = new Agent({
  model: createMockModel("Persisted to disk."),
  sessionStore: store,
});

await agent.prompt("Write this to the file-backed store.");
await new Promise((resolve) => setTimeout(resolve, 0));

const tree = await store.load();
console.log(`Saved ${tree.entries.length} entries to ${filePath}.`);
