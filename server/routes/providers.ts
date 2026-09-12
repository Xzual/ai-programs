import { Router } from "express";
import type { Request } from "express";
import { providerRegistry } from "../providers/registry";
import type { ProviderHealth, ProviderMetadata, RuntimeProviderId } from "../providers/types";

function toProviderPayload(provider: ProviderMetadata) {
  const modelExamples = provider.models.map((model) => model.id);
  return {
    ...provider,
    provider: provider.id,
    displayName: provider.name,
    privacy: provider.privacyMode,
    modelExamples,
    tasks: ["conversation"],
    requiredEnv: provider.id === "gemini" ? ["GEMINI_API_KEY"] : [],
    notes: provider.id === "gemini"
      ? "Cloud provider. Set GEMINI_API_KEY on the backend environment. Key values are never returned to frontend."
      : provider.id === "ollama"
      ? "Local HTTP runtime. Availability is detected by health check; EDITH does not start Ollama."
      : "Offline degraded fallback for development, demo, and last-resort chat.",
  };
}

function toLegacyHealth(providers: ProviderHealth[]) {
  const ollama = providers.find((provider) => provider.id === "ollama");
  const gemini = providers.find((provider) => provider.id === "gemini");
  return {
    ollamaConnected: Boolean(ollama?.available),
    ollamaHealthy: Boolean(ollama?.healthy),
    geminiAvailable: Boolean(gemini?.available),
    geminiConfigured: Boolean(gemini?.configured),
    geminiStatus: gemini?.status ?? "configuration_required",
    availableModels: ollama?.models.map((model) => model.id) ?? [],
  };
}

function providerSnapshotOptions(req: Request) {
  return {
    ollamaUrl: typeof req.query.ollamaUrl === "string" ? req.query.ollamaUrl : undefined,
    model: typeof req.query.model === "string" ? req.query.model : undefined,
    timeoutMs: 2500,
  };
}

export function createProvidersRouter(): Router {
  const router = Router();

  router.get("/api/providers", async (req, res) => {
    const providers = await providerRegistry.snapshot(providerSnapshotOptions(req));
    res.json({
      success: true,
      providers: providers.map(toProviderPayload),
      ...toLegacyHealth(providers),
      timestamp: Date.now(),
      checkedAt: Date.now(),
    });
  });

  router.get("/api/providers/health", async (req, res) => {
    const health = await providerRegistry.health(providerSnapshotOptions(req));
    res.json({
      success: true,
      providers: health.map(toProviderPayload),
      ...toLegacyHealth(health),
      timestamp: Date.now(),
      checkedAt: Date.now(),
    });
  });

  router.get("/api/models", async (req, res) => {
    const providers = await providerRegistry.modelSnapshot(providerSnapshotOptions(req));
    res.json({
      success: true,
      providers,
      ...toLegacyHealth(providers),
      models: providers.flatMap((provider) =>
        provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          provider: provider.id as RuntimeProviderId,
          default: model.id === provider.defaultModel,
          available: provider.available && (provider.id !== "ollama" || provider.models.some((candidate) => candidate.id === model.id)),
          providerStatus: provider.status,
        })),
      ),
    });
  });

  return router;
}
