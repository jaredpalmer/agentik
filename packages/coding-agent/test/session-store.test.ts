import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@agentik/agent";
import { SessionStore } from "../src/session/store.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agentik-session-store-"));
}

describe("SessionStore", () => {
  it("should create a session file with header", () => {
    const rootDir = makeTempDir();

    try {
      const store = new SessionStore({
        cwd: process.cwd(),
        provider: "anthropic",
        model: "claude-opus-4-6",
        rootDir,
      });

      const sessionFile = store.getSessionFile();
      expect(existsSync(sessionFile)).toBe(true);

      const content = readFileSync(sessionFile, "utf8").trim();
      const firstLine = content.split("\n")[0];
      const header = JSON.parse(firstLine) as { type: string; provider: string; model: string };
      expect(header.type).toBe("session");
      expect(header.provider).toBe("anthropic");
      expect(header.model).toBe("claude-opus-4-6");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("should append and read message entries", () => {
    const rootDir = makeTempDir();

    try {
      const store = new SessionStore({
        cwd: process.cwd(),
        provider: "openai",
        model: "gpt-4o",
        rootDir,
      });

      const userMessage: AgentMessage = {
        role: "user",
        content: "hello",
        timestamp: Date.now(),
      };
      store.appendMessage(userMessage);

      expect(store.getPersistedMessageCount()).toBe(1);

      const entries = store.readEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe("session");
      expect(entries[1].type).toBe("message");
      if (entries[1].type === "message") {
        expect(entries[1].message.role).toBe("user");
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("should rotate to a new session file and reset persisted count", () => {
    const rootDir = makeTempDir();

    try {
      const store = new SessionStore({
        cwd: process.cwd(),
        provider: "anthropic",
        model: "claude-opus-4-6",
        rootDir,
      });

      const oldSessionFile = store.getSessionFile();
      const userMessage: AgentMessage = {
        role: "user",
        content: "hello",
        timestamp: Date.now(),
      };
      store.appendMessage(userMessage);
      expect(store.getPersistedMessageCount()).toBe(1);

      const newSessionFile = store.startNewSession();
      expect(newSessionFile).toBe(store.getSessionFile());
      expect(newSessionFile).not.toBe(oldSessionFile);
      expect(store.getPersistedMessageCount()).toBe(0);

      const newEntries = store.readEntries();
      expect(newEntries).toHaveLength(1);
      expect(newEntries[0].type).toBe("session");
      expect(existsSync(oldSessionFile)).toBe(true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
