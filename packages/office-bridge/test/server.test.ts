import { describe, expect, it } from "bun:test";
import { SessionManager } from "../src/session-manager.js";

describe("SessionManager", () => {
  it("creates and tracks sessions", () => {
    const manager = new SessionManager();
    const ws = { send() {}, close() {} };
    const session = manager.create(ws);

    expect(session.sessionId).toBeTruthy();
    expect(manager.getSessionCount()).toBe(1);
    expect(manager.get(session.sessionId)).toBe(session);
    expect(manager.getByWs(ws)).toBe(session);

    manager.dispose();
  });

  it("removes session by id", () => {
    const manager = new SessionManager();
    const ws = { send() {}, close() {} };
    const session = manager.create(ws);

    manager.remove(session.sessionId);
    expect(manager.getSessionCount()).toBe(0);
    expect(manager.get(session.sessionId)).toBeUndefined();

    manager.dispose();
  });

  it("removes session by ws", () => {
    const manager = new SessionManager();
    const ws = { send() {}, close() {} };
    const session = manager.create(ws);

    manager.removeByWs(ws);
    expect(manager.getSessionCount()).toBe(0);
    expect(manager.get(session.sessionId)).toBeUndefined();

    manager.dispose();
  });

  it("disposes all sessions", () => {
    const manager = new SessionManager();
    manager.create({ send() {}, close() {} });
    manager.create({ send() {}, close() {} });
    expect(manager.getSessionCount()).toBe(2);

    manager.dispose();
    expect(manager.getSessionCount()).toBe(0);
  });
});
