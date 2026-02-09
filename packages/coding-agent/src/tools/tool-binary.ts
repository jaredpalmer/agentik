import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";

type ToolGuidance = {
  packageName: string;
  install: string;
};

const TOOL_GUIDANCE: Record<string, ToolGuidance> = {
  rg: {
    packageName: "ripgrep",
    install:
      "Install ripgrep (`rg`) and ensure it is on PATH. macOS: `brew install ripgrep`; Debian/Ubuntu: `sudo apt install ripgrep`; Fedora: `sudo dnf install ripgrep`.",
  },
  fd: {
    packageName: "fd",
    install:
      "Install fd (`fd`) and ensure it is on PATH. macOS: `brew install fd`; Debian/Ubuntu: `sudo apt install fd-find` (binary may be `fdfind`); Fedora: `sudo dnf install fd-find`.",
  },
};

class MissingToolBinaryError extends Error {
  readonly binaryName: string;

  constructor(binaryName: string) {
    super(formatMissingToolBinaryMessage(binaryName));
    this.name = "MissingToolBinaryError";
    this.binaryName = binaryName;
  }
}

function getPathValue(env: NodeJS.ProcessEnv): string {
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  return (pathKey ? env[pathKey] : undefined) ?? "";
}

function getPathExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [""];

  const pathExtKey = Object.keys(env).find((key) => key.toUpperCase() === "PATHEXT");
  const pathExtValue = (pathExtKey ? env[pathExtKey] : undefined) ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = pathExtValue
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);

  return ["", ...extensions];
}

function buildCandidates(binaryName: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [binaryName];

  const lower = binaryName.toLowerCase();
  if (
    lower.endsWith(".exe") ||
    lower.endsWith(".cmd") ||
    lower.endsWith(".bat") ||
    lower.endsWith(".com")
  ) {
    return [binaryName];
  }

  return getPathExtensions(env).map((ext) => `${binaryName}${ext}`);
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveToolBinary(
  binaryName: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!binaryName.trim()) return null;

  const hasPathSeparator = binaryName.includes("/") || binaryName.includes("\\");
  if (hasPathSeparator) {
    return canExecute(binaryName) ? binaryName : null;
  }

  const pathValue = getPathValue(env);
  if (!pathValue) return null;

  const dirs = pathValue.split(delimiter).filter(Boolean);
  const candidates = buildCandidates(binaryName, env);

  for (const dir of dirs) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (canExecute(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

export function formatMissingToolBinaryMessage(binaryName: string): string {
  const guidance = TOOL_GUIDANCE[binaryName];

  if (!guidance) {
    return `Missing required command: ${binaryName}. Install it and ensure it is on PATH, then retry.`;
  }

  return `Missing required command: ${binaryName} (${guidance.packageName}). ${guidance.install}`;
}

export function requireToolBinary(
  binaryName: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const resolved = resolveToolBinary(binaryName, env);
  if (!resolved) {
    throw new MissingToolBinaryError(binaryName);
  }
  return resolved;
}

function stripQuotedSegments(command: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (!quote) {
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        output += " ";
      } else {
        output += char;
      }
      continue;
    }

    if (char === "\\" && quote !== "'" && i + 1 < command.length) {
      output += "  ";
      i++;
      continue;
    }

    if (char === quote) {
      quote = null;
      output += " ";
    } else {
      output += " ";
    }
  }

  return output;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectCommandToolUsage(command: string, toolNames: readonly string[]): string[] {
  if (!command.trim() || toolNames.length === 0) return [];

  const sanitized = stripQuotedSegments(command);
  const toolPattern = toolNames.map((tool) => escapeForRegex(tool)).join("|");
  const regex = new RegExp(
    `(^|[|;&\\n(])\\s*(?:sudo\\s+)?(?:env\\s+[^\\s=]+=[^\\s]+\\s+)*(${toolPattern})(?=\\s|$)`,
    "g"
  );

  const found = new Set<string>();
  for (const match of sanitized.matchAll(regex)) {
    const tool = match[2];
    if (tool) found.add(tool);
  }

  return toolNames.filter((tool) => found.has(tool));
}

export function findMissingToolBinaries(
  toolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return toolNames.filter((toolName) => !resolveToolBinary(toolName, env));
}
