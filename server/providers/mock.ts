import type { AIProviderAdapter, GenerateOptions, GenerateResult, ProviderHealth, ProviderMetadata, StreamChunk } from "./types";

const DEFAULT_MODEL = "edith-mock";

export class MockProvider implements AIProviderAdapter {
  metadata(): ProviderMetadata {
    return {
      id: "mock",
      name: "EDITH Mock",
      configured: true,
      available: true,
      healthy: true,
      modelAvailable: true,
      status: "available",
      privacyMode: "offline",
      models: [{ id: DEFAULT_MODEL, name: "EDITH Mock" }],
      defaultModel: DEFAULT_MODEL,
      capabilities: ["text", "streaming"],
      supportsStreaming: true,
      supportsVision: false,
      supportsTools: false,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ...this.metadata(),
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startedAt = Date.now();
    return {
      provider: "mock",
      model: options.model || DEFAULT_MODEL,
      text: "EDITH mock provider is available.",
      latencyMs: Date.now() - startedAt,
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = await this.generate(options);
    for (const word of result.text.split(" ")) {
      yield { text: `${word} ` };
    }
    yield { done: true };
  }
}
