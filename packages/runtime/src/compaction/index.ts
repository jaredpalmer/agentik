import type { AgentMessage, SessionEntry } from "../types";
import { buildSessionContextEntries } from "../session-manager";

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
}

export interface PreparedCompaction {
  summaryInput: AgentMessage[];
  firstKeptEntryId: string;
  tokensBefore: number;
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") {
    return Math.ceil(content.length / 4);
  }

  if (Array.isArray(content)) {
    let chars = 0;
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      if ("text" in part && typeof (part as { text?: unknown }).text === "string") {
        chars += (part as { text: string }).text.length;
      } else if (
        "reasoning" in part &&
        typeof (part as { reasoning?: unknown }).reasoning === "string"
      ) {
        chars += (part as { reasoning: string }).reasoning.length;
      } else if ("input" in part && typeof (part as { input?: unknown }).input === "string") {
        chars += (part as { input: string }).input.length;
      }
    }
    return Math.ceil(chars / 4);
  }

  if (content != null) {
    try {
      return Math.ceil(JSON.stringify(content).length / 4);
    } catch {
      return 0;
    }
  }

  return 0;
}

export function estimateTokens(message: AgentMessage): number {
  if (!message || typeof message !== "object") {
    return 0;
  }

  const content = (message as { content?: unknown }).content;
  return estimateContentTokens(content);
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) {
    return false;
  }
  return contextTokens > contextWindow - settings.reserveTokens;
}

export function prepareCompaction(
  entries: SessionEntry[],
  leafId: string | null | undefined,
  settings: CompactionSettings
): PreparedCompaction | null {
  const { entries: contextEntries } = buildSessionContextEntries(entries, leafId);
  const messages = contextEntries.map((entry) => entry.message);
  const tokensBefore = estimateContextTokens(messages);

  if (messages.length === 0) {
    return null;
  }

  if (settings.keepRecentTokens <= 0) {
    const firstKeptEntryId = contextEntries[contextEntries.length - 1].entry.id;
    return {
      summaryInput: messages.slice(0, -1),
      firstKeptEntryId,
      tokensBefore,
    };
  }

  let runningTokens = 0;
  let cutIndex = contextEntries.length;

  for (let index = contextEntries.length - 1; index >= 0; index -= 1) {
    runningTokens += estimateTokens(contextEntries[index].message);
    if (runningTokens >= settings.keepRecentTokens) {
      cutIndex = index;
      break;
    }
  }

  if (cutIndex <= 0 || cutIndex >= contextEntries.length) {
    return null;
  }

  const firstKeptEntryId = contextEntries[cutIndex].entry.id;
  const summaryInput = messages.slice(0, cutIndex);

  if (summaryInput.length === 0) {
    return null;
  }

  return {
    summaryInput,
    firstKeptEntryId,
    tokensBefore,
  };
}

export async function compact(options: {
  entries: SessionEntry[];
  leafId?: string | null;
  contextWindow: number;
  settings?: Partial<CompactionSettings>;
  summarize: (
    messages: AgentMessage[],
    context: { thinkingLevel: string }
  ) => PromiseLike<string> | string;
}): Promise<CompactionResult | null> {
  const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...options.settings };
  const { context } = buildSessionContextEntries(options.entries, options.leafId);
  const contextTokens = estimateContextTokens(context.messages);

  if (!shouldCompact(contextTokens, options.contextWindow, settings)) {
    return null;
  }

  const prepared = prepareCompaction(options.entries, options.leafId, settings);
  if (!prepared) {
    return null;
  }

  const summary = await options.summarize(prepared.summaryInput, {
    thinkingLevel: context.thinkingLevel,
  });

  if (!summary) {
    return null;
  }

  return {
    summary,
    firstKeptEntryId: prepared.firstKeptEntryId,
    tokensBefore: prepared.tokensBefore,
  };
}
