import { describe, expect, it } from "bun:test";
import { TuiApp } from "../src/tui/tui-app";

type AgentStub = { subscribe: () => () => void };
type TestableApp = TuiApp & {
  handleEvent: (event: unknown) => void;
  submitPrompt: (prompt: string) => void;
  messages: Array<{ role: string; content: string }>;
};

function createApp() {
  const agent = { subscribe: () => () => {} } as AgentStub;
  const app = new TuiApp({ agent: agent as never });
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
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hi",
      },
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

  it("shows explicit tool error status", () => {
    const app = createApp() as unknown as TestableApp & {
      formatToolStatus: (
        toolName: string,
        args: unknown,
        status: "running" | "done" | "error"
      ) => string;
    };

    const status = app.formatToolStatus("read", { path: "src/index.ts" }, "error");

    expect(status).toBe("Error running Read");
  });

  it("does not duplicate errors already emitted as events", async () => {
    const error = new Error("Boom");
    error.stack = "Stack: boom";

    let app = null as unknown as TestableApp;
    const agent = {
      subscribe: () => () => {},
      prompt: async () => {
        app.handleEvent({ type: "error", error });
        throw error;
      },
    };
    app = new TuiApp({ agent: agent as never }) as unknown as TestableApp;

    app.submitPrompt("hello");
    await Promise.resolve();

    expect(app.messages.length).toBe(1);
    expect(app.messages[0]?.content).toBe("Stack: boom");
  });
});
