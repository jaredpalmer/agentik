import { Agent } from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// Demonstrates steering vs follow-up message queues.
// Steering messages are injected before the next model turn.
// Follow-up messages are injected after the current turn completes.
const agent = new Agent({
  model: createMockModel("Mock turn response."),
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
});

agent.enqueueSteeringMessage("Steer: ask before writing.");
agent.enqueueSteeringMessage("Steer: focus on README first.");
agent.enqueueFollowUpMessage("Follow-up: add tests after the summary.");

await agent.prompt("Start with a short plan.");

const userMessages = agent.state.messages
  .filter((message) => message.role === "user")
  .map((message) =>
    typeof message.content === "string" ? message.content : JSON.stringify(message.content)
  );

console.log("User message order:");
console.log(userMessages.map((message, index) => `${index + 1}. ${message}`).join("\n"));
