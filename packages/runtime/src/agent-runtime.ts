import {
  ToolLoopAgent,
  type LanguageModel,
  type PrepareStepFunction,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolLoopAgentOnFinishCallback,
  type ToolLoopAgentOnStepFinishCallback,
  stepCountIs,
  type StopCondition,
  type ToolSet,
} from "ai";
import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";
import type {
  AgentCallOptions,
  AgentConfig,
  AgentEvent,
  AgentMessage,
  AgentState,
  QueueMode,
  ResolveModelOptions,
  ThinkingBudgets,
  ThinkingLevel,
} from "./types";
import { createPrepareCall, createPrepareStep } from "./agent-config-utils";
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
  private toolChoice?: AgentConfig["toolChoice"];
  private stopWhen?: AgentConfig["stopWhen"];
  private output?: AgentConfig["output"];
  private providerOptions?: AgentConfig["providerOptions"];
  private callSettings?: AgentConfig["callSettings"];
  private prepareStep?: PrepareStepFunction<ToolSet>;
  private prepareCall?: AgentConfig<CALL_OPTIONS>["prepareCall"];
  private callOptionsSchema?: AgentConfig<CALL_OPTIONS>["callOptionsSchema"];
  private onFinish?: ToolLoopAgentOnFinishCallback<ToolSet>;
  private onEvent?: (event: AgentEvent) => void;
  private experimentalTransform?:
    | StreamTextTransform<ToolSet>
    | Array<StreamTextTransform<ToolSet>>;
  private onStepFinish?: ToolLoopAgentOnStepFinishCallback<ToolSet>;
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private steeringMode: QueueMode;
  private followUpMode: QueueMode;
  private pendingSteeringMessages: AgentMessage[] | null = null;
  private loopStrategy: "tool-loop-agent" | "manual";
  private sessionId?: string;
  private thinkingLevel?: ThinkingLevel;
  private thinkingBudgets?: ThinkingBudgets;
  private maxRetryDelayMs?: number;
  private resolveModel?: (
    options: ResolveModelOptions<CALL_OPTIONS>
  ) => LanguageModel | PromiseLike<LanguageModel>;
  private thinkingAdapter?: AgentConfig<CALL_OPTIONS>["thinkingAdapter"];
  private getApiKey?: AgentConfig<CALL_OPTIONS>["getApiKey"];
  private apiKeyHeaders?: AgentConfig<CALL_OPTIONS>["apiKeyHeaders"];
  private streamFn?: AgentConfig<CALL_OPTIONS>["streamFn"];
  private skipToolCalls = false;
  private activeAbortController?: AbortController;

  constructor(options: AgentConfig<CALL_OPTIONS>) {
    this.stateInternal = {
      instructions: options.instructions,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      thinkingBudgets: options.thinkingBudgets,
      sessionId: options.sessionId,
      tools: options.tools ?? [],
      messages: [],
      streamMessage: null,
      pendingToolCalls: new Set<string>(),
      isStreaming: false,
    };
    this.toolChoice = options.toolChoice;
    this.stopWhen = options.stopWhen;
    this.output = options.output;
    this.providerOptions = options.providerOptions;
    this.callSettings = options.callSettings;
    this.prepareStep = options.prepareStep;
    this.prepareCall = options.prepareCall;
    this.callOptionsSchema = options.callOptionsSchema;
    this.onStepFinish = options.onStepFinish;
    this.onFinish = options.onFinish;
    this.experimentalTransform = options.experimental_transform;
    this.steeringMode = options.steeringMode ?? "one-at-a-time";
    this.followUpMode = options.followUpMode ?? "one-at-a-time";
    this.loopStrategy = options.loopStrategy ?? "tool-loop-agent";
    this.sessionId = options.sessionId;
    this.thinkingLevel = options.thinkingLevel;
    this.thinkingBudgets = options.thinkingBudgets;
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.resolveModel = options.resolveModel;
    this.thinkingAdapter = options.thinkingAdapter;
    this.getApiKey = options.getApiKey;
    this.apiKeyHeaders = options.apiKeyHeaders;
    this.streamFn = options.streamFn;
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

  setTools(tools: AgentConfig["tools"]): void {
    this.stateInternal.tools = tools ?? [];
  }

  setToolChoice(choice?: AgentConfig["toolChoice"]): void {
    this.toolChoice = choice;
  }

  setThinkingLevel(level?: ThinkingLevel): void {
    this.thinkingLevel = level;
    this.stateInternal.thinkingLevel = level;
  }

  setThinkingBudgets(budgets?: ThinkingBudgets): void {
    this.thinkingBudgets = budgets;
    this.stateInternal.thinkingBudgets = budgets;
  }

  setSessionId(sessionId?: string): void {
    this.sessionId = sessionId;
    this.stateInternal.sessionId = sessionId;
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

  replaceMessages(messages: AgentMessage[]): void {
    this.stateInternal.messages = messages.slice();
  }

  appendMessage(message: AgentMessage): void {
    this.appendMessages([message]);
  }

  clearMessages(): void {
    this.stateInternal.messages = [];
  }

  getSteeringMode(): QueueMode {
    return this.steeringMode;
  }

  setSteeringMode(mode: QueueMode): void {
    this.steeringMode = mode;
  }

  getLoopStrategy(): "tool-loop-agent" | "manual" {
    return this.loopStrategy;
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
    if (this.stateInternal.isStreaming) {
      this.skipToolCalls = true;
    }
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

  clearSteeringQueue(): void {
    this.steeringQueue = [];
  }

  clearFollowUpQueue(): void {
    this.followUpQueue = [];
  }

  clearAllQueues(): void {
    this.steeringQueue = [];
    this.followUpQueue = [];
  }

  abort(): void {
    this.activeAbortController?.abort();
  }

  reset(): void {
    this.stateInternal.messages = [];
    this.stateInternal.streamMessage = null;
    this.stateInternal.pendingToolCalls.clear();
    this.stateInternal.isStreaming = false;
    this.stateInternal.error = undefined;
    this.clearAllQueues();
    this.skipToolCalls = false;
    this.pendingSteeringMessages = null;
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

    const abortController = options.abortSignal ? undefined : new AbortController();
    this.activeAbortController = abortController;
    const abortSignal = options.abortSignal ?? abortController?.signal;

    let pendingMessages: AgentMessage[] = newMessages;

    try {
      while (true) {
        if (pendingMessages.length > 0) {
          this.appendMessages(pendingMessages);
        }

        await this.runOnce({ ...options, abortSignal });

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
      this.stateInternal.streamMessage = null;
      this.stateInternal.pendingToolCalls.clear();
      this.activeAbortController = undefined;
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

    const toolDefinitions = new Map(this.stateInternal.tools.map((tool) => [tool.name, tool]));
    const stringifyValue = (value: unknown): string => {
      if (typeof value === "string") {
        return value;
      }
      if (value == null) {
        return "";
      }
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        try {
          return String(value);
        } catch {
          return "";
        }
      }
    };
    const getSubagentId = (toolName: string): string | undefined => {
      const definition = toolDefinitions.get(toolName);
      if (definition?.kind !== "subagent") {
        return undefined;
      }
      return definition.subagentId ?? definition.name;
    };
    const getPromptFromArgs = (args: unknown): string => {
      if (args && typeof args === "object" && "prompt" in args) {
        const prompt = (args as { prompt?: unknown }).prompt;
        if (typeof prompt === "string") {
          return prompt;
        }
      }
      return stringifyValue(args);
    };

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
      if (options.toolCallId) {
        this.stateInternal.pendingToolCalls.add(options.toolCallId);
      }
      this.emit({
        type: "tool_execution_start",
        toolCallId: options.toolCallId ?? "",
        toolName: options.toolName ?? "unknown",
        args: options.args,
      });
      if (options.toolCallId && options.toolName) {
        const subagentId = getSubagentId(options.toolName);
        if (subagentId) {
          this.emit({
            type: "subagent_start",
            toolCallId: options.toolCallId,
            subagentId,
            prompt: getPromptFromArgs(options.args),
          });
        }
      }
    };
    const finalizeToolCall = (options: {
      toolCallId?: string;
      toolName?: string;
      result: unknown;
      isError: boolean;
    }) => {
      if (!options.toolCallId || endedToolCalls.has(options.toolCallId)) {
        return;
      }
      this.stateInternal.pendingToolCalls.delete(options.toolCallId);
      this.emit({
        type: "tool_execution_end",
        toolCallId: options.toolCallId,
        toolName: options.toolName ?? "unknown",
        result: options.result,
        isError: options.isError,
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
        const subagentId = getSubagentId(toolName);
        if (subagentId) {
          const result = partialResult as { output?: unknown; ui?: unknown };
          this.emit({
            type: "subagent_update",
            toolCallId,
            subagentId,
            delta: stringifyValue(result?.output),
            ui: result?.ui,
          });
        }
      },
      onEnd: ({ toolCallId, toolName, result, isError }) => {
        endedToolCalls.add(toolCallId);
        this.stateInternal.pendingToolCalls.delete(toolCallId);
        this.emit({
          type: "tool_execution_end",
          toolCallId,
          toolName,
          result,
          isError,
        });
        const subagentId = getSubagentId(toolName);
        if (subagentId) {
          const finalResult = result as { output?: unknown; ui?: unknown };
          this.emit({
            type: "subagent_end",
            toolCallId,
            subagentId,
            output: stringifyValue(finalResult?.output),
            isError,
            ui: finalResult?.ui,
          });
        }
      },
      shouldSkip: () =>
        this.skipToolCalls
          ? {
              reason: "Skipped due to queued user message.",
            }
          : false,
    });

    const agent = new ToolLoopAgent<CALL_OPTIONS, ToolSet>({
      model: this.stateInternal.model,
      tools: toolSet,
      instructions: this.stateInternal.instructions,
      toolChoice: this.toolChoice,
      stopWhen: this.buildStopWhen() as never,
      output: this.output as never,
      providerOptions: this.providerOptions as never,
      prepareStep: this.buildPrepareStep(),
      prepareCall: this.buildPrepareCall(),
      callOptionsSchema: this.callOptionsSchema,
      onStepFinish: this.onStepFinish as never,
      onFinish: this.onFinish as never,
      ...(this.callSettings as Record<string, unknown> | undefined),
    });

    const timeout = this.resolveTimeout(options.timeout);
    const experimentalTransform = options.experimental_transform ?? this.experimentalTransform;

    const streamParams = {
      messages: modelMessages,
      ...(options.options === undefined ? {} : { options: options.options as CALL_OPTIONS }),
      abortSignal: options.abortSignal,
      timeout,
      experimental_transform: experimentalTransform,
      onStepFinish: options.onStepFinish as never,
    } as const;

    const result = this.streamFn
      ? await this.streamFn({ agent, params: streamParams })
      : await agent.stream(streamParams);

    let currentAssistant: AgentMessage | null = null;
    let currentToolResults: unknown[] = [];
    let lastAssistant: AgentMessage | null = null;

    this.skipToolCalls = false;

    for await (const streamPart of result.fullStream as AsyncIterable<StreamPart>) {
      this.emit({ type: "stream_part", part: streamPart });

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
          this.stateInternal.streamMessage = currentAssistant;
          this.emit({ type: "message_start", message: currentAssistant });
          break;
        case "text-delta":
          if (currentAssistant && typeof currentAssistant.content === "string") {
            currentAssistant.content += streamPart.text ?? "";
          }
          if (currentAssistant) {
            this.stateInternal.streamMessage = currentAssistant;
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
            this.stateInternal.streamMessage = null;
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
          finalizeToolCall({
            toolCallId: streamPart.toolCallId,
            toolName: streamPart.toolName,
            result: streamPart.output,
            isError: false,
          });
          break;
        case "tool-error":
          currentToolResults.push(streamPart);
          finalizeToolCall({
            toolCallId: streamPart.toolCallId,
            toolName: streamPart.toolName,
            result: streamPart.error,
            isError: true,
          });
          break;
        case "tool-output-denied":
          currentToolResults.push(streamPart);
          finalizeToolCall({
            toolCallId: streamPart.toolCallId,
            toolName: streamPart.toolName,
            result: streamPart,
            isError: true,
          });
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

  private resolveTimeout(
    timeout: AgentCallOptions<CALL_OPTIONS>["timeout"]
  ): AgentCallOptions<CALL_OPTIONS>["timeout"] {
    if (timeout != null) {
      return timeout;
    }
    if (this.maxRetryDelayMs != null && this.maxRetryDelayMs > 0) {
      return { stepMs: this.maxRetryDelayMs };
    }
    return undefined;
  }

  private buildPrepareStep(): PrepareStepFunction<ToolSet> | undefined {
    return createPrepareStep(
      {
        prepareStep: this.prepareStep,
        resolveModel: this.resolveModel,
        thinkingAdapter: this.thinkingAdapter,
        thinkingLevel: this.thinkingLevel,
        thinkingBudgets: this.thinkingBudgets,
        sessionId: this.sessionId,
      },
      { preserveProviderOptions: true }
    );
  }

  private buildPrepareCall(): AgentConfig<CALL_OPTIONS>["prepareCall"] | undefined {
    return createPrepareCall(
      {
        prepareCall: this.prepareCall,
        resolveModel: this.resolveModel,
        thinkingAdapter: this.thinkingAdapter,
        thinkingLevel: this.thinkingLevel,
        thinkingBudgets: this.thinkingBudgets,
        sessionId: this.sessionId,
        getApiKey: this.getApiKey,
        apiKeyHeaders: this.apiKeyHeaders,
      },
      { preserveProviderOptions: true }
    );
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
