# Agentik vs pi-mono: Detailed Feature Comparison (Updated)

This document compares Agentik (current repo) against pi-mono’s agent stack, reflecting the **merged architecture** where runtime + session recording live in a single package.

## Current Agentik Architecture (Merged)

- `@agentik/runtime` (`packages/runtime`)
  - `Agent` entrypoint (wraps AI SDK `ToolLoopAgent`).
  - Built-in tools and event stream.
  - Optional session recording via `SessionStore`.
  - Subagents (optional, uses internal runtime).
- `@agentik/coding-agent` (`packages/coding-agent`)
  - CLI + OpenTUI reference client.

## Package Mapping

| pi-mono Package                                       | Agentik Package         | Purpose                                 |
| ----------------------------------------------------- | ----------------------- | --------------------------------------- |
| `@mariozechner/pi-agent-core`                         | `@agentik/runtime`      | Core agent loop, events, tools          |
| `@mariozechner/pi-coding-agent` (core/session/policy) | `@agentik/runtime`      | Session recording + future policy hooks |
| `@mariozechner/pi-coding-agent` (CLI)                 | `@agentik/coding-agent` | CLI and TUI                             |

**Status legend:** ✅ implemented · ⚠️ partial · ❌ missing

---

## 1. Agent Loop + Events (Runtime)

### 1.1 Custom Stream Function Hook

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent.ts`
- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/types.ts`

**Agentik Location:**

- `packages/runtime/src/agent-runtime.ts` (internal loop)
- `packages/runtime/src/types.ts` (options)

**Agentik:** `streamFn` in `AgentConfig` lets you override `ToolLoopAgent.stream()` for proxying.

---

### 1.2 Session ID Propagation (Provider Caching)

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent.ts`
- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent-loop.ts`

**Agentik Location:**

- `packages/runtime/src/agent-runtime.ts`
- `packages/runtime/src/types.ts`

**Agentik:** `sessionId` is stored on state/config and available to `prepareCall`/`thinkingAdapter`, but there is no default provider mapping.

---

### 1.3 Dynamic API Key Resolution

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent.ts`
- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/types.ts`

**Agentik Location:**

- `packages/runtime/src/agent-runtime.ts`
- `packages/runtime/src/types.ts`

**Agentik:** `getApiKey(providerId, modelId)` + optional `apiKeyHeaders` inject headers per call.

---

### 1.4 Thinking Levels and Budgets

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/types.ts` (ThinkingLevel)
- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent.ts` (ThinkingBudgets)

**Agentik Location:**

- `packages/runtime/src/types.ts`
- `packages/runtime/src/agent-runtime.ts`

**Agentik:** `thinkingLevel`/`thinkingBudgets` exist with `thinkingAdapter` hook; mapping to provider options is user-defined.

---

### 1.5 Max Retry Delay Cap

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent.ts`

**Agentik Location:**

- `packages/runtime/src/agent-runtime.ts`

**Agentik:** `maxRetryDelayMs` maps to `timeout.stepMs` when unset.

---

### 1.6 Richer Agent State

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/types.ts`

**Agentik Current State:**

- `packages/runtime/src/types.ts`

**Agentik:** `streamMessage` + `pendingToolCalls` are included in `AgentState`.

---

### 1.7 Streaming Event Fidelity

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent-loop.ts`
- Emits `AssistantMessageEvent` updates (text/thinking/toolcall deltas)

**Agentik Current:**

- `packages/runtime/src/agent-runtime.ts` emits `stream_part` for all stream parts.
- `message_update` still carries text deltas, but the full stream is available.

---

### 1.8 Steering Mid-Tool Execution

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/agent/src/agent-loop.ts`
- Can skip remaining tool calls if steering arrives

**Agentik Current:**

- Tool calls can be skipped when steering is queued; skipped tool results are emitted.

---

### 1.9 Low-Level Loop API

**Status:** ❌ Missing in Agentik

**pi-mono Reference:**

- `agentLoop` / `agentLoopContinue` (EventStream)

**Agentik Current:**

- Only `Agent` wrapper is public; no standalone loop function.

---

## 2. Sessions + Policy (Merged into Runtime)

### 2.1 Session Recording

**Status:** ✅ Implemented

**Agentik Implementation:**

- `packages/runtime/src/agent.ts` (`Agent` auto-records when `sessionStore` is provided)
- `packages/runtime/src/session-store.ts` (`SessionStore`, `InMemorySessionStore`)

**Behavior:** Records `message_end` events as `SessionEntry` with parent linkage.

---

### 2.2 JSONL Session Manager with Tree/Branching

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/coding-agent/src/core/session-manager.ts`

**Agentik Current:**

- `packages/runtime/src/session-manager.ts` (JSONL session manager + tree/branch APIs).

---

### 2.3 Compaction + Branch Summaries

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `compaction/compaction.ts`
- `compaction/branch-summarization.ts`

**Agentik Current:**

- `packages/runtime/src/compaction/index.ts` provides pure compaction helpers.
- Branch summaries are supported via `SessionManager.appendBranchSummary` but not automated.

---

### 2.4 Model Registry + Auth Storage

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `model-registry.ts`
- `auth-storage.ts`

**Agentik Current:**

- `packages/runtime/src/auth-store.ts` and `packages/runtime/src/model-registry.ts`.
- Auth store + model registry are available, but no OAuth refresh or provider discovery.

---

### 2.5 Settings Manager

**Status:** ❌ Missing

**pi-mono Reference:**

- `settings-manager.ts`

**Agentik Current:**

- No global/project settings merge or persistence.

---

### 2.6 Resource Loader (Skills/Prompts/Extensions/Themes)

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `resource-loader.ts`, `skills.ts`, `prompt-templates.ts`, `extensions/*`

**Agentik Current:**

- `DefaultResourceLoader` loads skills, prompts, AGENTS/CLAUDE context files, and append system prompts.
- No extensions/themes yet.

---

### 2.7 Session Policy Features

**Status:** ❌ Missing

**pi-mono Reference:**

- `agent-session.ts`

**Agentik Current:**

- No fork/switch/goto entry, retry/backoff, auto-compact-on-overflow, HTML export.

---

## 3. Tools

### 3.1 Built-in Tools (Agentik)

**Status:** ✅ Implemented

**Agentik Tools:**

- `read`, `write`, `edit`, `update`, `list`, `glob`, `find`, `grep`, `truncate`, `bash`, `webfetch`
- Located in `packages/runtime/src/tools/*`

---

### 3.2 Grep Tool

**Status:** ✅ Implemented

**pi-mono Reference:**

- `opensrc/repos/github.com/badlogic/pi-mono/packages/coding-agent/src/core/tools/grep.ts`

**Agentik Current:**

- `packages/runtime/src/tools/grep.ts`
- `createGrepTool` wired into `packages/coding-agent/src/cli.ts`

---

### 3.3 Find Tool

**Status:** ✅ Implemented

**pi-mono Reference:**

- `tools/find.ts`

**Agentik Current:**

- `packages/runtime/src/tools/find.ts`
- `createFindTool` wired into `packages/coding-agent/src/cli.ts`

---

### 3.4 Bash Operations Tracking

**Status:** ⚠️ Partial

**pi-mono Reference:**

- `tools/bash.ts` (file ops tracking)

**Agentik Current:**

- `bash` tool executes commands and emits UI metadata (command, cwd, exit code, duration).
- No file read/write/delete tracking yet.

---

## 4. CLI (coding-agent)

**Status:** ⚠️ Minimal vs pi-mono

**Agentik Current:**

- `--print` and interactive TUI only.
- RPC mode stubbed.
- No session tree navigation or fork/switch commands.

---

## 5. Updated Priority (Merged Architecture)

**Completed**

1. Session tree manager + JSONL storage
2. Custom stream function / proxy
3. Dynamic API keys + headers
4. Built-in grep/find tools
5. Richer agent state + streaming fidelity
6. Compaction helpers + manual branch summaries

**Critical (Remaining)**

1. Auto-compaction + overflow handling
2. Settings manager + session policy (fork/switch/goto/retry/backoff)
3. Session ID propagation provider mapping
4. Thinking levels / budgets provider mapping

**High**

1. Resource loader extensions/themes
2. Model registry auth refresh + provider discovery
3. CLI session tree navigation and fork/switch workflows

**Medium**

1. Bash operations tracking
2. Low-level loop API
3. HTML/JSONL export helpers

---

## 6. File Structure (Current + Missing Targets)

```
packages/
├── runtime/
│   └── src/
│       ├── agent.ts              # ✅ Agent wrapper (public)
│       ├── agent-runtime.ts      # Internal runtime loop
│       ├── auth-store.ts         # ✅ AuthStore interfaces
│       ├── model-registry.ts     # ✅ ModelRegistry helpers
│       ├── resource-loader.ts    # ✅ skills/prompts/context loader
│       ├── config.ts             # ✅ agent/session dir helpers
│       ├── session-store.ts      # ✅ SessionStore interface
│       ├── session-manager.ts    # ✅ JSONL session manager
│       ├── compaction/           # ✅ compaction helpers
│       ├── types.ts              # AgentMessage/Event/Session types
│       ├── tools/                # Built-in tools
│       │   ├── find.ts           # ✅ find tool
│       │   ├── grep.ts           # ✅ grep tool
│       │   └── ...               # other built-ins
│       └── subagents.ts          # Optional subagent manager
└── coding-agent/
    └── src/
        ├── cli.ts
        └── tui/
```
