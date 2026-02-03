import { anthropic } from "@ai-sdk/anthropic";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "@agentik/runtime";
import { AgentRuntime } from "@agentik/runtime";

// Example of defining a custom tool and letting the model call it.
// Requires environment variables:
// - ANTHROPIC_API_KEY
// - AGENTIK_MODEL (example: claude-opus-4-5)
const modelId = process.env.AGENTIK_MODEL;
if (!modelId || !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing AGENTIK_MODEL or ANTHROPIC_API_KEY.");
  console.error(
    "Try: AGENTIK_MODEL=claude-opus-4-5 ANTHROPIC_API_KEY=... bun examples/runtime-custom-tool.ts"
  );
  process.exit(1);
}

type WordCountInput = { text: string };

type WordCountOutput = {
  words: number;
  chars: number;
};

const wordCountTool: AgentToolDefinition<WordCountInput, WordCountOutput> = {
  name: "word_count",
  description: "Count words and characters in a string.",
  inputSchema: jsonSchema<WordCountInput>({
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  }),
  execute: async ({ text }) => {
    const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    return { output: { words, chars: text.length } };
  },
};

const runtime = new AgentRuntime({
  model: anthropic(modelId),
  tools: [wordCountTool],
});

let toolCalls = 0;
runtime.subscribe((event) => {
  if (event.type === "tool_execution_end") {
    toolCalls += 1;
    console.log("Tool result:", event.result);
  }
});

await runtime.prompt(
  "Use the word_count tool on the string: 'Count the words in this sentence.' and report the result."
);

if (toolCalls === 0) {
  console.log("No tool calls were observed. Try adjusting the prompt.");
}
