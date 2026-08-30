import type { EdithModelModality, EdithModelTaskType, EdithPrivacyPreference } from "../../src/edith/modelRouter";
import type { AiProvider } from "../../src/types";

const MODEL_TASK_TYPES = new Set<EdithModelTaskType>(["conversation", "classification", "planning", "verification", "coding", "vision", "voice"]);
const MODEL_MODALITIES = new Set<EdithModelModality>(["text", "image", "audio", "screen"]);
const MODEL_PRIVACY_PREFERENCES = new Set<EdithPrivacyPreference>(["local_first", "cloud_allowed", "offline_only"]);

export function parseAiProvider(value: unknown): AiProvider | undefined {
  return value === "ollama" ||
    value === "gemini" ||
    value === "openai" ||
    value === "anthropic" ||
    value === "openrouter" ||
    value === "local" ||
    value === "mock"
    ? value
    : undefined;
}

export function parseModelTaskType(value: unknown): EdithModelTaskType | undefined {
  return typeof value === "string" && MODEL_TASK_TYPES.has(value as EdithModelTaskType) ? value as EdithModelTaskType : undefined;
}

export function parseModelModality(value: unknown): EdithModelModality | undefined {
  return typeof value === "string" && MODEL_MODALITIES.has(value as EdithModelModality) ? value as EdithModelModality : undefined;
}

export function parsePrivacyPreference(value: unknown): EdithPrivacyPreference | undefined {
  return typeof value === "string" && MODEL_PRIVACY_PREFERENCES.has(value as EdithPrivacyPreference) ? value as EdithPrivacyPreference : undefined;
}
