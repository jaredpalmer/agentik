# Agentik

A modular AI coding agent and SDK.

**Packages**

- `@agentik/runtime` (`packages/runtime`): core agent loop/runtime, tool calls, and event model built on AI SDK
- `@agentik/sdk` (`packages/sdk`): agent sdk (session APIs and embedding helpers).
- `@agentik/coding-agent` (`packages/coding-agent`): minimal agent CLI and TUI built on opentui

## CLI

**Install**

```bash
curl -fsSL https://raw.githubusercontent.com/jaredpalmer/agentik/main/install.sh | bash
```

**Usage**

```bash
AGENTIK_MODEL=claude-opus-4-5 \
ANTHROPIC_API_KEY=your_key_here \
agentik
```

**Notes**

- The installer downloads the latest `cli-v*` GitHub Release asset and installs it as `agentik` in `~/.local/bin`.
- Override versions or install location:

```bash
AGENTIK_VERSION=cli-v0.1.0 AGENTIK_INSTALL_DIR="$HOME/bin" ./install.sh
```
