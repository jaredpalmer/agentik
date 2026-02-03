import { AgentRuntime } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Continue lets the model take another turn without adding a new user message.
const runtime = new AgentRuntime({
  model: createMockModel("Follow-up response."),
});

await runtime.prompt("Kick off the conversation.");
await runtime.continue();

const messages = runtime.state.messages;
console.log("Message count:", messages.length);
console.log("Last message role:", messages[messages.length - 1]?.role);
