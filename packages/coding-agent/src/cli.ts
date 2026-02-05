#!/usr/bin/env bun
/**
 * Minimal TUI for testing the agentik agent.
 * Streams responses and shows tool calls inline.
 */

import { Agent, type AgentEvent } from "@agentik/agent";
import { createInterface } from "node:readline";
import { codingTools } from "./tools/index.js";
import { bashGuard } from "./extensions/bash-guard.js";
import { toolLogger } from "./extensions/tool-logger.js";
import { contextInfo } from "./extensions/context-info.js";

// ============================================================================
// Model Setup
// ============================================================================

function createModel() {
  const provider = process.env.AGENTIK_PROVIDER ?? "anthropic";
  const modelId = process.env.AGENTIK_MODEL ?? "claude-sonnet-4-20250514";

  if (provider === "anthropic") {
    const { createAnthropic } = require("@ai-sdk/anthropic");
    const anthropic = createAnthropic();
    return anthropic(modelId);
  } else if (provider === "openai") {
    const { createOpenAI } = require("@ai-sdk/openai");
    const openai = createOpenAI();
    return openai(modelId);
  }

  throw new Error(`Unsupported provider: ${provider}. Use AGENTIK_PROVIDER=anthropic|openai`);
}

// ============================================================================
// TUI
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function formatEvent(event: AgentEvent): void {
  switch (event.type) {
    case "message_update": {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        process.stdout.write(ame.delta);
      } else if (ame.type === "thinking_delta") {
        process.stdout.write(`${DIM}${ame.delta}${RESET}`);
      } else if (ame.type === "toolcall_start") {
        process.stdout.write(`\n${YELLOW}[tool: `);
      } else if (ame.type === "toolcall_delta") {
        process.stdout.write(ame.delta);
      } else if (ame.type === "toolcall_end") {
        process.stdout.write(`]${RESET}\n`);
      }
      break;
    }

    case "tool_execution_start":
      process.stdout.write(`${DIM}  executing ${event.toolName}...${RESET}`);
      break;

    case "tool_execution_end":
      if (event.isError) {
        process.stdout.write(` ${RED}error${RESET}\n`);
      } else {
        process.stdout.write(` ${GREEN}done${RESET}\n`);
      }
      break;

    case "turn_end": {
      const msg = event.message;
      if (msg.role === "assistant") {
        const assistant = msg;
        const u = assistant.usage;
        process.stdout.write(
          `\n${DIM}[tokens: ${u.input}in/${u.output}out | stop: ${assistant.stopReason}]${RESET}\n`
        );
      }
      break;
    }
  }
}

async function main() {
  const model = createModel();

  const agent = new Agent({
    initialState: {
      model,
      systemPrompt: `You are a helpful coding assistant. You have access to tools for reading files, writing files, executing commands, and searching for files. Be concise and helpful.

Current working directory: ${process.cwd()}`,
      tools: codingTools,
    },
  });

  // Register extensions
  agent.use(bashGuard());
  agent.use(toolLogger());
  agent.use(contextInfo({ cwd: process.cwd() }));

  // Subscribe to events for streaming output
  agent.subscribe(formatEvent);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${BOLD}${CYAN}agentik${RESET} - coding agent`);
  console.log(
    `${DIM}Model: ${process.env.AGENTIK_PROVIDER ?? "anthropic"}/${process.env.AGENTIK_MODEL ?? "claude-sonnet-4-20250514"}${RESET}`
  );
  console.log(`${DIM}Tools: ${codingTools.map((t) => t.name).join(", ")}${RESET}`);
  console.log(`${DIM}Type /quit to exit${RESET}\n`);

  const prompt = () => {
    // eslint-disable-next-line typescript-eslint/no-misused-promises
    rl.question(`${BOLD}> ${RESET}`, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/clear") {
        agent.clearMessages();
        console.log("Conversation cleared.");
        prompt();
        return;
      }

      if (trimmed === "/reset") {
        agent.reset();
        console.log("Agent reset.");
        prompt();
        return;
      }

      try {
        process.stdout.write("\n");
        await agent.prompt(trimmed);
        process.stdout.write("\n");
      } catch (err) {
        console.error(`${RED}Error: ${(err as Error).message}${RESET}`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
