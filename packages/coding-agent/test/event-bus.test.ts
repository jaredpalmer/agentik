import { describe, expect, it } from "bun:test";
import { createEventBus } from "../src/extensions/event-bus.js";

describe("EventBus", () => {
  it("should emit and receive events", () => {
    const bus = createEventBus();
    let received: unknown;

    bus.on("test", (data) => {
      received = data;
    });

    bus.emit("test", { hello: "world" });
    expect(received).toEqual({ hello: "world" });
  });

  it("should support multiple handlers on same channel", () => {
    const bus = createEventBus();
    const results: number[] = [];

    bus.on("ch", () => results.push(1));
    bus.on("ch", () => results.push(2));

    bus.emit("ch", null);
    expect(results).toEqual([1, 2]);
  });

  it("should not cross channels", () => {
    const bus = createEventBus();
    let called = false;

    bus.on("a", () => {
      called = true;
    });

    bus.emit("b", null);
    expect(called).toBe(false);
  });

  it("should unsubscribe via returned function", () => {
    const bus = createEventBus();
    let count = 0;

    const unsub = bus.on("test", () => {
      count++;
    });

    bus.emit("test", null);
    expect(count).toBe(1);

    unsub();
    bus.emit("test", null);
    expect(count).toBe(1);
  });

  it("should handle no listeners gracefully", () => {
    const bus = createEventBus();
    expect(() => bus.emit("empty", null)).not.toThrow();
  });

  it("should clear all handlers", () => {
    const bus = createEventBus();
    let called = false;

    bus.on("test", () => {
      called = true;
    });

    bus.clear();
    bus.emit("test", null);
    expect(called).toBe(false);
  });

  it("should isolate handler errors", () => {
    const bus = createEventBus();
    const results: number[] = [];

    bus.on("test", () => {
      throw new Error("boom");
    });
    bus.on("test", () => {
      results.push(2);
    });

    // Should not throw, and second handler still runs
    expect(() => bus.emit("test", null)).not.toThrow();
    expect(results).toEqual([2]);
  });
});
