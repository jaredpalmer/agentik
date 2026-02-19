import type { LanguageModel } from "ai";

import type { AgentToolDefinition } from "./types";
import type { SubagentRegistry } from "./subagents";
import { createSubagentTool } from "./subagents";

export type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  model?: LanguageModel;
};

export type CreateAgentToolsOptions = {
  defaultModel: LanguageModel;
  allTools: AgentToolDefinition[];
};

/**
 * Given a map of { name: AgentDefinition }, creates SubagentSpec entries
 * in the registry and returns an array of AgentToolDefinition (one per agent)
 * with kind: "subagent".
 */
export function createAgentTools(
  definitions: Record<string, AgentDefinition>,
  registry: SubagentRegistry,
  options: CreateAgentToolsOptions
): AgentToolDefinition[] {
  const results: AgentToolDefinition[] = [];

  for (const [name, def] of Object.entries(definitions)) {
    const tools = def.tools
      ? options.allTools.filter((t) => def.tools!.includes(t.name))
      : options.allTools;

    const model = def.model ?? options.defaultModel;

    registry.register({
      id: name,
      config: {
        model,
        instructions: def.prompt,
        tools,
      },
    });

    const tool = createSubagentTool({
      id: name,
      registry,
      description: def.description,
    }) as AgentToolDefinition;

    results.push(tool);
  }

  return results;
}
