import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";
import { ProviderError } from "./types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";
const FALLBACK_MODELS = ["llama3.2:latest", "qwen2.5:latest", "mistral:latest", "gemma2:latest"];

interface OllamaProviderOptions {
  ollamaUrl?: string;
}

export class OllamaProvider implements AIProviderAdapter {
  metadata(): ProviderMetadata {
    return {
      id: "ollama",
      name: "Ollama",
      configured: true,
      available: false,
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

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.unavailable(Date.now() - startedAt, "provider_unavailable", `Ollama returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((model) => ({ id: model.name, name: model.name }));
      return {
        ...this.metadata(),
        available: true,
        status: "available",
        models: models.length ? models : this.metadata().models,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
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
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: options.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        options: { temperature: options.temperature },
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new ProviderError("provider_unavailable", `Ollama returned HTTP ${response.status}`, 502);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });
      const lines = chunkText.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield { text: parsed.message.content };
          }
          if (parsed.done) {
            yield { done: true };
          }
        } catch {
          // Ollama streams newline-delimited JSON; tolerate split or malformed lines.
        }
      }
    }
  }

  private unavailable(latencyMs: number, errorCode: ProviderHealth["errorCode"], error: string): ProviderHealth {
    return {
      ...this.metadata(),
      available: false,
      status: "offline",
      checkedAt: new Date().toISOString(),
      latencyMs,
      errorCode,
      error,
    };
  }
}
