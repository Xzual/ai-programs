import { AiProvider, ProviderHealthSnapshot, ProviderProfile, ProviderRuntimeStatus } from '../types';

const STATIC_PROVIDER_PROFILES: ProviderProfile[] = [
  {
    provider: 'ollama',
    displayName: 'Ollama',
    privacy: 'local',
    defaultModel: 'llama3.2',
    modelExamples: ['llama3.2', 'qwen2.5', 'mistral', 'gemma2'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding'],
    capabilities: ['text', 'streaming'],
    requiredEnv: [],
    status: 'unknown',
    notes: 'Local HTTP runtime. Availability is detected by the health endpoint; EDITH does not start Ollama.',
    pendingBackend: true,
  },
  {
    provider: 'gemini',
    displayName: 'Google Gemini',
    privacy: 'cloud',
    defaultModel: 'gemini-2.5-flash',
    modelExamples: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'structuredOutput', 'streaming'],
    requiredEnv: ['GEMINI_API_KEY'],
    status: 'configuration_required',
    notes: 'Cloud provider. Set GEMINI_API_KEY in environment configuration; the key value is never shown in frontend.',
    pendingBackend: true,
  },
  {
    provider: 'local',
    displayName: 'Local Provider',
    privacy: 'local',
    defaultModel: 'local-auto',
    modelExamples: ['local-auto'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding'],
    capabilities: ['text'],
    requiredEnv: [],
    status: 'unknown',
    notes: 'Generic local runtime slot. Pending backend adapter integration.',
    pendingBackend: true,
  },
  {
    provider: 'mock',
    displayName: 'EDITH Mock',
    privacy: 'offline',
    defaultModel: 'edith-mock',
    modelExamples: ['edith-mock'],
    tasks: ['conversation', 'classification'],
    capabilities: ['text'],
    requiredEnv: [],
    status: 'available',
    notes: 'Offline deterministic fallback for UI and routing tests.',
    pendingBackend: true,
  },
  {
    provider: 'openai',
    displayName: 'OpenAI',
    privacy: 'cloud',
    defaultModel: 'gpt-5',
    modelExamples: ['gpt-5', 'gpt-5-mini'],
    tasks: ['conversation', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'tools', 'streaming'],
    requiredEnv: ['OPENAI_API_KEY'],
    status: 'configuration_required',
    notes: 'Registered as a future adapter. Pending backend integration in this frontend pass.',
    pendingBackend: true,
  },
  {
    provider: 'anthropic',
    displayName: 'Anthropic Claude',
    privacy: 'cloud',
    defaultModel: 'claude-sonnet-4',
    modelExamples: ['claude-sonnet-4', 'claude-opus-4'],
    tasks: ['conversation', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'tools', 'streaming'],
    requiredEnv: ['ANTHROPIC_API_KEY'],
    status: 'configuration_required',
    notes: 'Registered as a future adapter. Pending backend integration in this frontend pass.',
    pendingBackend: true,
  },
  {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    privacy: 'cloud',
    defaultModel: 'auto',
    modelExamples: ['auto'],
    tasks: ['conversation', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'streaming'],
    requiredEnv: ['OPENROUTER_API_KEY'],
    status: 'configuration_required',
    notes: 'Registered as a future gateway adapter. Pending backend integration in this frontend pass.',
    pendingBackend: true,
  },
];

function normalizeStatus(value: unknown): ProviderRuntimeStatus {
  if (
    value === 'available' ||
    value === 'unavailable' ||
    value === 'configuration_required' ||
    value === 'rate_limited' ||
    value === 'offline' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

export function providerDisplayName(provider: AiProvider): string {
  return STATIC_PROVIDER_PROFILES.find((profile) => profile.provider === provider)?.displayName ?? provider.toUpperCase();
}

export function providerStatusLabel(status: ProviderRuntimeStatus): string {
  if (status === 'available') return 'ONLINE';
  if (status === 'configuration_required') return 'SETUP REQUIRED';
  if (status === 'rate_limited') return 'RATE LIMITED';
  if (status === 'offline') return 'OFFLINE';
  if (status === 'unavailable') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

export function providerTone(status: ProviderRuntimeStatus): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'available') return 'success';
  if (status === 'configuration_required' || status === 'rate_limited' || status === 'unknown') return 'warning';
  if (status === 'offline' || status === 'unavailable') return 'danger';
  return 'muted';
}

export function fallbackProviderProfiles(health?: Partial<ProviderHealthSnapshot>): ProviderProfile[] {
  return STATIC_PROVIDER_PROFILES.map((profile) => {
    if (profile.provider === 'ollama') {
      return {
        ...profile,
        status: health?.ollamaConnected ? 'available' : 'offline',
        modelExamples: health?.availableModels?.length ? health.availableModels : profile.modelExamples,
      };
    }
    if (profile.provider === 'gemini') {
      return {
        ...profile,
        status: health?.geminiAvailable ? 'available' : 'configuration_required',
      };
    }
    return profile;
  });
}

export async function fetchProviderHealth(ollamaUrl: string): Promise<ProviderHealthSnapshot> {
  try {
    const providerHealthResponse = await fetch(`/api/providers/health?ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
    if (providerHealthResponse.ok) {
      const data = await providerHealthResponse.json();
      const providers = Array.isArray(data.providers) ? data.providers : [];
      const gemini = providers.find((provider: { id?: string; provider?: string }) => (provider.id ?? provider.provider) === 'gemini');
      const ollama = providers.find((provider: { id?: string; provider?: string }) => (provider.id ?? provider.provider) === 'ollama');
      return {
        ollamaConnected: Boolean(ollama?.available ?? data.ollamaConnected),
        geminiAvailable: Boolean(gemini?.available ?? data.geminiAvailable),
        availableModels: Array.isArray(data.availableModels) ? data.availableModels : [],
        checkedAt: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        source: 'backend',
      };
    }

    const response = await fetch(`/api/health?ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
    if (!response.ok) throw new Error(`Health endpoint returned ${response.status}`);
    const data = await response.json();
    return {
      ollamaConnected: Boolean(data.ollamaConnected),
      geminiAvailable: Boolean(data.geminiAvailable),
      availableModels: Array.isArray(data.availableModels) ? data.availableModels : [],
      checkedAt: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
      source: 'backend',
    };
  } catch {
    return {
      ollamaConnected: false,
      geminiAvailable: false,
      availableModels: [],
      checkedAt: Date.now(),
      source: 'placeholder',
    };
  }
}

export async function fetchProviderProfiles(ollamaConnected: boolean): Promise<ProviderProfile[]> {
  try {
    const providerResponse = await fetch('/api/providers');
    if (providerResponse.ok) {
      const data = await providerResponse.json();
      const providers = Array.isArray(data.providers) ? data.providers : [];
      if (providers.length) {
        return providers.map((profile: ProviderProfile & { id?: AiProvider; name?: string; models?: string[] }) => ({
          ...profile,
          provider: profile.provider ?? profile.id,
          displayName: profile.displayName ?? profile.name ?? providerDisplayName(profile.provider ?? profile.id ?? 'mock'),
          modelExamples: profile.modelExamples ?? profile.models ?? [],
          status: normalizeStatus(profile.status),
          pendingBackend: false,
        }));
      }
    }

    const response = await fetch(`/api/edith/models/capabilities?ollamaAvailable=${ollamaConnected}`);
    if (!response.ok) throw new Error(`Models endpoint returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.providers)) throw new Error('Provider list missing');
    return data.providers.map((profile: ProviderProfile) => ({
      ...profile,
      status: normalizeStatus(profile.status),
      pendingBackend: false,
    }));
  } catch {
    return fallbackProviderProfiles({ ollamaConnected, geminiAvailable: false });
  }
}

export function modelsForProvider(provider: AiProvider, providerProfiles: ProviderProfile[], availableModels: string[]): string[] {
  const profile = providerProfiles.find((candidate) => candidate.provider === provider);
  const models = provider === 'ollama' && availableModels.length ? availableModels : profile?.modelExamples ?? [];
  return Array.from(new Set(['auto', ...models, profile?.defaultModel].filter(Boolean) as string[]));
}
