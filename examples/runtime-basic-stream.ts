import { Agent } from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// Basic runtime usage with a mock model.
// This runs without any API keys and streams text updates to stdout.
const agent = new Agent({
  model: createMockModel("Hello from the mock runtime."),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Say hello.");

console.log("\nDone. Messages:", agent.state.messages.length);
