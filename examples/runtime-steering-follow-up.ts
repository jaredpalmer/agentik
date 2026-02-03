import { AgentRuntime } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Demonstrates steering vs follow-up message queues.
// Steering messages are injected before the next model turn.
// Follow-up messages are injected after the current turn completes.
const runtime = new AgentRuntime({
  model: createMockModel("Mock turn response."),
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
});

runtime.enqueueSteeringMessage("Steer: ask before writing.");
runtime.enqueueSteeringMessage("Steer: focus on README first.");
runtime.enqueueFollowUpMessage("Follow-up: add tests after the summary.");

await runtime.prompt("Start with a short plan.");

const userMessages = runtime.state.messages
  .filter((message) => message.role === "user")
  .map((message) =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content)
  );

console.log("User message order:");
console.log(userMessages.map((message, index) => `${index + 1}. ${message}`).join("\n"));
