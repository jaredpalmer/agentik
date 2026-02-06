import { describe, expect, it } from "bun:test";
import { MessageRendererRegistry } from "../src/extensions/message-renderer.js";

describe("MessageRendererRegistry", () => {
  it("should register a renderer", () => {
    const registry = new MessageRendererRegistry();
    registry.register("todo", (msg) => [`TODO: ${msg.content}`]);

    expect(registry.has("todo")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("should throw on duplicate registration", () => {
    const registry = new MessageRendererRegistry();
    registry.register("todo", () => []);

    expect(() => {
      registry.register("todo", () => []);
    }).toThrow('Message renderer for "todo" is already registered');
  });

  it("should unregister via returned dispose function", () => {
    const registry = new MessageRendererRegistry();
    const dispose = registry.register("todo", () => []);

    expect(registry.has("todo")).toBe(true);
    dispose();
    expect(registry.has("todo")).toBe(false);
  });

  it("should render a message using registered renderer", () => {
    const registry = new MessageRendererRegistry();
    registry.register("status", (msg) => {
      return [`Status: ${msg.content}`];
    });

    const lines = registry.render({ customType: "status", content: "active" }, { expanded: false });

    expect(lines).toEqual(["Status: active"]);
  });

  it("should return undefined for unregistered custom type", () => {
    const registry = new MessageRendererRegistry();
    const result = registry.render({ customType: "unknown", content: "test" }, { expanded: false });
    expect(result).toBeUndefined();
  });

  it("should pass expanded option to renderer", () => {
    const registry = new MessageRendererRegistry();
    registry.register("detail", (msg, opts) => {
      if (opts.expanded) {
        return [`Full: ${msg.content}`, `Details: ${JSON.stringify(msg.details)}`];
      }
      return [`Summary: ${msg.content}`];
    });

    const collapsed = registry.render(
      { customType: "detail", content: "test", details: { a: 1 } },
      { expanded: false }
    );
    expect(collapsed).toEqual(["Summary: test"]);

    const expanded = registry.render(
      { customType: "detail", content: "test", details: { a: 1 } },
      { expanded: true }
    );
    expect(expanded).toEqual(["Full: test", 'Details: {"a":1}']);
  });

  it("should get a renderer by custom type", () => {
    const registry = new MessageRendererRegistry();
    const renderer = () => ["test"];
    registry.register("custom", renderer);

    expect(registry.get("custom")).toBe(renderer);
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});
