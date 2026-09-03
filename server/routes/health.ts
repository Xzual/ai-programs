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
      providers,
      timestamp: Date.now(),
    });
  });

  router.get("/api/ollama/models", async (req, res) => {
    const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
      res.status(502).json({ error: "Ollama sunucusuna ulaşılamadı", models: [] });
    } catch {
      res.json({
        error: "Ollama sunucusuna ulaşılamadı. EDITH yerel sunucuyu başlatmadı; yalnızca mevcut durumu algılıyor.",
        models: [
          { name: "llama3.2:latest", details: { family: "llama" } },
          { name: "qwen2.5:latest", details: { family: "qwen" } },
          { name: "mistral:latest", details: { family: "mistral" } },
          { name: "gemma2:latest", details: { family: "gemma" } },
        ],
        offline: true,
      });
    }
  });

  return router;
}
