import {
  EDITH_VOICE_ROOM_MODEL,
  type VoiceRoomRuntimeStatus,
  type VoiceRoomState,
} from './voiceRoomService';
import {hudSafeId,hudPositiveInteger,isVoiceTaskAdmittedV1,isHudPresentationV1,type VoiceTaskAdmittedV1,type HudPresentationV1} from './taskHudContracts';

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
  | 'connector_not_implemented'
  | 'websocket_route_missing'
  | 'backend_unavailable'
  | 'websocket_upgrade_failed'
  | 'gemini_live_unavailable';

export type VoiceLiveClientEvent =
  | { type: 'session:start'; personaId?: string }
  | { type: 'audio:chunk'; audio: string; mimeType: typeof VOICE_LIVE_INPUT_MIME }
  | { type: 'session:stop' }
  | { type: 'interrupt' };

export type VoiceLiveServerEvent = ({ generation?: number } & (
  | { type: 'status'; state: VoiceRoomState; sessionId?: string; safeMessage?: string }
  | { type: 'transcript:user'; text: string; partial: boolean; utteranceId?: string }
  | { type: 'transcript:assistant'; text: string; partial: boolean }
  | { type: 'audio:chunk'; audio: string; mimeType: typeof VOICE_LIVE_OUTPUT_MIME }
  | { type: 'error'; errorCode: VoiceLiveErrorCode; safeMessage: string }
  | { type: 'session:ready'; sessionId: string; model: typeof EDITH_VOICE_ROOM_MODEL; personaId?: string }
  | { type: 'skill:result'; utteranceId: string; outcome: string; taskId?: string; skillId?: string; verificationStatus?: string; reasonCode?: string; idempotentReplay?: boolean }
  | VoiceTaskAdmittedV1
  | HudPresentationV1
  | { type: 'session:ended'; reason: string }));

export function voiceLiveSocketUrl(locationLike: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${locationLike.host}/api/voice/live/ws`;
}

export function classifyVoiceSocketFailure(params: {
  socketUrl: string;
  closeCode?: number;
  closeReason?: string;
  opened: boolean;
}): { code: VoiceLiveErrorCode; safeMessage: string } {
  const reason = params.closeReason ? ` (${params.closeReason})` : '';

  if (!params.opened) {
    return {
      code: params.socketUrl.includes(':5173/')
        ? 'websocket_upgrade_failed'
        : 'backend_unavailable',
      safeMessage: params.socketUrl.includes(':5173/')
        ? `Voice Room WebSocket upgrade failed through the Vite/Tauri dev proxy at ${params.socketUrl}.`
        : `Voice Room backend WebSocket is unavailable at ${params.socketUrl}.`,
    };
  }

  if (params.closeCode === 1006) {
    return {
      code: 'websocket_upgrade_failed',
      safeMessage: `Voice Room WebSocket closed abnormally${reason}.`,
    };
  }

  if (params.closeCode === 1008 || params.closeCode === 1011) {
    return {
      code: 'gemini_live_unavailable',
      safeMessage: `Gemini Live socket session closed by backend${reason}.`,
    };
  }

  return {
    code: 'session_error',
    safeMessage: `Voice Room socket closed${reason}.`,
  };
}

export function parseVoiceLiveServerEvent(raw: string): VoiceLiveServerEvent | undefined {
  try {
    const event = JSON.parse(raw) as Partial<VoiceLiveServerEvent>;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return undefined;
    if (event.type === 'skill:task_admitted') return isVoiceTaskAdmittedV1(event) ? event : undefined;
    if (event.type === 'hud:presentation') return isHudPresentationV1(event) ? event : undefined;

    if (event.type === 'status' && typeof event.state === 'string') return event as VoiceLiveServerEvent;
    if ((event.type === 'transcript:user' || event.type === 'transcript:assistant') && typeof event.text === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'audio:chunk' && typeof event.audio === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'error' && typeof event.errorCode === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'session:ready' && typeof event.sessionId === 'string') return event as VoiceLiveServerEvent;
    if (event.type === 'skill:result' && typeof event.utteranceId === 'string' && ['configuration_required', 'completed', 'attention_required'].includes(String(event.outcome))) {
      if (event.outcome === 'completed' && (!event.taskId || event.verificationStatus !== 'PASS')) return undefined;
      return event as VoiceLiveServerEvent;
    }
    if (event.type === 'session:ended' && typeof event.reason === 'string') return event as VoiceLiveServerEvent;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Hints are canonical-fetch locators, never task/read authority or progress snapshots.
 * Bind only after accepting the real session:ready; clear on stop, close or owner change.
 */
export class VoiceHudEventReceiver {
  private session: {voiceSessionId:string; generation:number} | null = null;
  private commandSequence = 0;
  constructor(private readonly callbacks: {
    onTaskAdmitted?:(event:Readonly<VoiceTaskAdmittedV1>)=>void;
    onPresentation?:(event:Readonly<HudPresentationV1>)=>void;
  } = {}) {}
  bindSession(voiceSessionId:string,generation:number):boolean {
    if (!hudSafeId(voiceSessionId) || !hudPositiveInteger(generation)) return false;
    if (this.session?.voiceSessionId === voiceSessionId && this.session.generation === generation) return true;
    this.session = {voiceSessionId,generation};
    this.commandSequence = 0;
    return true;
  }
  clear():void { this.session = null; this.commandSequence = 0; }
  receive(value:unknown):boolean {
    let event:unknown = value;
    if (typeof value === 'string') { try { event = JSON.parse(value); } catch { return false; } }
    if (!isVoiceTaskAdmittedV1(event) && !isHudPresentationV1(event)) return false;
    if (!this.session || event.voiceSessionId !== this.session.voiceSessionId || event.generation !== this.session.generation || event.commandSequence <= this.commandSequence) return false;
    this.commandSequence = event.commandSequence;
    const delivered = Object.freeze({...event});
    if (delivered.type === 'skill:task_admitted') this.callbacks.onTaskAdmitted?.(delivered);
    else this.callbacks.onPresentation?.(delivered);
    return true;
  }
}

export function voiceRoomStateAfterServerStatus(
  state: VoiceRoomState,
  hasQueuedPlayback: boolean,
): VoiceRoomState {
  return state === 'idle' && hasQueuedPlayback ? 'speaking' : state;
}

export function voiceRoomRuntimeStatusAfterServerState(
  state: VoiceRoomState,
  current: VoiceRoomRuntimeStatus,
  localReady = false,
): VoiceRoomRuntimeStatus {
  if (state === 'connecting') return 'connecting';
  if (state === 'disconnected') return 'offline';
  if (state === 'error') return 'error';
  if (state === 'idle' && current === 'connecting') return current;
  return localReady ? 'connected' : current === 'connecting' ? 'connecting' : 'offline';
}

/** Local truth only: backend status and socket open never grant microphone readiness. */
export class LocalVoiceSessionGate {
  private generation = 0;
  private sessionId: string | null = null;
  private serverGeneration = -1;
  private microphoneActive = false;
  begin(): number { this.stop(); return this.generation; }
  current(generation: number): boolean { return generation === this.generation; }
  acceptReady(generation: number, sessionId: string, serverGeneration: number): boolean {
    if (!this.current(generation) || !sessionId || !Number.isSafeInteger(serverGeneration) || serverGeneration < 1 || serverGeneration <= this.serverGeneration) return false;
    this.sessionId = sessionId; this.serverGeneration = serverGeneration; this.microphoneActive = false;
    return true;
  }
  activateMicrophone(generation: number, active: boolean): boolean {
    if (!this.current(generation) || !this.sessionId) return false;
    this.microphoneActive = active;
    return this.ready;
  }
  acceptsEvent(generation: number, serverGeneration: number | undefined): boolean {
    return this.current(generation) && this.ready && serverGeneration === this.serverGeneration;
  }
  ownsReady(generation: number, serverGeneration: number): boolean { return this.current(generation) && Boolean(this.sessionId) && serverGeneration === this.serverGeneration; }
  staleServerEvent(serverGeneration: number | undefined): boolean { return serverGeneration !== undefined && serverGeneration < this.serverGeneration; }
  stop(): void { this.generation++; this.sessionId = null; this.serverGeneration = -1; this.microphoneActive = false; }
  pauseMicrophone(): void { this.microphoneActive = false; }
  get ready(): boolean { return Boolean(this.sessionId && this.microphoneActive); }
}

export function voiceSocketProtocols(csrfToken: string): string[] {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(csrfToken)) throw new Error('owner_session_required');
  return ['edith.voice.v1', `csrf.${csrfToken}`];
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
