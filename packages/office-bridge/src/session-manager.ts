import { BridgeSession } from "./session.js";

export class SessionManager {
  private sessions = new Map<string, BridgeSession>();
  private wsToSession = new Map<object, BridgeSession>();

  create(ws: { send(data: string): void; close(): void }): BridgeSession {
    const sessionId = crypto.randomUUID();
    const session = new BridgeSession(ws, sessionId);
    this.sessions.set(sessionId, session);
    this.wsToSession.set(ws, session);
    return session;
  }

  get(sessionId: string): BridgeSession | undefined {
    return this.sessions.get(sessionId);
  }

  getByWs(ws: object): BridgeSession | undefined {
    return this.wsToSession.get(ws);
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.dispose();
    this.sessions.delete(sessionId);

    for (const [ws, s] of this.wsToSession) {
      if (s === session) {
        this.wsToSession.delete(ws);
        break;
      }
    }
  }

  removeByWs(ws: object): void {
    const session = this.wsToSession.get(ws);
    if (!session) return;

    session.dispose();
    this.sessions.delete(session.sessionId);
    this.wsToSession.delete(ws);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.wsToSession.clear();
  }
}
