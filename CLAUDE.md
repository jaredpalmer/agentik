# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                  # Install dependencies
bun run build                # TypeScript build (tsc -b, composite projects)
bun test                     # Build + run all tests (uses bunfig.toml root = "./packages")
bun test packages/agent      # Run tests for one package
bun test --filter "edit"     # Run tests matching a pattern
bun run typecheck            # Type check without emit
bun run lint                 # oxlint with type-aware rules
bun run lint:fix             # Auto-fix lint issues
bun run format               # Format with oxfmt
bun run knip                 # Check for unused deps/exports

# Run the TUI
ANTHROPIC_API_KEY=... bun run packages/coding-agent/src/cli.ts
```

**Important**: Do NOT run `bun test ./packages` directly — the `bunfig.toml` sets `[test] root = "./packages"` to exclude vendored tests in `opensrc/`. Just use `bun test`.

## Architecture

Bun monorepo with two packages:

**`@agentik/agent`** — Core library. Depends only on `ai` (AI SDK 6) and `zod`.

- `agent-loop.ts` — The core loop: `agentLoop()` / `agentLoopContinue()`. Manages the `user → LLM → tool calls → execute → results → LLM` cycle. Does NOT use AI SDK's `maxSteps`; it controls tool execution directly.
- `agent.ts` — `Agent` class: stateful wrapper around the loop with event subscriptions, message queuing, steering (mid-run interrupts), and follow-up messages. Extensions are registered via `agent.use(extension)`.
- `event-stream.ts` — `EventStream<T, R>`: generic async iterable for streaming events via `for await...of`.
- `types.ts` — All type definitions. Key types: `AgentMessage` (union of User/Assistant/ToolResult + custom via declaration merging), `AgentTool<TParams, TDetails>`, `AgentEvent`, `Extension`, `ExtensionAPI`, `ThinkingLevel`.

**`@agentik/coding-agent`** — Concrete agent built on core.

- `tools/` — 7 tools (bash, read_file, write_file, edit, glob, grep, ls). Each uses Zod schemas for parameters and returns `AgentToolResult<Details>`.
- `extensions/` — 3 extensions: `bashGuard` (blocks dangerous commands), `toolLogger` (execution timing), `contextInfo` (injects cwd/git/timestamp).
- `tui/` — Terminal UI using `@opentui/core`. `app.ts` has the main `TuiApp` class; `theme.ts` has the Tokyonight-based color scheme.
- `cli.ts` — Entry point. Creates Agent, registers extensions, starts TUI.

### Key Patterns

- **Tools**: Zod schemas for parameters, `execute(toolCallId, params, signal?, onUpdate?)` returns `AgentToolResult`. All support `AbortSignal`.
- **Extensions**: `Extension = (api: ExtensionAPI) => void | (() => void)`. Hooks: `transformContext` (before LLM), `beforeToolCall` (block/modify), `afterToolResult` (modify results). Multiple hooks chain; first "block" wins for beforeToolCall.
- **Messages**: Extensible via TypeScript declaration merging on `CustomAgentMessages`. Custom messages are filtered out before LLM calls by `convertToLlm`.
- **Steering vs Follow-up**: Steering interrupts mid-run (after tool execution, skips remaining tools). Follow-ups queue after the agent would otherwise stop.
- **Thinking levels**: `off | minimal | low | medium | high | xhigh` map to budget token limits sent to the provider.

## Code Style

- **Formatter**: oxfmt — 100 char line width, double quotes, trailing commas (es5), semicolons, 2-space indent
- **Linter**: oxlint with type-aware rules. `no-floating-promises` and `no-misused-promises` are **errors**. `no-explicit-any` is a warning.
- **Pre-commit hooks** (lefthook): format, lint with auto-fix, typecheck, knip — all run sequentially

## Dependencies

- `ai@6.0.72` (AI SDK 6) — `streamText`, `tool()`, `LanguageModel`, `ModelMessage`
- `zod@4.3.6` — Tool parameter schemas
- `@opentui/core` — TUI rendering (coding-agent only)
- `@ai-sdk/anthropic`, `@ai-sdk/openai` — Provider SDKs (coding-agent only)

## Reference Source Code

Source code for dependencies is available in `opensrc/`. See `opensrc/sources.json` for available packages. Use `npx opensrc <package>` to fetch additional source when you need to understand internal implementation details beyond types.
