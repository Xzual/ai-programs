import type { AiProvider } from "../../src/types";

type ProviderLogLevel = "info" | "warn" | "error";

interface ProviderLogEvent {
  provider: AiProvider;
  model?: string;
  latencyMs?: number;
  success: boolean;
  errorCode?: string;
}

export function logProviderEvent(level: ProviderLogLevel, event: ProviderLogEvent): void {
  const parts = [
    `[AI Provider] provider=${event.provider}`,
    event.model ? `model=${event.model}` : undefined,
    typeof event.latencyMs === "number" ? `latencyMs=${event.latencyMs}` : undefined,
    `success=${event.success}`,
    event.errorCode ? `errorCode=${event.errorCode}` : undefined,
  ].filter(Boolean);

  console[level](parts.join(" "));
}
