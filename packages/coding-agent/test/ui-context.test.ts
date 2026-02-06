import { describe, expect, it } from "bun:test";
import { NoopUIContext } from "../src/extensions/ui-context.js";
import type { ExtensionUIContext } from "../src/extensions/ui-context.js";

describe("ExtensionUIContext interface", () => {
  it("NoopUIContext should implement ExtensionUIContext", () => {
    const ctx: ExtensionUIContext = new NoopUIContext();
    expect(ctx).toBeDefined();
  });
});

describe("NoopUIContext", () => {
  it("select should return undefined", async () => {
    const ctx = new NoopUIContext();
    const result = await ctx.select("Pick one", ["a", "b", "c"]);
    expect(result).toBeUndefined();
  });

  it("confirm should return false", async () => {
    const ctx = new NoopUIContext();
    const result = await ctx.confirm("Sure?", "Are you sure?");
    expect(result).toBe(false);
  });

  it("input should return undefined", async () => {
    const ctx = new NoopUIContext();
    const result = await ctx.input("Name:", "Enter name");
    expect(result).toBeUndefined();
  });

  it("notify should not throw", () => {
    const ctx = new NoopUIContext();
    expect(() => ctx.notify("hello")).not.toThrow();
    expect(() => ctx.notify("error!", "error")).not.toThrow();
  });

  it("setStatus should not throw", () => {
    const ctx = new NoopUIContext();
    expect(() => ctx.setStatus("ext", "active")).not.toThrow();
    expect(() => ctx.setStatus("ext", undefined)).not.toThrow();
  });

  it("setWidget should not throw", () => {
    const ctx = new NoopUIContext();
    expect(() => ctx.setWidget("w1", ["line 1"])).not.toThrow();
    expect(() => ctx.setWidget("w1", undefined)).not.toThrow();
  });

  it("setTitle should not throw", () => {
    const ctx = new NoopUIContext();
    expect(() => ctx.setTitle("My App")).not.toThrow();
  });

  it("select should respect abort signal", async () => {
    const ctx = new NoopUIContext();
    const controller = new AbortController();
    controller.abort();
    const result = await ctx.select("Pick", ["a"], {
      signal: controller.signal,
    });
    expect(result).toBeUndefined();
  });
});
