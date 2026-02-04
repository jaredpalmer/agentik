import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { SharedMemoryStore, SubagentRegistry } from "../src/subagents";

function createBaseOptions() {
  return {
    model: new MockLanguageModelV3(),
    tools: [],
  } as const;
}

describe("subagents", () => {
  it("manages shared memory", () => {
    const store = new SharedMemoryStore();
    store.set("key", "value");
    expect(store.get("key")).toBe("value");

    store.delete("key");
    expect(store.get("key")).toBeUndefined();
    expect(store.snapshot()).toEqual({});
  });

  it("registers and removes subagents", () => {
    const registry = new SubagentRegistry();
    const spec = registry.register({ id: "alpha", config: createBaseOptions() });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("alpha")).toBe(spec);
    expect(registry.remove("alpha")).toBe(true);
    expect(registry.get("alpha")).toBeUndefined();
  });
});
