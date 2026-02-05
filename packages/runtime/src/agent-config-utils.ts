import type { LanguageModel, PrepareStepFunction, ToolSet } from "ai";
import type { AgentConfig, ThinkingBudgets, ThinkingLevel } from "./types";

type PrepareStepConfig<CALL_OPTIONS = never> = Pick<
  AgentConfig<CALL_OPTIONS>,
  | "prepareStep"
  | "resolveModel"
  | "thinkingAdapter"
  | "thinkingLevel"
  | "thinkingBudgets"
  | "sessionId"
>;

type PrepareCallConfig<CALL_OPTIONS = never> = Pick<
  AgentConfig<CALL_OPTIONS>,
  | "prepareCall"
  | "resolveModel"
  | "thinkingAdapter"
  | "thinkingLevel"
  | "thinkingBudgets"
  | "sessionId"
  | "getApiKey"
  | "apiKeyHeaders"
>;

type PrepareOptions = {
  preserveProviderOptions?: boolean;
};

export function createPrepareStep<CALL_OPTIONS = never>(
  config: PrepareStepConfig<CALL_OPTIONS>,
  options: PrepareOptions = {}
): PrepareStepFunction<ToolSet> | undefined {
  if (!config.prepareStep && !config.resolveModel && !config.thinkingAdapter) {
    return undefined;
  }

  return async (stepOptions) => {
    const base = (await config.prepareStep?.(stepOptions)) ?? {};
    const model = base.model ?? stepOptions.model;
    const resolvedModel = config.resolveModel
      ? await config.resolveModel({
          model,
          sessionId: config.sessionId,
        })
      : model;

    let providerOptions = base.providerOptions;
    if (config.thinkingAdapter) {
      const adapted = config.thinkingAdapter({
        providerOptions,
        thinkingLevel: config.thinkingLevel,
        thinkingBudgets: config.thinkingBudgets,
        sessionId: config.sessionId,
      });
      providerOptions = options.preserveProviderOptions ? (adapted ?? providerOptions) : adapted;
    }

    return {
      ...base,
      model: resolvedModel,
      ...(providerOptions ? { providerOptions } : {}),
    };
  };
}

export function createPrepareCall<CALL_OPTIONS = never>(
  config: PrepareCallConfig<CALL_OPTIONS>,
  options: PrepareOptions = {}
): AgentConfig<CALL_OPTIONS>["prepareCall"] | undefined {
  if (!config.prepareCall && !config.resolveModel && !config.thinkingAdapter && !config.getApiKey) {
    return undefined;
  }

  return async (settings) => {
    const base = (await config.prepareCall?.(settings)) ?? settings;
    let model = base.model;
    if (config.resolveModel) {
      model = await config.resolveModel({
        model,
        sessionId: config.sessionId,
        callOptions: (settings as { options?: CALL_OPTIONS }).options,
      });
    }

    let providerOptions = base.providerOptions;
    if (config.thinkingAdapter) {
      const adapted = config.thinkingAdapter({
        providerOptions,
        thinkingLevel: config.thinkingLevel,
        thinkingBudgets: config.thinkingBudgets,
        sessionId: config.sessionId,
      });
      providerOptions = options.preserveProviderOptions ? (adapted ?? providerOptions) : adapted;
    }

    const apiKeyHeaders = await resolveApiKeyHeaders(config, model);
    const headers = mergeHeaders(base.headers, apiKeyHeaders);

    return {
      ...base,
      model,
      ...(providerOptions ? { providerOptions } : {}),
      ...(headers ? { headers } : {}),
    };
  };
}

type ApiKeyConfig<CALL_OPTIONS = never> = Pick<
  AgentConfig<CALL_OPTIONS>,
  "getApiKey" | "apiKeyHeaders"
>;

async function resolveApiKeyHeaders<CALL_OPTIONS = never>(
  config: ApiKeyConfig<CALL_OPTIONS>,
  model: LanguageModel
): Promise<Record<string, string> | undefined> {
  if (!config.getApiKey) {
    return undefined;
  }

  const { providerId, modelId } = getModelIdentity(model);
  if (!providerId) {
    return undefined;
  }

  const apiKey = await config.getApiKey(providerId, modelId);
  if (!apiKey) {
    return undefined;
  }
  if (config.apiKeyHeaders) {
    return config.apiKeyHeaders({ providerId, modelId, apiKey }) ?? undefined;
  }

  const normalized = providerId.toLowerCase();
  if (normalized.includes("anthropic")) {
    return { "x-api-key": apiKey };
  }
  if (normalized.includes("openai") || normalized.includes("openrouter")) {
    return { Authorization: `Bearer ${apiKey}` };
  }
  if (normalized.includes("azure")) {
    return { "api-key": apiKey };
  }

  return { Authorization: `Bearer ${apiKey}` };
}

function mergeHeaders(
  base: Record<string, string | undefined> | undefined,
  extra: Record<string, string> | undefined
): Record<string, string | undefined> | undefined {
  if (!extra) {
    return base;
  }
  return { ...(base ?? {}), ...extra };
}

function getModelIdentity(model: LanguageModel): { providerId?: string; modelId?: string } {
  if (typeof model === "string") {
    if (model.includes("/")) {
      const [providerId, modelId] = model.split("/", 2);
      return { providerId, modelId };
    }
    if (model.includes(":")) {
      const [providerId, modelId] = model.split(":", 2);
      return { providerId, modelId };
    }
    return { modelId: model };
  }

  if (model && typeof model === "object" && "provider" in model && "modelId" in model) {
    const typed = model as { provider?: string; modelId?: string };
    return { providerId: typed.provider, modelId: typed.modelId };
  }

  return {};
}
