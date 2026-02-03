# Agentik

Agentik’s goal is to make building coding agents feel boring and composable: a small, deterministic runtime, a higher-level SDK for sessions and policy, and a minimal CLI that acts as a reference client. You can embed the SDK in your own product, or use the runtime directly when you want full control without CLI assumptions.

## Architecture

Agentik is intentionally split into three layers so you can adopt only what you need.

- `runtime`: A thin wrapper around AI SDK v6 `ToolLoopAgent` that owns the tool loop, emits a stable event stream, and provides a small set of built-in tools.
- `sdk`: Session lifecycle and policy. This is where model selection, resource loading, and persistence live.
- `cli`: A minimal reference client that wires runtime + sdk and demonstrates streaming, tool events, and UI rendering.

**Packages**

- `@agentik/runtime` (`packages/runtime`): core agent loop/runtime, tool calls, and event model built on AI SDK
- `@agentik/sdk` (`packages/sdk`): agent sdk (session APIs and embedding helpers).
- `@agentik/coding-agent` (`packages/coding-agent`): minimal agent CLI and TUI built on opentui

## Runtime

`@agentik/runtime` is the thin loop around AI SDK v6 that owns tool execution and emits a structured event stream. It takes a model, tools, and optional hooks (context transforms, custom message conversion, event listeners) and exposes a small surface:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { AgentRuntime, createReadTool, createWriteTool } from "@agentik/runtime";

const runtime = new AgentRuntime({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createWriteTool(process.cwd())],
});

runtime.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await runtime.prompt("Summarize the README.");
```

**Separation of concerns**

The runtime is intentionally “dumb” and deterministic: it runs the loop, executes tools, and emits events. The SDK is where environment-specific policy lives: model selection and fallbacks, resource loading, session storage/restore, and app-level wiring. This keeps the runtime reusable and testable, while the SDK stays flexible for different products and integrations.

## SDK

`@agentik/sdk` builds on the runtime with session management and recording. `createAgentSession` wires a runtime, attaches a store, and starts capturing events as session entries.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createAgentSession, InMemorySessionStore } from "@agentik/sdk";
import { createReadTool, createWriteTool } from "@agentik/runtime";

const { session } = await createAgentSession({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createWriteTool(process.cwd())],
  sessionStore: new InMemorySessionStore(),
});

await session.runtime.prompt("List the repo packages.");
```

## Examples

**Stream tool and message events**

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { AgentRuntime, createBashTool, createReadTool } from "@agentik/runtime";

const runtime = new AgentRuntime({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createBashTool(process.cwd())],
});

runtime.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(`[tool:start] ${event.toolName}`, event.args);
  }
  if (event.type === "tool_execution_end") {
    console.log(`[tool:end] ${event.toolName}`, { isError: event.isError });
  }
});

await runtime.prompt("Find TODOs and summarize them.");
```

**Define a custom tool**

```ts
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDefinition } from "@agentik/runtime";

type RepoStatsInput = { path: string };

const repoStatsTool: AgentToolDefinition<RepoStatsInput, string> = {
  name: "repo_stats",
  description: "Return quick stats about a repo path.",
  inputSchema: jsonSchema<RepoStatsInput>({
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  }),
  execute: async ({ path }) => {
    const files = await Bun.file(`${path}/package.json`).exists();
    return { output: files ? "Node project detected." : "No package.json found." };
  },
};
```

**Persist sessions with a custom store**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { createAgentSession, type SessionStore } from "@agentik/sdk";
import type { SessionEntry, SessionTree } from "@agentik/runtime";

class FileSessionStore implements SessionStore {
  constructor(private filePath: string) {}

  async load(): Promise<SessionTree> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      return JSON.parse(data) as SessionTree;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  async append(entry: SessionEntry): Promise<void> {
    const tree = await this.load();
    tree.entries.push(entry);
    await writeFile(this.filePath, JSON.stringify(tree, null, 2));
  }
}

const { session } = await createAgentSession({
  model,
  tools,
  sessionStore: new FileSessionStore(".agentik/session.json"),
});
```

**Optional subagents with shared memory**

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { SubagentManager, SharedMemoryStore, createReadTool } from "@agentik/runtime";

const sharedMemory = new SharedMemoryStore();
const manager = new SubagentManager({
  enabled: true,
  maxAgents: 2,
  sharedMemory,
  baseRuntimeOptions: {
    model: anthropic("claude-opus-4-5"),
    tools: [createReadTool(process.cwd())],
  },
});

const explorer = manager.create({ id: "explorer" });
await explorer.runtime.prompt("Scan the repo for TODOs.");
sharedMemory.set("todos", "Captured in explorer output.");
```

## CLI

**Install**

```bash
curl -fsSL https://raw.githubusercontent.com/jaredpalmer/agentik/main/install.sh | bash
```

**Usage**

```bash
AGENTIK_MODEL=claude-opus-4-5 \
ANTHROPIC_API_KEY=your_key_here \
agentik
```

**Notes**

- The installer downloads the latest `cli-v*` GitHub Release asset and installs it as `agentik` in `~/.local/bin`.
- Override versions or install location:

```bash
AGENTIK_VERSION=cli-v0.1.0 AGENTIK_INSTALL_DIR="$HOME/bin" ./install.sh
```

**Modes**

- Interactive (default): launches the OpenTUI interface for streaming and inspection.
- Print: use `--print --prompt "..."` to stream text to stdout for scripts.
- RPC: reserved for future use (currently unimplemented).

**Why the CLI matters**

The CLI is intentionally small and serves as a reference client. It shows how to wire `@agentik/runtime` tools into `@agentik/sdk`, stream runtime events, and render them in a UI. If you are embedding Agentik in your own app, `packages/coding-agent` is the shortest path to copy/paste the essentials.

## Use cases

- Embed a coding agent into an existing product by composing the SDK with your own session store.
- Build a CI or repo assistant that reviews diffs and emits structured tool events for auditing.
- Prototype new tools (filesystem, webfetch, bash) against a stable runtime loop.
- Create a custom TUI or web UI by subscribing to runtime events.
- Spin up optional subagents for exploration tasks while keeping a shared memory snapshot.

## FAQ

<details>
<summary>How is this different from using the raw AI SDK?</summary>

AI SDK gives you the primitives. Agentik packages those primitives into a repeatable agent loop with a stable event model, session recording, and a reference CLI. If you already like rolling your own loop, tools, and storage, you may not need it. If you want a clean, tested baseline and a place to start, it saves a lot of glue work.

</details>

<details>
<summary>Do you use AI SDK’s ToolLoopAgent?</summary>

Yes. `@agentik/runtime` wraps `ToolLoopAgent` and focuses on event emission and tool wiring instead of re-implementing the loop.

</details>

<details>
<summary>When should I use the runtime vs the SDK?</summary>

Use `@agentik/runtime` when you want a simple, deterministic loop and plan to handle storage and policy yourself. Use `@agentik/sdk` when you want session recording, a storage abstraction, and a higher-level entry point.

</details>

<details>
<summary>Can I use any AI SDK model/provider?</summary>

Yes. Runtime expects an AI SDK `LanguageModel`, so any provider supported by AI SDK works.

</details>

<details>
<summary>Do I have to use the CLI?</summary>

No. The CLI is intentionally minimal and acts as a reference client. You can embed the SDK or runtime directly in your own app.

</details>

<details>
<summary>How are sessions stored?</summary>

Sessions are written through a simple `SessionStore` interface. The default in-memory store keeps a `SessionTree` (versioned JSON with message entries). You can implement your own store to persist to disk or a database.

</details>

<details>
<summary>Can I bring my own tools?</summary>

Yes. Tools are plain `AgentToolDefinition` objects. Pass any tool list into the runtime or `createAgentSession`.

</details>

<details>
<summary>Are subagents required?</summary>

No. Subagents are optional and disabled by default. If enabled, they can share a memory store while running their own runtime loops.

</details>
