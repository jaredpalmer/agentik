import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@agentik/agent";

export interface SessionHeader {
  type: "session";
  version: 1;
  id: string;
  createdAt: string;
  cwd: string;
  provider: string;
  model: string;
}

export interface SessionMessageEntry {
  type: "message";
  timestamp: string;
  message: AgentMessage;
}

export type SessionEntry = SessionHeader | SessionMessageEntry;

export interface SessionStoreOptions {
  cwd: string;
  provider: string;
  model: string;
  rootDir?: string;
}

const SESSION_VERSION = 1;

function getDefaultRootDir(): string {
  return join(homedir(), ".agentik", "sessions");
}

function encodeCwd(cwd: string): string {
  return Buffer.from(resolve(cwd)).toString("base64url");
}

function makeSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${rand}`;
}

function parseEntries(text: string): SessionEntry[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: SessionEntry[] = [];
  for (const line of lines) {
    const entry = JSON.parse(line) as SessionEntry;
    entries.push(entry);
  }
  return entries;
}

export class SessionStore {
  private readonly rootDir: string;
  private readonly cwd: string;
  private readonly provider: string;
  private readonly model: string;
  private sessionFile: string;
  private persistedMessageCount = 0;

  constructor(options: SessionStoreOptions) {
    this.rootDir = resolve(options.rootDir ?? getDefaultRootDir());
    this.cwd = resolve(options.cwd);
    this.provider = options.provider;
    this.model = options.model;
    this.sessionFile = "";
    this.startNewSession();
  }

  getSessionFile(): string {
    return this.sessionFile;
  }

  getPersistedMessageCount(): number {
    return this.persistedMessageCount;
  }

  startNewSession(): string {
    const cwdBucket = encodeCwd(this.cwd);
    const sessionId = makeSessionId();
    const sessionDir = join(this.rootDir, cwdBucket);
    mkdirSync(sessionDir, { recursive: true });

    this.sessionFile = join(sessionDir, `${sessionId}.jsonl`);
    this.persistedMessageCount = 0;

    const header: SessionHeader = {
      type: "session",
      version: SESSION_VERSION,
      id: sessionId,
      createdAt: new Date().toISOString(),
      cwd: this.cwd,
      provider: this.provider,
      model: this.model,
    };

    writeFileSync(this.sessionFile, `${JSON.stringify(header)}\n`, "utf8");
    return this.sessionFile;
  }

  appendMessage(message: AgentMessage): void {
    const entry: SessionMessageEntry = {
      type: "message",
      timestamp: new Date().toISOString(),
      message,
    };

    appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`, "utf8");
    this.persistedMessageCount += 1;
  }

  readEntries(): SessionEntry[] {
    if (!existsSync(this.sessionFile)) {
      return [];
    }
    const text = readFileSync(this.sessionFile, "utf8");
    return parseEntries(text);
  }
}
