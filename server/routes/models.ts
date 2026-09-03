import { Router } from "express";
import { modelCapabilityRegistry } from "../../src/edith/modelCapabilities";
import { modelRouterService } from "../../src/edith/modelRouter";
import { providerRegistry } from "../providers/registry";
import { parseAiProvider, parseModelModality, parseModelTaskType, parsePrivacyPreference } from "../utils/modelParsing";

export function createModelsRouter(): Router {
  const router = Router();

  router.get("/api/edith/models/route", async (req, res) => {
    const providers = await providerRegistry.health({
      ollamaUrl: typeof req.query.ollamaUrl === "string" ? req.query.ollamaUrl : undefined,
      model: typeof req.query.model === "string" ? req.query.model : undefined,
      timeoutMs: 2500,
    });
    const providerStatus = (provider: string) => providers.find((item) => item.id === provider)?.available ? "available" as const : "unavailable" as const;
    const providerHealth = {
      ollama: req.query.ollamaAvailable === "true" ? "available" as const : providerStatus("ollama"),
      gemini: providerStatus("gemini"),
      openai: process.env.OPENAI_API_KEY ? "unknown" as const : "unavailable" as const,
      anthropic: process.env.ANTHROPIC_API_KEY ? "unknown" as const : "unavailable" as const,
      openrouter: process.env.OPENROUTER_API_KEY ? "unknown" as const : "unavailable" as const,
      local: "unknown" as const,
      mock: "available" as const,
    };
    const route = modelRouterService.route({
      requestedProvider: parseAiProvider(req.query.provider),
      model: typeof req.query.model === "string" ? req.query.model : undefined,
      taskType: parseModelTaskType(req.query.taskType),
      modality: parseModelModality(req.query.modality),
      privacyPreference: parsePrivacyPreference(req.query.privacy),
      providerHealth,
    });
    res.json({ success: true, route });
  });

  router.get("/api/edith/models/capabilities", async (req, res) => {
    const providers = await providerRegistry.health({
      ollamaUrl: typeof req.query.ollamaUrl === "string" ? req.query.ollamaUrl : undefined,
      timeoutMs: 2500,
    });
    const gemini = providers.find((provider) => provider.id === "gemini");
    res.json({
      success: true,
      providers: modelCapabilityRegistry.list({
        ollama: req.query.ollamaAvailable === "true" ? "available" : providers.find((provider) => provider.id === "ollama")?.available ? "available" : "unavailable",
        gemini: gemini?.available ? "available" : "unavailable",
        openai: process.env.OPENAI_API_KEY ? "unknown" : "unavailable",
        anthropic: process.env.ANTHROPIC_API_KEY ? "unknown" : "unavailable",
        openrouter: process.env.OPENROUTER_API_KEY ? "unknown" : "unavailable",
        local: "unknown",
        mock: "available",
      }),
    });
  });

  return router;
}
