import { GoogleGenAI } from "@google/genai";
import { logProviderEvent } from "./logger";
import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";
import { ProviderError } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];
let runtimeGeminiApiKey: string | undefined;

export function setGeminiRuntimeApiKey(apiKey: string): void {
  const normalized = apiKey.trim();
  if (!normalized || normalized === "MY_GEMINI_API_KEY") {
    runtimeGeminiApiKey = undefined;
    delete process.env.GEMINI_API_KEY;
    return;
  }
  runtimeGeminiApiKey = normalized;
  process.env.GEMINI_API_KEY = normalized;
}

function readGeminiConfig() {
  const apiKey = runtimeGeminiApiKey ?? process.env.GEMINI_API_KEY;
  const defaultModel = process.env.GEMINI_DEFAULT_MODEL || DEFAULT_MODEL;
  const apiBaseUrl = process.env.GEMINI_API_BASE_URL;
  const configured = Boolean(apiKey && apiKey !== "MY_GEMINI_API_KEY");
  return { apiKey, defaultModel, apiBaseUrl, configured };
}

function extractGeminiText(result: unknown): string {
  const text = (result as { text?: unknown })?.text;
  if (typeof text === "string") return text;
  throw new ProviderError("malformed_response", "Gemini returned a malformed response.", 502);
}

function normalizeGeminiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("api key") || lower.includes("apikey") || lower.includes("unauthorized") || lower.includes("permission denied")) {
    return new ProviderError("invalid_api_key", "Gemini API key was rejected.", 401);
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate")) {
    return new ProviderError("rate_limited", "Gemini is rate limited.", 429);
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("model")) {
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
      available: configured,
      status: configured ? "unknown" : "configuration_required",
      privacyMode: "cloud",
      models: Array.from(new Set([defaultModel, ...DEFAULT_MODELS])).map((model) => ({ id: model, name: model })),
      defaultModel,
      capabilities: ["text", "streaming"],
      supportsStreaming: true,
      supportsVision: false,
      supportsTools: false,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const meta = this.metadata();
    if (!meta.configured) {
      return {
        ...meta,
        available: false,
        status: "configuration_required",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        errorCode: "configuration_required",
        error: "GEMINI_API_KEY is not configured.",
      };
    }

    try {
      await this.generate({
        model: meta.defaultModel,
        messages: [{ role: "user", content: "Reply with OK." }],
        temperature: 0,
        timeoutMs: 8000,
      });
      return {
        ...meta,
        available: true,
        status: "available",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const providerError = normalizeGeminiError(error);
      return {
        ...meta,
        available: false,
        status: providerError.code === "rate_limited" ? "rate_limited" : "unavailable",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        errorCode: providerError.code,
        error: providerError.message,
      };
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startedAt = Date.now();
    const meta = this.metadata();
    const model = options.model && options.model !== "auto" ? options.model : meta.defaultModel;
    const client = getGeminiClient();
    if (!client) {
      throw new ProviderError("configuration_required", "GEMINI_API_KEY is not configured.", 400);
    }

    try {
      const result = await withTimeout(
        client.models.generateContent({
          model,
          contents: this.toGeminiPrompt(options.messages),
          config: {
            temperature: options.temperature,
          },
        }),
        options.timeoutMs ?? 30000,
      );
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
}

export const geminiProvider = new GeminiProvider();
