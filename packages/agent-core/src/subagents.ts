import type { SystemModelMessage } from "@ai-sdk/provider-utils";
import type { AgentRuntimeOptions, AgentToolDefinition } from "./types";
import { AgentRuntime } from "./agent-runtime";

export type SharedMemorySnapshot = Record<string, unknown>;

export class SharedMemoryStore {
  private data = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  snapshot(): SharedMemorySnapshot {
    return Object.fromEntries(this.data.entries());
  }
}

export type SubagentOptions = {
  id: string;
  instructions?: string | SystemModelMessage | Array<SystemModelMessage>;
  tools?: AgentToolDefinition[];
  memory?: SharedMemoryStore;
};

export type SubagentInstance = {
  id: string;
  runtime: AgentRuntime;
  memory: SharedMemoryStore;
};

export type SubagentManagerOptions = {
  enabled?: boolean;
  maxAgents?: number;
  baseRuntimeOptions: AgentRuntimeOptions;
  sharedMemory?: SharedMemoryStore;
};

export class SubagentManager {
  private enabled: boolean;
  private maxAgents: number;
  private baseRuntimeOptions: AgentRuntimeOptions;
  private sharedMemory: SharedMemoryStore;
  private agents = new Map<string, SubagentInstance>();

  constructor(options: SubagentManagerOptions) {
    this.enabled = options.enabled ?? false;
    this.maxAgents = options.maxAgents ?? 4;
    this.baseRuntimeOptions = options.baseRuntimeOptions;
    this.sharedMemory = options.sharedMemory ?? new SharedMemoryStore();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  list(): SubagentInstance[] {
    return Array.from(this.agents.values());
  }

  create(options: SubagentOptions): SubagentInstance {
    if (!this.enabled) {
      throw new Error("Subagents are disabled.");
    }
    if (this.agents.size >= this.maxAgents) {
      throw new Error("Subagent limit reached.");
    }
    if (this.agents.has(options.id)) {
      throw new Error(`Subagent ${options.id} already exists.`);
    }

    const runtime = new AgentRuntime({
      ...this.baseRuntimeOptions,
      instructions: options.instructions ?? this.baseRuntimeOptions.instructions,
      tools: options.tools ?? this.baseRuntimeOptions.tools,
    });

    const instance: SubagentInstance = {
      id: options.id,
      runtime,
      memory: options.memory ?? this.sharedMemory,
    };
    this.agents.set(options.id, instance);
    return instance;
  }

  get(id: string): SubagentInstance | undefined {
    return this.agents.get(id);
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }
}
