import { geminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { OllamaProvider } from "./ollama";
import { routeProvider } from "./router";
import type { AIProviderAdapter, GenerateOptions, ProviderHealth, ProviderMetadata, ProviderRouteRequest, RuntimeProviderId } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<RuntimeProviderId, AIProviderAdapter>();

  constructor() {
    this.register(new OllamaProvider());
    this.register(geminiProvider);
    this.register(new MockProvider());
  }

  register(provider: AIProviderAdapter): void {
    this.providers.set(provider.metadata().id, provider);
  }

  get(provider: RuntimeProviderId): AIProviderAdapter | undefined {
    return this.providers.get(provider);
  }

  list(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((provider) => provider.metadata());
  }

  async health(options: Record<string, unknown> = {}): Promise<ProviderHealth[]> {
    return Promise.all(Array.from(this.providers.values()).map((provider) => provider.healthCheck(options)));
  }

  models(): Array<ProviderMetadata & { provider: RuntimeProviderId }> {
    return this.list().map((provider) => ({ ...provider, provider: provider.id }));
  }

  async snapshot(options: Record<string, unknown> = {}): Promise<ProviderHealth[]> {
    return this.health(options);
  }

  async modelSnapshot(options: Record<string, unknown> = {}): Promise<Array<ProviderHealth & { provider: RuntimeProviderId }>> {
    return (await this.snapshot(options)).map((provider) => ({ ...provider, provider: provider.id }));
  }

  route(request: ProviderRouteRequest) {
    return routeProvider(request);
  }

  async generate(provider: RuntimeProviderId, options: GenerateOptions) {
    const adapter = this.get(provider);
    if (!adapter) throw new Error(`Provider is not registered: ${provider}`);
    return adapter.generate(options);
  }
}

export const providerRegistry = new ProviderRegistry();
