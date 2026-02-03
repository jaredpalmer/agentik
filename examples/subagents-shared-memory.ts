import { SharedMemoryStore, SubagentManager } from "@agentik/runtime";
import { createMockModel } from "./mock-model";

// Subagents are optional and disabled by default.
// This example enables them and shares a memory store across agents.
const sharedMemory = new SharedMemoryStore();
const manager = new SubagentManager({
  enabled: true,
  maxAgents: 2,
  sharedMemory,
  baseRuntimeOptions: {
    model: createMockModel("Subagent response."),
  },
});

const explorer = manager.create({ id: "explorer" });
const summarizer = manager.create({ id: "summarizer" });

await explorer.runtime.prompt("Scan the repo and report key files.");
sharedMemory.set("findings", "README.md, packages/runtime, packages/sdk, packages/coding-agent");

await summarizer.runtime.prompt("Summarize the findings from shared memory.");

console.log("Shared memory snapshot:", sharedMemory.snapshot());
