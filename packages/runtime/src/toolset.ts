import { tool } from "@ai-sdk/provider-utils";
import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import type { AgentToolDefinition, AgentToolExecuteFunction, AgentToolResult } from "./types";

export type ToolEventHandlers = {
  onStart?: (options: { toolCallId: string; toolName: string; input: unknown }) => void;
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
  shouldSkip?: () => false | { reason?: string };
};

type ToolExecuteResult<OUTPUT, UI> =
  | AgentToolResult<OUTPUT, UI>
  | PromiseLike<AgentToolResult<OUTPUT, UI>>
  | AsyncIterable<AgentToolResult<OUTPUT, UI>>;

type ExecutableToolDefinition<INPUT, OUTPUT, UI> = AgentToolDefinition<INPUT, OUTPUT, UI> & {
  execute: AgentToolExecuteFunction<INPUT, OUTPUT, UI>;
};

function isAsyncIterable<OUTPUT, UI>(
  value: unknown
): value is AsyncIterable<AgentToolResult<OUTPUT, UI>> {
  return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}

export function createToolSet(tools: AgentToolDefinition[], handlers?: ToolEventHandlers): ToolSet {
  const toolSet: ToolSet = {};

  for (const definition of tools) {
    toolSet[definition.name] = buildTool(definition, handlers);
  }

  return toolSet;
}

function buildTool<INPUT, OUTPUT, UI>(
  definition: AgentToolDefinition<INPUT, OUTPUT, UI>,
  handlers?: ToolEventHandlers
): AiTool<INPUT, OUTPUT> {
  const uiByToolCallId = new Map<string, UI | undefined>();

  const toModelOutput = definition.toModelOutput;

  const base = {
    description: definition.description,
    title: definition.title,
    inputSchema: definition.inputSchema,
    needsApproval: definition.needsApproval,
    providerOptions: definition.providerOptions,
    strict: definition.strict,
    toModelOutput: toModelOutput
      ? ({
          toolCallId,
          input,
          output,
        }: {
          toolCallId: string;
          input: [INPUT] extends [never] ? unknown : INPUT;
          output: OUTPUT;
        }) =>
          toModelOutput({
            toolCallId,
            input,
            output,
            ui: uiByToolCallId.get(toolCallId),
          })
      : undefined,
  };

  if (definition.execute) {
    const withExecute = {
      ...base,
      ...(definition.outputSchema ? { outputSchema: definition.outputSchema } : {}),
      execute: (input: INPUT, options: ToolExecutionOptions) =>
        executeTool(
          definition as ExecutableToolDefinition<INPUT, OUTPUT, UI>,
          input,
          options,
          handlers,
          uiByToolCallId
        ),
    };

    return tool(withExecute as AiTool);
  }

  const outputSchema = definition.outputSchema;
  if (!outputSchema) {
    throw new Error(`Tool ${definition.name} must define outputSchema when execute is not set.`);
  }

  return tool({
    ...base,
    outputSchema,
  } as AiTool);
}

function executeTool<INPUT, OUTPUT, UI>(
  definition: ExecutableToolDefinition<INPUT, OUTPUT, UI>,
  input: INPUT,
  options: ToolExecutionOptions,
  handlers: ToolEventHandlers | undefined,
  uiByToolCallId: Map<string, UI | undefined>
): AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT {
  handlers?.onStart?.({
    toolCallId: options.toolCallId,
    toolName: definition.name,
    input,
  });

  const skip = handlers?.shouldSkip?.();
  if (skip) {
    const result = {
      output: {
        skipped: true,
        reason: skip.reason ?? "Skipped by runtime.",
      },
    } as AgentToolResult<OUTPUT, UI>;
    handlers?.onEnd?.({
      toolCallId: options.toolCallId,
      toolName: definition.name,
      result,
      isError: true,
    });
    return result.output;
  }

  try {
    const result = definition.execute(input, options) as ToolExecuteResult<OUTPUT, UI>;

    if (isAsyncIterable(result)) {
      return (async function* () {
        let lastPartial: AgentToolResult<OUTPUT, UI> | undefined;
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

    return Promise.resolve(result)
      .then((resolved) => {
        const safeResult =
          resolved == null ? ({ output: undefined } as AgentToolResult<OUTPUT, UI>) : resolved;
        uiByToolCallId.set(options.toolCallId, safeResult.ui);
        handlers?.onEnd?.({
          toolCallId: options.toolCallId,
          toolName: definition.name,
          result: safeResult,
          isError: false,
        });
        return safeResult.output;
      })
      .catch((error) => {
        handlers?.onEnd?.({
          toolCallId: options.toolCallId,
          toolName: definition.name,
          result: { output: error },
          isError: true,
        });
        throw error;
      });
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
