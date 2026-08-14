import type { AiProvider } from '../types';

export type EdithModelTaskType =
  | 'conversation'
  | 'classification'
  | 'planning'
  | 'verification'
  | 'coding'
  | 'vision'
  | 'voice';

export type EdithModelModality = 'text' | 'image' | 'audio' | 'screen';
export type EdithProviderHealth = 'available' | 'unavailable' | 'unknown';
export type EdithPrivacyPreference = 'local_first' | 'cloud_allowed' | 'offline_only';

export interface EdithModelRouteRequest {
  requestedProvider?: AiProvider | string;
  model?: string;
  taskType?: EdithModelTaskType;
  modality?: EdithModelModality;
  privacyPreference?: EdithPrivacyPreference;
  providerHealth?: Partial<Record<AiProvider, EdithProviderHealth>>;
}

export interface EdithModelCandidate {
  provider: AiProvider;
  model: string;
  health: EdithProviderHealth;
  privacy: 'local' | 'cloud' | 'offline';
  capabilities: EdithModelTaskType[];
  priority: number;
  skippedReason?: string;
}

export interface EdithModelRoute {
  id: string;
  createdAt: string;
  requestedProvider: AiProvider;
  taskType: EdithModelTaskType;
  modality: EdithModelModality;
  fallbackOrder: AiProvider[];
  candidates: EdithModelCandidate[];
  selectedProvider: AiProvider;
  selectedModel: string;
  rationale: string;
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  ollama: 'llama3.2',
  gemini: 'gemini-2.5-flash',
  mock: 'aura-mock',
};

const PROVIDER_CAPABILITIES: Record<AiProvider, EdithModelTaskType[]> = {
  ollama: ['conversation', 'classification', 'planning', 'verification', 'coding'],
  gemini: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision'],
  mock: ['conversation', 'classification'],
};

function routeId(): string {
  return `model-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProvider(provider: unknown): AiProvider {
  return provider === 'gemini' || provider === 'mock' || provider === 'ollama'
    ? provider
    : 'ollama';
}

function fallbackOrderFor(provider: AiProvider, privacy: EdithPrivacyPreference): AiProvider[] {
  if (privacy === 'offline_only') return provider === 'mock' ? ['mock'] : ['ollama', 'mock'];
  if (provider === 'mock') return ['mock'];
  if (provider === 'gemini') return ['gemini', 'mock'];
  return ['ollama', 'gemini', 'mock'];
}

export class ModelRouterService {
  route(request: EdithModelRouteRequest = {}): EdithModelRoute {
    const requestedProvider = normalizeProvider(request.requestedProvider);
    const taskType = request.taskType ?? 'conversation';
    const modality = request.modality ?? 'text';
    const privacyPreference = request.privacyPreference ?? 'local_first';
    const fallbackOrder = fallbackOrderFor(requestedProvider, privacyPreference);
    const health = request.providerHealth ?? {};

    const candidates = fallbackOrder.map((provider, index): EdithModelCandidate => {
      const providerHealth = health[provider] ?? (provider === 'mock' ? 'available' : 'unknown');
      const capabilities = PROVIDER_CAPABILITIES[provider];
      const supportsTask = capabilities.includes(taskType) || taskType === 'conversation';
      const supportsModality = modality === 'text' || (modality === 'image' && provider === 'gemini');
      const skippedReasons = [
        providerHealth === 'unavailable' ? 'provider unavailable' : undefined,
        !supportsTask ? `does not advertise ${taskType}` : undefined,
        !supportsModality ? `does not support ${modality}` : undefined,
      ].filter(Boolean);

      return {
        provider,
        model: provider === requestedProvider && request.model ? request.model : DEFAULT_MODELS[provider],
        health: providerHealth,
        privacy: provider === 'ollama' ? 'local' : provider === 'gemini' ? 'cloud' : 'offline',
        capabilities,
        priority: index + 1,
        skippedReason: skippedReasons.length > 0 ? skippedReasons.join('; ') : undefined,
      };
    });

    const selected = candidates.find((candidate) => !candidate.skippedReason) ?? candidates[candidates.length - 1];

    return {
      id: routeId(),
      createdAt: new Date().toISOString(),
      requestedProvider,
      taskType,
      modality,
      fallbackOrder,
      candidates,
      selectedProvider: selected.provider,
      selectedModel: selected.model,
      rationale: this.rationale(requestedProvider, selected, privacyPreference),
    };
  }

  shouldAttempt(route: EdithModelRoute, provider: AiProvider): boolean {
    return route.fallbackOrder.includes(provider);
  }

  private rationale(
    requestedProvider: AiProvider,
    selected: EdithModelCandidate,
    privacyPreference: EdithPrivacyPreference
  ): string {
    if (privacyPreference === 'offline_only') {
      return 'Offline-only routing excludes cloud providers and preserves local/mock fallback.';
    }
    if (selected.provider === requestedProvider) {
      return `Requested provider ${requestedProvider} is first eligible candidate.`;
    }
    return `Requested provider ${requestedProvider} was not eligible; routed to ${selected.provider}.`;
  }
}

export const modelRouterService = new ModelRouterService();
