#!/usr/bin/env bun
/**
 * CLI entry point for the agentik coding agent.
 * Uses OpenTUI for a rich terminal interface.
 */

import { Agent } from "@agentik/agent";
import { codingTools } from "./tools/index.js";
import { bashGuard } from "./extensions/bash-guard.js";
import { toolLogger } from "./extensions/tool-logger.js";
import { contextInfo } from "./extensions/context-info.js";
import { TuiApp } from "./tui/app.js";

// ============================================================================
// Model Setup
// ============================================================================

const DEFAULT_MODEL = "claude-opus-4-6";

async function createModel() {
  const provider = process.env.AGENTIK_PROVIDER ?? "anthropic";
  const modelId = process.env.AGENTIK_MODEL ?? DEFAULT_MODEL;

  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const anthropic = createAnthropic();
    return anthropic(modelId);
  } else if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
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

  if (err.message.includes("API key is missing")) {
    const match = err.message.match(/(\w+_API_KEY)/);
    const envVar = match?.[1] ?? "API_KEY";
    return `Missing API key. Set the ${envVar} environment variable.`;
  }

  if (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed")) {
    return "Connection failed. Check your network and try again.";
  }

  if (err.message.includes("rate limit") || err.message.includes("429")) {
    return "Rate limited. Wait a moment and try again.";
  }

  if (err.message.includes("401") || err.message.includes("invalid_api_key")) {
    return "Invalid API key. Check your credentials.";
  }

  if (err.message.includes("overloaded") || err.message.includes("529")) {
    return "API is overloaded. Try again in a moment.";
  }

  return err.message;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const provider = process.env.AGENTIK_PROVIDER ?? "anthropic";
  const modelId = process.env.AGENTIK_MODEL ?? DEFAULT_MODEL;
  const model = await createModel();

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

  const app = new TuiApp({
    agent,
    provider,
    modelId,
    toolNames: codingTools.map((t) => t.name),
  });

  await app.start();
}

main().catch((err) => {
  console.error(`Error: ${formatError(err)}`);
  process.exit(1);
});
