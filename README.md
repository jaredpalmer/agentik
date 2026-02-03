# Agentik

A modular AI coding agent and SDK.

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

**Why the CLI matters**

The CLI is intentionally small and serves as a reference client. It shows how to wire `@agentik/runtime` tools into `@agentik/sdk`, stream runtime events, and render them in a UI. If you are embedding Agentik in your own app, `packages/coding-agent` is the shortest path to copy/paste the essentials.
