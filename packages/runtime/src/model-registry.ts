import type { LanguageModel } from "ai";
import type { AuthStore } from "./auth-store";

export type ModelFactory = (options: { apiKey?: string }) => LanguageModel;

export type ModelDefinition = {
  id: string;
  label?: string;
  providerId?: string;
  modelId?: string;
  model?: LanguageModel;
  createModel?: ModelFactory;
  contextWindow?: number;
  maxOutputTokens?: number;
};

export class ModelRegistry {
  private models = new Map<string, ModelDefinition>();

  constructor(private authStore?: AuthStore) {}

  registerModel(definition: ModelDefinition): void {
    if (this.models.has(definition.id)) {
      throw new Error(`Model ${definition.id} is already registered.`);
    }
    this.models.set(definition.id, definition);
  }

  getModelDefinition(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  listModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  async resolveModel(id: string, options: { apiKey?: string } = {}): Promise<LanguageModel> {
    const definition = this.models.get(id);
    if (!definition) {
      throw new Error(`Model ${id} is not registered.`);
    }

    if (definition.createModel) {
      const apiKey =
        options.apiKey ??
        (definition.providerId ? await this.authStore?.get(definition.providerId) : undefined);
      return definition.createModel({ apiKey });
    }

    if (definition.model) {
      return definition.model;
    }

    throw new Error(`Model ${id} does not have a factory or concrete model.`);
  }
}
