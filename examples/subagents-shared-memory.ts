import {
  SharedMemoryStore,
  SubagentRegistry,
  createSubagentTool,
  type AgentToolResult,
} from "@jaredpalmer/agentik";
import { createMockModel } from "./mock-model";

// Create a subagent with shared memory and run it offline with a mock model.
const sharedMemory = new SharedMemoryStore();
const registry = new SubagentRegistry();

registry.register({
  id: "explorer",
  config: {
    model: createMockModel("Explorer scanned the repo and found 2 TODOs."),
  },
  memory: sharedMemory,
});

const explorerTool = createSubagentTool({ id: "explorer", registry });

// Normally the parent agent's model invokes this tool; call it directly here
// to demonstrate the delegation flow without an API key.
const stream = explorerTool.execute!(
  { prompt: "Scan the repo for TODOs." },
  { toolCallId: "demo-call", messages: [] }
) as AsyncIterable<AgentToolResult<string>>;

let output = "";
for await (const partial of stream) {
  output = partial.output;
}

sharedMemory.set("todos", output);
console.log("Subagent output:", output);
console.log("Shared memory snapshot:", sharedMemory.snapshot());
