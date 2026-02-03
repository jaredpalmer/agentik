import { AgentRuntime } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Basic runtime usage with a mock model.
// This runs without any API keys and streams text updates to stdout.
const runtime = new AgentRuntime({
  model: createMockModel("Hello from the mock runtime."),
});

runtime.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await runtime.prompt("Say hello.");

console.log("\nDone. Messages:", runtime.state.messages.length);
