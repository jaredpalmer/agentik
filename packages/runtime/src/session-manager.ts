import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSessionsDir } from "./config";
import type {
  AgentMessage,
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  ModelChangeEntry,
  SessionEntry,
  SessionFileEntry,
  SessionHeader,
  SessionInfoEntry,
  SessionMessageEntry,
  ThinkingLevel,
  ThinkingLevelChangeEntry,
} from "./types";

export const CURRENT_SESSION_VERSION = 1;

export type SessionContext = {
  messages: AgentMessage[];
  thinkingLevel: ThinkingLevel;
  model: { provider: string; modelId: string } | null;
};

export type SessionContextEntry = {
  entry: SessionEntry;
  message: AgentMessage;
};

export type SessionTreeNode = {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
};

export type SessionManagerOptions = {
  cwd?: string;
  sessionDir?: string;
  sessionFile?: string;
  persist?: boolean;
  parentSession?: string;
};

const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`;
const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`;
const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n`;
const BRANCH_SUMMARY_SUFFIX = `\n</summary>`;

function summaryToMessage(prefix: string, summary: string, suffix: string): AgentMessage {
  return { role: "user", content: `${prefix}${summary}${suffix}` };
}

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  switch (entry.type) {
    case "message":
      return entry.message;
    case "custom_message":
      return {
        role: "user",
        content: entry.content,
      };
    case "branch_summary":
      return summaryToMessage(BRANCH_SUMMARY_PREFIX, entry.summary, BRANCH_SUMMARY_SUFFIX);
    case "compaction":
      return summaryToMessage(COMPACTION_SUMMARY_PREFIX, entry.summary, COMPACTION_SUMMARY_SUFFIX);
    default:
      return undefined;
  }
}

export function buildSessionContextEntries(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>
): { context: SessionContext; entries: SessionContextEntry[] } {
  const entryMap = byId ?? new Map<string, SessionEntry>(entries.map((entry) => [entry.id, entry]));

  if (leafId === null) {
    return {
      context: { messages: [], thinkingLevel: "off", model: null },
      entries: [],
    };
  }

  let leaf = leafId ? entryMap.get(leafId) : entries[entries.length - 1];
  if (!leaf) {
    return {
      context: { messages: [], thinkingLevel: "off", model: null },
      entries: [],
    };
  }

  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? entryMap.get(current.parentId) : undefined;
  }

  let thinkingLevel: ThinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let compaction: CompactionEntry | null = null;

  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
      continue;
    }
    if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
      continue;
    }
    if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  const contextEntries: SessionContextEntry[] = [];
  const pushEntry = (entry: SessionEntry) => {
    const message = entryToMessage(entry);
    if (message) {
      contextEntries.push({ entry, message });
    }
  };

  if (compaction) {
    const compactionIndex = path.findIndex((entry) => entry.id === compaction?.id);
    let firstKeptIndex = path.findIndex((entry) => entry.id === compaction?.firstKeptEntryId);
    if (firstKeptIndex === -1) {
      firstKeptIndex = 0;
    }

    pushEntry(compaction);

    for (let index = firstKeptIndex; index < compactionIndex; index += 1) {
      pushEntry(path[index]);
    }

    for (let index = compactionIndex + 1; index < path.length; index += 1) {
      pushEntry(path[index]);
    }
  } else {
    for (const entry of path) {
      pushEntry(entry);
    }
  }

  return {
    context: {
      messages: contextEntries.map((entry) => entry.message),
      thinkingLevel,
      model,
    },
    entries: contextEntries,
  };
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>
): SessionContext {
  return buildSessionContextEntries(entries, leafId, byId).context;
}

function generateId(byId: { has(id: string): boolean }): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) {
      return id;
    }
  }
  return randomUUID();
}

function parseEntry(line: string): SessionFileEntry | null {
  try {
    const parsed = JSON.parse(line) as
      | SessionFileEntry
      | (Partial<SessionEntry> & { message?: AgentMessage });
    if (parsed && typeof parsed === "object") {
      if ("type" in parsed && typeof parsed.type === "string") {
        return parsed as SessionFileEntry;
      }
      if ("message" in parsed) {
        return {
          type: "message",
          id: "",
          parentId: null,
          timestamp: "",
          message: parsed.message as AgentMessage,
        } as SessionMessageEntry;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function loadEntriesFromFile(filePath: string): SessionFileEntry[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const entries: SessionFileEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const entry = parseEntry(trimmed);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function normalizeEntries(entries: SessionFileEntry[]): boolean {
  let mutated = false;
  const ids = new Set<string>();
  let previousId: string | null = null;
  const hasExplicitParent = entries.some(
    (entry) => entry.type !== "session" && entry.parentId != null
  );

  for (const entry of entries) {
    if (entry.type === "session") {
      if (entry.version == null) {
        entry.version = CURRENT_SESSION_VERSION;
        mutated = true;
      }
      continue;
    }

    if (!entry.id) {
      entry.id = generateId(ids);
      mutated = true;
    }
    ids.add(entry.id);

    if (!hasExplicitParent && previousId !== null) {
      entry.parentId = previousId;
      mutated = true;
    } else if (entry.parentId === undefined) {
      entry.parentId = previousId;
      mutated = true;
    }

    if (!entry.timestamp) {
      const legacy = (entry as { createdAt?: string }).createdAt;
      entry.timestamp = legacy ?? new Date().toISOString();
      mutated = true;
    }

    previousId = entry.id;
  }

  return mutated;
}

export class SessionManager {
  private sessionId = "";
  private sessionFile: string | undefined;
  private sessionDir: string;
  private cwd: string;
  private persist: boolean;
  private flushed = false;
  private fileEntries: SessionFileEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private labelsById = new Map<string, string>();
  private leafId: string | null = null;

  constructor(options: SessionManagerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.persist = options.persist ?? true;
    this.sessionDir = options.sessionDir ?? getSessionsDir(this.cwd);

    if (this.persist && !existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    if (options.sessionFile) {
      this.setSessionFile(options.sessionFile);
      return;
    }

    this.newSession({ parentSession: options.parentSession });
  }

  isPersisted(): boolean {
    return this.persist;
  }

  getCwd(): string {
    return this.cwd;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  setSessionFile(sessionFile: string): void {
    this.sessionFile = resolve(sessionFile);

    if (existsSync(this.sessionFile)) {
      this.fileEntries = loadEntriesFromFile(this.sessionFile);

      if (this.fileEntries.length === 0) {
        const explicitPath = this.sessionFile;
        this.newSession();
        this.sessionFile = explicitPath;
        this.rewriteFile();
        this.flushed = true;
        return;
      }

      const header = this.fileEntries.find((entry) => entry.type === "session");
      this.sessionId = header?.id ?? randomUUID();

      if (normalizeEntries(this.fileEntries)) {
        this.rewriteFile();
      }

      this.buildIndex();
      this.flushed = true;
      return;
    }

    const explicitPath = this.sessionFile;
    this.newSession();
    this.sessionFile = explicitPath;
  }

  newSession(options?: { parentSession?: string }): string | undefined {
    this.sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: this.sessionId,
      timestamp,
      cwd: this.cwd,
      parentSession: options?.parentSession,
    };

    this.fileEntries = [header];
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;
    this.flushed = false;

    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/g, "-");
      this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${this.sessionId}.jsonl`);
    }

    return this.sessionFile;
  }

  private buildIndex(): void {
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;

    for (const entry of this.fileEntries) {
      if (entry.type === "session") {
        continue;
      }
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;

      if (entry.type === "label") {
        if (entry.label) {
          this.labelsById.set(entry.targetId, entry.label);
        } else {
          this.labelsById.delete(entry.targetId);
        }
      }
    }
  }

  private rewriteFile(): void {
    if (!this.persist || !this.sessionFile) {
      return;
    }

    const content = `${this.fileEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    writeFileSync(this.sessionFile, content);
  }

  private persistEntry(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) {
      return;
    }

    if (!this.flushed) {
      for (const storedEntry of this.fileEntries) {
        appendFileSync(this.sessionFile, `${JSON.stringify(storedEntry)}\n`);
      }
      this.flushed = true;
      return;
    }

    appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
  }

  private appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.persistEntry(entry);
  }

  appendMessage(message: AgentMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendThinkingLevelChange(thinkingLevel: ThinkingLevel): string {
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean
  ): string {
    const entry: CompactionEntry<T> = {
      type: "compaction",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendBranchSummary<T = unknown>(
    fromId: string,
    summary: string,
    details?: T,
    fromHook?: boolean
  ): string {
    const entry: BranchSummaryEntry<T> = {
      type: "branch_summary",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      fromId,
      summary,
      details,
      fromHook,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: CustomEntry = {
      type: "custom",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      customType,
      data,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: CustomMessageEntry<T>["content"],
    display: boolean,
    details?: T
  ): string {
    const entry: CustomMessageEntry<T> = {
      type: "custom_message",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      customType,
      content,
      display,
      details,
    };

    this.appendEntry(entry);
    return entry.id;
  }

  appendSessionInfo(name: string): string {
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      name: name.trim(),
    };

    this.appendEntry(entry);
    return entry.id;
  }

  getSessionName(): string | undefined {
    const entries = this.getEntries();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.type === "session_info" && entry.name) {
        return entry.name;
      }
    }
    return undefined;
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  getLeafEntry(): SessionEntry | undefined {
    return this.leafId ? this.byId.get(this.leafId) : undefined;
  }

  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }

  getLabel(id: string): string | undefined {
    return this.labelsById.get(id);
  }

  appendLabelChange(targetId: string, label: string | undefined): string {
    if (!this.byId.has(targetId)) {
      throw new Error(`Entry ${targetId} not found`);
    }

    const entry: LabelEntry = {
      type: "label",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId,
      label,
    };

    this.appendEntry(entry);

    if (label) {
      this.labelsById.set(targetId, label);
    } else {
      this.labelsById.delete(targetId);
    }

    return entry.id;
  }

  getBranch(fromId?: string): SessionEntry[] {
    const path: SessionEntry[] = [];
    const startId = fromId ?? this.leafId;
    let current = startId ? this.byId.get(startId) : undefined;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return path;
  }

  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId, this.byId);
  }

  getHeader(): SessionHeader | null {
    const header = this.fileEntries.find((entry) => entry.type === "session");
    return header ? header : null;
  }

  getEntries(): SessionEntry[] {
    return this.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
  }

  getTree(): SessionTreeNode[] {
    const entries = this.getEntries();
    const nodeMap = new Map<string, SessionTreeNode>();
    const roots: SessionTreeNode[] = [];

    for (const entry of entries) {
      const label = this.labelsById.get(entry.id);
      nodeMap.set(entry.id, { entry, children: [], label });
    }

    for (const entry of entries) {
      const node = nodeMap.get(entry.id)!;
      if (entry.parentId === null || entry.parentId === entry.id) {
        roots.push(node);
        continue;
      }

      const parent = nodeMap.get(entry.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const stack = [...roots];
    while (stack.length > 0) {
      const node = stack.pop()!;
      node.children.sort(
        (a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
      );
      stack.push(...node.children);
    }

    return roots;
  }

  branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
  }

  resetLeaf(): void {
    this.leafId = null;
  }

  branchWithSummary(
    branchFromId: string | null,
    summary: string,
    details?: unknown,
    fromHook?: boolean
  ): string {
    if (branchFromId !== null && !this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }

    this.leafId = branchFromId;

    const entry: BranchSummaryEntry = {
      type: "branch_summary",
      id: generateId(this.byId),
      parentId: branchFromId,
      timestamp: new Date().toISOString(),
      fromId: branchFromId ?? "root",
      summary,
      details,
      fromHook,
    };

    this.appendEntry(entry);
    return entry.id;
  }
}
