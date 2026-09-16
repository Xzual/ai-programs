import {
  EDITH_VOICE_ROOM_MODEL,
  type VoiceRoomState,
} from './voiceRoomService';

export const VOICE_LIVE_INPUT_MIME = 'audio/pcm;rate=16000';
export const VOICE_LIVE_OUTPUT_MIME = 'audio/pcm;rate=24000';
export const VOICE_LIVE_INPUT_RATE = 16000;
export const VOICE_LIVE_OUTPUT_RATE = 24000;

export type VoiceLiveErrorCode =
  | 'configuration_required'
  | 'invalid_api_key'
  | 'live_model_unavailable'
  | 'mic_permission_denied'
  | 'audio_format_error'
  | 'network_error'
  | 'session_error'
  | 'connector_not_implemented';

export type VoiceLiveClientEvent =
  | { type: 'session:start' }
  | { type: 'audio:chunk'; audio: string; mimeType: typeof VOICE_LIVE_INPUT_MIME }
  | { type: 'session:stop' }
  | { type: 'interrupt' };

export type VoiceLiveServerEvent =
  | { type: 'status'; state: VoiceRoomState; sessionId?: string; safeMessage?: string }
  | { type: 'transcript:user'; text: string; partial: boolean }
  | { type: 'transcript:assistant'; text: string; partial: boolean }
  | { type: 'audio:chunk'; audio: string; mimeType: typeof VOICE_LIVE_OUTPUT_MIME }
  | { type: 'error'; errorCode: VoiceLiveErrorCode; safeMessage: string }
  | { type: 'session:ready'; sessionId: string; model: typeof EDITH_VOICE_ROOM_MODEL }
  | { type: 'session:ended'; reason: string };

export function voiceLiveSocketUrl(locationLike: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${locationLike.host}/api/voice/live/ws`;
}

export function parseVoiceLiveServerEvent(raw: string): VoiceLiveServerEvent | undefined {
  try {
    const event = JSON.parse(raw) as Partial<VoiceLiveServerEvent>;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return undefined;

    if (event.type === 'status' && typeof event.state === 'string') return event as VoiceLiveServerEvent;
    if ((event.type === 'transcript:user' || event.type === 'transcript:assistant') && typeof event.text === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'audio:chunk' && typeof event.audio === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'error' && typeof event.errorCode === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'session:ready' && typeof event.sessionId === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'session:ended' && typeof event.reason === 'string') return event as VoiceLiveServerEvent;
    return undefined;
  } catch {
    return undefined;
  }
}

export function int16PcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToInt16Pcm(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function downsampleFloat32ToInt16Pcm(input: Float32Array, inputSampleRate: number, outputSampleRate = VOICE_LIVE_INPUT_RATE): Int16Array {
  if (outputSampleRate === inputSampleRate) {
    return float32ToInt16Pcm(input);
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = count ? sum / count : input[start] ?? 0;
  }

  return float32ToInt16Pcm(output);
}

function float32ToInt16Pcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}
