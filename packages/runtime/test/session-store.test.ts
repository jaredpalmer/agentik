import { describe, expect, it } from "bun:test";
import { InMemorySessionStore } from "../src/session-store";

const initialTree = { version: 1 as const, entries: [] };

describe("InMemorySessionStore", () => {
  it("returns the initial tree", async () => {
    const store = new InMemorySessionStore(initialTree);
    const result = await store.load();
    expect(result).toBe(initialTree);
  });

  it("appends entries to the tree", async () => {
    const store = new InMemorySessionStore();
    await store.append({
      type: "message",
      id: "1",
      parentId: null,
      timestamp: new Date(0).toISOString(),
      message: { role: "user", content: "Hello" },
    });

    const result = await store.load();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("1");
  });
});
