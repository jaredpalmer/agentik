---
module: Agent Class
date: 2026-02-05
problem_type: type_error
component: agent_class
symptoms:
  - "TS2339: Property '_agentRef' does not exist on type '{}'"
  - "tsc -b build fails after adding ExtensionAPI object with getter"
root_cause: type_mismatch
resolution_type: code_fix
severity: medium
package: "@agentik/agent"
tags: [extension-api, getter, this-binding, object-literal, typescript]
---

# Troubleshooting: Object Literal Getter Cannot Reference Outer Class via Custom Property

## Problem

When constructing an `ExtensionAPI` object inside a class method, using a `_agentRef: this` property and referencing it from a `get state()` getter fails TypeScript type-checking because `this` inside the getter refers to the object literal itself, not the outer class.

## Environment

- Module: Agent Class
- Package: @agentik/agent
- Bun Version: 1.3.0
- AI SDK Version: 6.0.72
- Affected Component: `Agent.use()` method — ExtensionAPI construction
- Date: 2026-02-05

## Symptoms

- `tsc -b` fails with: `error TS2339: Property '_agentRef' does not exist on type '{}'`
- Build error points to `this._agentRef._state` inside `get state()` getter
- The `_agentRef` property exists on the object but TypeScript cannot type it correctly when the getter uses `this`

## What Didn't Work

**Attempted Solution 1:** Storing `_agentRef: this` on the object and using `this._agentRef._state` in the getter

- **Why it failed:** TypeScript infers the type of `this` inside a getter as the object literal type. The `_agentRef` property is not part of the `ExtensionAPI` interface, so TypeScript cannot see it. Even with `as unknown as ExtensionAPI` cast, the getter's `this` context is the untyped object literal where `_agentRef` doesn't exist.

**Attempted Solution 2:** Using `Object.defineProperty` to define the getter after construction

- **Why it failed:** Redundant — if the root problem (getter `this` binding) is solved, `Object.defineProperty` is unnecessary.

## Solution

Capture the outer class instance in a `const self` variable before the object literal, then reference `self._state` in the getter:

```typescript
// Before (broken):
const api: ExtensionAPI = {
  get state() {
    return this._agentRef._state; // TS2339: '_agentRef' does not exist
  },
  _agentRef: this,
  // ...
} as unknown as ExtensionAPI;

// After (fixed):
const self = this; // capture outer class 'this'

const api = {
  get state() {
    return self._state; // works — closure over outer variable
  },
  // ...
} as ExtensionAPI;
```

## Why This Works

1. **Root cause:** In JavaScript/TypeScript, `this` inside a getter on an object literal refers to the object itself at runtime. TypeScript types this as the inferred object literal type, which doesn't include custom helper properties like `_agentRef`.

2. **The `const self = this` pattern** creates a closure variable that arrow functions and getters can reference. Since `self` is typed as the class instance (`Agent`), `self._state` is properly typed.

3. **Arrow functions vs getters:** Arrow functions on the object already captured the outer `this` correctly (since arrow functions don't bind their own `this`). Only the `get state()` getter needed the fix because getters use standard function `this` semantics.

## Prevention

- When constructing objects with getters inside class methods, use the `const self = this` pattern if the getter needs to reference the outer class instance.
- Arrow function properties on objects already capture the enclosing `this` — prefer them for methods, but getters cannot be arrow functions.
- Avoid putting hidden helper properties (like `_agentRef`) on typed objects — use closures instead.

## Related Issues

- See also: [tool-hook-result-variable-flow-AgentLoop-20260205.md](../logic-errors/tool-hook-result-variable-flow-AgentLoop-20260205.md) — Related extension system logic issue in the same implementation session
