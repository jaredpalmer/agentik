import { Agent } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// This example passes instructions (system prompt) into the agent runtime
// and shows how to subscribe to events.
const agent = new Agent({
  model: createMockModel("Following the system prompt."),
  instructions: "Be terse and output one sentence.",
});

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await agent.prompt("Explain what Agentik is.");
console.log("\nDone.");
