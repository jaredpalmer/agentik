import { describe, expect, it } from "bun:test";
import { TuiApp } from "../src/tui/tui-app";

type RuntimeStub = { subscribe: () => () => void };
type TestableApp = TuiApp & {
  handleEvent: (event: unknown) => void;
  messages: Array<{ role: string; content: string }>;
};

function createApp() {
  const runtime = { subscribe: () => () => {} } as RuntimeStub;
  const app = new TuiApp({ runtime: runtime as never });
  return app;
}

describe("TuiApp", () => {
  it("renders assistant streaming updates", () => {
    const app = createApp() as unknown as TestableApp;
    const handleEvent = app.handleEvent.bind(app);

    handleEvent({ type: "message_start", message: { role: "assistant", content: "" } });
    handleEvent({
      type: "message_update",
      message: { role: "assistant", content: "" },
      delta: "Hi",
    });
    handleEvent({ type: "message_end", message: { role: "assistant", content: "Hi" } });

    const messages = app.messages;
    expect(messages[0]?.content).toBe("Hi");
  });

  it("stringifies non-string content", () => {
    const app = createApp() as unknown as TestableApp;
    const handleEvent = app.handleEvent.bind(app);

    handleEvent({ type: "message_start", message: { role: "user", content: { foo: "bar" } } });
    handleEvent({ type: "message_end", message: { role: "user", content: { foo: "bar" } } });

    const messages = app.messages;
    expect(messages[0]?.content).toBe('{\n  "foo": "bar"\n}');
  });

  it("uses stack traces for error events", () => {
    const app = createApp() as unknown as TestableApp;
    const handleEvent = app.handleEvent.bind(app);

    const error = new Error("Boom");
    error.stack = "Stack: boom";

    handleEvent({ type: "error", error });

    const messages = app.messages;
    expect(messages[0]?.content).toBe("Stack: boom");
  });

  it("suppresses abort errors when interrupting", () => {
    const app = createApp() as unknown as TestableApp & { isAborting: boolean };
    const handleEvent = app.handleEvent.bind(app);

    const error = new Error("aborted");
    error.name = "AbortError";
    app.isAborting = true;

    handleEvent({ type: "error", error });

    expect(app.messages.length).toBe(0);
  });
});
