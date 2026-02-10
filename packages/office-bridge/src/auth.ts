import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-opus-4-6",
  openai: "gpt-4o",
};

const ENV_API_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function createModelFromKey(
  apiKey?: string,
  provider = "anthropic",
  modelId?: string
): LanguageModel {
  const resolvedKey = apiKey || process.env[ENV_API_KEYS[provider] ?? ""] || "";
  if (!resolvedKey) {
    throw new Error(
      `No API key provided and ${ENV_API_KEYS[provider] ?? provider.toUpperCase() + "_API_KEY"} not set in environment`
    );
  }

  const model = modelId ?? DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.anthropic;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: resolvedKey });
      return anthropic(model);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: resolvedKey });
      return openai(model);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function createModelFromToken(_accessToken: string, _provider?: string): LanguageModel {
  throw new Error("OAuth not implemented yet");
}
