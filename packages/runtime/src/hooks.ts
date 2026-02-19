import type { Message } from "./messages";

export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "SessionStart"
  | "SessionEnd"
  | "SubagentStart"
  | "SubagentStop";

export type PreToolUseDecision = "allow" | "deny" | "ask";

export type HookResult = {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: PreToolUseDecision;
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
};

export type HookInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId: string;
};

export type HookContext = {
  sessionId?: string;
  messages: Message[];
};

export type HookCallback = (
  input: HookInput,
  toolUseId: string | null,
  context: HookContext
) => HookResult | Promise<HookResult>;

export type HookMatcher = {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
};

export type HookConfig = Partial<Record<HookEventName, HookMatcher[]>>;

const DECISION_PRIORITY: Record<PreToolUseDecision, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export class HookRunner {
  constructor(private config: HookConfig) {}

  async runPreToolUse(
    input: HookInput,
    context: HookContext
  ): Promise<{
    decision: PreToolUseDecision;
    updatedInput?: Record<string, unknown>;
    reason?: string;
  }> {
    const matchers = this.getMatchingHooks("PreToolUse", input.toolName);
    let decision: PreToolUseDecision = "allow";
    let updatedInput: Record<string, unknown> | undefined;
    let reason: string | undefined;

    for (const matcher of matchers) {
      const results = await this.runCallbacks(matcher, input, input.toolCallId, context);
      for (const result of results) {
        const output = result.hookSpecificOutput;
        if (!output?.permissionDecision) continue;

        if (DECISION_PRIORITY[output.permissionDecision] > DECISION_PRIORITY[decision]) {
          decision = output.permissionDecision;
          reason = output.permissionDecisionReason;
        }
        if (output.updatedInput) {
          updatedInput = output.updatedInput;
        }
      }
    }

    return { decision, updatedInput, reason };
  }

  async runPostToolUse(
    input: HookInput,
    _output: unknown,
    context: HookContext
  ): Promise<{ systemMessages?: string[] }> {
    const matchers = this.getMatchingHooks("PostToolUse", input.toolName);
    const systemMessages: string[] = [];

    for (const matcher of matchers) {
      const results = await this.runCallbacks(matcher, input, input.toolCallId, context);
      for (const result of results) {
        if (result.systemMessage) {
          systemMessages.push(result.systemMessage);
        }
      }
    }

    return systemMessages.length > 0 ? { systemMessages } : {};
  }

  async runPostToolUseFailure(
    input: HookInput,
    _error: Error,
    context: HookContext
  ): Promise<void> {
    const matchers = this.getMatchingHooks("PostToolUseFailure", input.toolName);
    for (const matcher of matchers) {
      await this.runCallbacks(matcher, input, input.toolCallId, context);
    }
  }

  async runStop(context: HookContext): Promise<{ preventStop?: boolean }> {
    const matchers = this.getMatchingHooks("Stop");
    let preventStop = false;

    const dummyInput: HookInput = { toolName: "", toolInput: {}, toolCallId: "" };
    for (const matcher of matchers) {
      const results = await this.runCallbacks(matcher, dummyInput, null, context);
      for (const result of results) {
        if (result.continue) {
          preventStop = true;
        }
      }
    }

    return preventStop ? { preventStop } : {};
  }

  async runSessionStart(context: HookContext): Promise<void> {
    const matchers = this.getMatchingHooks("SessionStart");
    const dummyInput: HookInput = { toolName: "", toolInput: {}, toolCallId: "" };
    for (const matcher of matchers) {
      await this.runCallbacks(matcher, dummyInput, null, context);
    }
  }

  async runSessionEnd(context: HookContext): Promise<void> {
    const matchers = this.getMatchingHooks("SessionEnd");
    const dummyInput: HookInput = { toolName: "", toolInput: {}, toolCallId: "" };
    for (const matcher of matchers) {
      await this.runCallbacks(matcher, dummyInput, null, context);
    }
  }

  async runSubagentStart(subagentId: string, context: HookContext): Promise<void> {
    const matchers = this.getMatchingHooks("SubagentStart");
    const input: HookInput = { toolName: subagentId, toolInput: {}, toolCallId: "" };
    for (const matcher of matchers) {
      await this.runCallbacks(matcher, input, null, context);
    }
  }

  async runSubagentStop(subagentId: string, context: HookContext): Promise<void> {
    const matchers = this.getMatchingHooks("SubagentStop");
    const input: HookInput = { toolName: subagentId, toolInput: {}, toolCallId: "" };
    for (const matcher of matchers) {
      await this.runCallbacks(matcher, input, null, context);
    }
  }

  private getMatchingHooks(eventName: HookEventName, toolName?: string): HookMatcher[] {
    const matchers = this.config[eventName];
    if (!matchers) return [];
    if (!toolName) return matchers;

    return matchers.filter((m) => {
      if (!m.matcher) return true;
      try {
        return new RegExp(m.matcher).test(toolName);
      } catch {
        return false;
      }
    });
  }

  private async runCallbacks(
    matcher: HookMatcher,
    input: HookInput,
    toolUseId: string | null,
    context: HookContext
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of matcher.hooks) {
      try {
        const resultOrPromise = hook(input, toolUseId, context);
        const result =
          matcher.timeout != null
            ? await withTimeout(resultOrPromise, matcher.timeout)
            : await resultOrPromise;
        results.push(result);
      } catch (error) {
        console.error(`[HookRunner] Hook callback failed:`, error);
      }
    }

    return results;
  }
}

function withTimeout<T>(promise: T | Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Hook timed out")), ms)),
  ]);
}
