import type { AuthStore } from "./auth-store";
import type { Skill } from "./resource-loader";
import type { SessionStore } from "./session-store";
import type { AgentToolDefinition } from "./types";

export type ToolProviderContext = {
  cwd: string;
  env?: Record<string, string>;
};

export type ToolProvider = {
  name: string;
  createTools(context: ToolProviderContext): AgentToolDefinition[];
};

export type SkillProvider = {
  name: string;
  loadSkills(): Promise<Skill[]>;
};

export type StorageProvider = {
  name: string;
  createSessionStore(sessionId: string): SessionStore;
  createAuthStore(): AuthStore;
};
