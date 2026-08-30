import type { AiProvider } from "../../src/types";
import { geminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { OllamaProvider } from "./ollama";
import type { AIProviderAdapter, ProviderHealth, ProviderMetadata } from "./types";

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
}

export const providerRegistry = new ProviderRegistry();
