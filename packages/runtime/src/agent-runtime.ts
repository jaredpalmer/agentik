import {
  ToolLoopAgent,
  type LanguageModel,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolChoice,
  type ToolLoopAgentOnStepFinishCallback,
  stepCountIs,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";
import type {
  AgentCallOptions,
  AgentEvent,
  AgentMessage,
  AgentRuntimeOptions,
  AgentState,
  QueueMode,
} from "./types";
import { defaultConvertToModelMessages } from "./message-utils";
import { createToolSet } from "./toolset";

type StreamPart = TextStreamPart<ToolSet>;

export class AgentRuntime<CALL_OPTIONS = never> {
  private stateInternal: AgentState;
  private listeners = new Set<(event: AgentEvent) => void>();
  private convertToModelMessages: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>;
  private transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  private toolChoice?: ToolChoice<Record<string, unknown>>;
  private stopWhen?: AgentRuntimeOptions["stopWhen"];
  private output?: unknown;
  private providerOptions?: unknown;
  private callSettings?: unknown;
  private onEvent?: (event: AgentEvent) => void;
  private experimental_transform?:
    | StreamTextTransform<ToolSet>
    | Array<StreamTextTransform<ToolSet>>;
  private onStepFinish?: ToolLoopAgentOnStepFinishCallback<ToolSet>;
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private steeringMode: QueueMode;
  private followUpMode: QueueMode;
  private pendingSteeringMessages: AgentMessage[] | null = null;

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
    this.steeringMode = options.steeringMode ?? "one-at-a-time";
    this.followUpMode = options.followUpMode ?? "one-at-a-time";
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

  getSteeringMode(): QueueMode {
    return this.steeringMode;
  }

  setSteeringMode(mode: QueueMode): void {
    this.steeringMode = mode;
  }

  getFollowUpMode(): QueueMode {
    return this.followUpMode;
  }

  setFollowUpMode(mode: QueueMode): void {
    this.followUpMode = mode;
  }

  getQueueCounts(): { steering: number; followUp: number } {
    return {
      steering: this.steeringQueue.length,
      followUp: this.followUpQueue.length,
    };
  }

  enqueueSteeringMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.enqueueMessages(this.steeringQueue, input);
  }

  enqueueFollowUpMessage(input: string | AgentMessage | Array<string | AgentMessage>): void {
    this.enqueueMessages(this.followUpQueue, input);
  }

  dequeueLastSteeringMessage(): AgentMessage | undefined {
    return this.steeringQueue.pop();
  }

  dequeueLastFollowUpMessage(): AgentMessage | undefined {
    return this.followUpQueue.pop();
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

    let pendingMessages: AgentMessage[] = newMessages;

    try {
      while (true) {
        if (pendingMessages.length > 0) {
          this.appendMessages(pendingMessages);
        }

        await this.runOnce(options);

        const steeringMessages = this.pendingSteeringMessages ?? this.takeSteeringMessages();
        this.pendingSteeringMessages = null;
        if (steeringMessages.length > 0) {
          pendingMessages = steeringMessages;
          continue;
        }

        const followUpMessages = this.takeFollowUpMessages();
        if (followUpMessages.length > 0) {
          pendingMessages = followUpMessages;
          continue;
        }

        break;
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

  private appendMessages(messages: AgentMessage[]): void {
    for (const message of messages) {
      this.stateInternal.messages.push(message);
      this.emit({ type: "message_start", message });
      this.emit({ type: "message_end", message });
    }
  }

  private async runOnce(options: AgentCallOptions<CALL_OPTIONS>): Promise<void> {
    const context = this.transformContext
      ? await this.transformContext(this.stateInternal.messages, options.abortSignal)
      : this.stateInternal.messages;
    this.stateInternal.messages = context;

    const modelMessages = await this.convertToModelMessages(context);

    const endedToolCalls = new Set<string>();
    const startedToolCalls = new Set<string>();
    const emitToolExecutionStart = (options: {
      toolCallId?: string;
      toolName?: string;
      args: unknown;
    }) => {
      if (options.toolCallId && startedToolCalls.has(options.toolCallId)) {
        return;
      }
      if (options.toolCallId) {
        startedToolCalls.add(options.toolCallId);
      }
      this.emit({
        type: "tool_execution_start",
        toolCallId: options.toolCallId ?? "",
        toolName: options.toolName ?? "unknown",
        args: options.args,
      });
    };
    const toolSet = createToolSet(this.stateInternal.tools, {
      onStart: ({ toolCallId, toolName, input }) => {
        emitToolExecutionStart({ toolCallId, toolName, args: input });
      },
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
      stopWhen: this.buildStopWhen() as never,
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

    for await (const streamPart of result.fullStream as AsyncIterable<StreamPart>) {
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
          emitToolExecutionStart({
            toolCallId: streamPart.toolCallId,
            toolName: streamPart.toolName,
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
        case "reasoning-start":
        case "reasoning-delta":
        case "reasoning-end":
        case "tool-input-start":
        case "tool-input-delta":
        case "tool-input-end":
        case "source":
        case "file":
        case "tool-approval-request":
        case "start":
        case "finish":
        case "abort":
        case "raw":
          break;
        case "error":
          this.emit({ type: "error", error: streamPart.error });
          break;
        default: {
          const _exhaustive: never = streamPart;
          return _exhaustive;
        }
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
  }

  private buildStopWhen(): StopCondition<ToolSet> | Array<StopCondition<ToolSet>> | undefined {
    const steeringStopCondition = this.createSteeringStopCondition();
    const baseStopWhen = this.stopWhen ?? stepCountIs(20);
    if (Array.isArray(baseStopWhen)) {
      return [...baseStopWhen, steeringStopCondition] as Array<StopCondition<ToolSet>>;
    }
    return [baseStopWhen as StopCondition<ToolSet>, steeringStopCondition];
  }

  private createSteeringStopCondition(): StopCondition<ToolSet> {
    return async () => {
      if (this.pendingSteeringMessages && this.pendingSteeringMessages.length > 0) {
        return true;
      }
      const messages = this.takeSteeringMessages();
      if (messages.length > 0) {
        this.pendingSteeringMessages = messages;
        return true;
      }
      return false;
    };
  }

  private enqueueMessages(
    queue: AgentMessage[],
    input: string | AgentMessage | Array<string | AgentMessage>
  ): void {
    const messages = this.normalizeQueuedMessages(input);
    queue.push(...messages);
  }

  private normalizeQueuedMessages(
    input: string | AgentMessage | Array<string | AgentMessage>
  ): AgentMessage[] {
    const items = Array.isArray(input) ? input : [input];
    return items.map((item) =>
      typeof item === "string" ? ({ role: "user", content: item } as AgentMessage) : item
    );
  }

  private takeQueuedMessages(queue: AgentMessage[], mode: QueueMode): AgentMessage[] {
    if (queue.length === 0) {
      return [];
    }
    if (mode === "all") {
      return queue.splice(0, queue.length);
    }
    return [queue.shift()!];
  }

  private takeSteeringMessages(): AgentMessage[] {
    return this.takeQueuedMessages(this.steeringQueue, this.steeringMode);
  }

  private takeFollowUpMessages(): AgentMessage[] {
    return this.takeQueuedMessages(this.followUpQueue, this.followUpMode);
  }
}
