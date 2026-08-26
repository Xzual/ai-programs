import type { AiProvider } from '../types';
import { modelCapabilityRegistry } from './modelCapabilities';

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
  modelCapabilities: string[];
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

function routeId(): string {
  return `model-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProvider(provider: unknown): AiProvider {
  return provider === 'gemini' ||
    provider === 'mock' ||
    provider === 'ollama' ||
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'openrouter' ||
    provider === 'local'
    ? provider
    : 'ollama';
}

function fallbackOrderFor(provider: AiProvider, privacy: EdithPrivacyPreference): AiProvider[] {
  if (privacy === 'offline_only') return provider === 'mock' ? ['mock'] : ['ollama', 'mock'];
  if (provider === 'mock') return ['mock'];
  if (provider === 'ollama' || provider === 'local') return [provider, 'gemini', 'mock'];
  return [provider, 'gemini', 'ollama', 'mock'].filter((candidate, index, list) =>
    list.indexOf(candidate) === index
  ) as AiProvider[];
}

export class ModelRouterService {
  route(request: EdithModelRouteRequest = {}): EdithModelRoute {
    const requestedProvider = normalizeProvider(request.requestedProvider);
    const taskType = request.taskType ?? 'conversation';
    const modality = request.modality ?? 'text';
    const privacyPreference = request.privacyPreference ?? 'local_first';
    const fallbackOrder = fallbackOrderFor(requestedProvider, privacyPreference);
    const health = request.providerHealth ?? {};
    const profiles = new Map(modelCapabilityRegistry.list(health).map((profile) => [profile.provider, profile]));

    const candidates = fallbackOrder.map((provider, index): EdithModelCandidate => {
      const profile = profiles.get(provider) ?? modelCapabilityRegistry.get(provider);
      const providerHealth = health[provider] ?? (provider === 'mock' ? 'available' : 'unknown');
      const capabilities = profile.tasks;
      const supportsTask = capabilities.includes(taskType) || taskType === 'conversation';
      const supportsModality =
        modality === 'text' ||
        (modality === 'image' && profile.capabilities.includes('vision')) ||
        (modality === 'screen' && profile.capabilities.includes('vision')) ||
        (modality === 'audio' && (profile.capabilities.includes('audioInput') || profile.capabilities.includes('audioOutput')));
      const skippedReasons = [
        providerHealth === 'unavailable' ? 'provider unavailable' : undefined,
        profile.status === 'configuration_required' && provider !== 'ollama' && provider !== 'mock'
          ? 'provider adapter or credentials are not configured'
          : undefined,
        !supportsTask ? `does not advertise ${taskType}` : undefined,
        !supportsModality ? `does not support ${modality}` : undefined,
      ].filter(Boolean);

      return {
        provider,
        model: provider === requestedProvider && request.model ? request.model : profile.defaultModel,
        health: providerHealth,
        privacy: profile.privacy,
        capabilities,
        modelCapabilities: profile.capabilities,
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
