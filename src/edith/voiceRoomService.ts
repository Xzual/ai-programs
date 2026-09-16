export const EDITH_VOICE_ROOM_MODEL = 'gemini-3.1-flash-live-preview';
export const EDITH_VOICE_ROOM_ASSISTANT = 'JARVIS';

export type VoiceRoomState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'disconnected'
  | 'error';

export type VoiceRoomRuntimeStatus = 'connected' | 'connecting' | 'offline' | 'configuration_required' | 'error';

export interface VoiceRoomCapabilitySnapshot {
  assistant: typeof EDITH_VOICE_ROOM_ASSISTANT;
  model: typeof EDITH_VOICE_ROOM_MODEL;
  runtimeStatus: VoiceRoomRuntimeStatus;
  liveConnectorBound: boolean;
  geminiApiKeyConfigured: boolean;
  backendOnlyApiKey: boolean;
  frontendCanReadApiKey: false;
  localSpeechRecognitionSupported: boolean;
  wakeWordEnabled: false;
  ttsOutputConnected: boolean;
  bargeInEnabled: boolean;
  statusMessage: string;
}

export const voiceRoomStateLabel: Record<VoiceRoomState, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  muted: 'Muted',
  disconnected: 'Offline',
  error: 'Error',
};

export function detectVoiceRoomSpeechSupport(targetWindow: Record<string, unknown> | undefined = typeof window !== 'undefined' ? window as any : undefined): boolean {
  try {
    return Boolean(targetWindow && ('SpeechRecognition' in targetWindow || 'webkitSpeechRecognition' in targetWindow));
  } catch {
    return false;
  }
}

export function getVoiceRoomCapabilitySnapshot(options: {
  localSpeechRecognitionSupported?: boolean;
  liveConnectorBound?: boolean;
  geminiApiKeyConfigured?: boolean;
  ttsOutputConnected?: boolean;
  bargeInEnabled?: boolean;
  runtimeStatus?: VoiceRoomRuntimeStatus;
  statusMessage?: string;
} = {}): VoiceRoomCapabilitySnapshot {
  const liveConnectorBound = Boolean(options.liveConnectorBound);
  const geminiApiKeyConfigured = Boolean(options.geminiApiKeyConfigured);
  const runtimeStatus: VoiceRoomRuntimeStatus = options.runtimeStatus
    ?? (liveConnectorBound ? 'connected' : geminiApiKeyConfigured ? 'offline' : 'configuration_required');

  return {
    assistant: EDITH_VOICE_ROOM_ASSISTANT,
    model: EDITH_VOICE_ROOM_MODEL,
    runtimeStatus,
    liveConnectorBound,
    geminiApiKeyConfigured,
    backendOnlyApiKey: true,
    frontendCanReadApiKey: false,
    localSpeechRecognitionSupported: Boolean(options.localSpeechRecognitionSupported),
    wakeWordEnabled: false,
    ttsOutputConnected: Boolean(options.ttsOutputConnected && liveConnectorBound),
    bargeInEnabled: Boolean(options.bargeInEnabled && liveConnectorBound),
    statusMessage: options.statusMessage ?? (liveConnectorBound
      ? 'Gemini Live voice connector is available through the backend.'
      : 'Gemini Live voice connector is not wired yet. No cloud voice session has been opened.'),
  };
}

export function normalizeVoiceRoomStatusPayload(payload: unknown, localSpeechRecognitionSupported: boolean): VoiceRoomCapabilitySnapshot {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const runtimeStatus = record.runtimeStatus === 'connected' ||
    record.runtimeStatus === 'connecting' ||
    record.runtimeStatus === 'offline' ||
    record.runtimeStatus === 'configuration_required' ||
    record.runtimeStatus === 'error'
    ? record.runtimeStatus
    : undefined;

  return getVoiceRoomCapabilitySnapshot({
    localSpeechRecognitionSupported,
    liveConnectorBound: record.liveConnectorBound === true,
    geminiApiKeyConfigured: record.geminiApiKeyConfigured === true || record.keyPresent === true || record.configured === true,
    ttsOutputConnected: record.ttsOutputConnected === true,
    bargeInEnabled: record.bargeInEnabled === true,
    runtimeStatus,
    statusMessage: typeof record.safeMessage === 'string'
      ? record.safeMessage
      : typeof record.message === 'string'
      ? record.message
      : undefined,
  });
}

export function getVoiceRoomTranscriptFallback(): string {
  return 'Transcript captured locally. Gemini Live backend is unavailable, so no voice response was generated.';
}
