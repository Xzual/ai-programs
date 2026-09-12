import { GoogleGenAI } from "@google/genai";
import { logProviderEvent } from "./logger";
import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";
import { ProviderError } from "./types";

const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];
let runtimeGeminiApiKey: string | undefined;

export function setGeminiRuntimeApiKey(apiKey: string): void {
  const normalized = apiKey.trim();
  if (!normalized || normalized === "MY_GEMINI_API_KEY" || normalized === "MY_GOOGLE_API_KEY") {
    runtimeGeminiApiKey = undefined;
    delete process.env.GEMINI_API_KEY;
    return;
  }
  runtimeGeminiApiKey = normalized;
  process.env.GEMINI_API_KEY = normalized;
}

function normalizeApiKey(apiKey: string | undefined): string | undefined {
  const normalized = apiKey?.trim();
  return normalized && normalized !== "MY_GEMINI_API_KEY" && normalized !== "MY_GOOGLE_API_KEY"
    ? normalized
    : undefined;
}

function readGeminiConfig() {
  const apiKey = normalizeApiKey(runtimeGeminiApiKey) ?? normalizeApiKey(process.env.GEMINI_API_KEY) ?? normalizeApiKey(process.env.GOOGLE_API_KEY);
  const defaultModel = process.env.GEMINI_DEFAULT_MODEL || DEFAULT_MODEL;
  const apiBaseUrl = (process.env.GEMINI_API_BASE_URL || GEMINI_API_ENDPOINT).replace(/\/+$/, "");
  const configured = Boolean(apiKey);
  return { apiKey, defaultModel, apiBaseUrl, configured };
}

function extractGeminiText(result: unknown): string {
  const outputText = (result as { output_text?: unknown; outputText?: unknown })?.output_text ?? (result as { outputText?: unknown })?.outputText;
  if (typeof outputText === "string") return outputText;
  const text = (result as { text?: unknown })?.text;
  if (typeof text === "string") return text;
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
  let parsed: { error?: { code?: unknown; status?: unknown; message?: unknown } } | Array<{ error?: { code?: unknown; status?: unknown; message?: unknown } }> | undefined;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    parsed = undefined;
  }
  const parsedError = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  const status = Number(source.status ?? source.response?.status ?? source.error?.code ?? parsedError?.code ?? source.code);
  const message = typeof source.error?.message === "string"
    ? source.error.message
    : typeof parsedError?.message === "string"
    ? parsedError.message
    : rawMessage;
  const googleStatus = typeof source.error?.status === "string"
    ? source.error.status
    : typeof parsedError?.status === "string"
    ? parsedError.status
    : undefined;
  return {
    status: Number.isFinite(status) ? status : undefined,
    message,
    googleStatus,
  };
}

function normalizeGeminiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const { status, message, googleStatus } = parseGeminiApiError(error);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("apikey") || lower.includes("unauthorized") || lower.includes("permission denied")) {
    return new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
  }
  if (status === 429 || lower.includes("429") || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource exhausted")) {
    return new ProviderError("rate_limited", "Gemini is rate limited.", 429);
  }
  if (status === 404 || googleStatus === "NOT_FOUND" || lower.includes("404") || lower.includes("not found") || lower.includes("does not exist") || lower.includes("no longer available")) {
    return new ProviderError("model_unavailable", message || "Requested Gemini model is unavailable.", 404);
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ProviderError("timeout", "Gemini request timed out.", 504);
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econn")) {
    return new ProviderError("network_error", "Gemini network request failed.", 503);
  }

  return new ProviderError("unknown_error", "Gemini request failed.", 502);
}

function normalizeGeminiModelName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

function modelSupportsGenerate(model: unknown): boolean {
  const actions = (model as { supportedActions?: unknown })?.supportedActions;
  return !Array.isArray(actions) || actions.includes("generateContent");
}

function uniqueModels(models: string[]): ProviderMetadata["models"] {
  return Array.from(new Set(models.filter(Boolean))).map((model) => ({ id: model, name: model }));
}

function isGeminiAuthKey(apiKey: string | undefined): boolean {
  return Boolean(apiKey?.startsWith("AQ."));
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

export function getGeminiClient(): GoogleGenAI | null {
  const { apiKey, apiBaseUrl, configured } = readGeminiConfig();
  if (!configured || !apiKey) {
    return null;
  }

  try {
    return new GoogleGenAI({
      apiKey,
      httpOptions: apiBaseUrl ? { baseUrl: apiBaseUrl } : undefined,
    });
  } catch (err) {
    console.error("Gemini init error:", err instanceof Error ? err.message : String(err));
    return null;
  }
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
      modelAvailable: configured,
      status: configured ? "unknown" : "configuration_required",
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
    const baseMeta = this.metadata();
    const client = getGeminiClient();
    if (!client) {
      return {
        ...baseMeta,
        available: false,
        healthy: false,
        modelAvailable: false,
        status: "configuration_required",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        errorCode: "configuration_required",
        error: "GEMINI_API_KEY is not configured.",
      };
    }

    const configuredDefaultModel = baseMeta.defaultModel;
    const models = await this.getModels().catch(() => baseMeta.models);
    const modelIds = models.map((model) => model.id);
    const meta: ProviderMetadata = {
      ...baseMeta,
      models,
    };
    const checkedModel = typeof options.model === "string" && options.model !== "auto" ? options.model : undefined;
    const modelAvailable = !checkedModel || modelIds.includes(checkedModel);

    if (!modelAvailable) {
      return {
        ...meta,
        available: false,
        healthy: false,
        modelAvailable: false,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        checkedModel,
        latencyMs: 0,
        errorCode: "model_unavailable",
        error: `Gemini modeli bu anahtar için listelenmiyor: ${checkedModel ?? configuredDefaultModel}`,
      };
    }

    const preferredModels = checkedModel
      ? [checkedModel]
      : Array.from(new Set([
        configuredDefaultModel,
        ...modelIds,
        ...DEFAULT_MODELS,
      ])).filter((model) => modelIds.length === 0 || modelIds.includes(model));
    let lastProviderError: ProviderError | undefined;

    for (const candidateModel of preferredModels) {
      try {
        await this.generate({
          model: candidateModel,
          messages: [{ role: "user", content: "Reply with OK." }],
          temperature: 0,
          timeoutMs: Math.max(typeof options.timeoutMs === "number" ? options.timeoutMs : 8000, 8000),
        });
        return {
          ...meta,
          defaultModel: candidateModel,
          available: true,
          healthy: true,
          modelAvailable: true,
          status: "available",
          checkedAt: new Date().toISOString(),
          checkedModel: checkedModel ?? candidateModel,
          latencyMs: Date.now() - startedAt,
          errorCode: candidateModel === configuredDefaultModel ? undefined : "model_unavailable",
          error: candidateModel === configuredDefaultModel ? undefined : `${configuredDefaultModel} is not available for this API key; using ${candidateModel}.`,
        };
      } catch (error) {
        lastProviderError = normalizeGeminiError(error);
        if (checkedModel || lastProviderError.code !== "model_unavailable") break;
      }
    }

    const providerError = lastProviderError ?? new ProviderError("model_unavailable", "No Gemini model could be verified for generation.", 404);
    return {
      ...meta,
      available: false,
      healthy: false,
      modelAvailable: providerError.code !== "model_unavailable",
      status: providerError.code === "rate_limited" ? "rate_limited" : "unavailable",
      checkedAt: new Date().toISOString(),
      checkedModel: checkedModel ?? configuredDefaultModel,
      latencyMs: Date.now() - startedAt,
      errorCode: providerError.code,
      error: providerError.message,
    };
  }

  async getModels(): Promise<ProviderMetadata["models"]> {
    const { apiKey } = readGeminiConfig();
    if (isGeminiAuthKey(apiKey)) return this.metadata().models;
    const client = getGeminiClient();
    const fallback = this.metadata().models;
    if (!client) return fallback;

    try {
      const pager = await client.models.list({ config: { pageSize: 100 } });
      const models: string[] = [];
      for await (const model of pager) {
        if (!modelSupportsGenerate(model)) continue;
        const id = normalizeGeminiModelName((model as { name?: unknown; id?: unknown }).name ?? (model as { id?: unknown }).id);
        if (id?.startsWith("gemini-")) models.push(id);
      }
      return models.length ? uniqueModels(models) : fallback;
    } catch {
      return fallback;
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startedAt = Date.now();
    const meta = this.metadata();
    const model = options.model && options.model !== "auto" ? options.model : meta.defaultModel;
    const { apiKey, apiBaseUrl } = readGeminiConfig();
    if (!apiKey) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }

    try {
      const result = isGeminiAuthKey(apiKey)
        ? await this.generateWithInteractionsApi({ apiKey, apiBaseUrl, model, options })
        : await this.generateWithSdk(model, options);
      const text = extractGeminiText(result);
      logProviderEvent("info", { provider: "gemini", model, latencyMs: Date.now() - startedAt, success: true });
      return {
        provider: "gemini",
        model,
        text,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      logProviderEvent("warn", {
        provider: "gemini",
        model,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: providerError.code,
      });
      throw providerError;
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const startedAt = Date.now();
    const meta = this.metadata();
    const model = options.model && options.model !== "auto" ? options.model : meta.defaultModel;
    const { apiKey } = readGeminiConfig();
    if (!apiKey) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }

    if (isGeminiAuthKey(apiKey)) {
      const result = await this.generate(options);
      yield { text: result.text };
      logProviderEvent("info", { provider: "gemini", model, latencyMs: Date.now() - startedAt, success: true });
      yield { done: true };
      return;
    }

    const client = getGeminiClient();
    if (!client) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }

    try {
      const resultStream = await withTimeout(
        client.models.generateContentStream({
          model,
          contents: this.toGeminiPrompt(options.messages),
          config: {
            temperature: options.temperature,
          },
        }),
        options.timeoutMs ?? 30000,
      );

      for await (const chunk of resultStream) {
        if (chunk.text) {
          yield { text: chunk.text };
        }
      }
      logProviderEvent("info", { provider: "gemini", model, latencyMs: Date.now() - startedAt, success: true });
      yield { done: true };
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      logProviderEvent("warn", {
        provider: "gemini",
        model,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: providerError.code,
      });
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

  private async generateWithSdk(model: string, options: GenerateOptions): Promise<unknown> {
    const client = getGeminiClient();
    if (!client) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }
    return withTimeout(
      client.models.generateContent({
        model,
        contents: this.toGeminiPrompt(options.messages),
        config: {
          temperature: options.temperature,
        },
      }),
      options.timeoutMs ?? 30000,
    );
  }

  private async generateWithInteractionsApi(input: {
    apiKey: string;
    apiBaseUrl: string;
    model: string;
    options: GenerateOptions;
  }): Promise<unknown> {
    const response = await withTimeout(
      fetch(`${input.apiBaseUrl}/interactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
          model: input.model,
          input: this.toGeminiPrompt(input.options.messages),
          parameters: input.options.temperature === undefined ? undefined : {
            temperature: input.options.temperature,
          },
        }),
      }),
      input.options.timeoutMs ?? 30000,
    );
    const body = await response.text();
    const parsed = body.trim() ? JSON.parse(body) : {};
    if (!response.ok) {
      throw new ProviderError(
        normalizeGeminiError(new Error(JSON.stringify(parsed))).code,
        Array.isArray(parsed) ? parsed[0]?.error?.message ?? "Gemini request failed." : parsed.error?.message ?? "Gemini request failed.",
        response.status,
      );
    }
    return parsed;
  }
}

export const geminiProvider = new GeminiProvider();
