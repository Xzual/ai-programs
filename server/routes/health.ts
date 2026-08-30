import { Router } from "express";
import { providerRegistry } from "../providers/registry";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/api/health", async (req, res) => {
    const ollamaUrl = (req.query.ollamaUrl as string) || "http://localhost:11434";
    let ollamaConnected = false;
    let availableModels: string[] = [];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as { models?: Array<{ name: string }> };
        ollamaConnected = true;
        availableModels = (data.models || []).map((m) => m.name);
      }
    } catch {
      ollamaConnected = false;
    }

    const gemini = providerRegistry.get("gemini")?.metadata();

    res.json({
      status: "ok",
      ollamaConnected,
      ollamaUrl,
      availableModels,
      geminiAvailable: Boolean(gemini?.configured),
      providers: providerRegistry.list(),
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
