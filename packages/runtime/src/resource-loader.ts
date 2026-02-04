import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { glob } from "glob";
import { getAgentDir } from "./config";

export type ResourceDiagnostic = {
  type: "warning" | "error";
  message: string;
  path?: string;
};

export type Skill = {
  name: string;
  description: string;
  filePath: string;
  source: "user" | "project" | "path";
  content: string;
  disableModelInvocation?: boolean;
};

export type PromptTemplate = {
  name: string;
  description: string;
  filePath: string;
  source: "user" | "project" | "path";
  content: string;
};

export type ResourceLoaderOptions = {
  cwd?: string;
  agentDir?: string;
  skillPaths?: string[];
  promptPaths?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string | string[];
  noSkills?: boolean;
  noPrompts?: boolean;
};

export interface ResourceLoader {
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  reload(): Promise<void>;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = normalizeNewlines(content);
  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const rawFrontmatter = normalized.slice(3, endIndex).trim();
  const body = normalized.slice(endIndex + 4).trim();
  const frontmatter: Record<string, string> = {};

  for (const line of rawFrontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    frontmatter[key] = stripQuotes(value);
  }

  return { frontmatter, body };
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function resolvePath(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("~")) {
    return join(homedir(), trimmed.slice(1));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

function resolvePromptInput(input: string | undefined, cwd: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const resolved = resolvePath(input, cwd);
  if (existsSync(resolved)) {
    return readFileSafe(resolved) ?? input;
  }
  return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
  const candidates = ["AGENTS.md", "CLAUDE.md"];
  for (const filename of candidates) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSafe(filePath);
    if (content) {
      return { path: filePath, content };
    }
  }
  return null;
}

function loadProjectContextFiles(
  cwd: string,
  agentDir: string
): Array<{ path: string; content: string }> {
  const contextFiles: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  const globalContext = loadContextFileFromDir(agentDir);
  if (globalContext) {
    contextFiles.push(globalContext);
    seen.add(globalContext.path);
  }

  let currentDir = cwd;
  const root = resolve("/");

  while (true) {
    const context = loadContextFileFromDir(currentDir);
    if (context && !seen.has(context.path)) {
      contextFiles.unshift(context);
      seen.add(context.path);
    }

    if (currentDir === root) {
      break;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return contextFiles;
}

function describeBody(body: string): string {
  const firstLine = body.split("\n").find((line) => line.trim());
  if (!firstLine) {
    return "";
  }
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
}

async function loadSkillsFromDir(
  dir: string,
  source: Skill["source"]
): Promise<{ skills: Skill[]; diagnostics: ResourceDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];

  if (!existsSync(dir)) {
    return { skills, diagnostics };
  }

  const rootFiles = await glob("*.md", { cwd: dir, dot: false, nodir: true });
  const nestedFiles = await glob("**/SKILL.md", {
    cwd: dir,
    dot: false,
    nodir: true,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  const files = [
    ...rootFiles.map((file) => join(dir, file)),
    ...nestedFiles.map((file) => join(dir, file)),
  ];

  for (const filePath of files) {
    const raw = readFileSafe(filePath);
    if (!raw) {
      diagnostics.push({ type: "warning", message: "Unable to read skill file", path: filePath });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(raw);
    const parentDir = basename(dirname(filePath));
    const name =
      frontmatter.name || (filePath.endsWith("SKILL.md") ? parentDir : basename(filePath, ".md"));
    const description = frontmatter.description || describeBody(body) || "Skill";

    skills.push({
      name,
      description,
      filePath,
      source,
      content: body,
      disableModelInvocation: frontmatter["disable-model-invocation"] === "true",
    });
  }

  return { skills, diagnostics };
}

async function loadPromptsFromDir(
  dir: string,
  source: PromptTemplate["source"]
): Promise<{ prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }> {
  const prompts: PromptTemplate[] = [];
  const diagnostics: ResourceDiagnostic[] = [];

  if (!existsSync(dir)) {
    return { prompts, diagnostics };
  }

  const files = await glob("*.md", { cwd: dir, dot: false, nodir: true });
  for (const file of files) {
    const filePath = join(dir, file);
    const raw = readFileSafe(filePath);
    if (!raw) {
      diagnostics.push({ type: "warning", message: "Unable to read prompt file", path: filePath });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(raw);
    const name = frontmatter.name || basename(filePath, ".md");
    const description = frontmatter.description || describeBody(body) || "Prompt";

    prompts.push({
      name,
      description,
      filePath,
      source,
      content: body,
    });
  }

  return { prompts, diagnostics };
}

export class DefaultResourceLoader implements ResourceLoader {
  private cwd: string;
  private agentDir: string;
  private skillPaths: string[];
  private promptPaths: string[];
  private systemPromptSource?: string;
  private appendSystemPromptSource: string[];
  private noSkills: boolean;
  private noPrompts: boolean;

  private skills: Skill[] = [];
  private skillDiagnostics: ResourceDiagnostic[] = [];
  private prompts: PromptTemplate[] = [];
  private promptDiagnostics: ResourceDiagnostic[] = [];
  private agentsFiles: Array<{ path: string; content: string }> = [];
  private systemPrompt?: string;
  private appendSystemPrompt: string[] = [];

  constructor(options: ResourceLoaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.agentDir = options.agentDir ?? getAgentDir();
    this.skillPaths = options.skillPaths ?? [];
    this.promptPaths = options.promptPaths ?? [];
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = Array.isArray(options.appendSystemPrompt)
      ? options.appendSystemPrompt
      : options.appendSystemPrompt
        ? [options.appendSystemPrompt]
        : [];
    this.noSkills = options.noSkills ?? false;
    this.noPrompts = options.noPrompts ?? false;

    void this.reload();
  }

  async reload(): Promise<void> {
    this.agentsFiles = loadProjectContextFiles(this.cwd, this.agentDir);

    this.systemPrompt = resolvePromptInput(this.systemPromptSource, this.cwd);
    if (!this.systemPrompt) {
      const systemCandidates = [join(this.agentDir, "SYSTEM.md"), join(this.cwd, "SYSTEM.md")];
      for (const candidate of systemCandidates) {
        if (existsSync(candidate)) {
          const content = readFileSafe(candidate);
          if (content) {
            this.systemPrompt = content;
            break;
          }
        }
      }
    }

    this.appendSystemPrompt = this.appendSystemPromptSource
      .map((value) => resolvePromptInput(value, this.cwd))
      .filter((value): value is string => Boolean(value));

    if (this.noSkills) {
      this.skills = [];
      this.skillDiagnostics = [];
    } else {
      const projectSkillsDir = join(this.cwd, ".agent", "skills");
      const userSkillsDir = join(this.agentDir, "skills");

      const aggregatedSkills: Skill[] = [];
      const diagnostics: ResourceDiagnostic[] = [];

      const sources: Array<{ dir: string; source: Skill["source"] }> = [
        { dir: projectSkillsDir, source: "project" },
        { dir: userSkillsDir, source: "user" },
      ];

      for (const path of this.skillPaths) {
        sources.push({ dir: resolvePath(path, this.cwd), source: "path" });
      }

      for (const source of sources) {
        const result = await loadSkillsFromDir(source.dir, source.source);
        aggregatedSkills.push(...result.skills);
        diagnostics.push(...result.diagnostics);
      }

      this.skills = aggregatedSkills;
      this.skillDiagnostics = diagnostics;
    }

    if (this.noPrompts) {
      this.prompts = [];
      this.promptDiagnostics = [];
    } else {
      const projectPromptsDir = join(this.cwd, ".agent", "prompts");
      const userPromptsDir = join(this.agentDir, "prompts");

      const aggregatedPrompts: PromptTemplate[] = [];
      const diagnostics: ResourceDiagnostic[] = [];

      const sources: Array<{ dir: string; source: PromptTemplate["source"] }> = [
        { dir: projectPromptsDir, source: "project" },
        { dir: userPromptsDir, source: "user" },
      ];

      for (const path of this.promptPaths) {
        sources.push({ dir: resolvePath(path, this.cwd), source: "path" });
      }

      for (const source of sources) {
        const result = await loadPromptsFromDir(source.dir, source.source);
        aggregatedPrompts.push(...result.prompts);
        diagnostics.push(...result.diagnostics);
      }

      this.prompts = aggregatedPrompts;
      this.promptDiagnostics = diagnostics;
    }
  }

  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    return { skills: this.skills, diagnostics: this.skillDiagnostics };
  }

  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
    return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
  }

  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
    return { agentsFiles: this.agentsFiles };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  getAppendSystemPrompt(): string[] {
    return this.appendSystemPrompt;
  }
}
