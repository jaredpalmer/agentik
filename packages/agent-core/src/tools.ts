import { tool } from '@ai-sdk/provider-utils';
import type { Tool as AiTool, ToolExecutionOptions } from '@ai-sdk/provider-utils';
import type { ToolSet } from 'ai';
import type {
  AgentToolDefinition,
  AgentToolResult,
} from './types';

export type ToolEventHandlers = {
  onStart?: (options: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => void;
  onUpdate?: (options: {
    toolCallId: string;
    toolName: string;
    partialResult: AgentToolResult;
  }) => void;
  onEnd?: (options: {
    toolCallId: string;
    toolName: string;
    result: AgentToolResult;
    isError: boolean;
  }) => void;
};

type ToolExecuteResult = AgentToolResult | AsyncIterable<AgentToolResult>;

function isAsyncIterable(value: unknown): value is AsyncIterable<AgentToolResult> {
  return (
    value != null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in (value as object)
  );
}

export function createToolSet(
  tools: AgentToolDefinition[],
  handlers?: ToolEventHandlers,
): ToolSet {
  const toolSet: ToolSet = {};

  for (const definition of tools) {
    toolSet[definition.name] = buildTool(definition, handlers);
  }

  return toolSet;
}

function buildTool(definition: AgentToolDefinition, handlers?: ToolEventHandlers): AiTool {
  const uiByToolCallId = new Map<string, unknown>();

  return tool({
    description: definition.description,
    title: definition.title,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    needsApproval: definition.needsApproval,
    providerOptions: definition.providerOptions,
    strict: definition.strict,
    execute: definition.execute
      ? async (input, options) =>
          await executeTool(definition, input, options, handlers, uiByToolCallId)
      : undefined,
    toModelOutput: definition.toModelOutput
      ? ({ toolCallId, input, output }) =>
          definition.toModelOutput?.({
            toolCallId,
            input,
            output,
            ui: uiByToolCallId.get(toolCallId),
          })
      : undefined,
  });
}

async function executeTool(
  definition: AgentToolDefinition,
  input: unknown,
  options: ToolExecutionOptions,
  handlers: ToolEventHandlers | undefined,
  uiByToolCallId: Map<string, unknown>,
): Promise<unknown> {
  handlers?.onStart?.({
    toolCallId: options.toolCallId,
    toolName: definition.name,
    input,
  });

  try {
    const result = definition.execute?.(input, options) as ToolExecuteResult;

    if (isAsyncIterable(result)) {
      return (async function* () {
        let lastPartial: AgentToolResult | undefined;
        for await (const partial of result) {
          lastPartial = partial;
          uiByToolCallId.set(options.toolCallId, partial.ui);
          handlers?.onUpdate?.({
            toolCallId: options.toolCallId,
            toolName: definition.name,
            partialResult: partial,
          });
          yield partial.output;
        }
        if (lastPartial != null) {
          handlers?.onEnd?.({
            toolCallId: options.toolCallId,
            toolName: definition.name,
            result: lastPartial,
            isError: false,
          });
        }
      })();
    }

    const resolved = await result;
    const safeResult =
      resolved == null ? ({ output: undefined } as AgentToolResult) : resolved;
    uiByToolCallId.set(options.toolCallId, safeResult.ui);
    handlers?.onEnd?.({
      toolCallId: options.toolCallId,
      toolName: definition.name,
      result: safeResult,
      isError: false,
    });

    return safeResult.output;
  } catch (error) {
    handlers?.onEnd?.({
      toolCallId: options.toolCallId,
      toolName: definition.name,
      result: { output: error },
      isError: true,
    });
    throw error;
  }
}
