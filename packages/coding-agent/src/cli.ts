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

const DEFAULT_MODEL = "claude-opus-4-6";

function createModel() {
  const provider = process.env.AGENTIK_PROVIDER ?? "anthropic";
  const modelId = process.env.AGENTIK_MODEL ?? DEFAULT_MODEL;

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
// Error formatting
// ============================================================================

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  // API key missing
  if (err.message.includes("API key is missing")) {
    const match = err.message.match(/(\w+_API_KEY)/);
    const envVar = match?.[1] ?? "API_KEY";
    return `Missing API key. Set the ${envVar} environment variable.`;
  }

  // Network / connection errors
  if (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed")) {
    return "Connection failed. Check your network and try again.";
  }

  // Rate limit
  if (err.message.includes("rate limit") || err.message.includes("429")) {
    return "Rate limited. Wait a moment and try again.";
  }

  // Auth errors
  if (err.message.includes("401") || err.message.includes("invalid_api_key")) {
    return "Invalid API key. Check your credentials.";
  }

  // Overloaded
  if (err.message.includes("overloaded") || err.message.includes("529")) {
    return "API is overloaded. Try again in a moment.";
  }

  return err.message;
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
        if (assistant.stopReason === "aborted") {
          process.stdout.write(`\n${DIM}[interrupted]${RESET}\n`);
        } else if (assistant.stopReason === "error") {
          // Error already printed elsewhere
        } else {
          process.stdout.write(
            `\n${DIM}[tokens: ${u.input}in/${u.output}out | stop: ${assistant.stopReason}]${RESET}\n`
          );
        }
      }
      break;
    }
  }
}

async function main() {
  const provider = process.env.AGENTIK_PROVIDER ?? "anthropic";
  const modelId = process.env.AGENTIK_MODEL ?? DEFAULT_MODEL;
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

  // --- Ctrl+C handling ---
  let lastSigint = 0;

  process.on("SIGINT", () => {
    const now = Date.now();

    if (agent.state.isStreaming) {
      // First Ctrl+C while streaming: abort the current response
      agent.abort();
      process.stdout.write(`\n${DIM}[cancelled]${RESET}\n`);
      lastSigint = now;
      return;
    }

    // Not streaming: double Ctrl+C within 2s exits
    if (now - lastSigint < 2000) {
      process.stdout.write(`\n${DIM}Goodbye!${RESET}\n`);
      rl.close();
      process.exit(0);
    }

    lastSigint = now;
    process.stdout.write(`\n${DIM}Press Ctrl+C again to exit${RESET}\n`);
    showPrompt();
  });

  // --- Banner ---
  console.log(`${BOLD}${CYAN}agentik${RESET} - coding agent`);
  console.log(`${DIM}Model: ${provider}/${modelId}${RESET}`);
  console.log(`${DIM}Tools: ${codingTools.map((t) => t.name).join(", ")}${RESET}`);
  console.log(`${DIM}Ctrl+C to cancel, twice to exit, /quit to exit${RESET}\n`);

  const showPrompt = () => {
    // eslint-disable-next-line typescript-eslint/no-misused-promises
    rl.question(`${BOLD}> ${RESET}`, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        showPrompt();
        return;
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log(`${DIM}Goodbye!${RESET}`);
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/clear") {
        agent.clearMessages();
        console.log(`${DIM}Conversation cleared.${RESET}`);
        showPrompt();
        return;
      }

      if (trimmed === "/reset") {
        agent.reset();
        console.log(`${DIM}Agent reset.${RESET}`);
        showPrompt();
        return;
      }

      try {
        process.stdout.write("\n");
        await agent.prompt(trimmed);
        process.stdout.write("\n");
      } catch (err) {
        process.stdout.write(`\n${RED}Error: ${formatError(err)}${RESET}\n\n`);
      }

      showPrompt();
    });
  };

  showPrompt();
}

main().catch((err) => {
  console.error(`${RED}Error: ${formatError(err)}${RESET}`);
  process.exit(1);
});
