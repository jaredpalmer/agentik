import { describe, expect, it } from "bun:test";
import { EventStream } from "../src/event-stream";

describe("EventStream", () => {
  it("push then iterate", async () => {
    const stream = new EventStream<string>();
    stream.push("a");
    stream.push("b");
    stream.end();

    const collected: string[] = [];
    for await (const event of stream) {
      collected.push(event);
    }
    expect(collected).toEqual(["a", "b"]);
  });

  it("iterate then push (async consumer waits)", async () => {
    const stream = new EventStream<number>();
    const collected: number[] = [];

    const consumer = (async () => {
      for await (const event of stream) {
        collected.push(event);
      }
    })();

    // Push after consumer is already waiting
    await Promise.resolve();
    stream.push(1);
    stream.push(2);
    stream.end();
    await consumer;

    expect(collected).toEqual([1, 2]);
  });

  it("end() terminates iteration", async () => {
    const stream = new EventStream<string>();
    const consumer = (async () => {
      const items: string[] = [];
      for await (const item of stream) {
        items.push(item);
      }
      return items;
    })();

    stream.push("x");
    stream.end();
    const items = await consumer;
    expect(items).toEqual(["x"]);
  });

  it("push after end() is ignored", async () => {
    const stream = new EventStream<string>();
    stream.end();
    stream.push("ignored");

    // Iterating should yield nothing
    const iter = stream[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  it("result() resolves after end() with value", async () => {
    const stream = new EventStream<string, number>();
    stream.push("event");
    stream.end(42);

    const result = await stream.result();
    expect(result).toBe(42);
  });

  it("buffers events pushed before consumption", async () => {
    const stream = new EventStream<string>();

    // Push several events before anyone starts consuming
    stream.push("first");
    stream.push("second");
    stream.push("third");
    stream.end();

    const collected: string[] = [];
    for await (const event of stream) {
      collected.push(event);
    }
    expect(collected).toEqual(["first", "second", "third"]);
  });

  it("multiple consumers each get their own iteration", async () => {
    const stream = new EventStream<string>();
    stream.push("a");
    stream.push("b");
    stream.end();

    const first: string[] = [];
    for await (const event of stream) {
      first.push(event);
    }

    // Second iteration on same stream after end() yields nothing (queue drained)
    const second: string[] = [];
    for await (const event of stream) {
      second.push(event);
    }

    expect(first).toEqual(["a", "b"]);
    expect(second).toEqual([]);
  });

  it("interleaved push and consume", async () => {
    const stream = new EventStream<number>();
    const collected: number[] = [];

    const consumer = (async () => {
      for await (const event of stream) {
        collected.push(event);
      }
    })();

    for (let i = 0; i < 5; i++) {
      stream.push(i);
      await Promise.resolve(); // yield to let consumer process
    }
    stream.end();
    await consumer;

    expect(collected).toEqual([0, 1, 2, 3, 4]);
  });
});
