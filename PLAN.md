# Coding Agent TUI Refresh + Subagent Lanes (Execution Plan)

## Goal

Refresh the `packages/coding-agent` TUI to reflect Codex-style layout, status/footer, input ergonomics, and tool-call/output presentation. Add explicit subagent runtime events and UI lanes so delegated work is visible and streamed distinctly.

## Scope

- Update runtime event model to emit subagent lifecycle events.
- Add CLI subagent registration via environment configuration.
- Refactor TUI layout and styling using OpenTUI primitives.
- Replace single-line input with a multi-line composer (Enter sends, Shift+Enter newline).
- Improve tool-call rendering and truncation.
- Track work in `features.json` and `session.txt`.

Out of scope (for this pass): full Codex slash-command popups, attachment UX, and complete Codex feature parity.

## Key Files

- `packages/runtime/src/types.ts`
- `packages/runtime/src/agent-runtime.ts`
- `packages/runtime/src/subagents.ts`
- `packages/coding-agent/src/cli.ts`
- `packages/coding-agent/src/tui/tui-app.ts`
- `packages/coding-agent/src/tui/markdown-theme.ts`
- `packages/coding-agent/src/tui/components/*`
- New: `packages/coding-agent/src/tui/theme.ts`
- New: `features.json`, `init.sh`, `session.txt`

## Feature Breakdown

See `features.json` for detailed, step-by-step instructions and acceptance criteria per feature.

## Commit Strategy

- Commit after each completed feature in `features.json`.
- Use concise, scoped messages (e.g., `tui: add theme tokens`, `runtime: emit subagent events`).
- Update `features.json` status and append to `session.txt` before each commit.

## Validation Strategy

- Run lightweight checks after each feature (TypeScript build or targeted lint if applicable).
- Manual TUI run after layout/input/tool-call changes.
- Document any skipped checks in `session.txt`.

## Execution Order (Feature IDs)

1. `F00` Bootstrap planning assets (`PLAN.md`, `features.json`, `init.sh`, `session.txt`).
2. `F01` Runtime: subagent metadata + event emission.
3. `F02` CLI: subagent registry/config + tool registration.
4. `F03` TUI: theme tokens + markdown theme alignment.
5. `F04` TUI: layout refactor and chrome (status/footer scaffolding).
6. `F05` TUI: multi-line textarea composer (Enter send, Shift+Enter newline).
7. `F06` TUI: status indicator + footer hint logic.
8. `F07` TUI: tool-call formatting, truncation, and summary presentation.
9. `F08` TUI: subagent lanes, streaming, and labeling.
10. `F09` Docs/notes (if needed): update README or internal notes.

## Acceptance Summary

- Subagent events are emitted and surfaced in the UI.
- Input supports multi-line compose with the requested keybindings.
- Tool-call output and execution status are visually clear and compact.
- Layout feels Codex-inspired: clear status line, footer hints, and consistent gutters.
- `features.json` and `session.txt` accurately reflect progress.
