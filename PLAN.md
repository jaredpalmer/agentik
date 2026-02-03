# Plan: Pi-Style Agent + Coding Agent on AI SDK v6 (Bun + OpenTUI)

## Goals

- Build a pi-like agent system on top of AI SDK v6, preserving a strict split between agent and SDK, with UI housed inside the CLI package.
- Use Bun workspaces.
- Wrap OpenTUI for the terminal UI layer.
- Support subagents with shared memory and delegation, but keep it optional/feature-flagged.

## Architecture (Packages)

- `packages/runtime`
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

## Core Parity Gaps vs pi-mono (Focus Areas 1–4)

**1. Runtime loop + tools** (Phase 1)

- Steering and follow-up message queues (one-at-a-time vs all).
- Thinking levels and per-level budgets.
- Custom stream function hook for proxy/backends.
- Session ID propagation for provider caching.
- Dynamic API key resolution hook.
- Richer agent state (current stream message, pending tool calls).

**2. Session model** (Phase 2)

- JSONL session manager with tree/branching model.
- Resume/fork/tree navigation workflows.
- Compaction pipeline (manual + automatic).
- Session metadata (labels, display names, model changes).
- Export to HTML/JSONL.

**3. Provider/auth/model registry** (Phase 2)

- Provider registry with tool-capable model list.
- Auth storage + OAuth-based login flows.
- Model selection and fallback logic.
- Provider-specific options/config resolution.

**4. Resources/customization** (Phase 3)

- Resource loader for skills, prompts, extensions, themes.
- Context file discovery (`AGENTS.md`, `SYSTEM.md`, append flows).
- Extension API (tool interception/override, events, commands, UI hooks).
- Prompt templates and package discovery/install.

#### Future examples backlog (post-feature work)

- Skills/prompts/extensions loading and override hooks.
- Session resume/listing with persistent stores and parent links.
- Model registry, provider selection, and fallback behavior.
- Tool approval/safety gates and tool override patterns.
- CLI modes (print/json/rpc) and session workflows.
