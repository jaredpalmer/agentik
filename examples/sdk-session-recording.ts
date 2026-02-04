import { Agent, InMemorySessionStore } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Create a session with an in-memory store and record events as session entries.
const store = new InMemorySessionStore();
const agent = new Agent({
  model: createMockModel("Recorded in the session store."),
  sessionStore: store,
});

await agent.prompt("Record this message.");

// Session recording is async; give the event loop a tick to flush appends.
await new Promise((resolve) => setTimeout(resolve, 0));

const tree = await store.load();
console.log("Session entries:", tree.entries.length);
