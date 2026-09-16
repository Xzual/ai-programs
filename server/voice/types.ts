import type { RawData, WebSocket } from "ws";

export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const GEMINI_LIVE_INPUT_MIME = "audio/pcm;rate=16000";
export const GEMINI_LIVE_OUTPUT_MIME = "audio/pcm;rate=24000";

export type VoiceLiveState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "idle"
  | "error"
  | "disconnected";

export type VoiceLiveErrorCode =
  | "configuration_required"
  | "invalid_api_key"
  | "live_model_unavailable"
  | "mic_permission_denied"
  | "audio_format_error"
  | "network_error"
  | "session_error"
  | "connector_not_implemented";

export type VoiceClientEvent =
  | { type: "session:start" }
  | { type: "audio:chunk"; audio: string; mimeType?: string }
  | { type: "session:stop" }
  | { type: "interrupt" };

export type VoiceServerEvent =
  | { type: "status"; state: VoiceLiveState; sessionId?: string; safeMessage?: string }
  | { type: "transcript:user"; text: string; partial: boolean }
  | { type: "transcript:assistant"; text: string; partial: boolean }
  | { type: "audio:chunk"; audio: string; mimeType: typeof GEMINI_LIVE_OUTPUT_MIME }
  | { type: "error"; errorCode: VoiceLiveErrorCode; safeMessage: string }
  | { type: "session:ready"; sessionId: string; model: typeof GEMINI_LIVE_MODEL }
  | { type: "session:ended"; reason: string };

export interface VoiceLiveStatus {
  success: true;
  assistant: "JARVIS";
  model: typeof GEMINI_LIVE_MODEL;
  configured: boolean;
  available: boolean;
  connected: boolean;
  status: "configuration_required" | "available" | "offline" | "error";
  runtimeStatus: "configuration_required" | "connected" | "offline" | "error";
  errorCode?: VoiceLiveErrorCode;
  safeMessage: string;
  keyPresent: boolean;
  secretExposed: false;
  frontendCanReadApiKey: false;
  liveConnectorBound: boolean;
  wakeWordEnabled: false;
  ttsOutputConnected: boolean;
  bargeInEnabled: boolean;
  inputMimeType: typeof GEMINI_LIVE_INPUT_MIME;
  outputMimeType: typeof GEMINI_LIVE_OUTPUT_MIME;
  checkedAt: number;
}

export interface GeminiLiveProvider {
  connect(callbacks: {
    onReady: (sessionId?: string) => void;
    onState: (state: VoiceLiveState, safeMessage?: string) => void;
    onUserTranscript: (text: string, partial: boolean) => void;
    onAssistantTranscript: (text: string, partial: boolean) => void;
    onAudio: (base64Audio: string, mimeType: typeof GEMINI_LIVE_OUTPUT_MIME) => void;
    onError: (errorCode: VoiceLiveErrorCode, safeMessage: string) => void;
    onClose: () => void;
  }): Promise<GeminiLiveSession>;
}

export interface GeminiLiveSession {
  sendAudio(base64Audio: string, mimeType?: string): void;
  endAudioStream(): void;
  interrupt(): void;
  close(): void;
}

export interface VoiceSocketContext {
  socket: WebSocket;
  rawData?: RawData;
}
