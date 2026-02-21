import { anthropic } from "@ai-sdk/anthropic";
import {
  Agent,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createGlobTool,
  createListTool,
  createReadTool,
  createSubagentRegistry,
  createSubagentTool,
  createUpdateTool,
  createWebFetchTool,
  createWriteTool,
  type AgentToolDefinition,
} from "@jaredpalmer/agentik";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TuiApp } from "./tui/tui-app";
import { createSessionLogger, type CliRunMode, withPolicyGuards } from "./policy";
import { hasRepoScaffold, initScaffold, loadRepoContext, loadSettings } from "./repo-scaffold";

type CliMode = "interactive" | "print" | "rpc";

type SubagentConfigInput = {
  id: string;
  model?: string;
  instructions?: string;
};

const ENV_SUBAGENTS = "AGENTIK_SUBAGENTS";
const ENV_SUBAGENTS_FILE = "AGENTIK_SUBAGENTS_FILE";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "init") {
    await runInit(argv.slice(1));
    return;
  }

  const args = new Set(argv);
  const mode = parseMode(args);
  const prompt = getArgValue(argv, "--prompt");
  const modelId = process.env.AGENTIK_MODEL;

  if (!modelId) {
    throw new Error("AGENTIK_MODEL is required.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const model = anthropic(modelId);
  const cwd = process.cwd();
  const hasScaffold = hasRepoScaffold(cwd);
  const settings = hasScaffold ? await loadSettings(cwd) : undefined;
  const repoContext = hasScaffold ? await loadRepoContext({ cwd }) : { messages: [] };
  const sessionLogger = settings ? await createSessionLogger({ cwd, settings }) : undefined;

  // Tool definitions are heterogeneous; we coerce to the shared type to avoid variance issues with `needsApproval`.
  const baseTools = [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createUpdateTool(cwd),
    createListTool(cwd),
    createGlobTool(cwd),
    createFindTool(cwd),
    createGrepTool(cwd),
    createBashTool(cwd),
    createWebFetchTool(),
  ] as AgentToolDefinition[];

  const policyMode: CliRunMode = mode === "interactive" ? "interactive" : "print";
  const guardedBaseTools =
    settings && hasScaffold
      ? withPolicyGuards({ tools: baseTools, settings, mode: policyMode, sessionLogger })
      : baseTools;

  const subagentConfigs = await loadSubagentConfigs();
  const subagentRegistry = createSubagentRegistry(
    subagentConfigs.map((config) => ({
      id: config.id,
      config: {
        model: config.model ? anthropic(config.model) : model,
        instructions: config.instructions,
        tools: guardedBaseTools,
      },
    }))
  );
  const subagentTools = subagentConfigs.map((config) =>
    createSubagentTool({
      id: config.id,
      registry: subagentRegistry,
    })
  );
  const tools = [...guardedBaseTools, ...subagentTools] as AgentToolDefinition[];

  const scaffoldInstructions =
    repoContext.messages.length > 0
      ? repoContext.messages
          .map((message) => `--- ${message.source} ---\n${message.content.trim()}`)
          .join("\n\n")
      : undefined;

  const agent = new Agent({
    model,
    tools,
    instructions: scaffoldInstructions,
  });

  if (sessionLogger) {
    agent.subscribe((event) => {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        void sessionLogger.log({ type: "agent_event", event, timestamp: new Date().toISOString() });
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        void sessionLogger.log({
          type: "final_message",
          message: event.message,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  if (mode === "interactive") {
    const app = new TuiApp({ agent });
    await app.start();
    return;
  }

  if (mode === "rpc") {
    throw new Error("RPC mode is not implemented yet.");
  }

  if (!prompt) {
    throw new Error("--prompt is required in print mode.");
  }

  agent.subscribe((event) => {
    if (event.type === "message_update") {
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      return;
    }
    if (event.type === "error") {
      const message = formatRuntimeError(event.error);
      process.stderr.write(`\nError during streaming: ${message}\n`);
    }
  });

  await agent.prompt(prompt);
}

async function runInit(argv: string[]): Promise<void> {
  const force = argv.includes("--force");
  const dir = getArgValue(argv, "--dir") ?? process.cwd();
  const targetDir = resolve(dir);
  const written = await initScaffold({ cwd: targetDir, force });

  if (written.length === 0) {
    process.stdout.write(`Scaffold already exists in ${targetDir}. Use --force to overwrite.\n`);
    return;
  }

  process.stdout.write(`Initialized Agentik scaffold in ${targetDir}:\n`);
  for (const file of written) {
    process.stdout.write(`- ${file}\n`);
  }
}

function parseMode(args: Set<string>): CliMode {
  if (args.has("--print")) {
    return "print";
  }
  if (args.has("--rpc")) {
    return "rpc";
  }
  return "interactive";
}

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

async function loadSubagentConfigs(): Promise<SubagentConfigInput[]> {
  const filePath = process.env[ENV_SUBAGENTS_FILE];
  const inline = process.env[ENV_SUBAGENTS];
  if (!filePath && !inline) {
    return [];
  }
  const raw = filePath ? await readFile(filePath, "utf8") : inline;
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const source = filePath ? `${ENV_SUBAGENTS_FILE} (${filePath})` : ENV_SUBAGENTS;
    throw new Error(`Failed to parse ${source}: ${formatRuntimeError(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${ENV_SUBAGENTS} must be a JSON array.`);
  }
  return parsed.map((entry, index) => normalizeSubagentConfig(entry, index));
}

function normalizeSubagentConfig(entry: unknown, index: number): SubagentConfigInput {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Subagent config at index ${index} must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`Subagent config at index ${index} is missing a valid id.`);
  }
  const model = typeof record.model === "string" ? record.model : undefined;
  const instructions = typeof record.instructions === "string" ? record.instructions : undefined;
  return {
    id: id.trim(),
    model,
    instructions,
  };
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error == null) {
    return "Unknown error";
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    try {
      return String(error);
    } catch {
      return "Unknown error";
    }
  }
}
