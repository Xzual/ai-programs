import { Router } from "express";
import type { Request } from "express";
import fs from "node:fs";
import path from "node:path";
import type { AiProvider } from "../../src/types";
import { setGeminiRuntimeApiKey } from "../providers/gemini";
import { providerRegistry } from "../providers/registry";
import type { ProviderHealth, ProviderMetadata } from "../providers/types";

const DEV_KEY_ENV_BY_PROVIDER: Partial<Record<AiProvider, string>> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function setRuntimeProviderApiKey(provider: AiProvider, apiKey: string): string | undefined {
  const envName = DEV_KEY_ENV_BY_PROVIDER[provider];
  if (!envName) return undefined;
  if (provider === "gemini") {
    setGeminiRuntimeApiKey(apiKey);
    return envName;
  }
  process.env[envName] = apiKey.trim();
  return envName;
}

function persistLocalEnvValue(name: string, value: string): void {
  const envPath = path.resolve(process.cwd(), ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const content = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing.trimEnd()}${existing.trimEnd() ? "\n" : ""}${line}\n`;
  fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
}

function toProviderPayload(provider: ProviderMetadata) {
  const modelExamples = provider.models.map((model) => model.id);
  return {
    ...provider,
    provider: provider.id,
    displayName: provider.name,
    privacy: provider.privacyMode,
    modelExamples,
    tasks: ["conversation"],
    requiredEnv: provider.id === "gemini" ? ["GEMINI_API_KEY", "GOOGLE_API_KEY"] : [],
    notes: provider.id === "gemini"
      ? "Cloud provider. Set GEMINI_API_KEY on the backend environment, or GOOGLE_API_KEY for Google SDK compatibility; key values are never returned to frontend."
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

  router.post("/api/providers/dev-key", async (req, res) => {
    const provider = String(req.body?.provider ?? "").trim() as AiProvider;
    const apiKey = String(req.body?.apiKey ?? "").trim();

    if (!provider || !apiKey) {
      return res.status(400).json({
        success: false,
        error: "provider and apiKey are required.",
      });
    }

    const envName = setRuntimeProviderApiKey(provider, apiKey);
    if (!envName) {
      return res.status(400).json({
        success: false,
        error: "This provider does not accept a runtime dev API key.",
        provider,
      });
    }

    try {
      persistLocalEnvValue(envName, apiKey);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `API anahtarı yerel .env dosyasına yazılamadı: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const adapter = providerRegistry.get(provider);
    const health = adapter ? await adapter.healthCheck({ timeoutMs: 8000 }) : undefined;

    res.json({
      success: true,
      provider,
      configured: health ? Boolean(health.configured) : true,
      available: health ? Boolean(health.available) : false,
      status: health?.status ?? "unknown",
      errorCode: health?.errorCode,
      error: health?.error,
      requiredEnv: [envName],
      message: health?.available
        ? `${envName} doğrulandı. Anahtar değeri geri döndürülmedi.`
        : `${envName} alındı ancak Gemini doğrulaması başarısız oldu. Anahtar değeri geri döndürülmedi.`,
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
          provider: provider.id as AiProvider,
          default: model.id === provider.defaultModel,
        })),
      ),
    });
  });

  return router;
}
