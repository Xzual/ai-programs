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
