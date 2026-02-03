import { createAgentSession } from "@agentik/sdk";
import { createMockModel } from "./mock-model";

// This example passes instructions (system prompt) into the session runtime
// and shows how to subscribe to events.
const { session } = await createAgentSession({
  model: createMockModel("Following the system prompt."),
  instructions: "Be terse and output one sentence.",
});

session.runtime.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await session.runtime.prompt("Explain what Agentik is.");
console.log("\nDone.");
