import { streamText, type LanguageModel, type ToolChoice, type CallSettings } from "ai";
import { tool as aiSdkTool } from "@ai-sdk/provider-utils";
import type { ModelMessage, SystemModelMessage, ProviderOptions } from "@ai-sdk/provider-utils";
import { EventStream } from "./event-stream";
import { convertToModelMessages } from "./convert-messages";
import type { HookRunner, HookInput } from "./hooks";
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  Message,
} from "./messages";
import type {
  AgentMessage,
  AgentToolDefinition,
  AgentEvent,
  AgentToolResult,
  ThinkingLevel,
  ThinkingBudgets,
  AssistantMessageEvent,
} from "./types";

// ============================================================================
// Public Types
// ============================================================================

export type AgentLoopContext = {
  instructions?: string | SystemModelMessage | SystemModelMessage[];
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
};

export type ResolveModelFn = (options: {
  thinkingLevel?: ThinkingLevel;
}) => LanguageModel | PromiseLike<LanguageModel>;

export type ThinkingAdapterFn = (options: {
  providerOptions?: ProviderOptions;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
  sessionId?: string;
}) => ProviderOptions | undefined;

export type GetApiKeyFn = (
  providerId: string,
  modelId?: string
) => string | undefined | PromiseLike<string | undefined>;

export type ApiKeyHeadersFn = (options: {
  providerId: string;
  modelId?: string;
  apiKey: string;
}) => Record<string, string> | undefined;

export type AgentLoopConfig = {
  model: LanguageModel;
  convertToModelMessages?: (
    messages: AgentMessage[]
  ) => ModelMessage[] | PromiseLike<ModelMessage[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => PromiseLike<AgentMessage[]>;
  getSteeringMessages?: () => PromiseLike<AgentMessage[] | null>;
  getFollowUpMessages?: () => PromiseLike<AgentMessage[] | null>;
  hookRunner?: HookRunner;
  thinkingLevel?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
  thinkingAdapter?: ThinkingAdapterFn;
  resolveModel?: ResolveModelFn;
  getApiKey?: GetApiKeyFn;
  apiKeyHeaders?: ApiKeyHeadersFn;
  providerOptions?: ProviderOptions;
  callSettings?: CallSettings;
  toolChoice?: ToolChoice<Record<string, unknown>>;
  maxSteps?: number;
  sessionId?: string;
};

const DEFAULT_MAX_STEPS = 20;

const DEFAULT_THINKING_BUDGETS: Required<ThinkingBudgets> = {
  minimal: 1024,
  low: 4096,
  medium: 10000,
  high: 32000,
};

// ============================================================================
// Public API
// ============================================================================

export function agentLoop(
  prompts: AgentMessage[],
  context: AgentLoopContext,
  config: AgentLoopConfig,
  signal?: AbortSignal
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = new EventStream<AgentEvent, AgentMessage[]>();

  void (async () => {
    const newMessages: AgentMessage[] = [...prompts];
    const ctx: AgentLoopContext = {
      ...context,
      messages: [...context.messages, ...prompts],
    };

    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });
    for (const prompt of prompts) {
      stream.push({ type: "message_start", message: prompt });
      stream.push({ type: "message_end", message: prompt });
    }

    await runLoop(ctx, newMessages, config, signal, stream);
  })();

  return stream;
}

export function agentLoopContinue(
  context: AgentLoopContext,
  config: AgentLoopConfig,
  signal?: AbortSignal
): EventStream<AgentEvent, AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  const last = context.messages[context.messages.length - 1];
  if (last && typeof last === "object" && "role" in last && last.role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const stream = new EventStream<AgentEvent, AgentMessage[]>();

  void (async () => {
    const newMessages: AgentMessage[] = [];
    const ctx: AgentLoopContext = { ...context };

    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });

    await runLoop(ctx, newMessages, config, signal, stream);
  })();

  return stream;
}

// ============================================================================
// Internal: Main Loop
// ============================================================================

async function runLoop(
  ctx: AgentLoopContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>
): Promise<void> {
  let firstTurn = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];
  let stepCount = 0;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  // Outer loop: continues when follow-up messages arrive after agent would stop
  while (true) {
    let hasMoreToolCalls = true;
    let steeringAfterTools: AgentMessage[] | null = null;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (signal?.aborted) break;
      if (stepCount >= maxSteps) break;
      stepCount++;

      if (!firstTurn) {
        stream.push({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      // Process pending messages
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          stream.push({ type: "message_start", message });
          stream.push({ type: "message_end", message });
          ctx.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // Stream assistant response
      const message = await streamAssistantResponse(ctx, config, signal, stream);
      newMessages.push(message);

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        stream.push({ type: "turn_end", message, toolResults: [] });
        stream.push({ type: "agent_end", messages: newMessages });
        stream.end(newMessages);
        return;
      }

      // Check for tool calls
      const toolCalls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
      hasMoreToolCalls = toolCalls.length > 0;

      const toolResults: ToolResultMessage[] = [];
      if (hasMoreToolCalls) {
        const toolExecution = await executeToolCalls(
          ctx.tools,
          message,
          signal,
          stream,
          config.getSteeringMessages,
          config.hookRunner,
          ctx
        );
        toolResults.push(...toolExecution.toolResults);
        steeringAfterTools = toolExecution.steeringMessages ?? null;

        for (const result of toolResults) {
          ctx.messages.push(result);
          newMessages.push(result);
        }
      }

      stream.push({ type: "turn_end", message, toolResults });

      // Check steering after turn
      if (steeringAfterTools && steeringAfterTools.length > 0) {
        pendingMessages = steeringAfterTools;
        steeringAfterTools = null;
      } else {
        pendingMessages = (await config.getSteeringMessages?.()) || [];
      }
    }

    // Check for stop hook
    if (config.hookRunner) {
      const hookCtx = {
        sessionId: config.sessionId,
        messages: ctx.messages.filter((m): m is Message => isMessage(m)),
      };
      const stopResult = await config.hookRunner.runStop(hookCtx);
      if (stopResult.preventStop) {
        continue;
      }
    }

    // Check for follow-up messages
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }

    break;
  }

  stream.push({ type: "agent_end", messages: newMessages });
  stream.end(newMessages);
}

// ============================================================================
// Internal: Stream Assistant Response
// ============================================================================

function createEmptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0 };
}

function getThinkingBudget(
  level: ThinkingLevel | undefined,
  customBudgets?: ThinkingBudgets
): number | undefined {
  if (!level || level === "off") return undefined;
  const key = level as keyof ThinkingBudgets;
  return customBudgets?.[key] ?? DEFAULT_THINKING_BUDGETS[key];
}

function getSystemPrompt(
  instructions: AgentLoopContext["instructions"]
): string | SystemModelMessage[] | undefined {
  if (!instructions) return undefined;
  if (typeof instructions === "string") return instructions;
  if (Array.isArray(instructions)) return instructions;
  return [instructions];
}

async function streamAssistantResponse(
  ctx: AgentLoopContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>
): Promise<AssistantMessage> {
  // Apply context transform
  let messages = ctx.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // Convert messages to AI SDK format
  const convert = config.convertToModelMessages ?? convertToModelMessages;
  const llmMessages = await convert(messages);

  // Build tool definitions for LLM (schema only, no execute)
  const tools = createToolDefinitionsForLLM(ctx.tools);

  // Resolve model
  let model = config.model;
  if (config.resolveModel) {
    model = await config.resolveModel({ thinkingLevel: config.thinkingLevel });
  }

  // Build provider options (thinking budgets)
  let providerOptions: ProviderOptions | undefined = config.providerOptions
    ? { ...config.providerOptions }
    : undefined;

  if (config.thinkingAdapter) {
    providerOptions =
      config.thinkingAdapter({
        providerOptions,
        thinkingLevel: config.thinkingLevel,
        thinkingBudgets: config.thinkingBudgets,
        sessionId: config.sessionId,
      }) ?? providerOptions;
  } else {
    const budget = getThinkingBudget(config.thinkingLevel, config.thinkingBudgets);
    if (budget !== undefined) {
      providerOptions = {
        ...providerOptions,
        anthropic: {
          ...(providerOptions?.anthropic as Record<string, unknown> | undefined),
          thinking: { type: "enabled", budgetTokens: budget },
        },
      };
    }
  }

  // Build partial assistant message for streaming
  const partialMessage: AssistantMessage = {
    role: "assistant",
    content: [],
    model: typeof model === "string" ? model : model.modelId,
    usage: createEmptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };

  let addedPartial = false;
  let currentTextIndex = -1;
  let currentTextContent = "";
  let currentThinkingIndex = -1;
  let currentThinkingContent = "";
  let currentToolInputIndex = -1;
  let currentToolInputName = "";

  try {
    const systemPrompt = getSystemPrompt(ctx.instructions);
    const result = streamText({
      model,
      system: systemPrompt,
      messages: llmMessages,
      tools,
      toolChoice: config.toolChoice,
      abortSignal: signal,
      providerOptions,
      ...config.callSettings,
    });

    stream.push({ type: "message_start", message: { ...partialMessage } });
    ctx.messages.push(partialMessage);
    addedPartial = true;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-start": {
          currentTextIndex = partialMessage.content.length;
          partialMessage.content.push({ type: "text", text: "" });
          currentTextContent = "";

          const startEvent: AssistantMessageEvent = {
            type: "text_start",
            contentIndex: currentTextIndex,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: startEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "text-delta": {
          if (currentTextIndex === -1) {
            currentTextIndex = partialMessage.content.length;
            partialMessage.content.push({ type: "text", text: "" });
            currentTextContent = "";

            const startEvent: AssistantMessageEvent = {
              type: "text_start",
              contentIndex: currentTextIndex,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: startEvent,
              message: { ...partialMessage },
            });
          }

          currentTextContent += part.text;
          (partialMessage.content[currentTextIndex] as TextContent).text = currentTextContent;

          const deltaEvent: AssistantMessageEvent = {
            type: "text_delta",
            contentIndex: currentTextIndex,
            delta: part.text,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: deltaEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "text-end": {
          if (currentTextIndex !== -1) {
            const endEvent: AssistantMessageEvent = {
              type: "text_end",
              contentIndex: currentTextIndex,
              content: currentTextContent,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: endEvent,
              message: { ...partialMessage },
            });
            currentTextIndex = -1;
          }
          break;
        }

        case "reasoning-start": {
          currentThinkingIndex = partialMessage.content.length;
          partialMessage.content.push({ type: "thinking", thinking: "" });
          currentThinkingContent = "";

          const startEvent: AssistantMessageEvent = {
            type: "thinking_start",
            contentIndex: currentThinkingIndex,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: startEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "reasoning-delta": {
          if (currentThinkingIndex === -1) {
            currentThinkingIndex = partialMessage.content.length;
            partialMessage.content.push({ type: "thinking", thinking: "" });
            currentThinkingContent = "";

            const startEvent: AssistantMessageEvent = {
              type: "thinking_start",
              contentIndex: currentThinkingIndex,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: startEvent,
              message: { ...partialMessage },
            });
          }

          currentThinkingContent += part.text;
          (partialMessage.content[currentThinkingIndex] as ThinkingContent).thinking =
            currentThinkingContent;

          const thinkDeltaEvent: AssistantMessageEvent = {
            type: "thinking_delta",
            contentIndex: currentThinkingIndex,
            delta: part.text,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: thinkDeltaEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "reasoning-end": {
          if (currentThinkingIndex !== -1) {
            const endEvent: AssistantMessageEvent = {
              type: "thinking_end",
              contentIndex: currentThinkingIndex,
              content: currentThinkingContent,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: endEvent,
              message: { ...partialMessage },
            });
            currentThinkingIndex = -1;
          }
          break;
        }

        case "tool-input-start": {
          currentToolInputIndex = partialMessage.content.length;
          currentToolInputName = part.toolName;

          partialMessage.content.push({
            type: "toolCall",
            id: part.id,
            name: part.toolName,
            arguments: {},
          });

          const tcStartEvent: AssistantMessageEvent = {
            type: "toolcall_start",
            contentIndex: currentToolInputIndex,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: tcStartEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "tool-input-delta": {
          const tcDeltaEvent: AssistantMessageEvent = {
            type: "toolcall_delta",
            contentIndex: currentToolInputIndex,
            delta: part.delta,
            partial: { ...partialMessage },
          };
          stream.push({
            type: "message_update",
            assistantMessageEvent: tcDeltaEvent,
            message: { ...partialMessage },
          });
          break;
        }

        case "tool-call": {
          const toolCall: ToolCall = {
            type: "toolCall",
            id: part.toolCallId,
            name: part.toolName,
            arguments: part.input as Record<string, unknown>,
          };

          if (currentToolInputIndex !== -1 && currentToolInputName === part.toolName) {
            partialMessage.content[currentToolInputIndex] = toolCall;
            const tcEndEvent: AssistantMessageEvent = {
              type: "toolcall_end",
              contentIndex: currentToolInputIndex,
              toolCall,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: tcEndEvent,
              message: { ...partialMessage },
            });
            currentToolInputIndex = -1;
            currentToolInputName = "";
          } else {
            const toolCallIndex = partialMessage.content.length;
            partialMessage.content.push(toolCall);

            const tcStartEvent: AssistantMessageEvent = {
              type: "toolcall_start",
              contentIndex: toolCallIndex,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: tcStartEvent,
              message: { ...partialMessage },
            });

            const tcEndEvent: AssistantMessageEvent = {
              type: "toolcall_end",
              contentIndex: toolCallIndex,
              toolCall,
              partial: { ...partialMessage },
            };
            stream.push({
              type: "message_update",
              assistantMessageEvent: tcEndEvent,
              message: { ...partialMessage },
            });
          }
          break;
        }

        case "finish-step": {
          const u = part.usage;
          partialMessage.usage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
          };
          break;
        }

        case "finish": {
          const hasToolCalls = partialMessage.content.some((c) => c.type === "toolCall");
          if (hasToolCalls) {
            partialMessage.stopReason = "toolUse";
          } else if (part.finishReason === "length") {
            partialMessage.stopReason = "length";
          } else {
            partialMessage.stopReason = "stop";
          }

          if (partialMessage.usage.inputTokens === 0 && part.totalUsage) {
            const u = part.totalUsage;
            partialMessage.usage = {
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
              cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
            };
          }
          break;
        }

        case "error": {
          partialMessage.stopReason = "error";
          partialMessage.errorMessage = String(part.error);
          break;
        }
      }

      // Keep context in sync
      if (addedPartial) {
        ctx.messages[ctx.messages.length - 1] = partialMessage;
      }
    }

    // Finalize
    const finalMessage: AssistantMessage = { ...partialMessage };
    if (addedPartial) {
      ctx.messages[ctx.messages.length - 1] = finalMessage;
    } else {
      ctx.messages.push(finalMessage);
    }
    stream.push({ type: "message_end", message: finalMessage });

    return finalMessage;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isAborted = signal?.aborted;

    partialMessage.stopReason = isAborted ? "aborted" : "error";
    partialMessage.errorMessage = errorMsg;

    if (addedPartial) {
      ctx.messages[ctx.messages.length - 1] = partialMessage;
    } else {
      ctx.messages.push(partialMessage);
      stream.push({ type: "message_start", message: { ...partialMessage } });
    }
    stream.push({ type: "message_end", message: partialMessage });

    return partialMessage;
  }
}

// ============================================================================
// Internal: Tool Execution
// ============================================================================

async function executeToolCalls(
  tools: AgentToolDefinition[],
  assistantMessage: AssistantMessage,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  getSteeringMessages: AgentLoopConfig["getSteeringMessages"],
  hookRunner: HookRunner | undefined,
  ctx: AgentLoopContext
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
  const toolCalls = assistantMessage.content.filter((c): c is ToolCall => c.type === "toolCall");
  const results: ToolResultMessage[] = [];
  let steeringMessages: AgentMessage[] | undefined;

  for (let index = 0; index < toolCalls.length; index++) {
    let toolCall = toolCalls[index];
    const tool = tools.find((t) => t.name === toolCall.name);

    stream.push({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    let result: AgentToolResult | undefined;
    let isError = false;

    try {
      if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

      // Run PreToolUse hook
      if (hookRunner) {
        const hookInput: HookInput = {
          toolName: toolCall.name,
          toolInput: toolCall.arguments,
          toolCallId: toolCall.id,
        };
        const hookCtx = {
          sessionId: ctx.instructions ? undefined : undefined,
          messages: ctx.messages.filter((m): m is Message => isMessage(m)),
        };
        const hookResult = await hookRunner.runPreToolUse(hookInput, hookCtx);

        if (hookResult.decision === "deny") {
          result = {
            output: `Tool call denied: ${hookResult.reason ?? "blocked by hook"}`,
          };
          isError = true;
        } else if (hookResult.updatedInput) {
          toolCall = { ...toolCall, arguments: hookResult.updatedInput };
        }
      }

      if (!result && tool.execute) {
        const execResult = tool.execute(toolCall.arguments, {
          toolCallId: toolCall.id,
          messages: convertToModelMessages(ctx.messages),
          abortSignal: signal,
        });

        if (isAsyncIterable(execResult)) {
          // Handle streaming tool results
          let lastResult: AgentToolResult | undefined;
          for await (const partial of execResult) {
            lastResult = partial;
            stream.push({
              type: "tool_execution_update",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              partialResult: partial,
            });
          }
          result = lastResult;
        } else {
          result = await execResult;
        }
      }

      if (!result) {
        result = { output: "" };
      }

      // Run PostToolUse hook
      if (hookRunner && !isError) {
        const hookInput: HookInput = {
          toolName: toolCall.name,
          toolInput: toolCall.arguments,
          toolCallId: toolCall.id,
        };
        const hookCtx = {
          sessionId: undefined,
          messages: ctx.messages.filter((m): m is Message => isMessage(m)),
        };
        await hookRunner.runPostToolUse(hookInput, result, hookCtx);
      }
    } catch (e) {
      result = {
        output: e instanceof Error ? e.message : String(e),
      };
      isError = true;

      // Run PostToolUseFailure hook
      if (hookRunner) {
        const hookInput: HookInput = {
          toolName: toolCall.name,
          toolInput: toolCall.arguments,
          toolCallId: toolCall.id,
        };
        const hookCtx = {
          sessionId: undefined,
          messages: ctx.messages.filter((m): m is Message => isMessage(m)),
        };
        await hookRunner.runPostToolUseFailure(
          hookInput,
          e instanceof Error ? e : new Error(String(e)),
          hookCtx
        );
      }
    }

    const finalResult = result;

    stream.push({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: finalResult,
      isError,
    });

    const outputText =
      typeof finalResult.output === "string"
        ? finalResult.output
        : JSON.stringify(finalResult.output);

    const toolResultMessage: ToolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: outputText }],
      details: finalResult.output,
      isError,
      timestamp: Date.now(),
    };

    results.push(toolResultMessage);
    stream.push({ type: "message_start", message: toolResultMessage });
    stream.push({ type: "message_end", message: toolResultMessage });

    // Check for steering messages
    if (getSteeringMessages) {
      const steering = await getSteeringMessages();
      if (steering && steering.length > 0) {
        steeringMessages = steering;
        const remainingCalls = toolCalls.slice(index + 1);
        for (const skipped of remainingCalls) {
          results.push(skipToolCall(skipped, stream));
        }
        break;
      }
    }
  }

  return { toolResults: results, steeringMessages };
}

function skipToolCall(
  toolCall: ToolCall,
  stream: EventStream<AgentEvent, AgentMessage[]>
): ToolResultMessage {
  stream.push({
    type: "tool_execution_start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments,
  });
  stream.push({
    type: "tool_execution_end",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result: { output: "Skipped due to queued user message." },
    isError: true,
  });

  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: "Skipped due to queued user message." }],
    isError: true,
    timestamp: Date.now(),
  };

  stream.push({ type: "message_start", message: toolResultMessage });
  stream.push({ type: "message_end", message: toolResultMessage });

  return toolResultMessage;
}

// ============================================================================
// Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createToolDefinitionsForLLM(tools: AgentToolDefinition[]): Record<string, any> {
  if (tools.length === 0) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  for (const tool of tools) {
    result[tool.name] = aiSdkTool({
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
  }
  return result;
}

function isMessage(msg: unknown): msg is Message {
  if (msg == null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.timestamp === "number" &&
    (m.role === "user" || m.role === "assistant" || m.role === "toolResult")
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}
