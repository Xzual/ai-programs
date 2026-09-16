import { GoogleGenAI } from "@google/genai";
import { logProviderEvent } from "./logger";
import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";
import { ProviderError } from "./types";

const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_MODELS = ["gemini-3.6-flash", "gemini-2.5-pro"];
const UNSUPPORTED_GEMINI_MODELS = new Set(["gemini-2.5-flash"]);
const INVALID_KEY_LOG_THROTTLE_MS = 60_000;
const INVALID_HEALTH_CACHE_MS = 60_000;

let lastInvalidKeyLogAt = 0;
let cachedInvalidHealth: { keyMarker: string; health: ProviderHealth; expiresAt: number } | undefined;
let cachedHealth: { keyMarker: string; model: string; health: ProviderHealth; expiresAt: number } | undefined;

function envNumber(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function placeholderKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (value.trim().startsWith("AIza")) return false;
  return !normalized ||
    normalized === "my_gemini_api_key" ||
    normalized === "your_gemini_api_key" ||
    normalized === "your_api_key" ||
    normalized.includes("placeholder") ||
    normalized.includes("dummy") ||
    normalized.includes("fake") ||
    normalized.includes("example");
}

function readGeminiConfig() {
  const rawApiKey = process.env.GEMINI_API_KEY?.trim();
  const apiKey = rawApiKey && !placeholderKey(rawApiKey) ? rawApiKey : undefined;
  const syntheticInvalid = Boolean(apiKey?.startsWith("AIza") && /fake|test|invalid/i.test(apiKey));
  return {
    apiKey,
    configured: Boolean(apiKey),
    syntheticInvalid,
    defaultModel: process.env.GEMINI_DEFAULT_MODEL || DEFAULT_MODEL,
    timeoutMs: envNumber("GEMINI_TIMEOUT_MS", 30_000),
    apiBaseUrl: process.env.GEMINI_API_BASE_URL?.trim().replace(/\/+$/, ""),
    keyMarker: apiKey ? `${apiKey.length}:${apiKey.slice(0, 4)}` : "missing",
  };
}

function uniqueModels(models: string[]): ProviderMetadata["models"] {
  return Array.from(new Set(models.filter((model) => model && !UNSUPPORTED_GEMINI_MODELS.has(model))))
    .map((model) => ({ id: model, name: model }));
}

function normalizeGeminiModelName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

function modelSupportsGenerate(model: unknown): boolean {
  const actions = (model as { supportedActions?: unknown })?.supportedActions;
  return !Array.isArray(actions) || actions.includes("generateContent");
}

function extractGeminiText(result: unknown): string {
  const direct = (result as { text?: unknown; output_text?: unknown; outputText?: unknown })?.text ??
    (result as { output_text?: unknown })?.output_text ??
    (result as { outputText?: unknown })?.outputText;
  if (typeof direct === "string") return direct;

  const candidates = (result as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates;
  const candidateText = candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
  if (candidateText) return candidateText;

  throw new ProviderError("malformed_response", "Gemini returned a malformed response.", 502);
}

function parseGeminiApiError(error: unknown): { status?: number; message: string; googleStatus?: string } {
  const source = error as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
    error?: { code?: unknown; status?: unknown; message?: unknown };
  };
  const rawMessage = typeof source.message === "string" ? source.message : String(error);
  let parsed: { error?: { code?: unknown; status?: unknown; message?: unknown } } | undefined;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    parsed = undefined;
  }
  const status = Number(source.status ?? source.response?.status ?? source.error?.code ?? parsed?.error?.code ?? source.code);
  const message = typeof source.error?.message === "string"
    ? source.error.message
    : typeof parsed?.error?.message === "string"
    ? parsed.error.message
    : rawMessage;
  const googleStatus = typeof source.error?.status === "string"
    ? source.error.status
    : typeof parsed?.error?.status === "string"
    ? parsed.error.status
    : undefined;
  return { status: Number.isFinite(status) ? status : undefined, message, googleStatus };
}

function normalizeGeminiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const { status, message, googleStatus } = parseGeminiApiError(error);
  const lower = message.toLowerCase();
  if (status === 400 && lower.includes("api key not valid")) {
    return new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
  }
  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("apikey") || lower.includes("unauthorized") || lower.includes("permission denied")) {
    return new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
  }
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource exhausted")) {
    return new ProviderError("rate_limited", "Gemini is rate limited.", 429);
  }
  if (status === 404 || googleStatus === "NOT_FOUND" || lower.includes("not found") || lower.includes("does not exist")) {
    return new ProviderError("model_unavailable", "Requested Gemini model is unavailable.", 404);
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ProviderError("timeout", "Gemini request timed out.", 504);
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econn")) {
    return new ProviderError("network_error", "Gemini network request failed.", 503);
  }
  return new ProviderError("unknown_error", "Gemini request failed.", 502);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new ProviderError("timeout", "Gemini request timed out.", 504)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function client(): GoogleGenAI | undefined {
  const { apiKey, apiBaseUrl } = readGeminiConfig();
  if (!apiKey) return undefined;
  return new GoogleGenAI({
    apiKey,
    httpOptions: apiBaseUrl ? { baseUrl: apiBaseUrl } : undefined,
  });
}

function throttledInvalidKeyLog(model?: string): void {
  const now = Date.now();
  if (now - lastInvalidKeyLogAt < INVALID_KEY_LOG_THROTTLE_MS) return;
  lastInvalidKeyLogAt = now;
  logProviderEvent("warn", {
    provider: "gemini",
    model,
    success: false,
    errorCode: "invalid_api_key",
  });
}

export class GeminiProvider implements AIProviderAdapter {
  metadata(): ProviderMetadata {
    const { configured, defaultModel } = readGeminiConfig();
    return {
      id: "gemini",
      name: "Google Gemini",
      configured,
      available: false,
      healthy: false,
      modelAvailable: false,
      status: configured ? "unavailable" : "configuration_required",
      privacyMode: "cloud",
      models: uniqueModels([defaultModel, ...DEFAULT_MODELS]),
      defaultModel,
      capabilities: ["text", "streaming"],
      supportsStreaming: true,
      supportsVision: false,
      supportsTools: false,
    };
  }

  async healthCheck(options: Record<string, unknown> = {}): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const base = this.metadata();
    const config = readGeminiConfig();
    const timeoutMs = Math.max(
      typeof options.timeoutMs === "number" ? options.timeoutMs : config.timeoutMs,
      envNumber("GEMINI_HEALTH_TIMEOUT_MS", 15_000),
    );
    const checkedModel = typeof options.model === "string" && options.model !== "auto" ? options.model : config.defaultModel;

    if (!config.configured) {
      return {
        ...base,
        status: "configuration_required",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        errorCode: "configuration_required",
        error: "GEMINI_API_KEY is not configured.",
        errorMessage: "GEMINI_API_KEY is not configured.",
      };
    }

    if (config.syntheticInvalid) {
      const providerError = new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
      throttledInvalidKeyLog(checkedModel);
      return {
        ...base,
        configured: true,
        available: false,
        healthy: false,
        modelAvailable: false,
        status: "invalid_api_key",
        checkedAt: new Date().toISOString(),
        checkedModel,
        latencyMs: Date.now() - startedAt,
        errorCode: providerError.code,
        error: providerError.message,
        errorMessage: providerError.message,
      };
    }

    if (cachedInvalidHealth?.keyMarker === config.keyMarker && cachedInvalidHealth.expiresAt > Date.now()) {
      return {
        ...cachedInvalidHealth.health,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
      };
    }
    if (cachedHealth?.keyMarker === config.keyMarker && cachedHealth.model === checkedModel && cachedHealth.expiresAt > Date.now()) {
      return {
        ...cachedHealth.health,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
      };
    }

    try {
      const models = await this.getModels({ timeoutMs });
      const modelIds = models.map((model) => model.id);
      const model = modelIds.includes(checkedModel) ? checkedModel : modelIds[0] ?? config.defaultModel;
      const result = await this.generate({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        temperature: 0,
        timeoutMs,
      });
      if (!result.text.trim()) throw new ProviderError("empty_response", "Gemini returned an empty health response.", 502);
      const health: ProviderHealth = {
        ...base,
        models,
        defaultModel: model,
        available: true,
        healthy: true,
        modelAvailable: true,
        status: "available",
        checkedAt: new Date().toISOString(),
        checkedModel: model,
        latencyMs: Date.now() - startedAt,
      };
      cachedHealth = {
        keyMarker: config.keyMarker,
        model,
        health,
        expiresAt: Date.now() + envNumber("GEMINI_HEALTH_CACHE_MS", 60_000),
      };
      return health;
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      if (providerError.code === "invalid_api_key") throttledInvalidKeyLog(checkedModel);
      const status = providerError.code === "invalid_api_key"
        ? "invalid_api_key"
        : providerError.code === "timeout"
        ? "timeout"
        : providerError.code === "rate_limited"
        ? "rate_limited"
        : "unavailable";
      const health: ProviderHealth = {
        ...base,
        configured: true,
        available: false,
        healthy: false,
        modelAvailable: false,
        status,
        checkedAt: new Date().toISOString(),
        checkedModel,
        latencyMs: Date.now() - startedAt,
        errorCode: providerError.code,
        error: providerError.message,
        errorMessage: providerError.message,
      };
      if (providerError.code === "invalid_api_key") {
        cachedInvalidHealth = {
          keyMarker: config.keyMarker,
          health,
          expiresAt: Date.now() + INVALID_HEALTH_CACHE_MS,
        };
      }
      return health;
    }
  }

  async getModels(options: Record<string, unknown> = {}): Promise<ProviderMetadata["models"]> {
    const config = readGeminiConfig();
    const gemini = client();
    if (!config.configured || !gemini) return this.metadata().models;
    const pager = await withTimeout(
      gemini.models.list({ config: { pageSize: 100 } }),
      typeof options.timeoutMs === "number" ? options.timeoutMs : config.timeoutMs,
    );
    const models: string[] = [];
    for await (const model of pager) {
      if (!modelSupportsGenerate(model)) continue;
      const id = normalizeGeminiModelName((model as { name?: unknown; id?: unknown }).name ?? (model as { id?: unknown }).id);
      if (id?.startsWith("gemini-") && !UNSUPPORTED_GEMINI_MODELS.has(id)) models.push(id);
    }
    return models.length ? uniqueModels(models) : this.metadata().models;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startedAt = Date.now();
    const config = readGeminiConfig();
    const gemini = client();
    const model = options.model && options.model !== "auto" ? options.model : config.defaultModel;
    if (!config.configured || !gemini) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }
    if (config.syntheticInvalid) {
      throw new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
    }

    try {
      const result = await withTimeout(
        gemini.models.generateContent({
          model,
          contents: this.toGeminiPrompt(options.messages),
          config: { temperature: options.temperature },
        }),
        options.timeoutMs ?? config.timeoutMs,
      );
      const text = extractGeminiText(result);
      logProviderEvent("info", { provider: "gemini", model, latencyMs: Date.now() - startedAt, success: true });
      return { provider: "gemini", model, text, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      if (providerError.code === "invalid_api_key") throttledInvalidKeyLog(model);
      else logProviderEvent("warn", { provider: "gemini", model, latencyMs: Date.now() - startedAt, success: false, errorCode: providerError.code });
      throw providerError;
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config = readGeminiConfig();
    const gemini = client();
    const model = options.model && options.model !== "auto" ? options.model : config.defaultModel;
    if (!config.configured || !gemini) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }
    if (config.syntheticInvalid) {
      throw new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
    }

    try {
      const resultStream = await withTimeout(
        gemini.models.generateContentStream({
          model,
          contents: this.toGeminiPrompt(options.messages),
          config: { temperature: options.temperature },
        }),
        options.timeoutMs ?? config.timeoutMs,
      );
      let sawText = false;
      for await (const chunk of resultStream) {
        if (chunk.text) {
          sawText = true;
          yield { text: chunk.text, status: "streaming" };
        }
      }
      if (!sawText) throw new ProviderError("empty_response", "Gemini completed without assistant text.", 502);
      yield { done: true, status: "completed" };
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      if (providerError.code === "invalid_api_key") throttledInvalidKeyLog(model);
      else logProviderEvent("warn", { provider: "gemini", model, success: false, errorCode: providerError.code });
      throw providerError;
    }
  }

  private toGeminiPrompt(messages: GenerateOptions["messages"]): string {
    return messages.map((message) => {
      if (message.role === "system") return `System:\n${message.content}`;
      if (message.role === "assistant") return `Assistant:\n${message.content}`;
      return `User:\n${message.content}`;
    }).join("\n\n");
  }
}

export const geminiProvider = new GeminiProvider();
