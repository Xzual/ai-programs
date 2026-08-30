import { Router } from "express";
import type { AiProvider } from "../../src/types";
import { providerRegistry } from "../providers/registry";
import type { ProviderHealth } from "../providers/types";

function toLegacyHealth(providers: ProviderHealth[]) {
  const ollama = providers.find((provider) => provider.id === "ollama");
  const gemini = providers.find((provider) => provider.id === "gemini");
  return {
    ollamaConnected: Boolean(ollama?.available),
    geminiAvailable: Boolean(gemini?.configured),
    availableModels: ollama?.models.map((model) => model.id) ?? [],
  };
}

export function createProvidersRouter(): Router {
  const router = Router();

  router.get("/api/providers", (_req, res) => {
    res.json({
      success: true,
      providers: providerRegistry.list(),
    });
  });

  router.get("/api/providers/health", async (req, res) => {
    const health = await providerRegistry.health({
      ollamaUrl: typeof req.query.ollamaUrl === "string" ? req.query.ollamaUrl : undefined,
    });
    res.json({
      success: true,
      providers: health,
      ...toLegacyHealth(health),
      checkedAt: Date.now(),
    });
  });

  router.get("/api/models", (_req, res) => {
    const providers = providerRegistry.models();
    res.json({
      success: true,
      providers,
      models: providers.flatMap((provider) =>
        provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          provider: provider.id as AiProvider,
          default: model.id === provider.defaultModel,
        })),
      ),
    });
  });

  return router;
}
