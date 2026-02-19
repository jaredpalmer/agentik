import type { SystemModelMessage } from "@ai-sdk/provider-utils";
import { jsonSchema } from "@ai-sdk/provider-utils";

import type { AgentConfig, AgentToolDefinition } from "./types";
import type { AssistantMessage, UserMessage } from "./messages";
import { agentLoop, type AgentLoopConfig, type AgentLoopContext } from "./agent-loop";

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

export type SubagentSpec = {
  id: string;
  config: AgentConfig;
  memory?: SharedMemoryStore;
};

export class SubagentRegistry {
  private agents = new Map<string, SubagentSpec>();

  register(spec: SubagentSpec): SubagentSpec {
    if (this.agents.has(spec.id)) {
      throw new Error(`Subagent ${spec.id} already exists.`);
    }
    this.agents.set(spec.id, spec);
    return spec;
  }

  get(id: string): SubagentSpec | undefined {
    return this.agents.get(id);
  }

  list(): SubagentSpec[] {
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

export type SubagentToolOptions = {
  id: string;
  registry: SubagentRegistry;
  name?: string;
  description?: string;
  label?: string;
};

export function createSubagentTool(
  options: SubagentToolOptions
): AgentToolDefinition<SubagentToolInput, string, AssistantMessage> {
  const spec = options.registry.get(options.id);
  if (!spec) {
    throw new Error(`Subagent ${options.id} is not registered.`);
  }

  const toolName = options.name ?? options.id;

  return {
    name: toolName,
    label: options.label ?? toolName,
    description: options.description ?? `Delegate work to ${options.id}.`,
    kind: "subagent",
    subagentId: options.id,
    inputSchema: subagentSchema,
    toModelOutput: ({ output }) => ({ type: "text", value: output ?? "" }),
    execute: async function* (input, execOptions) {
      const userMessage: UserMessage = {
        role: "user",
        content: input.prompt,
        timestamp: Date.now(),
      };

      const context: AgentLoopContext = {
        instructions: spec.config.instructions,
        messages: [],
        tools: spec.config.tools ?? [],
      };

      const loopConfig: AgentLoopConfig = {
        model: spec.config.model,
        toolChoice: spec.config.toolChoice,
        providerOptions: spec.config.providerOptions,
        callSettings: spec.config.callSettings,
        maxSteps: spec.config.maxSteps,
        convertToModelMessages: spec.config.convertToModelMessages,
        transformContext: spec.config.transformContext,
        thinkingLevel: spec.config.thinkingLevel,
        thinkingBudgets: spec.config.thinkingBudgets,
        thinkingAdapter: spec.config.thinkingAdapter,
        getApiKey: spec.config.getApiKey,
        apiKeyHeaders: spec.config.apiKeyHeaders,
        sessionId: spec.config.sessionId,
      };

      const eventStream = agentLoop([userMessage], context, loopConfig, execOptions.abortSignal);

      for await (const event of eventStream) {
        if (event.type === "message_end" && "stopReason" in event.message) {
          const msg = event.message;
          const text = msg.content
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("");
          yield { output: text, ui: msg };
        }
      }
    },
  } satisfies AgentToolDefinition<SubagentToolInput, string, AssistantMessage>;
}

export function createSubagentRegistry(specs: SubagentSpec[] = []): SubagentRegistry {
  const registry = new SubagentRegistry();
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
