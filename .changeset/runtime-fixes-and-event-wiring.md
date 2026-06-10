---
"@jaredpalmer/agentik": minor
---

Fix runtime bugs and wire up documented-but-inert features:

- `PreToolUse`/`PostToolUse`/`PostToolUseFailure` hook contexts now receive the configured `sessionId`
- `getApiKey`/`apiKeyHeaders` are now actually used: resolved keys are sent as auth headers on each model call (`Authorization: Bearer` by default)
- `subagent_start`/`subagent_update`/`subagent_end` events are now emitted when `kind: "subagent"` tools run
- Errors thrown inside the agent loop (e.g. from `transformContext`) are surfaced as an `error` event and end the stream instead of leaking an unhandled rejection and hanging consumers
- The loop stops when aborted or out of steps instead of consulting stop hooks and follow-up queues
- `composeSignals` honors an already-aborted `abortSignal` passed to `prompt()`/`continue()`
- `EventStream.end()` is idempotent and always resolves `result()`, which previously hung forever when called without a value
- `Agent` isolates throwing event listeners so one bad subscriber cannot silently kill a run, and failed runs emit an `error` event
- Subagent specs pass `hooks` and `resolveModel` through to the subagent loop
