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
import type {
  CallSettings,
  LanguageModel,
  AgentStreamParameters,
  StreamTextResult,
  PrepareStepFunction,
  StopCondition,
  StreamTextTransform,
  TextStreamPart,
  ToolLoopAgent,
  ToolChoice,
  ToolLoopAgentOnFinishCallback,
  ToolLoopAgentOnStepFinishCallback,
  ToolLoopAgentSettings,
  ToolSet,
} from "ai";

type AgentOutput = import("ai").Output.Output;

export interface CustomAgentMessages {}

type CustomAgentMessage = CustomAgentMessages[keyof CustomAgentMessages];
type UnionIfNotNever<A, B> = [B] extends [never] ? A : A | B;

export type AgentMessage = UnionIfNotNever<ModelMessage, CustomAgentMessage>;

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

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message: AgentMessage | null;
      toolResults: unknown[];
    }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: string }
  | { type: "message_end"; message: AgentMessage }
  | { type: "stream_part"; part: TextStreamPart<ToolSet> }
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
  | { type: "error"; error: unknown };

export type ResolveModelOptions<CALL_OPTIONS = never> = {
  model: LanguageModel;
  sessionId?: string;
  callOptions?: CALL_OPTIONS;
};

export type AgentConfig<CALL_OPTIONS = never> = {
  model: LanguageModel;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  toolChoice?: ToolChoice<ToolSet>;
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>;
  output?: AgentOutput;
  providerOptions?: ProviderOptions;
  callSettings?: CallSettings;
  prepareStep?: PrepareStepFunction<ToolSet>;
  callOptionsSchema?: ToolLoopAgentSettings<
    CALL_OPTIONS,
    ToolSet,
    AgentOutput
  >["callOptionsSchema"];
  prepareCall?: ToolLoopAgentSettings<CALL_OPTIONS, ToolSet, AgentOutput>["prepareCall"];
  onStepFinish?: ToolLoopAgentOnStepFinishCallback<ToolSet>;
  onFinish?: ToolLoopAgentOnFinishCallback<ToolSet>;
  experimental_transform?: StreamTextTransform<ToolSet> | Array<StreamTextTransform<ToolSet>>;
  streamFn?: (options: {
    agent: ToolLoopAgent<CALL_OPTIONS, ToolSet, AgentOutput>;
    params: AgentStreamParameters<CALL_OPTIONS, ToolSet>;
  }) => PromiseLike<StreamTextResult<ToolSet, AgentOutput>>;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  convertToModelMessages?: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  onEvent?: (event: AgentEvent) => void;
  loopStrategy?: "tool-loop-agent" | "manual";
  sessionId?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
  maxRetryDelayMs?: number;
  resolveModel?: (
    options: ResolveModelOptions<CALL_OPTIONS>
  ) => LanguageModel | PromiseLike<LanguageModel>;
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

export type AgentCallOptions<CALL_OPTIONS = never> = {
  options?: CALL_OPTIONS;
  abortSignal?: AbortSignal;
  timeout?: number | { totalMs?: number; stepMs?: number; chunkMs?: number };
  experimental_transform?: StreamTextTransform<ToolSet> | Array<StreamTextTransform<ToolSet>>;
  onStepFinish?: ToolLoopAgentOnStepFinishCallback<ToolSet>;
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
