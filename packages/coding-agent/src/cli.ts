import { anthropic } from "@ai-sdk/anthropic";
import {
  createBashTool,
  createEditTool,
  createGlobTool,
  createListTool,
  createReadTool,
  createUpdateTool,
  createWebFetchTool,
  createWriteTool,
  type AgentToolDefinition,
} from "@agentik/agent-core";
import { createAgentSession } from "@agentik/agent-sdk";
import { TuiApp } from "./tui/tui-app";
import { pathToFileURL } from "node:url";

type CliMode = "interactive" | "print" | "rpc";

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
  const tools = [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createUpdateTool(cwd),
    createListTool(cwd),
    createGlobTool(cwd),
    createBashTool(cwd),
    createWebFetchTool(),
  ] as AgentToolDefinition[];

  const { session } = await createAgentSession({ model, tools });

  if (mode === "interactive") {
    const app = new TuiApp({ runtime: session.runtime });
    await app.start();
    return;
  }

  if (mode === "rpc") {
    throw new Error("RPC mode is not implemented yet.");
  }

  if (!prompt) {
    throw new Error("--prompt is required in print mode.");
  }

  session.runtime.subscribe((event) => {
    if (event.type === "message_update") {
      process.stdout.write(event.delta);
      return;
    }
    if (event.type === "error") {
      const message = formatRuntimeError(event.error);
      process.stderr.write(`\nError during streaming: ${message}\n`);
    }
  });

  await session.runtime.prompt(prompt);
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
