import { Agent } from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// Collect and print the event sequence emitted by the runtime.
const events: string[] = [];
const agent = new Agent({
  model: createMockModel("Event log demo."),
  onEvent: (event) => {
    events.push(event.type);
  },
});

await agent.prompt("Ping.");

console.log("Events:", events.join(" -> "));
