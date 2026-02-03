import {
  ToolLoopAgent,
  type LanguageModel,
  type ProviderMetadata,
  type StreamTextTransform,
  type ToolChoice,
  type ToolLoopAgentOnStepFinishCallback,
  type ToolSet,
} from "ai";
import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";
import type {
  AgentCallOptions,
  AgentEvent,
  AgentMessage,
  AgentRuntimeOptions,
  AgentState,
} from "./types";
import { defaultConvertToModelMessages } from "./message-utils";
import { createToolSet } from "./toolset";

type StreamPart = {
  type: string;
  id?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  providerMetadata?: ProviderMetadata;
};

export class AgentRuntime<CALL_OPTIONS = never> {
  private stateInternal: AgentState;
  private listeners = new Set<(event: AgentEvent) => void>();
  private convertToModelMessages: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>;
  private transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  private toolChoice?: ToolChoice<Record<string, unknown>>;
  private stopWhen?: unknown;
  private output?: unknown;
  private providerOptions?: unknown;
  private callSettings?: unknown;
  private onEvent?: (event: AgentEvent) => void;
  private experimental_transform?:
    | StreamTextTransform<ToolSet>
    | Array<StreamTextTransform<ToolSet>>;
  private onStepFinish?: ToolLoopAgentOnStepFinishCallback<ToolSet>;

  constructor(options: AgentRuntimeOptions) {
    this.stateInternal = {
      instructions: options.instructions,
      model: options.model,
      tools: options.tools ?? [],
      messages: [],
      isStreaming: false,
    };
    this.toolChoice = options.toolChoice;
    this.stopWhen = options.stopWhen;
    this.output = options.output;
    this.providerOptions = options.providerOptions;
    this.callSettings = options.callSettings;
    this.convertToModelMessages = options.convertToModelMessages ?? defaultConvertToModelMessages;
    this.transformContext = options.transformContext;
    this.onEvent = options.onEvent;
  }

  get state(): AgentState {
    return this.stateInternal;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setInstructions(instructions?: string | SystemModelMessage | Array<SystemModelMessage>): void {
    this.stateInternal.instructions = instructions;
  }

  setModel(model: LanguageModel): void {
    this.stateInternal.model = model;
  }

  setTools(tools: AgentRuntimeOptions["tools"]): void {
    this.stateInternal.tools = tools ?? [];
  }

  setToolChoice(choice?: ToolChoice<Record<string, unknown>>): void {
    this.toolChoice = choice;
  }

  setTransform(
    transform?: (messages: AgentMessage[], signal?: AbortSignal) => PromiseLike<AgentMessage[]>
  ): void {
    this.transformContext = transform;
  }

  setConvertToModelMessages(
    convert?: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>
  ): void {
    this.convertToModelMessages = convert ?? defaultConvertToModelMessages;
  }

  async prompt(
    input: string | ModelMessage[],
    options: AgentCallOptions<CALL_OPTIONS> = {}
  ): Promise<void> {
    const messages = Array.isArray(input)
      ? input
      : ([{ role: "user", content: input }] satisfies ModelMessage[]);
    await this.run(messages, options);
  }

  async continue(options: AgentCallOptions<CALL_OPTIONS> = {}): Promise<void> {
    await this.run([], options);
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async run(
    newMessages: ModelMessage[],
    options: AgentCallOptions<CALL_OPTIONS>
  ): Promise<void> {
    if (this.stateInternal.isStreaming) {
      throw new Error("Agent is already running.");
    }

    this.stateInternal.isStreaming = true;
    this.stateInternal.error = undefined;
    this.emit({ type: "agent_start" });

    try {
      for (const message of newMessages) {
        this.stateInternal.messages.push(message);
        this.emit({ type: "message_start", message });
        this.emit({ type: "message_end", message });
      }

      const context = this.transformContext
        ? await this.transformContext(this.stateInternal.messages, options.abortSignal)
        : this.stateInternal.messages;
      this.stateInternal.messages = context;

      const modelMessages = await this.convertToModelMessages(context);

      const endedToolCalls = new Set<string>();
      const toolSet = createToolSet(this.stateInternal.tools, {
        onUpdate: ({ toolCallId, toolName, partialResult }) => {
          this.emit({
            type: "tool_execution_update",
            toolCallId,
            toolName,
            partialResult,
          });
        },
        onEnd: ({ toolCallId, toolName, result, isError }) => {
          endedToolCalls.add(toolCallId);
          this.emit({
            type: "tool_execution_end",
            toolCallId,
            toolName,
            result,
            isError,
          });
        },
      });

      const agent = new ToolLoopAgent<CALL_OPTIONS, ToolSet>({
        model: this.stateInternal.model,
        tools: toolSet,
        instructions: this.stateInternal.instructions,
        toolChoice: this.toolChoice,
        stopWhen: this.stopWhen as never,
        output: this.output as never,
        providerOptions: this.providerOptions as never,
        ...(this.callSettings as Record<string, unknown> | undefined),
      });

      const result = await agent.stream({
        messages: modelMessages,
        ...(options.options === undefined ? {} : { options: options.options as CALL_OPTIONS }),
        abortSignal: options.abortSignal,
        timeout: options.timeout,
        experimental_transform: this.experimental_transform,
        onStepFinish: this.onStepFinish as never,
      });

      let currentAssistant: AgentMessage | null = null;
      let currentToolResults: unknown[] = [];
      let lastAssistant: AgentMessage | null = null;

      for await (const part of result.fullStream) {
        const streamPart = part as StreamPart;
        switch (streamPart.type) {
          case "start-step":
            this.emit({ type: "turn_start" });
            currentToolResults = [];
            currentAssistant = null;
            break;
          case "finish-step":
            this.emit({
              type: "turn_end",
              message: currentAssistant ?? null,
              toolResults: currentToolResults,
            });
            break;
          case "text-start":
            currentAssistant = { role: "assistant", content: "" };
            this.emit({ type: "message_start", message: currentAssistant });
            break;
          case "text-delta":
            if (currentAssistant && typeof currentAssistant.content === "string") {
              currentAssistant.content += streamPart.text ?? "";
            }
            if (currentAssistant) {
              this.emit({
                type: "message_update",
                message: currentAssistant,
                delta: streamPart.text ?? "",
              });
            }
            break;
          case "text-end":
            if (currentAssistant) {
              lastAssistant = currentAssistant;
              this.emit({ type: "message_end", message: currentAssistant });
            }
            break;
          case "tool-call":
            this.emit({
              type: "tool_execution_start",
              toolCallId: streamPart.toolCallId ?? "",
              toolName: streamPart.toolName ?? "unknown",
              args: streamPart.input,
            });
            break;
          case "tool-result":
            currentToolResults.push(streamPart);
            if (streamPart.toolCallId && !endedToolCalls.has(streamPart.toolCallId)) {
              this.emit({
                type: "tool_execution_end",
                toolCallId: streamPart.toolCallId,
                toolName: streamPart.toolName ?? "unknown",
                result: streamPart.output,
                isError: false,
              });
            }
            break;
          case "tool-error":
            currentToolResults.push(streamPart);
            if (streamPart.toolCallId && !endedToolCalls.has(streamPart.toolCallId)) {
              this.emit({
                type: "tool_execution_end",
                toolCallId: streamPart.toolCallId,
                toolName: streamPart.toolName ?? "unknown",
                result: streamPart.error,
                isError: true,
              });
            }
            break;
          case "tool-output-denied":
            currentToolResults.push(streamPart);
            if (streamPart.toolCallId && !endedToolCalls.has(streamPart.toolCallId)) {
              this.emit({
                type: "tool_execution_end",
                toolCallId: streamPart.toolCallId,
                toolName: streamPart.toolName ?? "unknown",
                result: streamPart,
                isError: true,
              });
            }
            break;
          case "error":
            this.emit({ type: "error", error: streamPart.error });
            break;
          default:
            break;
        }
      }

      const response = await result.response;
      for (const message of response.messages) {
        if (message.role === "assistant") {
          lastAssistant = message;
        }
        if (message.role === "tool") {
          this.emit({ type: "message_start", message });
          this.emit({ type: "message_end", message });
        }
        this.stateInternal.messages.push(message);
      }

      if (lastAssistant != null && currentAssistant == null) {
        this.emit({
          type: "message_start",
          message: lastAssistant,
        });
        this.emit({
          type: "message_end",
          message: lastAssistant,
        });
      }

      this.emit({ type: "agent_end", messages: this.stateInternal.messages });
    } catch (error) {
      this.stateInternal.error = String(error);
      this.emit({ type: "error", error });
      throw error;
    } finally {
      this.stateInternal.isStreaming = false;
    }
  }
}
