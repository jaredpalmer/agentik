import { anthropic } from "@ai-sdk/anthropic";
import {
  Agent,
  SharedMemoryStore,
  SubagentRegistry,
  createReadTool,
  createSubagentTool,
} from "@agentik/runtime";

const sharedMemory = new SharedMemoryStore();
const registry = new SubagentRegistry();

registry.register({
  id: "explorer",
  config: {
    model: anthropic("claude-opus-4-5"),
    tools: [createReadTool(process.cwd())],
  },
  memory: sharedMemory,
});

const explorerTool = createSubagentTool({ id: "explorer", registry });
const agent = new Agent({
  model: anthropic("claude-opus-4-5"),
  tools: [explorerTool],
});

await agent.prompt("Delegate to explorer: scan the repo for TODOs.");
sharedMemory.set("todos", "Captured in explorer output.");
