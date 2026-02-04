import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "./config";

export interface AuthStore {
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, apiKey: string): Promise<void>;
  delete(providerId: string): Promise<void>;
  list(): Promise<Record<string, string>>;
}

export class InMemoryAuthStore implements AuthStore {
  private data = new Map<string, string>();

  async get(providerId: string): Promise<string | undefined> {
    return this.data.get(providerId);
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    this.data.set(providerId, apiKey);
  }

  async delete(providerId: string): Promise<void> {
    this.data.delete(providerId);
  }

  async list(): Promise<Record<string, string>> {
    return Object.fromEntries(this.data.entries());
  }
}

export class FileAuthStore implements AuthStore {
  private filePath: string;

  constructor(filePath: string = join(getAgentDir(), "auth.json")) {
    this.filePath = filePath;
  }

  async get(providerId: string): Promise<string | undefined> {
    const data = await this.load();
    return data[providerId];
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    const data = await this.load();
    data[providerId] = apiKey;
    await this.save(data);
  }

  async delete(providerId: string): Promise<void> {
    const data = await this.load();
    if (providerId in data) {
      delete data[providerId];
      await this.save(data);
    }
  }

  async list(): Promise<Record<string, string>> {
    return this.load();
  }

  private async load(): Promise<Record<string, string>> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private async save(data: Record<string, string>): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
