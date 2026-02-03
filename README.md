# Agentik

A modular AI coding agent and SDK.

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
