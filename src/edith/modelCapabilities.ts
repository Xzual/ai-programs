import type { AiProvider } from '../types';
import type { EdithModelTaskType } from './modelRouter';

export type EdithModelCapability =
  | 'text'
  | 'vision'
  | 'audioInput'
  | 'audioOutput'
  | 'tools'
  | 'computerUse'
  | 'structuredOutput'
  | 'reasoning'
  | 'streaming'
  | 'embeddings';

export interface EdithProviderProfile {
  provider: AiProvider;
  displayName: string;
  privacy: 'local' | 'cloud' | 'offline';
  defaultModel: string;
  modelExamples: string[];
  tasks: EdithModelTaskType[];
  capabilities: EdithModelCapability[];
  requiredEnv: string[];
  status: 'available' | 'unavailable' | 'configuration_required';
  notes: string;
}

const PROVIDER_DEFINITIONS: Array<Omit<EdithProviderProfile, 'status'>> = [
  {
    provider: 'ollama',
    displayName: 'Ollama',
    privacy: 'local',
    defaultModel: 'llama3.2',
    modelExamples: ['llama3.2', 'qwen2.5', 'mistral', 'gemma2'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding'],
    capabilities: ['text', 'streaming'],
    requiredEnv: [],
    notes: 'Local HTTP runtime. Availability is detected by health check; EDITH does not start the server.',
  },
  {
    provider: 'gemini',
    displayName: 'Google Gemini',
    privacy: 'cloud',
    defaultModel: 'gemini-2.5-flash',
    modelExamples: ['gemini-2.5-flash'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'streaming'],
    requiredEnv: ['GEMINI_API_KEY'],
    notes: 'Cloud provider used only when an API key is configured and privacy policy allows cloud.',
  },
  {
    provider: 'openai',
    displayName: 'OpenAI',
    privacy: 'cloud',
    defaultModel: 'gpt-5',
    modelExamples: ['gpt-5', 'gpt-5-mini'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision', 'voice'],
    capabilities: ['text', 'vision', 'audioInput', 'audioOutput', 'tools', 'structuredOutput', 'reasoning', 'streaming', 'embeddings'],
    requiredEnv: ['OPENAI_API_KEY'],
    notes: 'Registered as a future adapter; no OpenAI SDK call path is bound in this codebase yet.',
  },
  {
    provider: 'anthropic',
    displayName: 'Anthropic Claude',
    privacy: 'cloud',
    defaultModel: 'claude-sonnet-4',
    modelExamples: ['claude-sonnet-4', 'claude-opus-4'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'tools', 'structuredOutput', 'reasoning', 'streaming'],
    requiredEnv: ['ANTHROPIC_API_KEY'],
    notes: 'Registered as a future adapter; no Anthropic SDK call path is bound in this codebase yet.',
  },
  {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    privacy: 'cloud',
    defaultModel: 'auto',
    modelExamples: ['auto'],
    tasks: ['conversation', 'classification', 'planning', 'verification', 'coding', 'vision'],
    capabilities: ['text', 'vision', 'tools', 'structuredOutput', 'streaming'],
    requiredEnv: ['OPENROUTER_API_KEY'],
    notes: 'Registered as a future gateway adapter; provider-specific capabilities must be checked per routed model.',
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
    notes: 'Generic local provider slot for future non-Ollama runtimes.',
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
    notes: 'Offline deterministic fallback for UI and routing tests.',
  },
];

function envConfigured(envNames: string[]): boolean {
  return envNames.every((name) => {
    const value = process.env[name];
    return Boolean(value && value !== `MY_${name}`);
  });
}

export class ModelCapabilityRegistry {
  list(providerHealth: Partial<Record<AiProvider, 'available' | 'unavailable' | 'unknown'>> = {}): EdithProviderProfile[] {
    return PROVIDER_DEFINITIONS.map((definition) => {
      const health = providerHealth[definition.provider];
      const status: EdithProviderProfile['status'] = health === 'available'
        ? 'available'
        : health === 'unavailable'
        ? 'unavailable'
        : definition.provider === 'mock'
        ? 'available'
        : envConfigured(definition.requiredEnv)
        ? 'configuration_required'
        : 'configuration_required';
      return { ...definition, status };
    });
  }

  get(provider: AiProvider): EdithProviderProfile {
    return this.list().find((profile) => profile.provider === provider) ?? this.list().find((profile) => profile.provider === 'mock')!;
  }

  defaultModel(provider: AiProvider): string {
    return this.get(provider).defaultModel;
  }
}

export const modelCapabilityRegistry = new ModelCapabilityRegistry();
