import { AgentRuntime, type AgentMessage } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// This example shows how to trim or enrich context before the model sees it.
// Here we keep only the last 2 messages and inject a system instruction.
const runtime = new AgentRuntime({
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

await runtime.prompt("Hello");
await runtime.prompt("Follow up question.");

// The runtime state reflects the transformed context.
console.log(
  "Context roles:",
  runtime.state.messages.map((message) => message.role)
);
