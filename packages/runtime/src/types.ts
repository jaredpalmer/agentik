import type {
  FlexibleSchema,
  ModelMessage,
  ProviderOptions,
  SystemModelMessage,
  ToolNeedsApprovalFunction,
  ToolResultOutput,
} from "@ai-sdk/provider-utils";
import type { CallSettings, LanguageModel, StopCondition, ToolChoice, ToolSet } from "ai";

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

export interface AgentState {
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  model: LanguageModel;
  tools: AgentToolDefinition[];
  messages: AgentMessage[];
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

export type AgentRuntimeOptions = {
  model: LanguageModel;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  toolChoice?: ToolChoice<ToolSet>;
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>;
  output?: unknown;
  providerOptions?: ProviderOptions;
  callSettings?: CallSettings;
  convertToModelMessages?: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  onEvent?: (event: AgentEvent) => void;
};

export type AgentCallOptions<CALL_OPTIONS = never> = {
  options?: CALL_OPTIONS;
  abortSignal?: AbortSignal;
  timeout?: number | { totalMs?: number; stepMs?: number; chunkMs?: number };
};

export type SessionEntry = {
  id: string;
  parentId?: string;
  message: AgentMessage;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type SessionTree = {
  version: 1;
  entries: SessionEntry[];
};
