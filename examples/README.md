# Examples

Each example is runnable with Bun:

```bash
bun examples/runtime-basic-stream.ts
```

Some examples require API keys and a model ID:

```bash
AGENTIK_MODEL=claude-opus-4-5 \
ANTHROPIC_API_KEY=your_key_here \
bun examples/runtime-builtin-tools-anthropic.ts
```

## Index

- `runtime-basic-stream.ts`: minimal runtime usage with streaming output (mock model).
- `runtime-event-log.ts`: log the event sequence emitted by the runtime (mock model).
- `runtime-transform-context.ts`: trim or enrich the context before calling the model (mock model).
- `runtime-continue.ts`: continue a conversation without a new user message (mock model).
- `runtime-steering-follow-up.ts`: queue steering vs follow-up messages (mock model).
- `sdk-session-recording.ts`: record messages into an in-memory session store (mock model).
- `sdk-file-session-store.ts`: persist session entries to a JSON file (mock model).
- `sdk-session-manager.ts`: manage JSONL session files and branching (no model required).
- `sdk-compaction.ts`: run compaction helpers and append a summary entry (no model required).
- `sdk-resource-loader.ts`: load skills/prompts and AGENTS.md/CLAUDE.md context files.
- `sdk-model-registry.ts`: register models and resolve them using an auth store (mock model).
- `sdk-instructions-and-events.ts`: set instructions and stream events via Agent (mock model).
- `runtime-custom-tool.ts`: define and call a custom tool (real model required).
- `runtime-builtin-tools-anthropic.ts`: use built-in list/read tools (real model required).
- `subagents-shared-memory.ts`: create subagents with shared memory (mock model).

The helper `mock-model.ts` provides a small offline model that streams a single response.
