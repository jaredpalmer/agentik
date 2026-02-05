import { describe, expect, it } from "bun:test";
import { EventStream } from "../src/event-stream.js";

type TestEvent = { type: "data"; value: string } | { type: "done"; result: string };

describe("EventStream", () => {
  it("should yield pushed events", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e.type === "done" ? e.result : "")
    );

    stream.push({ type: "data", value: "first" });
    stream.push({ type: "data", value: "second" });
    stream.push({ type: "done", result: "final" });

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "data", value: "first" },
      { type: "data", value: "second" },
      { type: "done", result: "final" },
    ]);
  });

  it("should resolve final result", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e.type === "done" ? e.result : "")
    );

    stream.push({ type: "done", result: "the answer" });

    const result = await stream.result();
    expect(result).toBe("the answer");
  });

  it("should handle async push and consumption", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e.type === "done" ? e.result : "")
    );

    // Push events asynchronously
    setTimeout(() => {
      stream.push({ type: "data", value: "async1" });
      stream.push({ type: "data", value: "async2" });
      stream.push({ type: "done", result: "async-done" });
    }, 5);

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBe(3);
    expect(events[0]).toEqual({ type: "data", value: "async1" });
    expect(events[2]).toEqual({ type: "done", result: "async-done" });
  });

  it("should handle end() with explicit result", async () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e.type === "done" ? e.result : "")
    );

    stream.push({ type: "data", value: "one" });
    stream.end("explicit result");

    const events: TestEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "data", value: "one" }]);
    const result = await stream.result();
    expect(result).toBe("explicit result");
  });

  it("should not push after done", () => {
    const stream = new EventStream<TestEvent, string>(
      (e) => e.type === "done",
      (e) => (e.type === "done" ? e.result : "")
    );

    stream.push({ type: "done", result: "final" });
    stream.push({ type: "data", value: "ignored" }); // Should be ignored

    // The stream should still work
    const consumed: TestEvent[] = [];
    void (async () => {
      for await (const event of stream) {
        consumed.push(event);
      }
    })();

    // Give it time to consume
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(consumed.length).toBe(1);
        expect(consumed[0]).toEqual({ type: "done", result: "final" });
        resolve();
      }, 10);
    });
  });
});
