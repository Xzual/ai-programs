import type { ProviderHealth, ProviderRouteRequest, ProviderRouteResult, RuntimeProviderId } from "./types";

const PROVIDERS: RuntimeProviderId[] = ["ollama", "gemini", "mock"];

function normalizeProvider(value: unknown): RuntimeProviderId | "auto" {
  return value === "gemini" || value === "ollama" || value === "mock" || value === "auto"
    ? value
    : "auto";
}

export function modelMatches(requestedModel: string, availableModel: string): boolean {
  return availableModel === requestedModel || availableModel === `${requestedModel}:latest`;
}

function providerById(health: ProviderHealth[]): Map<RuntimeProviderId, ProviderHealth> {
  return new Map(health.filter((item): item is ProviderHealth & { id: RuntimeProviderId } =>
    item.id === "ollama" || item.id === "gemini" || item.id === "mock",
  ).map((item) => [item.id, item]));
}

function bestModel(provider: ProviderHealth | undefined, requestedModel: string): {
  model: string;
  modelAvailable: boolean;
} {
  if (!provider) return { model: requestedModel, modelAvailable: false };
  if (requestedModel === "auto") {
    return {
      model: provider.defaultModel || provider.models[0]?.id || requestedModel,
      modelAvailable: provider.available && provider.models.length > 0,
    };
  }
  const matched = provider.models.find((model) => modelMatches(requestedModel, model.id));
  return {
    model: matched?.id ?? requestedModel,
    modelAvailable: Boolean(provider.available && matched),
  };
}

function candidate(providerId: RuntimeProviderId, providers: Map<RuntimeProviderId, ProviderHealth>, requestedModel: string) {
  const provider = providers.get(providerId);
  const { model, modelAvailable } = bestModel(provider, requestedModel);
  const skippedReason = !provider
    ? "provider not registered"
    : !provider.available
    ? provider.status
    : !modelAvailable
    ? "model_unavailable"
    : undefined;
  return {
    provider: providerId,
    model,
    available: Boolean(provider?.available),
    modelAvailable,
    status: provider?.status ?? "unavailable" as const,
    skippedReason,
    errorCode: provider?.errorCode,
  };
}

function autoOrder(): RuntimeProviderId[] {
  return ["ollama", "gemini", "mock"];
}

function manualOrder(provider: RuntimeProviderId, fallbackEnabled: boolean): RuntimeProviderId[] {
  if (!fallbackEnabled || provider === "mock") return [provider];
  return [provider, ...autoOrder().filter((item) => item !== provider)];
}

export function routeProvider(request: ProviderRouteRequest): ProviderRouteResult {
  const requestedProvider = normalizeProvider(request.requestedProvider);
  const requestedModel = request.requestedModel?.trim() || "auto";
  const fallbackEnabled = request.fallbackEnabled !== false;
  const mode = request.mode ?? (requestedProvider === "auto" ? "auto" : "manual");
  const providers = providerById(request.health);
  const order = mode === "auto" || requestedProvider === "auto"
    ? autoOrder()
    : manualOrder(requestedProvider, fallbackEnabled);
  const candidates = order
    .filter((provider, index, list) => PROVIDERS.includes(provider) && list.indexOf(provider) === index)
    .map((provider) => candidate(provider, providers, requestedModel));

  const selected = candidates.find((item) => !item.skippedReason) ?? (
    fallbackEnabled
      ? candidate("mock", providers, requestedModel)
      : candidates[0]
  );
  const resolvedProvider = selected.provider;
  const resolvedHealth = providers.get(resolvedProvider);
  const fallbackUsed = requestedProvider !== "auto" && resolvedProvider !== requestedProvider;
  const failedReason = selected.skippedReason;

  return {
    requestedProvider,
    requestedModel,
    resolvedProvider,
    resolvedModel: resolvedProvider === "mock" ? "edith-mock" : selected.model,
    providerStatus: resolvedHealth?.status ?? (failedReason ? "unavailable" : "available"),
    fallbackUsed,
    fallbackProvider: fallbackUsed ? resolvedProvider : undefined,
    fallbackModel: fallbackUsed ? selected.model : undefined,
    errorCode: selected.errorCode ?? (failedReason === "model_unavailable" ? "MODEL_NOT_AVAILABLE" : undefined),
    errorMessage: resolvedHealth?.errorMessage ?? resolvedHealth?.error,
    modelAvailable: selected.modelAvailable || resolvedProvider === "mock",
    configured: Boolean(resolvedHealth?.configured),
    available: Boolean(resolvedHealth?.available),
    candidates,
  };
}
