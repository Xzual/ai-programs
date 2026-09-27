import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import {
  EDITH_VOICE_ROOM_ASSISTANT,
  EDITH_VOICE_ROOM_MODEL,
  getVoiceRoomCapabilitySnapshot,
  getVoiceRoomTranscriptFallback,
  normalizeVoiceRoomStatusPayload,
  voiceRoomStateLabel,
} from '../src/edith/voiceRoomService';
import {
  classifyVoiceSocketFailure,
  downsampleFloat32ToInt16Pcm,
  parseVoiceLiveServerEvent,
  VOICE_LIVE_INPUT_MIME,
  VOICE_LIVE_OUTPUT_MIME,
  voiceRoomRuntimeStatusAfterServerState,
  voiceRoomStateAfterServerStatus,
  voiceLiveSocketUrl,
} from '../src/edith/voiceLiveClient';
import { ManagedVoiceSession, voiceSessionManager } from '../server/voice/voiceSessionManager';
import type { GeminiLiveCallbacks, GeminiLiveProvider, GeminiLiveSession } from '../server/voice/types';
import { EDITH_CORE_PROTOCOL_VERSION } from '../src/edith/coreBehaviorProtocol';

const offline = getVoiceRoomCapabilitySnapshot({ localSpeechRecognitionSupported: false });

assert.equal(offline.assistant, EDITH_VOICE_ROOM_ASSISTANT);
assert.equal(offline.assistant, 'JARVIS');
assert.equal(offline.model, EDITH_VOICE_ROOM_MODEL);
assert.equal(offline.model, 'gemini-3.1-flash-live-preview');
assert.equal(offline.runtimeStatus, 'configuration_required');
assert.equal(offline.liveConnectorBound, false);
assert.equal(offline.geminiApiKeyConfigured, false);
assert.equal(offline.backendOnlyApiKey, true);
assert.equal(offline.frontendCanReadApiKey, false);
assert.equal(offline.wakeWordEnabled, false);
assert.equal(offline.ttsOutputConnected, false);
assert.equal(offline.bargeInEnabled, false);
assert.match(offline.statusMessage, /not wired/i);

const connected = getVoiceRoomCapabilitySnapshot({
  localSpeechRecognitionSupported: true,
  liveConnectorBound: true,
  ttsOutputConnected: true,
  bargeInEnabled: true,
});

assert.equal(connected.runtimeStatus, 'connected');
assert.equal(connected.ttsOutputConnected, true);
assert.equal(connected.bargeInEnabled, true);
assert.equal(connected.frontendCanReadApiKey, false);

assert.equal(voiceRoomStateLabel.idle, 'Idle');
assert.equal(voiceRoomStateLabel.listening, 'Listening');
assert.equal(voiceRoomStateLabel.thinking, 'Thinking');
assert.equal(voiceRoomStateLabel.speaking, 'Speaking');
assert.match(getVoiceRoomTranscriptFallback(), /Gemini Live backend is unavailable/i);

const backendStatus = normalizeVoiceRoomStatusPayload({
  success: true,
  runtimeStatus: 'configuration_required',
  geminiApiKeyConfigured: false,
  frontendCanReadApiKey: false,
  liveConnectorBound: false,
  wakeWordEnabled: false,
  ttsOutputConnected: false,
  bargeInEnabled: false,
  message: 'Gemini Live voice connector is not wired yet. No cloud voice session has been opened.',
}, true);

assert.equal(backendStatus.runtimeStatus, 'configuration_required');
assert.equal(backendStatus.localSpeechRecognitionSupported, true);
assert.equal(backendStatus.frontendCanReadApiKey, false);
assert.equal(backendStatus.liveConnectorBound, false);

voiceSessionManager.setCapabilityContextProvider(() => '{"ready":["voice_room"]}');
const liveStatus = voiceSessionManager.status();
assert.equal(liveStatus.model, 'gemini-3.1-flash-live-preview');
assert.equal(liveStatus.secretExposed, false);
assert.equal(liveStatus.frontendCanReadApiKey, false);
assert.equal(liveStatus.capabilityContextBound, true);
assert.equal(liveStatus.keyPresent, Boolean(process.env.GEMINI_API_KEY));
assert.equal('apiKey' in liveStatus, false);
assert.equal('GEMINI_API_KEY' in liveStatus, false);

const socketServer = createServer();
voiceSessionManager.handleUpgrade(socketServer);
await new Promise<void>((resolve) => socketServer.listen(0, '127.0.0.1', resolve));
const address = socketServer.address() as AddressInfo;
const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/voice/live/ws`);
try {
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  assert.equal(voiceSessionManager.status().connected, false, 'An open socket is not a ready Gemini Live session.');
} finally {
  socket.close();
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
}

assert.deepEqual(parseVoiceLiveServerEvent(JSON.stringify({ type: 'status', state: 'listening' })), {
  type: 'status',
  state: 'listening',
});
assert.equal(parseVoiceLiveServerEvent('not-json'), undefined);
assert.equal(parseVoiceLiveServerEvent(JSON.stringify({ type: 'audio:chunk', audio: 'AA==', mimeType: VOICE_LIVE_OUTPUT_MIME }))?.type, 'audio:chunk');
assert.equal(voiceLiveSocketUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/api/voice/live/ws');
assert.equal(voiceLiveSocketUrl({ protocol: 'https:', host: 'edith.local' }), 'wss://edith.local/api/voice/live/ws');
assert.deepEqual(
  classifyVoiceSocketFailure({ socketUrl: 'ws://localhost:5173/api/voice/live/ws', opened: false }).code,
  'websocket_upgrade_failed',
);
assert.deepEqual(
  classifyVoiceSocketFailure({ socketUrl: 'ws://localhost:3000/api/voice/live/ws', opened: false }).code,
  'backend_unavailable',
);
assert.equal(VOICE_LIVE_INPUT_MIME, 'audio/pcm;rate=16000');
assert.equal(VOICE_LIVE_OUTPUT_MIME, 'audio/pcm;rate=24000');
assert.equal(voiceRoomStateAfterServerStatus('idle', true), 'speaking');
assert.equal(voiceRoomStateAfterServerStatus('idle', false), 'idle');
assert.equal(voiceRoomRuntimeStatusAfterServerState('connecting', 'connected'), 'connecting');
assert.equal(voiceRoomRuntimeStatusAfterServerState('idle', 'connecting'), 'connecting');
assert.equal(voiceRoomRuntimeStatusAfterServerState('idle', 'connected'), 'connected');

const managedEvents: Array<Record<string, unknown>> = [];
const managedCallbackHistory: GeminiLiveCallbacks[] = [];
let managedConnectCount = 0;
let managedCloseCount = 0;
let managedSystemInstruction = '';
const managedSocket = {
  readyState: WebSocket.OPEN,
  send(payload: string) {
    managedEvents.push(JSON.parse(payload));
  },
} as unknown as WebSocket;
const fakeLiveSession: GeminiLiveSession = {
  sendAudio() {},
  endAudioStream() {},
  close() {
    managedCloseCount += 1;
  },
};
const fakeProvider: GeminiLiveProvider = {
  async connect(callbacks, options) {
    managedConnectCount += 1;
    managedSystemInstruction = options?.systemInstruction ?? '';
    managedCallbackHistory.push(callbacks);
    callbacks.onReady(`test-session-${managedConnectCount}`);
    callbacks.onState('listening');
    return fakeLiveSession;
  },
};
const managedSession = new ManagedVoiceSession(
  managedSocket,
  () => fakeProvider,
  () => 'E.D.I.T.H. COMPACT RUNTIME CONTEXT\n- Ready skills: Voice Room.',
);
await managedSession.start();
assert.equal(managedSystemInstruction.includes(`CORE BEHAVIOR PROTOCOL v${EDITH_CORE_PROTOCOL_VERSION}`), true);
assert.equal(managedSystemInstruction.includes('E.D.I.T.H. COMPACT RUNTIME CONTEXT'), true);
assert.equal(managedSystemInstruction.includes('Never invent a skill, tool'), true);
managedEvents.length = 0;
managedCallbackHistory[0]?.onState('thinking');
managedSession.handleMessage(Buffer.from(JSON.stringify({
  type: 'audio:chunk',
  audio: 'AA==',
  mimeType: VOICE_LIVE_INPUT_MIME,
})));
assert.deepEqual(
  managedEvents.filter((event) => event.type === 'status').map((event) => event.state),
  ['thinking'],
  'Continuous microphone chunks must not overwrite Gemini thinking/speaking state.',
);
managedEvents.length = 0;
managedSession.interrupt();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(managedConnectCount, 2, 'Interrupt should replace the Gemini Live transport.');
assert.equal(managedCloseCount, 1, 'Interrupt should close the previous Gemini Live transport.');
managedCallbackHistory[0]?.onClose();
assert.equal(
  managedEvents.some((event) => event.type === 'status' && event.state === 'disconnected'),
  false,
  'Callbacks from the interrupted transport must not disconnect the replacement session.',
);
managedSession.stop('test_complete');

const pcm = downsampleFloat32ToInt16Pcm(new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]), 48000, 16000);
assert.equal(pcm.length, 2);
assert.ok(pcm[0] !== undefined);

console.log(JSON.stringify({
  success: true,
  scenarios: [
    'voice_room_uses_jarvis_and_gemini_live_preview_model',
    'voice_room_configuration_required_without_backend_key',
    'voice_room_frontend_has_no_api_key_access',
    'voice_room_wake_word_barge_in_and_tts_blocked_until_live_connector',
    'voice_room_backend_status_payload_normalized_without_key_exposure',
    'voice_room_status_manager_never_exposes_api_key',
    'voice_room_capability_context_provider_bound',
    'voice_room_uses_shared_edith_core_protocol',
    'voice_room_socket_without_live_session_is_not_connected',
    'voice_room_frontend_service_event_parsing_and_pcm_conversion',
    'voice_room_websocket_url_and_failure_codes',
    'voice_room_audio_chunks_do_not_overwrite_provider_state',
    'voice_room_stays_speaking_until_pcm_playback_drains',
    'voice_room_interrupt_replaces_live_transport_without_stale_callbacks',
    'voice_room_animation_states_declared',
  ],
}, null, 2));
