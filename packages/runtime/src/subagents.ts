import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";
import { jsonSchema } from "@ai-sdk/provider-utils";
import {
  ToolLoopAgent,
  readUIMessageStream,
  type ToolLoopAgentOnFinishCallback,
  type ToolLoopAgentOnStepFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";
import { createPrepareCall, createPrepareStep } from "./agent-config-utils";
import type { AgentConfig, AgentToolDefinition } from "./types";
import { createToolSet } from "./toolset";

export type SharedMemorySnapshot = Record<string, unknown>;

export class SharedMemoryStore {
  private data = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  snapshot(): SharedMemorySnapshot {
    return Object.fromEntries(this.data.entries());
  }
}

export type SubagentSpec<CALL_OPTIONS = never> = {
  id: string;
  config: AgentConfig<CALL_OPTIONS>;
  memory?: SharedMemoryStore;
};

export class SubagentRegistry<CALL_OPTIONS = never> {
  private agents = new Map<string, SubagentSpec<CALL_OPTIONS>>();

  register(spec: SubagentSpec<CALL_OPTIONS>): SubagentSpec<CALL_OPTIONS> {
    if (this.agents.has(spec.id)) {
      throw new Error(`Subagent ${spec.id} already exists.`);
    }
    this.agents.set(spec.id, spec);
    return spec;
  }

  get(id: string): SubagentSpec<CALL_OPTIONS> | undefined {
    return this.agents.get(id);
  }

  list(): SubagentSpec<CALL_OPTIONS>[] {
    return Array.from(this.agents.values());
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }
}

export type SubagentToolInput = {
  prompt: string;
};

const subagentSchema = jsonSchema<SubagentToolInput>({
  type: "object",
  properties: {
    prompt: { type: "string", description: "Prompt to send to the subagent." },
  },
  required: ["prompt"],
  additionalProperties: false,
});

export type SubagentToolOptions<CALL_OPTIONS = never> = {
  id: string;
  registry: SubagentRegistry<CALL_OPTIONS>;
  name?: string;
  description?: string;
  label?: string;
};

function uiMessageToText(message: UIMessage): string {
  const parts = message.parts ?? [];
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function buildToolLoopAgent<CALL_OPTIONS>(
  config: AgentConfig<CALL_OPTIONS>,
  tools: AgentToolDefinition[]
) {
  const toolSet = createToolSet(tools ?? []);

  return new ToolLoopAgent<CALL_OPTIONS, ToolSet>({
    model: config.model,
    tools: toolSet,
    instructions: config.instructions,
    toolChoice: config.toolChoice,
    stopWhen: config.stopWhen as never,
    output: config.output as never,
    providerOptions: config.providerOptions,
    prepareStep: createPrepareStep(config),
    prepareCall: createPrepareCall(config),
    callOptionsSchema: config.callOptionsSchema,
    onStepFinish: config.onStepFinish as ToolLoopAgentOnStepFinishCallback<ToolSet>,
    onFinish: config.onFinish as ToolLoopAgentOnFinishCallback<ToolSet>,
    ...(config.callSettings as Record<string, unknown> | undefined),
  });
}

export function createSubagentTool<CALL_OPTIONS = never>(
  options: SubagentToolOptions<CALL_OPTIONS>
): AgentToolDefinition<SubagentToolInput, string, UIMessage> {
  const spec = options.registry.get(options.id);
  if (!spec) {
    throw new Error(`Subagent ${options.id} is not registered.`);
  }

  const toolName = options.name ?? options.id;

  return {
    name: toolName,
    label: options.label ?? toolName,
    description: options.description ?? `Delegate work to ${options.id}.`,
    inputSchema: subagentSchema,
    toModelOutput: ({ output }) => ({ type: "text", value: output ?? "" }),
    execute: async function* (input, execOptions) {
      const agent = buildToolLoopAgent(spec.config, spec.config.tools ?? []);
      const messages = [{ role: "user", content: input.prompt }] satisfies ModelMessage[];

      const streamParams = {
        messages,
        abortSignal: execOptions.abortSignal,
      } as const;

      const stream = spec.config.streamFn
        ? await spec.config.streamFn({ agent, params: streamParams })
        : await agent.stream(streamParams);

      const uiStream = stream.toUIMessageStream();
      let lastText = "";

      for await (const uiMessage of readUIMessageStream({ stream: uiStream })) {
        lastText = uiMessageToText(uiMessage);
        yield {
          output: lastText,
          ui: uiMessage,
        };
      }

      return;
    },
  } satisfies AgentToolDefinition<SubagentToolInput, string, UIMessage>;
}

export function createSubagentRegistry<CALL_OPTIONS = never>(
  specs: SubagentSpec<CALL_OPTIONS>[] = []
): SubagentRegistry<CALL_OPTIONS> {
  const registry = new SubagentRegistry<CALL_OPTIONS>();
  for (const spec of specs) {
    registry.register(spec);
  }
  return registry;
}

export type SubagentOptions = {
  id: string;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  memory?: SharedMemoryStore;
};

export type SubagentInstance = SubagentSpec;
