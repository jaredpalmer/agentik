import { anthropic } from "@ai-sdk/anthropic";
import { AgentRuntime, createListTool, createReadTool } from "@agentik/runtime";

// Example using built-in file tools with a real model.
// Requires environment variables:
// - ANTHROPIC_API_KEY
// - AGENTIK_MODEL (example: claude-opus-4-5)
const modelId = process.env.AGENTIK_MODEL;
if (!modelId || !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing AGENTIK_MODEL or ANTHROPIC_API_KEY.");
  console.error(
    "Try: AGENTIK_MODEL=claude-opus-4-5 ANTHROPIC_API_KEY=... bun examples/runtime-builtin-tools-anthropic.ts"
  );
  process.exit(1);
}

const cwd = process.cwd();
const runtime = new AgentRuntime({
  model: anthropic(modelId),
  tools: [createListTool(cwd), createReadTool(cwd)],
});

runtime.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(`[tool:start] ${event.toolName}`);
  }
  if (event.type === "tool_execution_end") {
    console.log(`[tool:end] ${event.toolName} (error: ${event.isError})`);
  }
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await runtime.prompt(
  "List the top-level files and read README.md. Then summarize what this repo is about."
);

console.log("\nDone.");
