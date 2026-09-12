import { Router } from "express";
import { providerRegistry } from "../providers/registry";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/api/health", async (req, res) => {
    const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
    const providers = await providerRegistry.health({
      ollamaUrl,
      model: typeof req.query.model === "string" ? req.query.model : undefined,
      timeoutMs: 2500,
    });
    const ollama = providers.find((provider) => provider.id === "ollama");
    const gemini = providers.find((provider) => provider.id === "gemini");
    const availableModels = ollama?.models.map((model) => model.id) ?? [];

    res.json({
      status: "ok",
      ollamaConnected: Boolean(ollama?.available),
      ollamaHealthy: Boolean(ollama?.healthy),
      ollamaUrl,
      availableModels,
      geminiAvailable: Boolean(gemini?.available),
      geminiConfigured: Boolean(gemini?.configured),
      geminiStatus: gemini?.status ?? "configuration_required",
      providers,
      timestamp: Date.now(),
    });
  });

  router.get("/api/ollama/models", async (req, res) => {
    const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
    const ollama = providerRegistry.get("ollama");
    const health = ollama
      ? await ollama.healthCheck({ ollamaUrl, timeoutMs: 3000 })
      : undefined;
    res.status(health?.available ? 200 : 503).json({
      success: Boolean(health?.available),
      provider: "ollama",
      status: health?.status ?? "unavailable",
      available: Boolean(health?.available),
      healthy: Boolean(health?.healthy),
      errorCode: health?.errorCode,
      error: health?.errorMessage ?? health?.error,
      models: health?.models.map((model) => ({ name: model.id, id: model.id })) ?? [],
    });
  });

  return router;
}
