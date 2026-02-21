import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type RepoContextMessage = {
  role: "system";
  source: string;
  content: string;
};

export type RepoContextLoadResult = {
  messages: RepoContextMessage[];
};

export type AgentikSettings = {
  context: {
    agentFile: string;
    projectStateFile: string;
    rulesGlob: string;
  };
  policy: {
    denyPaths: string[];
    requireApproval: {
      write: boolean;
      edit: boolean;
      bash: boolean;
    };
  };
  sessions: {
    persist: boolean;
    dir: string;
  };
  qualityGates: {
    requireTestsPassing: boolean;
  };
};

const DEFAULT_SETTINGS: AgentikSettings = {
  context: {
    agentFile: "AGENTIK.md",
    projectStateFile: "PROJECT_STATE.md",
    rulesGlob: ".agentik/rules/**/*.md",
  },
  policy: {
    denyPaths: ["**/.env", "**/.env.*", "**/secrets/**", "**/*.pem", "**/*.key"],
    requireApproval: {
      write: true,
      edit: true,
      bash: true,
    },
  },
  sessions: {
    persist: true,
    dir: ".agentik/sessions",
  },
  qualityGates: {
    requireTestsPassing: false,
  },
};

const SCAFFOLD_FILES: Record<string, string> = {
  "AGENTIK.md": `# AGENTIK\n\n## Repo Operating Principles\n\n- Plan before editing.\n- Ask before wide changes.\n- Keep diffs small.\n- Update PROJECT_STATE.md after meaningful work.\n`,
  "PROJECT_STATE.md": `# PROJECT STATE\n\n## Current goal\n\n- _Describe the active objective._\n\n## Key decisions\n\n- _Record architecture and implementation decisions._\n\n## Open questions\n\n- _Track unresolved tradeoffs or unknowns._\n\n## Next steps\n\n- _List immediate follow-up actions._\n\n## Known commands\n\n- _Add useful setup, lint, test, and build commands._\n`,
  ".agentik/rules/00-safety.md": `# Safety\n\n- Never access secrets.\n- Confirm before destructive actions.\n- Never exfiltrate local sensitive data.\n`,
  ".agentik/rules/10-style.md": `# Style\n\n- Prefer minimal diffs.\n- Run tests and formatter when available.\n- Update documentation with behavior changes.\n`,
  ".agentik/settings.json": `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`,
};

export async function initScaffold(options: { cwd: string; force?: boolean }): Promise<string[]> {
  const written: string[] = [];
  const root = resolve(options.cwd);

  for (const [relativePath, content] of Object.entries(SCAFFOLD_FILES)) {
    const filePath = join(root, relativePath);
    if (!options.force && existsSync(filePath)) {
      continue;
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    written.push(relativePath);
  }

  await mkdir(join(root, ".agentik/sessions"), { recursive: true });
  return written;
}

export function hasRepoScaffold(cwd: string): boolean {
  return existsSync(join(cwd, "AGENTIK.md"));
}

export async function loadSettings(cwd: string): Promise<AgentikSettings> {
  const settingsPath = join(cwd, ".agentik/settings.json");
  if (!existsSync(settingsPath)) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  const raw = await readFile(settingsPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AgentikSettings>;

  return {
    context: {
      ...DEFAULT_SETTINGS.context,
      ...(parsed.context ?? {}),
    },
    policy: {
      ...DEFAULT_SETTINGS.policy,
      ...(parsed.policy ?? {}),
      requireApproval: {
        ...DEFAULT_SETTINGS.policy.requireApproval,
        ...(parsed.policy?.requireApproval ?? {}),
      },
      denyPaths: parsed.policy?.denyPaths ?? DEFAULT_SETTINGS.policy.denyPaths,
    },
    sessions: {
      ...DEFAULT_SETTINGS.sessions,
      ...(parsed.sessions ?? {}),
    },
    qualityGates: {
      ...DEFAULT_SETTINGS.qualityGates,
      ...(parsed.qualityGates ?? {}),
    },
  };
}

export async function loadRepoContext(options: { cwd: string }): Promise<RepoContextLoadResult> {
  const cwd = resolve(options.cwd);
  const settings = await loadSettings(cwd);
  const messages: RepoContextMessage[] = [];

  const agentFilePath = join(cwd, settings.context.agentFile);
  if (existsSync(agentFilePath)) {
    messages.push({
      role: "system",
      source: settings.context.agentFile,
      content: await readFile(agentFilePath, "utf8"),
    });
  } else {
    return { messages: [] };
  }

  const projectStatePath = join(cwd, settings.context.projectStateFile);
  if (existsSync(projectStatePath)) {
    messages.push({
      role: "system",
      source: settings.context.projectStateFile,
      content: await readFile(projectStatePath, "utf8"),
    });
  }

  const rulesRoot = inferRulesRoot(settings.context.rulesGlob);
  const ruleFiles = await collectMarkdownFiles(join(cwd, rulesRoot));
  for (const filePath of ruleFiles.sort((a, b) => a.localeCompare(b))) {
    messages.push({
      role: "system",
      source: filePath.slice(cwd.length + 1),
      content: await readFile(filePath, "utf8"),
    });
  }

  return { messages };
}

function inferRulesRoot(globPattern: string): string {
  const normalized = globPattern.replaceAll("\\", "/");
  const marker = normalized.indexOf("**");
  const root = marker >= 0 ? normalized.slice(0, marker) : normalized;
  return root.replace(/\/$/, "");
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(filePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStats = await stat(filePath);
    if (fileStats.size === 0) {
      continue;
    }

    if (entry.name.endsWith(".md")) {
      files.push(filePath);
    }
  }

  return files;
}
