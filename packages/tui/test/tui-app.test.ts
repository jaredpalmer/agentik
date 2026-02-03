import { describe, expect, it } from "bun:test";
import { TuiApp } from "../src/tui-app";

type RuntimeStub = { subscribe: () => () => void };

function createApp() {
  const runtime = { subscribe: () => () => {} } as RuntimeStub;
  const app = new TuiApp({ runtime: runtime as never });
  (app as any).messagesView = { content: "" };
  (app as any).renderer = { requestRender: () => {} };
  return app;
}

describe("TuiApp", () => {
  it("renders assistant streaming updates", () => {
    const app = createApp();
    const handleEvent = (app as any).handleEvent.bind(app) as (event: unknown) => void;

    handleEvent({ type: "message_start", message: { role: "assistant", content: "" } });
    handleEvent({ type: "message_update", message: { role: "assistant", content: "" }, delta: "Hi" });
    handleEvent({ type: "message_end", message: { role: "assistant", content: "Hi" } });

    expect((app as any).messagesView.content).toBe("[assistant] Hi");
  });

  it("stringifies non-string content", () => {
    const app = createApp();
    const handleEvent = (app as any).handleEvent.bind(app) as (event: unknown) => void;

    handleEvent({ type: "message_start", message: { role: "user", content: { foo: "bar" } } });
    handleEvent({ type: "message_end", message: { role: "user", content: { foo: "bar" } } });

    expect((app as any).messagesView.content).toBe('[user] {\n  "foo": "bar"\n}');
  });
});
