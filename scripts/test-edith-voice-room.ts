import assert from 'node:assert/strict';
import {
  EDITH_VOICE_ROOM_ASSISTANT,
  EDITH_VOICE_ROOM_MODEL,
  getVoiceRoomCapabilitySnapshot,
  getVoiceRoomTranscriptFallback,
  normalizeVoiceRoomStatusPayload,
  voiceRoomStateLabel,
} from '../src/edith/voiceRoomService';
import {
  downsampleFloat32ToInt16Pcm,
  parseVoiceLiveServerEvent,
  VOICE_LIVE_INPUT_MIME,
  VOICE_LIVE_OUTPUT_MIME,
  voiceLiveSocketUrl,
} from '../src/edith/voiceLiveClient';
import { voiceSessionManager } from '../server/voice/voiceSessionManager';

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

const liveStatus = voiceSessionManager.status();
assert.equal(liveStatus.model, 'gemini-3.1-flash-live-preview');
assert.equal(liveStatus.secretExposed, false);
assert.equal(liveStatus.frontendCanReadApiKey, false);
assert.equal(liveStatus.keyPresent, Boolean(process.env.GEMINI_API_KEY));
assert.equal('apiKey' in liveStatus, false);
assert.equal('GEMINI_API_KEY' in liveStatus, false);

assert.deepEqual(parseVoiceLiveServerEvent(JSON.stringify({ type: 'status', state: 'listening' })), {
  type: 'status',
  state: 'listening',
});
assert.equal(parseVoiceLiveServerEvent('not-json'), undefined);
assert.equal(parseVoiceLiveServerEvent(JSON.stringify({ type: 'audio:chunk', audio: 'AA==', mimeType: VOICE_LIVE_OUTPUT_MIME }))?.type, 'audio:chunk');
assert.equal(voiceLiveSocketUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/api/voice/live/ws');
assert.equal(VOICE_LIVE_INPUT_MIME, 'audio/pcm;rate=16000');
assert.equal(VOICE_LIVE_OUTPUT_MIME, 'audio/pcm;rate=24000');

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
    'voice_room_frontend_service_event_parsing_and_pcm_conversion',
    'voice_room_animation_states_declared',
  ],
}, null, 2));
