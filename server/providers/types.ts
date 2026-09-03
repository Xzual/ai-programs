import type { AiProvider, ProviderRuntimeStatus } from "../../src/types";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ProviderMetadata {
  id: AiProvider;
  name: string;
  configured: boolean;
  available: boolean;
  healthy: boolean;
  modelAvailable: boolean;
  status: ProviderRuntimeStatus;
  privacyMode: "local" | "cloud" | "offline";
  models: ProviderModelInfo[];
  defaultModel: string;
  capabilities: Array<"text" | "streaming" | "vision" | "tools" | "structuredOutput" | "embeddings">;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
}

export interface ProviderHealth extends ProviderMetadata {
  checkedAt: string;
  latencyMs: number;
  checkedModel?: string;
  errorCode?: ProviderErrorCode;
  error?: string;
}

export type ProviderErrorCode =
  | "configuration_required"
  | "provider_unavailable"
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "invalid_api_key"
  | "model_unavailable"
  | "malformed_response"
  | "unknown_error";

export interface GenerateOptions {
  model?: string;
  messages: ProviderMessage[];
  temperature?: number;
  timeoutMs?: number;
  ollamaUrl?: string;
}

export interface GenerateResult {
  provider: AiProvider;
  model: string;
  text: string;
  latencyMs: number;
}

export interface StreamChunk {
  text?: string;
  done?: boolean;
}

export interface AIProviderAdapter {
  metadata(): ProviderMetadata;
  healthCheck(options?: Record<string, unknown>): Promise<ProviderHealth>;
  getModels?(options?: Record<string, unknown>): Promise<ProviderModelInfo[]>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
