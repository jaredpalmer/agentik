import { Agent } from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// Continue lets the model take another turn without adding a new user message.
const agent = new Agent({
  model: createMockModel("Follow-up response."),
});

await agent.prompt("Kick off the conversation.");
await agent.continue();

const messages = agent.state.messages;
console.log("Message count:", messages.length);
console.log("Last message role:", messages[messages.length - 1]?.role);
