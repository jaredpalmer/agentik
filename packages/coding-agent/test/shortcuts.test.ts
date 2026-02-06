import { describe, expect, it } from "bun:test";
import { ShortcutRegistry } from "../src/extensions/shortcuts.js";

describe("ShortcutRegistry", () => {
  it("should register a shortcut", () => {
    const registry = new ShortcutRegistry();
    registry.register("ctrl+k", {
      description: "Quick action",
      handler: () => {},
    });

    expect(registry.has("ctrl+k")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("should get a registered shortcut", () => {
    const registry = new ShortcutRegistry();
    const handler = () => {};
    registry.register("ctrl+k", {
      description: "Quick action",
      handler,
    });

    const shortcut = registry.get("ctrl+k");
    expect(shortcut).toBeDefined();
    expect(shortcut!.key).toBe("ctrl+k");
    expect(shortcut!.description).toBe("Quick action");
    expect(shortcut!.handler).toBe(handler);
  });

  it("should return undefined for unregistered key", () => {
    const registry = new ShortcutRegistry();
    expect(registry.get("ctrl+x")).toBeUndefined();
  });

  it("should throw on reserved key", () => {
    const registry = new ShortcutRegistry();
    expect(() => {
      registry.register("ctrl+c", { handler: () => {} });
    }).toThrow("reserved");

    expect(() => {
      registry.register("escape", { handler: () => {} });
    }).toThrow("reserved");

    expect(() => {
      registry.register("enter", { handler: () => {} });
    }).toThrow("reserved");
  });

  it("should throw on duplicate registration", () => {
    const registry = new ShortcutRegistry();
    registry.register("ctrl+k", { handler: () => {} });

    expect(() => {
      registry.register("ctrl+k", { handler: () => {} });
    }).toThrow("already registered");
  });

  it("should unregister via returned dispose function", () => {
    const registry = new ShortcutRegistry();
    const dispose = registry.register("ctrl+k", { handler: () => {} });

    expect(registry.has("ctrl+k")).toBe(true);
    dispose();
    expect(registry.has("ctrl+k")).toBe(false);
  });

  it("should execute a shortcut handler", async () => {
    const registry = new ShortcutRegistry();
    let executed = false;

    registry.register("ctrl+k", {
      handler: (ctx) => {
        executed = true;
        expect(ctx.key).toBe("ctrl+k");
      },
    });

    const result = await registry.execute("ctrl+k");
    expect(result).toBe(true);
    expect(executed).toBe(true);
  });

  it("should return false for executing unregistered key", async () => {
    const registry = new ShortcutRegistry();
    const result = await registry.execute("ctrl+x");
    expect(result).toBe(false);
  });

  it("should handle async shortcut handlers", async () => {
    const registry = new ShortcutRegistry();
    let done = false;

    registry.register("ctrl+k", {
      handler: async () => {
        await new Promise((r) => setTimeout(r, 10));
        done = true;
      },
    });

    await registry.execute("ctrl+k");
    expect(done).toBe(true);
  });

  it("should normalize key case", () => {
    const registry = new ShortcutRegistry();
    registry.register("Ctrl+K", { handler: () => {} });
    expect(registry.has("ctrl+k")).toBe(true);
    expect(registry.has("CTRL+K")).toBe(true);
  });

  it("should list all shortcuts sorted by key", () => {
    const registry = new ShortcutRegistry();
    registry.register("f2", { description: "Second", handler: () => {} });
    registry.register("f1", { description: "First", handler: () => {} });

    const list = registry.listShortcuts();
    expect(list).toHaveLength(2);
    expect(list[0].key).toBe("f1");
    expect(list[1].key).toBe("f2");
  });

  it("should check reserved keys statically", () => {
    expect(ShortcutRegistry.isReserved("ctrl+c")).toBe(true);
    expect(ShortcutRegistry.isReserved("ctrl+d")).toBe(true);
    expect(ShortcutRegistry.isReserved("escape")).toBe(true);
    expect(ShortcutRegistry.isReserved("ctrl+k")).toBe(false);
    expect(ShortcutRegistry.isReserved("f1")).toBe(false);
  });
});
