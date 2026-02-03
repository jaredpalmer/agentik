import { describe, expect, it } from "bun:test";
import type { CliRenderer, TextRenderable } from "@opentui/core";
import { Loader } from "../src/tui/components/loader";

describe("Loader", () => {
  it("stops updating when the view is destroyed", () => {
    let renderCalls = 0;
    const renderer = {
      isDestroyed: false,
      requestRender: () => {
        renderCalls += 1;
      },
    } as unknown as CliRenderer;

    const view = {
      isDestroyed: true,
      destroy: () => {},
      set content(_value: unknown) {
        throw new Error("should not update content");
      },
    } as unknown as TextRenderable;

    const loader = new Loader(renderer, { view, intervalMs: 5, frames: ["*"] });
    expect(() => loader.setMessage("hi")).not.toThrow();
    expect(renderCalls).toBe(0);
  });
});
