export type AiState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'searching'
  | 'tool_execution'
  | 'computer_use'
  | 'browser_use'
  | 'coding'
  | 'trading_analysis'
  | 'warning'
  | 'error'
  | 'success';

export type AiProvider = 'ollama' | 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'local' | 'mock';
export type AssistantPersona = 'jarvis' | 'friday' | 'ultron' | 'karen' | 'alfred' | 'homer';
export type ProviderRuntimeStatus =
  | 'available'
  | 'unavailable'
  | 'configuration_required'
  | 'rate_limited'
  | 'offline'
  | 'unknown';

export interface AssistantThemeTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  glow: string;
  bgTint: string;
  core: string;
  notification: string;
}

export interface AssistantProfile {
  id: AssistantPersona;
  name: string;
  description: string;
  platform: 'E.D.I.T.H.';
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  themeTokens: AssistantThemeTokens;
  systemPrompt: string;
  personality: string;
  speakingStyle: string;
  greetingStyle: string;
  voice: string;
  voiceId: string;
  memoryNamespace: string;
  notificationIdentity: string;
  taskReportSignature: string;
  preferredModel: 'auto' | string;
  preferredProvider: 'auto' | AiProvider;
  fallbackModels: string[];
  tools: string[];
  agentPolicy: string;
}

export type MemoryCategory = 'user_pref' | 'fact' | 'summary' | 'custom';

export type MemoryType =
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'preference'
  | 'project'
  | 'procedural'
  | 'failure';

export type MemoryScope = 'global' | 'user' | 'project' | 'task' | 'conversation';
export type MemorySensitivity = 'public' | 'internal' | 'sensitive';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  assistantProfileId?: AssistantPersona;
  assistantName?: string;
  requestedProvider?: AiProvider;
  requestedModel?: string;
  providerUsed?: AiProvider;
  modelUsed?: string;
  fallbackUsed?: boolean;
  fallbackProvider?: AiProvider;
  fallbackModel?: string;
  providerStatus?: ProviderRuntimeStatus;
  isStreaming?: boolean;
  audioUrl?: string;
  toolsUsed?: string[];
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  createdAt: number;
  isSensitive?: boolean;
  type?: MemoryType;
  scope?: MemoryScope;
  content?: string;
  source?: string;
  provenance?: string;
  confidence?: number;
  importance?: number;
  sensitivity?: MemorySensitivity;
  updatedAt?: number;
  lastAccessed?: number;
  ttlMs?: number;
  relatedEntityIds?: string[];
  mergeOf?: string[];
  deletedAt?: number;
  assistantNamespace?: string;
  namespace?: string;
}

export interface AutomationTool {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  lastRun?: number;
  status: 'idle' | 'running' | 'success' | 'error';
  requiresConfirmation: boolean;
  category: 'file' | 'system' | 'reminder' | 'analytics' | 'web' | 'media' | 'code' | 'monitor' | 'vision' | 'computer' | 'browser' | 'design3d' | 'iot' | 'finance' | 'knowledge';
  /** Input fields shown in the run dialog */
  inputFields?: ToolInputField[];
}

export interface ToolInputField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'textarea';
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
}

export interface ToolExecutionLog {
  id: string;
  toolId: string;
  toolName: string;
  args: Record<string, any>;
  result: string;
  timestamp: number;
  status: 'success' | 'error' | 'denied';
  assistantProfileId?: AssistantPersona;
  assistantName?: string;
  taskReportSignature?: string;
}

export interface IntegrationConfig {
  id: string;
  name: string;
  description: string;
  status: 'connected' | 'disconnected' | 'needs_auth';
  iconName: string;
  webhookUrl?: string;
  apiKey?: string;
  enabled: boolean;
  lastSync?: number;
}

export interface EdithUserAccount {
  id: string;
  name: 'CAN İPKİN' | 'ARDA YORULMAZEL';
  role: 'admin';
  permissions: string[];
  voiceProfile: {
    enrolled: boolean;
    label: string;
  };
  preferences: Record<string, unknown>;
  lastLogin?: number;
  securitySettings: {
    authenticationMode: 'typed_name' | 'spoken_name';
    biometricVerified: false;
  };
}

export interface EdithAuthSession {
  authenticated: boolean;
  user: EdithUserAccount;
  authenticatedAt: number;
  method: 'typed_name' | 'spoken_name';
  assurance: 'admin_name_match';
}

export interface UserSettings {
  aiProvider: AiProvider;
  ollamaUrl: string;
  selectedModel: string;
  sttEngine: 'webspeech' | 'whisper';
  ttsEngine: 'webspeech' | 'piper' | 'claude_voice';
  assistantPersona: AssistantPersona;
  language: 'tr' | 'en';
  userName: string;
  autoSpeech: boolean;
  voiceHandsFree: boolean;
  claudeVoiceApiKey?: string;
  claudeVoiceId?: string;
  temperature: number;
  memoryEnabled: boolean;
  animationQuality: 'low' | 'medium' | 'high';
  systemPrompt: string;
}

export interface SystemHealth {
  ollamaConnected: boolean;
  ollamaUrl: string;
  availableModels: string[];
  geminiAvailable: boolean;
  micAvailable: boolean;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  lastChecked: number;
}

export interface ProviderProfile {
  provider: AiProvider;
  displayName: string;
  privacy: 'local' | 'cloud' | 'offline';
  defaultModel: string;
  modelExamples: string[];
  tasks: string[];
  capabilities: string[];
  requiredEnv: string[];
  status: ProviderRuntimeStatus;
  notes: string;
  pendingBackend?: boolean;
}

export interface ProviderHealthSnapshot {
  ollamaConnected: boolean;
  geminiAvailable: boolean;
  availableModels: string[];
  checkedAt?: number;
  source: 'backend' | 'placeholder';
}
