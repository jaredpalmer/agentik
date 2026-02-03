import { describe, expect, it } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { SharedMemoryStore, SubagentManager } from "../src/subagents";

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

  it("creates and removes subagents when enabled", () => {
    const manager = new SubagentManager({ enabled: true, baseRuntimeOptions: createBaseOptions() });
    const agent = manager.create({ id: "alpha" });

    expect(manager.list()).toHaveLength(1);
    expect(manager.get("alpha")).toBe(agent);
    expect(manager.remove("alpha")).toBe(true);
    expect(manager.get("alpha")).toBeUndefined();
  });

  it("enforces enabled flag and maxAgents", () => {
    const manager = new SubagentManager({
      enabled: false,
      maxAgents: 1,
      baseRuntimeOptions: createBaseOptions(),
    });

    expect(() => manager.create({ id: "alpha" })).toThrow("Subagents are disabled.");

    manager.setEnabled(true);
    manager.create({ id: "alpha" });
    expect(() => manager.create({ id: "beta" })).toThrow("Subagent limit reached.");
  });
});
