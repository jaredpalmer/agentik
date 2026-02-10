import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
};

export function createModelFromKey(
  apiKey: string,
  provider = "anthropic",
  modelId?: string
): LanguageModel {
  const model = modelId ?? DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.anthropic;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function createModelFromToken(_accessToken: string, _provider?: string): LanguageModel {
  throw new Error("OAuth not implemented yet");
}
