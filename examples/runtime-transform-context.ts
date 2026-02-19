import { Agent, type AgentMessage } from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// This example shows how to trim or enrich context before the model sees it.
// Here we keep only the last 2 messages and inject a system instruction.
const agent = new Agent({
  model: createMockModel("Context transformed."),
  transformContext: async (messages) => {
    const trimmed = messages.slice(-2);
    const systemMessage: AgentMessage = {
      role: "system",
      content: "You are concise and skip fluff.",
    };
    return [systemMessage, ...trimmed];
  },
});

await agent.prompt("Hello");
await agent.prompt("Follow up question.");

// The agent state reflects the transformed context.
console.log(
  "Context roles:",
  agent.state.messages.map((message) => message.role)
);
