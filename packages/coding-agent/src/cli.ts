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
} from "@agentik/runtime";
import { TuiApp } from "./tui/tui-app";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

type CliMode = "interactive" | "print" | "rpc";

type SubagentConfigInput = {
  id: string;
  model?: string;
  instructions?: string;
};

const ENV_SUBAGENTS = "AGENTIK_SUBAGENTS";
const ENV_SUBAGENTS_FILE = "AGENTIK_SUBAGENTS_FILE";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
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

  const subagentConfigs = await loadSubagentConfigs();
  const subagentRegistry = createSubagentRegistry(
    subagentConfigs.map((config) => ({
      id: config.id,
      config: {
        model: config.model ? anthropic(config.model) : model,
        instructions: config.instructions,
        tools: baseTools,
      },
    }))
  );
  const subagentTools = subagentConfigs.map((config) =>
    createSubagentTool({
      id: config.id,
      registry: subagentRegistry,
    })
  );
  const tools = [...baseTools, ...subagentTools] as AgentToolDefinition[];

  const agent = new Agent({ model, tools });

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
      process.stdout.write(event.delta);
      return;
    }
    if (event.type === "error") {
      const message = formatRuntimeError(event.error);
      process.stderr.write(`\nError during streaming: ${message}\n`);
    }
  });

  await agent.prompt(prompt);
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

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryUrl && import.meta.url === entryUrl) {
  runCli().catch((error) => {
    console.error(formatRuntimeError(error));
    process.exitCode = 1;
  });
}
