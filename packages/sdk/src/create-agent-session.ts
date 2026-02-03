import type { ModelMessage, ProviderOptions, SystemModelMessage } from "@ai-sdk/provider-utils";
import type { AgentRuntimeOptions, AgentMessage, AgentToolDefinition } from "@agentik/agent";
import { AgentRuntime } from "@agentik/agent";
import type { CallSettings, LanguageModel, StopCondition, ToolChoice, ToolSet } from "ai";
import { AgentSession } from "./agent-session";
import type { SessionStore } from "./session-store";

export type CreateAgentSessionOptions = {
  model: LanguageModel;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  toolChoice?: ToolChoice<ToolSet>;
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>;
  output?: unknown;
  providerOptions?: ProviderOptions;
  callSettings?: CallSettings;
  convertToModelMessages?: (messages: AgentMessage[]) => PromiseLike<ModelMessage[]>;
  transformContext?: AgentRuntimeOptions["transformContext"];
  onEvent?: AgentRuntimeOptions["onEvent"];
  sessionStore?: SessionStore;
};

export type CreateAgentSessionResult = {
  session: AgentSession;
};

export async function createAgentSession(
  options: CreateAgentSessionOptions
): Promise<CreateAgentSessionResult> {
  const runtime = new AgentRuntime({
    model: options.model,
    instructions: options.instructions,
    tools: options.tools,
    toolChoice: options.toolChoice,
    stopWhen: options.stopWhen,
    output: options.output,
    providerOptions: options.providerOptions,
    callSettings: options.callSettings,
    convertToModelMessages: options.convertToModelMessages,
    transformContext: options.transformContext,
    onEvent: options.onEvent,
  });

  const session = new AgentSession(runtime, { store: options.sessionStore });
  session.startRecording();

  return { session };
}
