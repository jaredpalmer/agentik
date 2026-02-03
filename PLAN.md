# Plan: Pi-Style Agent + Coding Agent on AI SDK v6 (Bun + OpenTUI)

## Goals

- Build a pi-like agent system on top of AI SDK v6, preserving a strict split between agent and SDK, with UI housed inside the CLI package.
- Use Bun workspaces.
- Wrap OpenTUI for the terminal UI layer.
- Support subagents with shared memory and delegation, but keep it optional/feature-flagged.

## Architecture (Packages)

- `packages/agent`
  - AI SDK v6 runtime wrapper (ToolLoopAgent + event model).
  - Tool registry, tool execution policies, and streaming event bus.
  - Session tree format (pi-style JSONL) and compaction hooks.
  - Subagent manager (optional) with shared-memory access rules.

- `packages/sdk`
  - `createAgentSession` and embedding API (pi-style `sdk.ts`).
  - Loads settings/auth, resources (skills/prompts/extensions), and session state.
  - Model resolution and fallback behavior.

- `packages/coding-agent`
  - CLI with modes: interactive (TUI), print/JSON, and RPC.
  - Session management, command system, and tool wiring.
  - Internal `src/tui/` module for OpenTUI renderables and input handling.

## Phases

### Phase 0: Repo Skeleton (Bun)

- Create Bun workspace root configs and shared tsconfig.
- Add package scaffolds with `src/index.ts` placeholders.
- Wire basic build/typecheck scripts.

### Phase 1: Agent (AI SDK v6)

- Define `AgentMessage`, `AgentEvent`, and session tree.
- Implement AI SDK v6 `ToolLoopAgent` wrapper.
- Add tool registry + execution policies + event emission.
- Add compaction hooks and context transformers.

### Phase 2: SDK

- Implement `createAgentSession` entrypoint.
- Resource loading (skills/prompts/extensions), settings/auth.
- Session restore and model fallback logic.

### Phase 3: TUI (OpenTUI Wrapper)

- Implemented inside `packages/coding-agent/src/tui/`.
- Renderer bootstrap, message list, input/editor.
- Event stream to renderable mapping.
- Overlays, status/footer, and keybindings.

### Phase 4: Coding Agent CLI

- CLI entry + mode router.
- Interactive TUI mode.
- Print/JSON mode.
- RPC mode.

### Phase 5: Subagents (Optional Feature)

- Shared-memory store with explicit access rules.
- Delegation tool for spawning subagents with restricted tools.
- Optional parallel orchestration policy.

### Phase 6: Docs + Examples

- Quick start and configuration.
- Tooling, extensions, skills.
- Subagent usage patterns.
- SDK embedding examples.
