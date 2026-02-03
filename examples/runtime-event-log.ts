import { AgentRuntime } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Collect and print the event sequence emitted by the runtime.
const events: string[] = [];
const runtime = new AgentRuntime({
  model: createMockModel("Event log demo."),
  onEvent: (event) => {
    events.push(event.type);
  },
});

await runtime.prompt("Ping.");

console.log("Events:", events.join(" -> "));
