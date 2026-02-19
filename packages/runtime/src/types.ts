import type {
  FilePart,
  FlexibleSchema,
  ImagePart,
  ModelMessage,
  ProviderOptions,
  SystemModelMessage,
  TextPart,
  ToolNeedsApprovalFunction,
  ToolResultOutput,
} from "@ai-sdk/provider-utils";
import type { CallSettings, LanguageModel, ToolChoice } from "ai";
import type {
  Message,
  AssistantMessage,
  ToolCall,
  ToolResultMessage as OwnToolResultMessage,
} from "./messages";
import type { HookConfig } from "./hooks";

export interface CustomAgentMessages {}

type CustomAgentMessage = CustomAgentMessages[keyof CustomAgentMessages];
type UnionIfNotNever<A, B> = [B] extends [never] ? A : A | B;

export type AgentMessage = UnionIfNotNever<Message | ModelMessage, CustomAgentMessage>;

export type AgentToolResult<OUTPUT = unknown, UI = unknown> = {
  output: OUTPUT;
  ui?: UI;
};

export type AgentToolExecuteFunction<INPUT, OUTPUT, UI = unknown> = (
  input: INPUT,
  options: {
    toolCallId: string;
    messages: ModelMessage[];
    abortSignal?: AbortSignal;
    experimental_context?: unknown;
  }
) =>
  | AgentToolResult<OUTPUT, UI>
  | PromiseLike<AgentToolResult<OUTPUT, UI>>
  | AsyncIterable<AgentToolResult<OUTPUT, UI>>;

type AgentToolDefinitionBase<INPUT, OUTPUT, UI> = {
  name: string;
  description?: string;
  title?: string;
  label?: string;
  kind?: "subagent";
  subagentId?: string;
  inputSchema: FlexibleSchema<INPUT>;
  needsApproval?: boolean | ToolNeedsApprovalFunction<[INPUT] extends [never] ? unknown : INPUT>;
  toModelOutput?: (options: {
    toolCallId: string;
    input: [INPUT] extends [never] ? unknown : INPUT;
    output: OUTPUT;
    ui?: UI;
  }) => ToolResultOutput | PromiseLike<ToolResultOutput>;
  providerOptions?: ProviderOptions;
  strict?: boolean;
};

type AgentToolOutputConfig<INPUT, OUTPUT, UI> = [OUTPUT] extends [never]
  ? {
      execute?: never;
      outputSchema?: never;
    }
  :
      | {
          execute: AgentToolExecuteFunction<INPUT, OUTPUT, UI>;
          outputSchema?: FlexibleSchema<OUTPUT>;
        }
      | {
          execute?: never;
          outputSchema: FlexibleSchema<OUTPUT>;
        };

export type AgentToolDefinition<
  INPUT = unknown,
  OUTPUT = unknown,
  UI = unknown,
> = AgentToolDefinitionBase<INPUT, OUTPUT, UI> & AgentToolOutputConfig<INPUT, OUTPUT, UI>;

export type QueueMode = "one-at-a-time" | "all";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ThinkingBudgets = {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
};

export interface AgentState {
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  model: LanguageModel;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
  sessionId?: string;
  tools: AgentToolDefinition[];
  messages: AgentMessage[];
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  isStreaming: boolean;
  error?: string;
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | {
      type: "toolcall_end";
      contentIndex: number;
      toolCall: ToolCall;
      partial: AssistantMessage;
    }
  | {
      type: "done";
      reason: "stop" | "length" | "toolUse";
      message: AssistantMessage;
    }
  | {
      type: "error";
      reason: "aborted" | "error";
      error: AssistantMessage;
    };

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message: AgentMessage | null;
      toolResults: OwnToolResultMessage[] | unknown[];
    }
  | { type: "message_start"; message: AgentMessage }
  | {
      type: "message_update";
      message: AgentMessage;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: "subagent_start";
      toolCallId: string;
      subagentId: string;
      prompt: string;
    }
  | {
      type: "subagent_update";
      toolCallId: string;
      subagentId: string;
      delta: string;
      ui?: unknown;
    }
  | {
      type: "subagent_end";
      toolCallId: string;
      subagentId: string;
      output: string;
      isError: boolean;
      ui?: unknown;
    }
  | { type: "error"; error: unknown };

export type ResolveModelOptions = {
  model: LanguageModel;
  sessionId?: string;
};

export type AgentConfig = {
  model: LanguageModel;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  toolChoice?: ToolChoice<Record<string, unknown>>;
  providerOptions?: ProviderOptions;
  callSettings?: CallSettings;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  convertToModelMessages?: (
    messages: AgentMessage[]
  ) => ModelMessage[] | PromiseLike<ModelMessage[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  onEvent?: (event: AgentEvent) => void;
  sessionId?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
  maxSteps?: number;
  hooks?: HookConfig;
  resolveModel?: (options: ResolveModelOptions) => LanguageModel | PromiseLike<LanguageModel>;
  thinkingAdapter?: (options: {
    providerOptions?: ProviderOptions;
    thinkingLevel?: ThinkingLevel;
    thinkingBudgets?: ThinkingBudgets;
    sessionId?: string;
  }) => ProviderOptions | undefined;
  getApiKey?: (
    providerId: string,
    modelId?: string
  ) => string | undefined | PromiseLike<string | undefined>;
  apiKeyHeaders?: (options: {
    providerId: string;
    modelId?: string;
    apiKey: string;
  }) => Record<string, string> | undefined;
};

export type AgentCallOptions = {
  abortSignal?: AbortSignal;
  timeout?: number | { totalMs?: number; stepMs?: number; chunkMs?: number };
};

export type SessionHeader = {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

export type SessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

export type SessionMessageEntry = SessionEntryBase & {
  type: "message";
  message: AgentMessage;
  metadata?: Record<string, unknown>;
};

export type ThinkingLevelChangeEntry = SessionEntryBase & {
  type: "thinking_level_change";
  thinkingLevel: ThinkingLevel;
};

export type ModelChangeEntry = SessionEntryBase & {
  type: "model_change";
  provider: string;
  modelId: string;
};

export type CompactionEntry<T = unknown> = SessionEntryBase & {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
};

export type BranchSummaryEntry<T = unknown> = SessionEntryBase & {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
};

export type CustomEntry<T = unknown> = SessionEntryBase & {
  type: "custom";
  customType: string;
  data?: T;
};

export type CustomMessageEntry<T = unknown> = SessionEntryBase & {
  type: "custom_message";
  customType: string;
  content: string | Array<TextPart | ImagePart | FilePart>;
  details?: T;
  display: boolean;
};

export type LabelEntry = SessionEntryBase & {
  type: "label";
  targetId: string;
  label: string | undefined;
};

export type SessionInfoEntry = SessionEntryBase & {
  type: "session_info";
  name?: string;
};

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

export type SessionFileEntry = SessionHeader | SessionEntry;

export type SessionTree = {
  version: 1;
  entries: SessionEntry[];
};
