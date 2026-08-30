import type { AiProvider } from "../../src/types";
import { geminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { OllamaProvider } from "./ollama";
import type { AIProviderAdapter, GenerateOptions, ProviderHealth, ProviderMetadata } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<AiProvider, AIProviderAdapter>();

  constructor() {
    this.register(new OllamaProvider());
    this.register(geminiProvider);
    this.register(new MockProvider());
  }

  register(provider: AIProviderAdapter): void {
    this.providers.set(provider.metadata().id, provider);
  }

  get(provider: AiProvider): AIProviderAdapter | undefined {
    return this.providers.get(provider);
  }

  list(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((provider) => provider.metadata());
  }

  async health(options: Record<string, unknown> = {}): Promise<ProviderHealth[]> {
    return Promise.all(Array.from(this.providers.values()).map((provider) => provider.healthCheck(options)));
  }

  models(): Array<ProviderMetadata & { provider: AiProvider }> {
    return this.list().map((provider) => ({ ...provider, provider: provider.id }));
  }

  resolve(requestedProvider: AiProvider | "auto" | string | undefined, requestedModel?: string): {
    provider: AIProviderAdapter;
    requestedProvider: AiProvider | "auto";
    requestedModel?: string;
    resolvedProvider: AiProvider;
    resolvedModel: string;
    fallbackUsed: boolean;
  } {
    const normalizedProvider = this.normalizeProvider(requestedProvider);
    const provider = normalizedProvider === "auto"
      ? this.get("ollama") ?? this.get("mock")
      : this.get(normalizedProvider) ?? this.get("mock");
    if (!provider) throw new Error("No AI providers are registered.");

    const metadata = provider.metadata();
    return {
      provider,
      requestedProvider: normalizedProvider,
      requestedModel,
      resolvedProvider: metadata.id,
      resolvedModel: requestedModel && requestedModel !== "auto" ? requestedModel : metadata.defaultModel,
      fallbackUsed: normalizedProvider !== "auto" && metadata.id !== normalizedProvider,
    };
  }

  async generate(provider: AiProvider, options: GenerateOptions) {
    const adapter = this.get(provider);
    if (!adapter) throw new Error(`Provider is not registered: ${provider}`);
    return adapter.generate(options);
  }

  private normalizeProvider(provider: AiProvider | "auto" | string | undefined): AiProvider | "auto" {
    return provider === "auto" ||
      provider === "ollama" ||
      provider === "gemini" ||
      provider === "mock" ||
      provider === "openai" ||
      provider === "anthropic" ||
      provider === "openrouter" ||
      provider === "local"
      ? provider
      : "ollama";
  }
}

export const providerRegistry = new ProviderRegistry();
