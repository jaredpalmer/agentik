import { describe, expect, test } from "bun:test";
import { BridgeClient, type BridgeClientState } from "../src/bridge-client.js";
import { serializeServerMessage } from "../src/protocol.js";

describe("BridgeClient", () => {
  test("initializes with disconnected state", () => {
    const client = new BridgeClient({
      url: "ws://localhost:3100/ws",
      apiKey: "sk-test",
    });
    expect(client.state).toBe("disconnected");
    expect(client.sessionId).toBeNull();
  });

  test("emits stateChange events", () => {
    const states: BridgeClientState[] = [];
    const client = new BridgeClient({
      url: "ws://localhost:49999/ws",
      apiKey: "sk-test",
      maxReconnectAttempts: 0,
    });
    client.on("stateChange", (state) => states.push(state));

    // Connect will try to open WebSocket to invalid port → will go connecting then disconnected
    client.connect();
    expect(states[0]).toBe("connecting");

    client.disconnect();
  });

  test("registers and unregisters tool handlers", () => {
    const client = new BridgeClient({
      url: "ws://localhost:3100/ws",
      apiKey: "sk-test",
    });

    const unregister = client.registerToolHandler("read_range", async () => ({
      content: [{ type: "text", text: "data" }],
      isError: false,
    }));

    // Handler is registered (we can verify by calling it indirectly via protocol)
    expect(typeof unregister).toBe("function");

    unregister();
  });

  test("on() returns unsubscribe function", () => {
    const client = new BridgeClient({
      url: "ws://localhost:3100/ws",
      apiKey: "sk-test",
    });

    let count = 0;
    const unsub = client.on("error", () => {
      count++;
    });

    expect(typeof unsub).toBe("function");
    unsub();
    // After unsubscribe, count should not increase on events
    expect(count).toBe(0);
  });

  test("can be constructed with all options", () => {
    const client = new BridgeClient({
      url: "ws://localhost:3100/ws",
      apiKey: "sk-test",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      appType: "excel",
      maxReconnectAttempts: 3,
      reconnectBaseDelay: 500,
    });
    expect(client.state).toBe("disconnected");
  });

  describe("with real WebSocket server", () => {
    test("connects and receives session_ready", async () => {
      // Start a minimal WS server
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Not found", { status: 404 });
        },
        websocket: {
          message(ws, message) {
            const data = JSON.parse(String(message));
            if (data.type === "init") {
              ws.send(
                serializeServerMessage({
                  type: "session_ready",
                  sessionId: "test-session-1",
                })
              );
            }
          },
          open() {},
          close() {},
        },
      });

      try {
        const client = new BridgeClient({
          url: `ws://localhost:${server.port}`,
          apiKey: "sk-test",
          maxReconnectAttempts: 0,
        });

        const sessionId = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          client.on("sessionReady", (id) => {
            clearTimeout(timeout);
            resolve(id);
          });
          client.connect();
        });

        expect(sessionId).toBe("test-session-1");
        expect(client.state).toBe("ready");
        expect(client.sessionId).toBe("test-session-1");

        client.disconnect();
      } finally {
        void server.stop(true);
      }
    });

    test("handles tool requests via registered handlers", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Not found", { status: 404 });
        },
        websocket: {
          message(ws, message) {
            const data = JSON.parse(String(message));
            if (data.type === "init") {
              ws.send(serializeServerMessage({ type: "session_ready", sessionId: "s1" }));
              // Send a tool request after session ready
              ws.send(
                serializeServerMessage({
                  type: "tool_request",
                  toolCallId: "tc_1",
                  toolName: "read_range",
                  params: { range: "A1:B5" },
                })
              );
            }
            if (data.type === "tool_result") {
              // Echo back the result as an agent event for verification
              ws.send(
                serializeServerMessage({
                  type: "agent_event",
                  event: {
                    type: "tool_execution_end",
                    toolCallId: data.toolCallId,
                    toolName: "read_range",
                    result: data.content,
                    isError: data.isError,
                  },
                })
              );
            }
          },
          open() {},
          close() {},
        },
      });

      try {
        const client = new BridgeClient({
          url: `ws://localhost:${server.port}`,
          apiKey: "sk-test",
          maxReconnectAttempts: 0,
        });

        client.registerToolHandler("read_range", async (_id, _name, params) => ({
          content: [{ type: "text", text: `Data from ${String(params.range)}` }],
          isError: false,
        }));

        const result = await new Promise<{ toolCallId: string; isError: boolean }>(
          (resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
            client.on("agentEvent", (event) => {
              if (event.type === "tool_execution_end") {
                clearTimeout(timeout);
                resolve({ toolCallId: event.toolCallId, isError: event.isError });
              }
            });
            client.connect();
          }
        );

        expect(result.toolCallId).toBe("tc_1");
        expect(result.isError).toBe(false);

        client.disconnect();
      } finally {
        void server.stop(true);
      }
    });

    test("sends error for unregistered tool handler", async () => {
      let receivedResult: { toolCallId: string; isError: boolean; text: string } | null = null;

      const server = Bun.serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Not found", { status: 404 });
        },
        websocket: {
          message(ws, message) {
            const data = JSON.parse(String(message));
            if (data.type === "init") {
              ws.send(serializeServerMessage({ type: "session_ready", sessionId: "s2" }));
              ws.send(
                serializeServerMessage({
                  type: "tool_request",
                  toolCallId: "tc_2",
                  toolName: "unknown_tool",
                  params: {},
                })
              );
            }
            if (data.type === "tool_result") {
              receivedResult = {
                toolCallId: data.toolCallId,
                isError: data.isError,
                text: data.content[0]?.text ?? "",
              };
            }
          },
          open() {},
          close() {},
        },
      });

      try {
        const client = new BridgeClient({
          url: `ws://localhost:${server.port}`,
          apiKey: "sk-test",
          maxReconnectAttempts: 0,
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
          client.on("sessionReady", () => {
            // Wait a bit for the tool request/response cycle
            setTimeout(() => {
              clearTimeout(timeout);
              resolve();
            }, 200);
          });
          client.connect();
        });

        expect(receivedResult).not.toBeNull();
        expect(receivedResult!.isError).toBe(true);
        expect(receivedResult!.text).toContain("No handler registered");

        client.disconnect();
      } finally {
        void server.stop(true);
      }
    });
  });
});
