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
    models: ['llama3.2', 'qwen2.5', 'mistral', 'gemma2'],
    configured: true,
    available: false,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: false,
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
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    configured: false,
    available: false,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: false,
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
    models: ['local-auto'],
    configured: false,
    available: false,
    supportsStreaming: false,
    supportsVision: false,
    supportsTools: false,
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
    models: ['edith-mock'],
    configured: true,
    available: true,
    supportsStreaming: false,
    supportsVision: false,
    supportsTools: false,
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
    models: ['gpt-5', 'gpt-5-mini'],
    configured: false,
    available: false,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
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
    models: ['claude-sonnet-4', 'claude-opus-4'],
    configured: false,
    available: false,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
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
    models: ['auto'],
    configured: false,
    available: false,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: false,
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
    value === 'degraded' ||
    value === 'error' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function normalizeProvider(value: unknown): AiProvider | undefined {
  if (
    value === 'ollama' ||
    value === 'gemini' ||
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'openrouter' ||
    value === 'local' ||
    value === 'mock'
  ) {
    return value;
  }
  return undefined;
}

type ProviderPayload = Omit<Partial<ProviderProfile>, 'id' | 'models' | 'status'> & {
  id?: unknown;
  name?: string;
  models?: Array<string | { id?: string; name?: string; model?: string }>;
  providerId?: unknown;
  status?: unknown;
};

function normalizeModels(models: ProviderPayload['models']): string[] {
  if (!Array.isArray(models)) return [];
  return models
    .map((model) => {
      if (typeof model === 'string') return model;
      return model.id ?? model.model ?? model.name;
    })
    .filter((model): model is string => Boolean(model));
}

function toProviderPayloadArray(data: unknown): ProviderPayload[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const providers = record.providers ?? record.providerHealth ?? record.health;
  if (Array.isArray(providers)) return providers as ProviderPayload[];
  if (providers && typeof providers === 'object') {
    return Object.entries(providers as Record<string, ProviderPayload>).map(([id, profile]) => ({
      ...profile,
      id: profile.id ?? id,
    }));
  }
  return [];
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Expected JSON from ${response.url || 'provider endpoint'} but received a non-JSON response.`);
  }
}

function normalizeProviderProfile(raw: ProviderPayload): ProviderProfile | undefined {
  const provider = normalizeProvider(raw.provider ?? raw.providerId ?? raw.id);
  if (!provider) return undefined;

  const fallback = STATIC_PROVIDER_PROFILES.find((profile) => profile.provider === provider);
  if (!fallback) return undefined;

  const rawModels = normalizeModels(raw.models);
  const modelExamples = Array.isArray(raw.modelExamples) && raw.modelExamples.length
    ? raw.modelExamples
    : rawModels.length
    ? rawModels
    : fallback.modelExamples;

  const configured = typeof raw.configured === 'boolean'
    ? raw.configured
    : raw.status === 'configuration_required'
    ? false
    : fallback.configured;
  const available = typeof raw.available === 'boolean'
    ? raw.available
    : raw.status === 'available'
    ? true
    : raw.status === 'offline' || raw.status === 'unavailable' || raw.status === 'error'
    ? false
    : fallback.available;
  const status = raw.status
    ? normalizeStatus(raw.status)
    : available
    ? 'available'
    : configured === false
    ? 'configuration_required'
    : fallback.status;
  const privacyMode = raw.privacyMode ?? raw.privacy ?? fallback.privacyMode ?? fallback.privacy;
  const privacy = privacyMode === 'cloud' || privacyMode === 'offline' || privacyMode === 'local'
    ? privacyMode
    : fallback.privacy;

  return {
    ...fallback,
    ...raw,
    provider,
    id: provider,
    name: raw.name ?? raw.displayName ?? fallback.displayName,
    displayName: raw.displayName ?? raw.name ?? fallback.displayName,
    privacy,
    privacyMode,
    defaultModel: raw.defaultModel ?? fallback.defaultModel,
    modelExamples: Array.from(new Set(['auto', ...modelExamples, raw.defaultModel ?? fallback.defaultModel].filter(Boolean) as string[])),
    models: Array.from(new Set(modelExamples)),
    tasks: Array.isArray(raw.tasks) ? raw.tasks : fallback.tasks,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : fallback.capabilities,
    configured,
    available,
    supportsStreaming: raw.supportsStreaming ?? fallback.supportsStreaming,
    supportsVision: raw.supportsVision ?? fallback.supportsVision,
    supportsTools: raw.supportsTools ?? fallback.supportsTools,
    errorCode: raw.errorCode,
    lastCheckedAt: raw.lastCheckedAt,
    requiredEnv: Array.isArray(raw.requiredEnv) ? raw.requiredEnv : fallback.requiredEnv,
    status,
    notes: raw.notes ?? fallback.notes,
    pendingBackend: raw.pendingBackend ?? false,
  };
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
  if (status === 'degraded') return 'DEGRADED';
  if (status === 'error') return 'ERROR';
  return 'UNKNOWN';
}

export function providerTone(status: ProviderRuntimeStatus): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'available') return 'success';
  if (status === 'configuration_required' || status === 'rate_limited' || status === 'degraded' || status === 'unknown') return 'warning';
  if (status === 'offline' || status === 'unavailable' || status === 'error') return 'danger';
  return 'muted';
}

export function fallbackProviderProfiles(health?: Partial<ProviderHealthSnapshot>): ProviderProfile[] {
  return STATIC_PROVIDER_PROFILES.map((profile) => {
    if (profile.provider === 'ollama') {
      return {
        ...profile,
        status: health?.ollamaConnected ? 'available' : 'offline',
        modelExamples: health?.availableModels?.length ? health.availableModels : profile.modelExamples,
        models: health?.availableModels?.length ? health.availableModels : profile.models,
        configured: true,
        available: Boolean(health?.ollamaConnected),
      };
    }
    if (profile.provider === 'gemini') {
      return {
        ...profile,
        status: health?.geminiAvailable ? 'available' : 'configuration_required',
        configured: Boolean(health?.geminiAvailable),
        available: Boolean(health?.geminiAvailable),
      };
    }
    return profile;
  });
}

export async function fetchProviderHealth(ollamaUrl: string): Promise<ProviderHealthSnapshot> {
  try {
    const providerHealthResponse = await fetch(`/api/providers/health?ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
    if (providerHealthResponse.ok) {
      const data = await readJsonResponse(providerHealthResponse);
      const providerProfiles = toProviderPayloadArray(data)
        .map((profile) => normalizeProviderProfile({ ...profile, pendingBackend: false, lastCheckedAt: Date.now() }))
        .filter((profile): profile is ProviderProfile => Boolean(profile));
      const providers = providerProfiles;
      const gemini = providers.find((provider: { id?: string; provider?: string }) => (provider.id ?? provider.provider) === 'gemini');
      const ollama = providers.find((provider: { id?: string; provider?: string }) => (provider.id ?? provider.provider) === 'ollama');
      return {
        ollamaConnected: Boolean(ollama?.available ?? data.ollamaConnected),
        geminiAvailable: Boolean(gemini?.available ?? data.geminiAvailable),
        availableModels: Array.isArray(data.availableModels) ? data.availableModels : [],
        providers: providerProfiles,
        errorCode: typeof data.errorCode === 'string' ? data.errorCode : undefined,
        checkedAt: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        source: 'backend',
      };
    }

    const response = await fetch(`/api/health?ollamaUrl=${encodeURIComponent(ollamaUrl)}`);
    if (!response.ok) throw new Error(`Health endpoint returned ${response.status}`);
    const data = await readJsonResponse(response);
    return {
      ollamaConnected: Boolean(data.ollamaConnected),
      geminiAvailable: Boolean(data.geminiAvailable),
      availableModels: Array.isArray(data.availableModels) ? data.availableModels : [],
      providers: [],
      errorCode: typeof data.errorCode === 'string' ? data.errorCode : undefined,
      checkedAt: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
      source: 'backend',
    };
  } catch {
    return {
      ollamaConnected: false,
      geminiAvailable: false,
      availableModels: [],
      providers: [],
      checkedAt: Date.now(),
      source: 'placeholder',
    };
  }
}

async function fetchProviderModelMap(): Promise<Map<AiProvider, string[]>> {
  const modelMap = new Map<AiProvider, string[]>();
  try {
    const response = await fetch('/api/models');
    if (!response.ok) return modelMap;
    const data = await readJsonResponse(response);
    const rawModelPayload = data.models;
    const rawModels = Array.isArray(rawModelPayload) ? rawModelPayload : [];
    rawModels.forEach((entry: unknown) => {
      if (typeof entry === 'string') {
        const existing = modelMap.get('ollama') ?? [];
        modelMap.set('ollama', [...existing, entry]);
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      const record = entry as Record<string, unknown>;
      const provider = normalizeProvider(record.provider ?? record.providerId);
      const modelId = typeof record.id === 'string'
        ? record.id
        : typeof record.model === 'string'
        ? record.model
        : typeof record.name === 'string'
        ? record.name
        : undefined;
      if (!provider || !modelId) return;
      const existing = modelMap.get(provider) ?? [];
      modelMap.set(provider, [...existing, modelId]);
    });

    if (rawModelPayload && typeof rawModelPayload === 'object' && !Array.isArray(rawModelPayload)) {
      Object.entries(rawModelPayload as Record<string, unknown>).forEach(([providerId, models]) => {
        const provider = normalizeProvider(providerId);
        if (!provider || !Array.isArray(models)) return;
        const normalizedModels = normalizeModels(models as ProviderPayload['models']);
        if (!normalizedModels.length) return;
        const existing = modelMap.get(provider) ?? [];
        modelMap.set(provider, [...existing, ...normalizedModels]);
      });
    }

    const providers = toProviderPayloadArray(data);
    providers.forEach((profile) => {
      const provider = normalizeProvider(profile.provider ?? profile.providerId ?? profile.id);
      const models = normalizeModels(profile.models);
      if (!provider || !models.length) return;
      const existing = modelMap.get(provider) ?? [];
      modelMap.set(provider, [...existing, ...models]);
    });
  } catch {
    return modelMap;
  }

  modelMap.forEach((models, provider) => {
    modelMap.set(provider, Array.from(new Set(models)));
  });
  return modelMap;
}

function mergeModelMap(profiles: ProviderProfile[], modelMap: Map<AiProvider, string[]>): ProviderProfile[] {
  return profiles.map((profile) => {
    const models = modelMap.get(profile.provider);
    if (!models?.length) return profile;
    const merged = Array.from(new Set(['auto', ...models, profile.defaultModel].filter(Boolean) as string[]));
    return {
      ...profile,
      modelExamples: merged,
      models,
    };
  });
}

export async function fetchProviderProfiles(ollamaConnected: boolean): Promise<ProviderProfile[]> {
  const modelMap = await fetchProviderModelMap();
  try {
    const providerResponse = await fetch('/api/providers');
    if (providerResponse.ok) {
      const data = await readJsonResponse(providerResponse);
      const providers = toProviderPayloadArray(data);
      if (providers.length) {
        const normalized = providers
          .map((profile) =>
            normalizeProviderProfile({ ...profile, pendingBackend: false })
          )
          .filter((profile): profile is ProviderProfile => Boolean(profile));
        if (normalized.length) return mergeModelMap(normalized, modelMap);
      }
    }

    const response = await fetch(`/api/edith/models/capabilities?ollamaAvailable=${ollamaConnected}`);
    if (!response.ok) throw new Error(`Models endpoint returned ${response.status}`);
    const data = await readJsonResponse(response);
    if (!Array.isArray(data.providers)) throw new Error('Provider list missing');
    const normalized = data.providers
      .map((profile: Partial<ProviderProfile>) => normalizeProviderProfile({ ...profile, pendingBackend: false }))
      .filter((profile): profile is ProviderProfile => Boolean(profile));
    return normalized.length ? mergeModelMap(normalized, modelMap) : mergeModelMap(fallbackProviderProfiles({ ollamaConnected, geminiAvailable: false }), modelMap);
  } catch {
    return mergeModelMap(fallbackProviderProfiles({ ollamaConnected, geminiAvailable: false }), modelMap);
  }
}

function providerModels(provider: AiProvider, providerProfiles: ProviderProfile[], availableModels: string[]): string[] {
  const profile = providerProfiles.find((candidate) => candidate.provider === provider);
  if (provider === 'ollama' && availableModels.length) return availableModels;
  return profile?.models ?? profile?.modelExamples ?? [];
}

export function modelsForProvider(provider: AiProvider, providerProfiles: ProviderProfile[], availableModels: string[]): string[] {
  const profile = providerProfiles.find((candidate) => candidate.provider === provider);
  const models = providerModels(provider, providerProfiles, availableModels);
  return Array.from(new Set(['auto', ...models, profile?.defaultModel].filter(Boolean) as string[]));
}

export function selectValidModelForProvider(
  provider: AiProvider,
  providerProfiles: ProviderProfile[],
  availableModels: string[],
  currentModel?: string
): string {
  const profile = providerProfiles.find((candidate) => candidate.provider === provider);
  const models = providerModels(provider, providerProfiles, availableModels).filter((model) => model !== 'auto');
  if (provider === 'ollama' && !availableModels.length && profile?.status !== 'available') return 'auto';
  if (currentModel && currentModel !== 'auto' && models.includes(currentModel)) return currentModel;
  if (profile?.defaultModel && models.includes(profile.defaultModel)) return profile.defaultModel;
  return models[0] ?? 'auto';
}

export function modelDisabledReason(
  provider: AiProvider,
  model: string,
  providerProfiles: ProviderProfile[],
  availableModels: string[]
): string | undefined {
  if (model === 'auto') return undefined;
  const profile = providerProfiles.find((candidate) => candidate.provider === provider);
  const status = profile?.status ?? 'unknown';
  if (status === 'configuration_required') return 'configuration required';
  if (status === 'offline') return 'provider offline';
  if (status === 'unavailable' || status === 'error') return 'provider unavailable';
  if (status === 'rate_limited') return 'provider rate limited';
  if (status === 'unknown') return 'provider status unknown';
  if (provider === 'ollama' && availableModels.length > 0 && !availableModels.includes(model)) return 'model unavailable';
  const models = providerModels(provider, providerProfiles, availableModels);
  if (models.length > 0 && !models.includes(model)) return 'model unavailable';
  return undefined;
}
