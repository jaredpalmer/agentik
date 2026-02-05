/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to AI SDK ModelMessage format only at the LLM call boundary.
 * Uses AI SDK's streamText for the actual LLM calls.
 */

import {
  streamText,
  tool as aiSdkTool,
  type ModelMessage,
  type ToolCallPart,
  type ToolResultPart,
} from "ai";
import { EventStream } from "./event-stream.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  TextContent,
  ThinkingBudgets,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from "./types.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Start an agent loop with new prompt messages.
 * The prompts are added to the context and events are emitted for them.
 */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();

  void (async () => {
    const newMessages: AgentMessage[] = [...prompts];
    const currentContext: AgentContext = {
      ...context,
      messages: [...context.messages, ...prompts],
    };

    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });
    for (const prompt of prompts) {
      stream.push({ type: "message_start", message: prompt });
      stream.push({ type: "message_end", message: prompt });
    }

    await runLoop(currentContext, newMessages, config, signal, stream);
  })();

  return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries after overflow or errors.
 */
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal
): EventStream<AgentEvent, AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }

  const stream = createAgentStream();

  void (async () => {
    const newMessages: AgentMessage[] = [];
    const currentContext: AgentContext = { ...context };

    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });

    await runLoop(currentContext, newMessages, config, signal, stream);
  })();

  return stream;
}

// ============================================================================
// Internal
// ============================================================================

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : [])
  );
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>
): Promise<void> {
  let firstTurn = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  // Outer loop: continues when follow-up messages arrive after agent would stop
  while (true) {
    let hasMoreToolCalls = true;
    let steeringAfterTools: AgentMessage[] | null = null;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
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
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // Stream assistant response via AI SDK
      const message = await streamAssistantResponse(currentContext, config, signal, stream);
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
          currentContext.tools,
          message,
          signal,
          stream,
          config.getSteeringMessages,
          config.beforeToolCall,
          config.afterToolResult
        );
        toolResults.push(...toolExecution.toolResults);
        steeringAfterTools = toolExecution.steeringMessages ?? null;

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      stream.push({ type: "turn_end", message, toolResults });

      // Get steering messages after turn completes
      if (steeringAfterTools && steeringAfterTools.length > 0) {
        pendingMessages = steeringAfterTools;
        steeringAfterTools = null;
      } else {
        pendingMessages = (await config.getSteeringMessages?.()) || [];
      }
    }

    // Agent would stop here. Check for follow-up messages.
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
// AI SDK Integration
// ============================================================================

function createEmptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Convert our Message[] to AI SDK ModelMessage[].
 */
function convertToAiSdkMessages(messages: Message[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else {
          const parts = msg.content.map((c) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text };
            }
            // ImageContent -> AI SDK file part with base64 data
            return {
              type: "file" as const,
              data: c.data,
              mediaType: c.mimeType,
            };
          });
          result.push({ role: "user", content: parts });
        }
        break;
      }
      case "assistant": {
        const parts: ({ type: "text"; text: string } | ToolCallPart)[] = [];
        for (const c of msg.content) {
          if (c.type === "text") {
            parts.push({ type: "text", text: c.text });
          } else if (c.type === "toolCall") {
            parts.push({
              type: "tool-call",
              toolCallId: c.id,
              toolName: c.name,
              input: c.arguments,
            });
          }
          // ThinkingContent is not sent back to the LLM
        }
        if (parts.length > 0) {
          result.push({ role: "assistant", content: parts });
        }
        break;
      }
      case "toolResult": {
        const toolParts: ToolResultPart[] = [
          {
            type: "tool-result",
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            output: {
              type: "text",
              value: msg.content
                .map((c) => (c.type === "text" ? c.text : `[image: ${c.mimeType}]`))
                .join("\n"),
            },
          },
        ];
        result.push({ role: "tool", content: toolParts });
        break;
      }
    }
  }

  return result;
}

/**
 * Convert our AgentTool[] to AI SDK tool definitions (without execute - we handle execution ourselves).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToAiSdkTools(tools: AgentTool[] | undefined): Record<string, any> {
  if (!tools || tools.length === 0) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  for (const tool of tools) {
    result[tool.name] = aiSdkTool({
      description: tool.description,
      inputSchema: tool.parameters,
    });
  }
  return result;
}

const DEFAULT_THINKING_BUDGETS: Required<ThinkingBudgets> = {
  minimal: 1024,
  low: 4096,
  medium: 10000,
  high: 32000,
  xhigh: 100000,
};

/**
 * Get thinking budget tokens for a given thinking level.
 * Uses custom budgets if provided, otherwise falls back to defaults.
 */
function getThinkingBudget(
  level: string | undefined,
  customBudgets?: ThinkingBudgets
): number | undefined {
  if (!level || level === "off") return undefined;
  const key = level as keyof ThinkingBudgets;
  return customBudgets?.[key] ?? DEFAULT_THINKING_BUDGETS[key];
}

/**
 * Stream an assistant response from the LLM via AI SDK's streamText.
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>
): Promise<AssistantMessage> {
  // Apply context transform if configured
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // Convert to LLM-compatible messages
  const llmMessages = await config.convertToLlm(messages);

  // Convert to AI SDK format
  const aiSdkMessages = convertToAiSdkMessages(llmMessages);
  const aiSdkTools = convertToAiSdkTools(context.tools);

  // Build provider options for thinking/reasoning
  const providerOptions: Record<string, unknown> = {
    ...config.providerOptions,
  };
  const budget = getThinkingBudget(config.reasoning, config.thinkingBudgets);
  if (budget !== undefined) {
    providerOptions.anthropic = {
      ...(providerOptions.anthropic as Record<string, unknown> | undefined),
      thinking: { type: "enabled", budgetTokens: budget },
    };
  }

  // Build the partial assistant message for streaming updates
  const partialMessage: AssistantMessage = {
    role: "assistant",
    content: [],
    model: typeof config.model === "string" ? config.model : config.model.modelId,
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
    const result = streamText({
      model: config.model,
      system: context.systemPrompt || undefined,
      messages: aiSdkMessages,
      tools: aiSdkTools,
      // Default stopWhen is stepCountIs(1) - we handle the loop ourselves
      maxOutputTokens: config.maxTokens,
      temperature: config.temperature,
      abortSignal: signal,
      providerOptions:
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.keys(providerOptions).length > 0 ? (providerOptions as any) : undefined,
    });

    // Emit start
    stream.push({ type: "message_start", message: { ...partialMessage } });
    context.messages.push(partialMessage);
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
            // Start new text content if we didn't get text-start
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
            // Start new thinking if we didn't get reasoning-start
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

          // Push a placeholder toolCall
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

          // If we tracked this tool via tool-input-start, replace the placeholder
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
            // No prior tool-input events, emit start+end directly
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
          // Extract per-step usage
          const u = part.usage;
          partialMessage.usage = {
            input: u.inputTokens ?? 0,
            output: u.outputTokens ?? 0,
            cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWrite: u.inputTokenDetails?.cacheWriteTokens ?? 0,
            totalTokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          break;
        }

        case "finish": {
          // Map finish reason
          const hasToolCalls = partialMessage.content.some((c) => c.type === "toolCall");
          if (hasToolCalls) {
            partialMessage.stopReason = "toolUse";
          } else if (part.finishReason === "length") {
            partialMessage.stopReason = "length";
          } else {
            partialMessage.stopReason = "stop";
          }

          // Use totalUsage if we didn't get finish-step usage
          if (partialMessage.usage.totalTokens === 0 && part.totalUsage) {
            const u = part.totalUsage;
            partialMessage.usage = {
              input: u.inputTokens ?? 0,
              output: u.outputTokens ?? 0,
              cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0,
              cacheWrite: u.inputTokenDetails?.cacheWriteTokens ?? 0,
              totalTokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
        context.messages[context.messages.length - 1] = partialMessage;
      }
    }

    // Emit message_end
    const finalMessage: AssistantMessage = { ...partialMessage };
    if (addedPartial) {
      context.messages[context.messages.length - 1] = finalMessage;
    } else {
      context.messages.push(finalMessage);
    }
    stream.push({ type: "message_end", message: finalMessage });

    return finalMessage;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isAborted = signal?.aborted;

    partialMessage.stopReason = isAborted ? "aborted" : "error";
    partialMessage.errorMessage = errorMessage;

    if (addedPartial) {
      context.messages[context.messages.length - 1] = partialMessage;
    } else {
      context.messages.push(partialMessage);
      stream.push({ type: "message_start", message: { ...partialMessage } });
    }
    stream.push({ type: "message_end", message: partialMessage });

    return partialMessage;
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

async function executeToolCalls(
  tools: AgentTool[] | undefined,
  assistantMessage: AssistantMessage,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
  beforeToolCall?: AgentLoopConfig["beforeToolCall"],
  afterToolResult?: AgentLoopConfig["afterToolResult"]
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
  const toolCalls = assistantMessage.content.filter((c): c is ToolCall => c.type === "toolCall");
  const results: ToolResultMessage[] = [];
  let steeringMessages: AgentMessage[] | undefined;

  for (let index = 0; index < toolCalls.length; index++) {
    let toolCall = toolCalls[index];
    const tool = tools?.find((t) => t.name === toolCall.name);

    stream.push({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    let result: AgentToolResult<unknown> | undefined;
    let isError = false;

    try {
      if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

      // Call beforeToolCall hook
      if (beforeToolCall) {
        const hookResult = await beforeToolCall(toolCall, tool);
        if (hookResult.action === "block") {
          result = hookResult.result;
        } else if (hookResult.toolCall) {
          toolCall = hookResult.toolCall;
        }
      }

      if (!result) {
        result = await tool.execute(toolCall.id, toolCall.arguments, signal, (partialResult) => {
          stream.push({
            type: "tool_execution_update",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
            partialResult,
          });
        });
      }
    } catch (e) {
      result = {
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        details: {},
      };
      isError = true;
    }

    // result is always assigned at this point (either by hook, execute, or catch)
    const finalResult = result;

    stream.push({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: finalResult,
      isError,
    });

    let toolResultMessage: ToolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: finalResult.content,
      details: finalResult.details,
      isError,
      timestamp: Date.now(),
    };

    // Call afterToolResult hook
    if (afterToolResult) {
      toolResultMessage = await afterToolResult(toolCall, toolResultMessage);
    }

    results.push(toolResultMessage);
    stream.push({ type: "message_start", message: toolResultMessage });
    stream.push({ type: "message_end", message: toolResultMessage });

    // Check for steering messages - skip remaining tools if user interrupted
    if (getSteeringMessages) {
      const steering = await getSteeringMessages();
      if (steering.length > 0) {
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
  const result: AgentToolResult<unknown> = {
    content: [{ type: "text", text: "Skipped due to queued user message." }],
    details: {},
  };

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
    result,
    isError: true,
  });

  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: {},
    isError: true,
    timestamp: Date.now(),
  };

  stream.push({ type: "message_start", message: toolResultMessage });
  stream.push({ type: "message_end", message: toolResultMessage });

  return toolResultMessage;
}
