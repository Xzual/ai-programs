import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";
import { ProviderError } from "./types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";
const FALLBACK_MODELS = ["llama3.2:latest", "qwen2.5:latest", "mistral:latest", "gemma2:latest"];
const DEFAULT_HEALTH_TIMEOUT_MS = 2500;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 12000;
const DEFAULT_GENERATION_TIMEOUT_MS = 60000;

interface OllamaProviderOptions {
  ollamaUrl?: string;
  model?: string;
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  generationTimeoutMs?: number;
}

interface ParsedOllamaChunk {
  text?: string;
  done: boolean;
  hasThinking: boolean;
}

function readTimeout(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function modelMatches(requestedModel: string, availableModel: string): boolean {
  return availableModel === requestedModel || availableModel === `${requestedModel}:latest`;
}

function resolveAvailableModel(requestedModel: string | undefined, models: ProviderMetadata["models"]): string {
  if (!models.length) return requestedModel && requestedModel !== "auto" ? requestedModel : DEFAULT_MODEL;
  if (requestedModel && requestedModel !== "auto") {
    const matchingModel = models.find((model) => modelMatches(requestedModel, model.id));
    if (matchingModel) return matchingModel.id;
  }
  return models.find((model) => modelMatches(DEFAULT_MODEL, model.id))?.id ?? models[0].id;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseOllamaStreamChunk(raw: unknown): ParsedOllamaChunk {
  const chunk = raw as {
    done?: unknown;
    response?: unknown;
    thinking?: unknown;
    reasoning?: unknown;
    message?: {
      content?: unknown;
      thinking?: unknown;
      reasoning?: unknown;
    };
  };

  const messageContent = chunk.message?.content;
  const responseContent = chunk.response;
  const text = hasNonEmptyString(messageContent)
    ? messageContent
    : hasNonEmptyString(responseContent)
    ? responseContent
    : undefined;

  return {
    text,
    done: chunk.done === true,
    hasThinking: hasNonEmptyString(chunk.message?.thinking) ||
      hasNonEmptyString(chunk.message?.reasoning) ||
      hasNonEmptyString(chunk.thinking) ||
      hasNonEmptyString(chunk.reasoning),
  };
}

async function readWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new ProviderError("timeout", message, 504));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class OllamaProvider implements AIProviderAdapter {
  metadata(): ProviderMetadata {
    return {
      id: "ollama",
      name: "Ollama",
      configured: true,
      available: false,
      healthy: false,
      modelAvailable: false,
      status: "unknown",
      privacyMode: "local",
      models: FALLBACK_MODELS.map((model) => ({ id: model, name: model })),
      defaultModel: DEFAULT_MODEL,
      capabilities: ["text", "streaming"],
      supportsStreaming: true,
      supportsVision: false,
      supportsTools: false,
    };
  }

  async healthCheck(options: OllamaProviderOptions = {}): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA_URL;
    const requestedModel = options.model && options.model !== "auto" ? options.model : undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? readTimeout("OLLAMA_HEALTH_TIMEOUT_MS", DEFAULT_HEALTH_TIMEOUT_MS));
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.unavailable(Date.now() - startedAt, "provider_unavailable", `Ollama returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((model) => ({ id: model.name, name: model.name }));
      const resolvedModel = resolveAvailableModel(requestedModel, models);
      const modelAvailable = requestedModel
        ? models.some((model) => modelMatches(requestedModel, model.id))
        : models.length > 0;
      return {
        ...this.metadata(),
        available: true,
        healthy: true,
        modelAvailable,
        status: models.length ? "available" : "degraded",
        models: models.length ? models : this.metadata().models,
        defaultModel: resolvedModel,
        checkedAt: new Date().toISOString(),
        checkedModel: requestedModel,
        latencyMs: Date.now() - startedAt,
        errorCode: modelAvailable ? undefined : "model_unavailable",
        error: modelAvailable ? undefined : requestedModel
          ? `Ollama model is not installed: ${requestedModel}`
          : "Ollama is reachable but no local models are installed.",
      };
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      return this.unavailable(Date.now() - startedAt, code, "Ollama local API is unreachable.");
    }
  }

  async getModels(options: OllamaProviderOptions = {}) {
    return (await this.healthCheck(options)).models;
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    throw new ProviderError("provider_unavailable", "Ollama generate() is not used directly; use stream() for chat.", 503);
  }

  async *stream(options: GenerateOptions & OllamaProviderOptions): AsyncIterable<StreamChunk> {
    const ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA_URL;
    const model = options.model || DEFAULT_MODEL;
    const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? readTimeout("OLLAMA_FIRST_TOKEN_TIMEOUT_MS", DEFAULT_FIRST_TOKEN_TIMEOUT_MS);
    const generationTimeoutMs = options.generationTimeoutMs ?? options.timeoutMs ?? readTimeout("OLLAMA_GENERATION_TIMEOUT_MS", DEFAULT_GENERATION_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), generationTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: options.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          options: { temperature: options.temperature },
          think: process.env.OLLAMA_THINKING_ENABLED === "true",
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      throw new ProviderError(code, "Ollama local API is unreachable.", code === "timeout" ? 504 : 503);
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeoutId);
      const body = await response.text().catch(() => "");
      const lower = body.toLowerCase();
      const code = response.status === 404 || lower.includes("not found") || lower.includes("model")
        ? "model_unavailable"
        : "provider_unavailable";
      throw new ProviderError(code, body || `Ollama returned HTTP ${response.status}`, code === "model_unavailable" ? 404 : 502);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let sawReadableText = false;
    let sawThinking = false;
    let sawAnyChunk = false;
    let firstRead = true;

    yield { status: "warming_up" };

    try {
      readLoop:
      while (true) {
        const readPromise = reader.read();
        const result = firstRead
          ? await readWithTimeout(
            readPromise,
            firstTokenTimeoutMs,
            () => controller.abort(),
            `Ollama model did not produce a first token within ${firstTokenTimeoutMs}ms.`,
          )
          : await readPromise;
        firstRead = false;

        const { done, value } = result;
        if (done) break;
        sawAnyChunk = true;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const parsedLine = this.parseLine(line);
          if (!parsedLine) continue;
          if (parsedLine.hasThinking) sawThinking = true;
          if (parsedLine.text) {
            sawReadableText = true;
            yield { text: parsedLine.text, status: "streaming" };
          }
          if (parsedLine.done) {
            if (sawReadableText) {
              yield { done: true, status: "completed" };
              return;
            }
            break readLoop;
          }
        }
      }

      const remaining = buffer.trim();
      if (remaining) {
        const parsedLine = this.parseLine(remaining);
        if (parsedLine?.hasThinking) sawThinking = true;
        if (parsedLine?.text) {
          sawReadableText = true;
          yield { text: parsedLine.text, status: "streaming" };
        }
        if (parsedLine?.done) {
          if (sawReadableText) {
            yield { done: true, status: "completed" };
            return;
          }
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      throw new ProviderError(code, code === "timeout" ? "Ollama generation timed out." : "Ollama stream failed.", code === "timeout" ? 504 : 503);
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
    }

    if (!sawReadableText && sawThinking) {
      throw new ProviderError(
        "empty_final_response_with_thinking",
        "Ollama returned reasoning/thinking content without final assistant text.",
        502,
      );
    }
    if (!sawReadableText && sawAnyChunk) {
      throw new ProviderError("empty_response", "Ollama completed without final assistant text.", 502);
    }
  }

  private parseLine(line: string): ParsedOllamaChunk | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;
    try {
      return parseOllamaStreamChunk(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }

  private unavailable(latencyMs: number, errorCode: ProviderHealth["errorCode"], error: string): ProviderHealth {
    return {
      ...this.metadata(),
      available: false,
      healthy: false,
      modelAvailable: false,
      status: "offline",
      checkedAt: new Date().toISOString(),
      latencyMs,
      errorCode,
      error,
    };
  }
}
