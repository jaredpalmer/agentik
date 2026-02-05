---
module: Agent Loop
date: 2026-02-05
problem_type: logic_error
component: agent_loop
symptoms:
  - "TS2454: Variable 'result' is used before being assigned"
  - "Adding beforeToolCall hook creates conditional assignment path where result may be undefined"
root_cause: missing_null_check
resolution_type: code_fix
severity: medium
package: "@agentik/agent"
tags: [extension-system, hook, before-tool-call, variable-flow, typescript]
---

# Troubleshooting: Tool Hook Integration Creates Unassigned Variable Path

## Problem

When adding `beforeToolCall` hook support to `executeToolCalls()` in the agent loop, a conditional "block" path was introduced where the hook provides the result instead of `tool.execute()`. TypeScript correctly flagged that the `result` variable might be used before assignment because the compiler cannot track that `blocked = true` guarantees `result` is assigned.

## Environment

- Module: Agent Loop
- Package: @agentik/agent
- Bun Version: 1.3.0
- AI SDK Version: 6.0.72
- Affected Component: `executeToolCalls()` in `agent-loop.ts`
- Date: 2026-02-05

## Symptoms

- `tsc -b` fails with three TS2454 errors on lines using `result` after the try/catch block
- The errors appear at: `result` usage in `tool_execution_end` event push, and `result.content` / `result.details` in `ToolResultMessage` construction
- Build was clean before adding the hook conditional

## What Didn't Work

**Attempted Solution 1:** Using a `blocked` boolean flag to guard execution

```typescript
let result: AgentToolResult<unknown>;
let blocked = false;

if (beforeToolCall) {
  const hookResult = await beforeToolCall(toolCall, tool);
  if (hookResult.action === "block") {
    result = hookResult.result;
    blocked = true;
  }
}

if (!blocked) {
  result = await tool.execute(...);
}
```

- **Why it failed:** TypeScript's control flow analysis cannot determine that `blocked === true` implies `result` is assigned. The `let blocked` + `if (!blocked)` pattern creates a path where TypeScript sees `result` as potentially unassigned after both branches.

## Solution

Changed `result` type to `AgentToolResult<unknown> | undefined` and used the hook result assignment itself as the guard condition, then used non-null assertion (`!`) after the try/catch where all paths guarantee assignment:

```typescript
// Before (broken):
let result: AgentToolResult<unknown>;
let blocked = false;
// ... blocked flag pattern — TS2454

// After (fixed):
let result: AgentToolResult<unknown> | undefined;

if (beforeToolCall) {
  const hookResult = await beforeToolCall(toolCall, tool);
  if (hookResult.action === "block") {
    result = hookResult.result;  // assigned by hook
  } else if (hookResult.toolCall) {
    toolCall = hookResult.toolCall;  // modify args, continue
  }
}

if (!result) {
  result = await tool.execute(...);  // assigned by execution
}

// catch also assigns result on error

// After try/catch, result is guaranteed assigned
const finalResult = result!;  // non-null assertion safe here
```

Key changes:

1. `result` typed as `| undefined` instead of bare type
2. `!result` replaces `!blocked` as the guard — TypeScript understands this narrows the type
3. `result!` used after the try/catch where all three paths (hook block, execute, catch) assign it

## Why This Works

1. **Root cause:** TypeScript's definite assignment analysis tracks whether a variable of type `T` has been assigned, but cannot follow boolean flag indirection (`blocked = true` implies `result` assigned). It can, however, track `undefined` checks directly on the variable itself.

2. **`!result` guard:** By checking the variable directly (`if (!result)`), TypeScript's control flow analysis correctly determines that after the `if` block, `result` is assigned (either by the hook or by `tool.execute()`). Combined with the `catch` block also assigning `result`, all paths are covered.

3. **`result!` assertion:** After the try/catch, TypeScript still sees `result` as `AgentToolResult | undefined` because the catch might not execute. The `!` assertion is safe because exactly one of three paths always assigns it: hook block, tool execute, or catch.

## Prevention

- When adding conditional assignment paths (e.g., hook can provide a value OR the normal path provides it), use `| undefined` on the variable and check the variable directly rather than using a separate boolean flag.
- TypeScript's control flow analysis works best with direct variable checks (`if (!x)`) rather than indirect flag patterns (`if (!flagThatMeansXIsSet)`).
- When you know all paths in a try/catch assign a variable but TypeScript can't prove it, assign to a `const` with `!` and document why it's safe.

## Related Issues

- See also: [extensionapi-object-getter-this-binding-AgentClass-20260205.md](../type-errors/extensionapi-object-getter-this-binding-AgentClass-20260205.md) — Related extension system type issue in the same implementation session
