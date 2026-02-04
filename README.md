# Agentik

Agentik’s goal is to make building coding agents feel boring and composable: a small, deterministic runtime with optional session recording, and a minimal CLI that acts as a reference client. You can embed the runtime in your own product, or use the CLI when you want a ready-made interface.

## Architecture

Agentik is intentionally split into two layers so you can adopt only what you need.

- `runtime`: A thin wrapper around AI SDK v6 `ToolLoopAgent` that owns the tool loop, emits a stable event stream, and provides a small set of built-in tools.
- `cli`: A minimal reference client that wires the runtime into a TUI and demonstrates streaming, tool events, and UI rendering.

**Packages**

- `@agentik/runtime` (`packages/runtime`): core agent loop/runtime, tool calls, and event model built on AI SDK
- `@agentik/coding-agent` (`packages/coding-agent`): minimal agent CLI and TUI built on opentui

## Runtime

`@agentik/runtime` is the thin loop around AI SDK v6 that owns tool execution and emits a structured event stream. The primary entrypoint is `Agent`, which takes a model, tools, and optional hooks (context transforms, custom message conversion, event listeners):

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { Agent, createReadTool, createWriteTool } from "@agentik/runtime";

const agent = new Agent({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createWriteTool(process.cwd())],
});

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
});

await agent.prompt("Summarize the README.");
```

**Separation of concerns**

The runtime is intentionally “dumb” and deterministic: it runs the loop, executes tools, and emits events. Session recording is optional and done via a `SessionStore` that you pass to `Agent`. This keeps the runtime reusable and testable while still letting you layer in persistence when you need it. Optional helpers include a JSONL `SessionManager`, compaction utilities, a resource loader for skills/prompts, and small auth/model registries.

**Queued messages (steering vs follow-up)**

Steering messages are injected before the next model turn, so they can redirect the loop at a turn boundary. Follow-up messages are appended after the current turn completes, so they do not change the in-flight turn. Each queue supports `one-at-a-time` or `all` modes.

```ts
import { Agent } from "@agentik/runtime";

const agent = new Agent({
  model,
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
});

agent.enqueueSteeringMessage("Steer: ask before writing.");
agent.enqueueFollowUpMessage("Follow-up: add tests.");

await agent.prompt("Start with a plan.");
```

## Session recording

Provide a `SessionStore` to record `message_end` events as session entries.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { Agent, InMemorySessionStore, createReadTool, createWriteTool } from "@agentik/runtime";

const agent = new Agent({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createWriteTool(process.cwd())],
  sessionStore: new InMemorySessionStore(),
});

await agent.prompt("List the repo packages.");
```

## Session manager (JSONL)

If you want pi-style JSONL sessions with tree/branching, use `SessionManager`. It owns session files and can build LLM-ready context from the current leaf.

```ts
import { SessionManager } from "@agentik/runtime";

const sessions = new SessionManager({
  cwd: process.cwd(),
  sessionDir: ".agentik-example/sessions",
  persist: true,
});

sessions.appendMessage({ role: "user", content: "Hello from JSONL." });
sessions.appendMessage({ role: "assistant", content: "Stored in the session file." });

const context = sessions.buildSessionContext();
console.log(context.messages.length);
console.log("Session file:", sessions.getSessionFile());
```

## Compaction utilities

Compaction helpers are available as pure functions so you can wire them into your own policy.

```ts
import { compact } from "@agentik/runtime";

const result = await compact({
  entries: sessions.getEntries(),
  leafId: sessions.getLeafId(),
  contextWindow: 2000,
  summarize: async (messages) => `Summary of ${messages.length} messages.`,
});

if (result) {
  sessions.appendCompaction(result.summary, result.firstKeptEntryId, result.tokensBefore);
}
```

## Dynamic auth + proxy streaming

Use `getApiKey` to resolve short-lived tokens and `streamFn` to wrap or proxy the AI SDK stream.

```ts
import { Agent } from "@agentik/runtime";

const agent = new Agent({
  model,
  getApiKey: async (providerId) => process.env[`${providerId.toUpperCase()}_API_KEY`],
  apiKeyHeaders: ({ apiKey }) => ({ "x-api-key": apiKey }), // customize per provider
  streamFn: async ({ agent, params }) => agent.stream(params),
});
```

## Auth store + model registry

Use `AuthStore` to persist API keys and `ModelRegistry` to register models with metadata and factories.

```ts
import { InMemoryAuthStore, ModelRegistry } from "@agentik/runtime";

const authStore = new InMemoryAuthStore();
await authStore.set("provider-id", "api-key");

const registry = new ModelRegistry(authStore);
registry.registerModel({
  id: "fast-model",
  providerId: "provider-id",
  // createProviderModel = provider factory from your AI SDK package
  createModel: ({ apiKey }) => createProviderModel({ apiKey }),
  contextWindow: 128000,
});

const model = await registry.resolveModel("fast-model");
```

## Built-in tools

`@agentik/runtime` ships a small built-in toolset:

- `read`, `write`, `edit`, `update`
- `list`, `glob`, `find`, `grep`
- `bash`, `webfetch`

## Examples

**Stream tool and message events**

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { Agent, createBashTool, createReadTool } from "@agentik/runtime";

const agent = new Agent({
  model: anthropic("claude-opus-4-5"),
  tools: [createReadTool(process.cwd()), createBashTool(process.cwd())],
});

agent.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(`[tool:start] ${event.toolName}`, event.args);
  }
  if (event.type === "tool_execution_end") {
    console.log(`[tool:end] ${event.toolName}`, { isError: event.isError });
  }
});

await agent.prompt("Find TODOs and summarize them.");
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
import { Agent, type SessionEntry, type SessionStore, type SessionTree } from "@agentik/runtime";

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

const agent = new Agent({
  model,
  tools,
  sessionStore: new FileSessionStore(".agentik/session.json"),
});
```

**Optional subagents with shared memory**

```ts
import { anthropic } from "@ai-sdk/anthropic";
import {
  SubagentRegistry,
  SharedMemoryStore,
  createReadTool,
  createSubagentTool,
  Agent,
} from "@agentik/runtime";

const sharedMemory = new SharedMemoryStore();
const registry = new SubagentRegistry();
registry.register({
  id: "explorer",
  config: {
    model: anthropic("claude-opus-4-5"),
    tools: [createReadTool(process.cwd())],
  },
  memory: sharedMemory,
});

const explorerTool = createSubagentTool({ id: "explorer", registry });
const agent = new Agent({
  model: anthropic("claude-opus-4-5"),
  tools: [explorerTool],
});

await agent.prompt("Delegate to explorer: scan the repo for TODOs.");
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

**Interactive controls**

- While streaming, press Enter to queue a steering message.
- Press Alt+Enter to queue a follow-up message.
- Press Up Arrow to dequeue the last queued message back into the input for editing.

**Why the CLI matters**

The CLI is intentionally small and serves as a reference client. It shows how to wire `@agentik/runtime` tools into `Agent`, stream runtime events, and render them in a UI. If you are embedding Agentik in your own app, `packages/coding-agent` is the shortest path to copy/paste the essentials.

## Use cases

- Embed a coding agent into an existing product by composing `Agent` with your own session store.
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
<summary>Can I use any AI SDK model/provider?</summary>

Yes. Runtime expects an AI SDK `LanguageModel`, so any provider supported by AI SDK works.

</details>

<details>
<summary>Do I have to use the CLI?</summary>

No. The CLI is intentionally minimal and acts as a reference client. You can embed `Agent` directly in your own app.

</details>

<details>
<summary>How are sessions stored?</summary>

Sessions are written through a simple `SessionStore` interface. The default in-memory store keeps a `SessionTree` (versioned JSON with message entries). You can implement your own store to persist to disk or a database.

</details>

<details>
<summary>Can I bring my own tools?</summary>

Yes. Tools are plain `AgentToolDefinition` objects. Pass any tool list into `Agent`.

</details>

<details>
<summary>Are subagents required?</summary>

No. Subagents are optional and disabled by default. If enabled, they can share a memory store while running their own runtime loops.

</details>
