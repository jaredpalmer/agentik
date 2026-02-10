import { describe, expect, it } from "bun:test";
import { parseServerMessage } from "@agentik/office-common";
import { BridgeSession } from "../src/session.js";

function createMockWs() {
  const sent: string[] = [];
  return {
    ws: {
      send(data: string) {
        sent.push(data);
      },
      close() {},
    },
    sent,
    getMessages() {
      return sent.map((s) => parseServerMessage(s)).filter(Boolean);
    },
  };
}

describe("BridgeSession", () => {
  it("starts uninitialized", () => {
    const { ws } = createMockWs();
    const session = new BridgeSession(ws, "test-id");
    expect(session.sessionId).toBe("test-id");
    expect(session.isInitialized).toBe(false);
  });

  it("sends error on prompt before init", async () => {
    const mock = createMockWs();
    const session = new BridgeSession(mock.ws, "test-id");
    await session.handlePrompt("hello");

    const messages = mock.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe("error");
  });

  it("sends error on steer before init", () => {
    const mock = createMockWs();
    const session = new BridgeSession(mock.ws, "test-id");
    session.handleSteer("hello");

    const messages = mock.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe("error");
  });

  it("disposes cleanly", () => {
    const { ws } = createMockWs();
    const session = new BridgeSession(ws, "test-id");
    session.dispose();
    expect(session.isInitialized).toBe(false);
  });
});
