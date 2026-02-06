/**
 * Provider registration — extensions can register custom LLM providers.
 *
 * Each provider has a name, base URL, API key, and a list of models.
 * Registrations are stored immediately and available via get().
 */

/** Configuration for a model within a provider. */
export interface ModelConfig {
  name: string;
  displayName?: string;
  maxTokens?: number;
  supportsThinking?: boolean;
}

/** Configuration for registering a provider. */
export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  models?: ModelConfig[];
  headers?: Record<string, string>;
}

/** A registered provider entry. */
export interface RegisteredProvider {
  name: string;
  config: ProviderConfig;
}

export class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();

  /** Register or update a provider. */
  register(name: string, config: ProviderConfig): () => void {
    const entry: RegisteredProvider = { name, config };
    this.providers.set(name, entry);

    return () => {
      this.providers.delete(name);
    };
  }

  /** Get a registered provider. */
  get(name: string): RegisteredProvider | undefined {
    return this.providers.get(name);
  }

  /** Check if a provider is registered. */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** List all registered providers. */
  listProviders(): RegisteredProvider[] {
    return [...this.providers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Number of registered providers. */
  get size(): number {
    return this.providers.size;
  }
}
