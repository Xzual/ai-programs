import type { ProviderRuntimeStatus } from "../../src/types";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ProviderMetadata {
  id: "gemini" | "ollama" | "mock";
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
  errorMessage?: string;
}

export type ProviderErrorCode =
  | "configuration_required"
  | "provider_unavailable"
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "invalid_api_key"
  | "model_unavailable"
  | "empty_response"
  | "empty_final_response_with_thinking"
  | "malformed_response"
  | "unknown_error";

export interface GenerateOptions {
  model?: string;
  messages: ProviderMessage[];
  temperature?: number;
  timeoutMs?: number;
  ollamaUrl?: string;
  firstTokenTimeoutMs?: number;
  generationTimeoutMs?: number;
}

export interface GenerateResult {
  provider: "gemini" | "ollama" | "mock";
  model: string;
  text: string;
  latencyMs: number;
}

export interface StreamChunk {
  text?: string;
  done?: boolean;
  status?: string;
}

export interface AIProviderAdapter {
  metadata(): ProviderMetadata;
  healthCheck(options?: Record<string, unknown>): Promise<ProviderHealth>;
  getModels?(options?: Record<string, unknown>): Promise<ProviderModelInfo[]>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export type RuntimeProviderId = ProviderMetadata["id"];

export interface ProviderRouteRequest {
  requestedProvider?: RuntimeProviderId | "auto" | string;
  requestedModel?: string;
  mode?: "manual" | "auto";
  fallbackEnabled?: boolean;
  health: ProviderHealth[];
}

export interface ProviderRouteResult {
  requestedProvider: RuntimeProviderId | "auto";
  requestedModel: string;
  resolvedProvider: RuntimeProviderId;
  resolvedModel: string;
  providerStatus: ProviderRuntimeStatus;
  fallbackUsed: boolean;
  fallbackProvider?: RuntimeProviderId;
  fallbackModel?: string;
  errorCode?: string;
  errorMessage?: string;
  modelAvailable: boolean;
  configured: boolean;
  available: boolean;
  candidates: Array<{
    provider: RuntimeProviderId;
    model: string;
    available: boolean;
    modelAvailable: boolean;
    status: ProviderRuntimeStatus;
    skippedReason?: string;
    errorCode?: string;
  }>;
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
