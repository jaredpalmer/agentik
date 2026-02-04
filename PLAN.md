# Plan: Pi-Style Agent + Coding Agent on AI SDK v6 (Bun + OpenTUI)

## Goals

- Build a pi-like agent system on top of AI SDK v6 with a single runtime package (loop + optional session recording) and UI housed inside the CLI package.
- Use Bun workspaces.
- Wrap OpenTUI for the terminal UI layer.
- Support subagents with shared memory and delegation, but keep it optional/feature-flagged.

## Architecture (Packages)

- `packages/runtime`
  - AI SDK v6 runtime wrapper (ToolLoopAgent + event model).
  - Tool registry, tool execution policies, and streaming event bus.
  - Session tree format (pi-style JSONL) and compaction hooks.
  - Subagent manager (optional) with shared-memory access rules.

- `packages/coding-agent`
  - CLI with modes: interactive (TUI), print/JSON, and RPC.
  - Session management, command system, and tool wiring.
  - Internal `src/tui/` module for OpenTUI renderables and input handling.

## Phases

### Phase 0: Repo Skeleton (Bun) — ✅ Complete

- Create Bun workspace root configs and shared tsconfig.
- Add package scaffolds with `src/index.ts` placeholders.
- Wire basic build/typecheck scripts.

### Phase 1: Agent (AI SDK v6) — ✅ Complete

- Define `AgentMessage`, `AgentEvent`, and session tree.
- Implement AI SDK v6 `ToolLoopAgent` wrapper.
- Add tool registry + execution policies + event emission.
- Add compaction hooks and context transformers.

### Phase 2: Sessions + Policy (Runtime) — ⚠️ Partial

Implemented: session recording (`SessionStore`), JSONL `SessionManager`, compaction helpers, resource loader (skills/prompts/context), auth store, model registry, config helpers.
Remaining: settings manager, session policy features (fork/switch/goto/retry/backoff), auto-compaction/overflow handling, model fallback logic.

### Phase 3: TUI (OpenTUI Wrapper) — ❌ Pending

- Implemented inside `packages/coding-agent/src/tui/`.
- Renderer bootstrap, message list, input/editor.
- Event stream to renderable mapping.
- Overlays, status/footer, and keybindings.

### Phase 4: Coding Agent CLI — ⚠️ Partial

- CLI entry + mode router.
- Interactive TUI mode.
- Print/JSON mode.
- RPC mode.

### Phase 5: Subagents (Optional Feature) — ⚠️ Partial

Implemented: shared-memory store + delegation tool for spawning subagents.
Remaining: explicit access rules + parallel orchestration policy.

### Phase 6: Docs + Examples — ⚠️ In Progress

- Quick start and configuration.
- Tooling, extensions, skills.
- Subagent usage patterns.
- Agent embedding examples.

## Core Parity Gaps vs pi-mono (Updated)

**1. Runtime loop + tools**

- ✅ Steering and follow-up message queues (one-at-a-time vs all).
- ⚠️ Thinking levels and per-level budgets (provider mapping pending).
- ✅ Custom stream function hook for proxy/backends.
- ⚠️ Session ID propagation for provider caching (mapping pending).
- ✅ Dynamic API key resolution hook + headers.
- ✅ Richer agent state (current stream message, pending tool calls).
- ✅ Streaming event fidelity (full stream parts).
- ✅ Grep/find tools.

**2. Session model**

- ✅ JSONL session manager with tree/branching model.
- ✅ Session metadata (labels, session name, model changes).
- ⚠️ Compaction pipeline (manual only; auto-compact pending).
- ❌ Resume/fork/tree navigation workflows (CLI).
- ❌ Export to HTML.

**3. Provider/auth/model registry**

- ✅ Model registry + auth storage helpers.
- ❌ OAuth-based login flows + provider discovery.
- ❌ Model selection and fallback logic.
- ❌ Provider-specific options/config resolution.

**4. Resources/customization**

- ✅ Resource loader for skills/prompts/context files + append system prompts.
- ❌ Extensions/themes and tool interception hooks.
- ❌ Prompt template discovery/install.

#### Examples status

- ✅ Session recording, session manager, compaction, resource loader examples.
- ✅ Model registry/auth store usage example.
- ❌ Session resume/fork/listing workflows.
- ❌ Tool approval/safety gates and override patterns.
- ❌ CLI RPC mode example.
