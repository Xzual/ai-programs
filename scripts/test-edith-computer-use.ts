import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import {
  createComputerUseRouter,
  computerUseStatus,
  resetComputerUseRuntimeForTests,
  validateComputerUseAction,
} from '../server/routes/computerUse';
import { createComputerOperatorEvent, operatorStateForAction } from '../src/edith/computerOperatorEvents';
import { DESKTOP_REALTIME_EVENTS, DesktopRealtimeEventStream } from '../src/edith/computerContractAdapter';
import type { DesktopObservationV2 } from '../src/edith/contracts';
import { computerTaskAcknowledgement, parseComputerCommand } from '../src/edith/computerCommandService';
import { interactionSafetyService } from '../src/edith/interactionSafetyService';
import { computerActionService } from '../src/edith/computerActionService';
import { consumeSseChunk } from '../src/edith/sseStream';
import { createKillSwitchRouter, isValidKillSwitchDeactivationConfirmation } from '../server/routes/killSwitch';
import { createOwnerSessionRouter } from '../server/security/ownerSession';

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nativeFetch(input, {
  ...init,
  signal: init?.signal ?? AbortSignal.timeout(5_000),
});

resetComputerUseRuntimeForTests();
assert.equal(validateComputerUseAction({ action: 'moveMouse', x: 100, y: 200 }), null);
assert.equal(validateComputerUseAction({ action: 'click', x: 100, y: 200, button: 'left' }), null);
assert.equal(validateComputerUseAction({ action: 'typeText', text: 'EDITH_COMPUTER_USE_OK' }), null);
assert.equal(validateComputerUseAction({ action: 'launchApp', app: 'notepad' }), null);
assert.match(validateComputerUseAction({ action: 'launchApp', app: 'powershell' }) ?? '', /allowlist/i);
assert.match(validateComputerUseAction({ action: 'shell', command: 'format' }) ?? '', /unsafe/i);
assert.equal(validateComputerUseAction({ action: 'clickMouse', x: -1, y: 2 }), null);
assert.match(validateComputerUseAction({ action: 'clickMouse', x: -40000, y: 2 }) ?? '', /virtual desktop safety range/i);
assert.match(validateComputerUseAction({ action: 'typeText', text: 'A\nB' }) ?? '', /printable/i);
assert.equal(validateComputerUseAction({ action: 'hotkey', keys: ['CTRL', 'A'] }), null);
assert.match(validateComputerUseAction({ action: 'hotkey', keys: ['CTRL', 'SHIFT', 'ESC'] }) ?? '', /cannot include/i);
assert.match(validateComputerUseAction({ action: 'hotkey', keys: ['CTRL', 'ALT', 'A'] }) ?? '', /cannot include/i);

assert.equal(operatorStateForAction('moveMouse'), 'moving');
assert.equal(operatorStateForAction('clickMouse'), 'clicking');
assert.equal(operatorStateForAction('typeText'), 'typing');
assert.equal(operatorStateForAction('scroll'), 'scrolling');
const serializedEvent = createComputerOperatorEvent('typing', 'Native typing\nstarted', { text: 'AIza-secret-value-that-must-not-appear' });
assert.equal(serializedEvent.type, 'typing');
assert.equal(serializedEvent.contractVersion, 2);
assert.equal(Number.isSafeInteger(serializedEvent.sequence), true);
assert.equal(serializedEvent.message?.includes('\n'), false);
assert.match(serializedEvent.textPreview ?? '', /^\[redacted \d+ chars\]$/);
assert.equal(JSON.stringify(serializedEvent).includes('AIza-secret'), false);
assert.equal(createComputerOperatorEvent('typing', 'Safe test', { text: 'EDITH_COMPUTER_USE_OK' }).textPreview, 'EDITH_COMPUTER_USE_OK');
assert.equal(JSON.parse(JSON.stringify(serializedEvent)).type, 'typing');
assert.equal(createComputerOperatorEvent('error', 'Safe failure').safeMessage, 'Safe failure');

assert.equal(parseComputerCommand('Computer Use çalışıyor mu?'), null);
assert.equal(parseComputerCommand('Not Defteri aç')?.kind, 'open_app');
assert.equal(parseComputerCommand('Ekrana bak')?.kind, 'observe');
assert.equal(parseComputerCommand('EDITH_COMPUTER_USE_OK yazma testi yap')?.kind, 'type_test');
const blockedPayment = parseComputerCommand('Bilgisayarı kullan ve bu ödemeyi yap');
assert.equal(blockedPayment?.kind, 'blocked');
assert.match(blockedPayment ? computerTaskAcknowledgement(blockedPayment) : '', /critical_action_blocked/);
assert.equal(parseComputerCommand('Computer Use ile bütün dosyaları kalıcı olarak sil')?.kind, 'blocked');
assert.equal(parseComputerCommand('Not Defteri aç ve şifremi yaz')?.kind, 'blocked');
assert.equal(parseComputerCommand('Kill switch devre dışı bırak')?.kind, 'blocked');
assert.equal(parseComputerCommand('Bilgisayarı kullanarak mail gönder')?.kind, 'blocked');
assert.equal(isValidKillSwitchDeactivationConfirmation(undefined), false);
assert.equal(isValidKillSwitchDeactivationConfirmation('disable'), false);
assert.equal(isValidKillSwitchDeactivationConfirmation('DISABLE_KILL_SWITCH'), true);
const partialSse = consumeSseChunk('', 'event: computer_task\ndata: {"type":"computer_');
assert.equal(partialSse.events.length, 0);
const completedSse = consumeSseChunk<{ type: string }>(partialSse.remainder, 'task"}\n\n');
assert.deepEqual(completedSse.events, [{ type: 'computer_task' }]);

let stopSignals = 0;
const app = express();
app.use(express.json());
app.use(createOwnerSessionRouter());
app.use(createComputerUseRouter({ activateStop: () => { stopSignals += 1; } }));
app.use(createKillSwitchRouter());
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const previousOwnerToken = process.env.EDITH_OWNER_TOKEN;
const previousOneTime = process.env.EDITH_OWNER_TOKEN_ONE_TIME;
const previousBridgeToken = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
const ownerToken = 'computer-use-test-owner-token';
const bridgeToken = 'computer-use-test-native-bridge-token-32';
process.env.EDITH_OWNER_TOKEN = ownerToken;
process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
process.env.EDITH_DESKTOP_BRIDGE_TOKEN = bridgeToken;

try {
  const sessionResponse = await fetch(`${base}/api/security/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, origin: base },
  });
  assert.equal(sessionResponse.status, 201);
  const sessionCookie = sessionResponse.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(sessionCookie);
  const ownerSession = await sessionResponse.json() as { session: { csrfToken: string } };
  assert.ok(ownerSession.session.csrfToken);
  const ownerHeaders = {
    'content-type': 'application/json',
    cookie: sessionCookie,
    origin: base,
    'sec-fetch-site': 'same-origin',
    'x-edith-csrf-token': ownerSession.session.csrfToken,
  };
  const desktopHeaders = { ...ownerHeaders, 'x-edith-desktop-runtime': 'tauri-v1' };

  const initialStatusResponse = await fetch(`${base}/api/computer-use/status`);
  assert.equal(initialStatusResponse.status, 200);
  const initialStatus = await initialStatusResponse.json() as Record<string, unknown>;
  assert.equal(initialStatus.available, false);
  assert.equal(initialStatus.runtime, 'browser_only');
  assert.equal(initialStatus.ownerCommandMode, false);
  assert.equal(initialStatus.skillId, 'computer_use');
  assert.equal(initialStatus.killSwitch === true || initialStatus.killSwitch === false, true);
  assert.equal(JSON.stringify(initialStatus).includes('GEMINI_API_KEY'), false);
  assert.equal(computerUseStatus({ killSwitchActive: false }).status, 'configuration_required');

  const unauthenticatedNativeSafety = await fetch(`${base}/api/computer-use/native-safety`);
  assert.equal(unauthenticatedNativeSafety.status, 401);
  const wrongNativeSafety = await fetch(`${base}/api/computer-use/native-safety`, {
    headers: { authorization: 'Bearer wrong-native-bridge-token-value' },
  });
  assert.equal(wrongNativeSafety.status, 401);
  const nativeSafety = await fetch(`${base}/api/computer-use/native-safety`, {
    headers: { authorization: `Bearer ${bridgeToken}` },
  });
  assert.equal(nativeSafety.status, 200);
  const nativeSafetyBody = await nativeSafety.json() as Record<string, unknown>;
  assert.equal(typeof nativeSafetyBody.killSwitchActive, 'boolean');
  assert.equal(JSON.stringify(nativeSafetyBody).includes(bridgeToken), false);

  const unconfirmedDeactivate = await fetch(`${base}/api/edith/kill-switch/deactivate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin: base,
      'x-edith-csrf-token': ownerSession.session.csrfToken,
    },
    body: '{}',
  });
  assert.equal(unconfirmedDeactivate.status, 409);
  assert.equal((await unconfirmedDeactivate.json() as { errorCode: string }).errorCode, 'owner_confirmation_required');

  const rejectedReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-edith-desktop-runtime': 'tauri-v1' }, body: '{}',
  });
  assert.equal(rejectedReport.status, 401);

  const wrongSessionReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST',
    headers: { ...desktopHeaders, cookie: 'edith_owner_session=forged-session' },
    body: '{}',
  });
  assert.equal(wrongSessionReport.status, 401);

  const noOriginHeaders = { ...desktopHeaders } as Record<string, string>;
  delete noOriginHeaders.origin;
  const noOriginReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: noOriginHeaders, body: '{}',
  });
  assert.equal(noOriginReport.status, 403);

  const crossOriginReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST',
    headers: { ...desktopHeaders, origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  });
  assert.equal(crossOriginReport.status, 403);

  const noCsrfHeaders = { ...desktopHeaders } as Record<string, string>;
  delete noCsrfHeaders['x-edith-csrf-token'];
  const noCsrfReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: noCsrfHeaders, body: '{}',
  });
  assert.equal(noCsrfReport.status, 403);

  const wrongCsrfReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: { ...desktopHeaders, 'x-edith-csrf-token': 'wrong-csrf' }, body: '{}',
  });
  assert.equal(wrongCsrfReport.status, 403);

  const spoofedDesktopHeader = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: ownerHeaders, body: '{}',
  });
  assert.equal(spoofedDesktopHeader.status, 403);
  assert.equal((await spoofedDesktopHeader.json() as { errorCode: string }).errorCode, 'desktop_reporter_required');

  const incompleteRuntimeReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST',
    headers: desktopHeaders,
    body: JSON.stringify({
      runtime: 'tauri', mode: 'owner_command', available: true,
      screenCapture: 'ready', mouseControl: 'error', keyboardControl: 'ready',
      ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing',
      targeting: 'window_relative_fallback', uia: 'missing', ocr: 'missing', multiMonitor: 'virtual_desktop',
      verification: 'post_observation_required',
      sessionExpiresAt: Date.now() + 60_000, safeMessage: 'Incomplete owner session.',
    }),
  });
  assert.equal(incompleteRuntimeReport.status, 200);
  assert.equal(computerUseStatus({ killSwitchActive: false }).status, 'configuration_required');

  const runtimeReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST',
    headers: desktopHeaders,
    body: JSON.stringify({
      runtime: 'tauri', mode: 'owner_command', available: true,
      screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready',
      ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing',
      targeting: 'window_relative_fallback', uia: 'missing', ocr: 'missing', multiMonitor: 'virtual_desktop',
      verification: 'post_observation_required',
      sessionExpiresAt: Date.now() + 60_000, safeMessage: 'Owner-approved local session is active.',
    }),
  });
  assert.equal(runtimeReport.status, 200);
  const reportedStatus = (await runtimeReport.json() as { status: Record<string, unknown> }).status;
  assert.equal(reportedStatus.runtime, 'tauri');
  assert.equal(reportedStatus.overlay, 'disabled');
  assert.match(JSON.stringify(reportedStatus.limitations), /virtual-desktop/i);
  assert.match(JSON.stringify(reportedStatus.limitations), /UIA and OCR semantic targeting are not connected/i);
  const unblockedReadyStatus = computerUseStatus({ killSwitchActive: false });
  assert.equal(unblockedReadyStatus.status, 'ready');
  assert.equal(unblockedReadyStatus.ownerCommandMode, true);
  const liveSafety = interactionSafetyService.snapshot();
  assert.equal(liveSafety.computer.runtimeBound, true);
  if (reportedStatus.killSwitch === true) {
    assert.equal(reportedStatus.available, false);
    assert.equal(reportedStatus.ownerCommandMode, false);
    assert.equal(reportedStatus.status, 'blocked');
    assert.equal(liveSafety.computer.mode, 'BLOCKED');
    assert.equal(computerActionService.phases().find((phase) => phase.name === 'ACT')?.status, 'blocked');
  } else {
    assert.equal(reportedStatus.available, true);
    assert.equal(reportedStatus.ownerCommandMode, true);
    assert.equal(reportedStatus.status, 'ready');
    assert.equal(liveSafety.computer.mode, 'SAFE_INTERACTION');
    assert.equal(computerActionService.phases().find((phase) => phase.name === 'ACT')?.status, 'required');
  }

  const invalid = await fetch(`${base}/api/computer-use/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'shell', command: 'format' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { errorCode: string }).errorCode, 'validation_error');

  const valid = await fetch(`${base}/api/computer-use/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'moveMouse', x: 100, y: 200 }),
  });
  assert.equal(valid.status, 409);
  assert.equal((await valid.json() as { errorCode: string }).errorCode, 'tauri_required');

  const observe = await fetch(`${base}/api/computer-use/observe`, { method: 'POST' });
  assert.equal(observe.status, 409);

  const event = createComputerOperatorEvent('clicking', 'Safe target click.', {
    x: -100,
    y: 200,
    sessionId: 'session-test',
    planId: 'plan-test',
    stepId: 'step-test',
    observationId: 'observation-test',
    actionId: 'action-test',
    verificationStatus: 'pending_post_observation',
  });
  const spoofedEvent = await fetch(`${base}/api/computer-use/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-edith-desktop-runtime': 'tauri-v1' },
    body: JSON.stringify(event),
  });
  assert.equal(spoofedEvent.status, 401);
  const eventResponse = await fetch(`${base}/api/computer-use/events`, {
    method: 'POST', headers: desktopHeaders, body: JSON.stringify(event),
  });
  assert.equal(eventResponse.status, 202);
  const events = await fetch(`${base}/api/computer-use/events`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
  assert.equal(events.events.some((entry) => entry.type === 'clicking'
    && entry.contractVersion === 2
    && entry.x === -100
    && entry.y === 200
    && entry.observationId === 'observation-test'
    && entry.actionId === 'action-test'
    && entry.verificationStatus === 'pending_post_observation'), true);
  assert.equal(JSON.stringify(events).includes('imageDataUrl'), false);

  const canonicalObservation: DesktopObservationV2 = {
    contractVersion: 2,
    amendment: '2.1',
    observationId: 'observation-realtime-test',
    sessionId: 'session-realtime-test',
    generation: 1,
    capturedAt: new Date(Date.now() - 100).toISOString(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    foreground: {
      hwndFingerprint: 'window-realtime-test',
      processId: 42,
      logicalBounds: { x: 10, y: 10, width: 800, height: 600, coordinateSpace: 'logical' },
      physicalBounds: { x: 10, y: 10, width: 800, height: 600, coordinateSpace: 'physical_virtual_desktop' },
    },
    virtualDesktop: {
      origin: { x: 0, y: 0 },
      logicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'logical' },
      physicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'physical_virtual_desktop' },
    },
    monitor: {
      monitorId: 'monitor-realtime-test',
      origin: { x: 0, y: 0 },
      logicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'logical' },
      physicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'physical_virtual_desktop' },
      dpiScale: 1,
    },
    source: 'windows_gdi_virtual_desktop',
    confidence: 1,
    capabilities: { screenshot: true, uia: false, accessibility: false, ocr: false, multiMonitor: false },
  };
  const canonicalStream = new DesktopRealtimeEventStream('desktop-stream-http-test', 'action-http-test');
  const canonicalEvent = canonicalStream.emit(DESKTOP_REALTIME_EVENTS.observation, canonicalObservation);
  const unauthenticatedCanonicalEvent = await fetch(`${base}/api/computer-use/realtime-events`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(canonicalEvent),
  });
  assert.equal(unauthenticatedCanonicalEvent.status, 401);
  const canonicalEventResponse = await fetch(`${base}/api/computer-use/realtime-events`, {
    method: 'POST', headers: desktopHeaders, body: JSON.stringify(canonicalEvent),
  });
  assert.equal(canonicalEventResponse.status, 202);
  const duplicateCanonicalEvent = await fetch(`${base}/api/computer-use/realtime-events`, {
    method: 'POST', headers: desktopHeaders, body: JSON.stringify(canonicalEvent),
  });
  assert.equal(duplicateCanonicalEvent.status, 409);
  assert.equal((await duplicateCanonicalEvent.json() as { errorCode: string }).errorCode, 'desktop_event_out_of_order');
  const pixelBearingEvent = {
    ...canonicalStream.emit(DESKTOP_REALTIME_EVENTS.observation, { ...canonicalObservation, observationId: 'observation-realtime-test-2', generation: 2 }),
    imageDataUrl: 'data:image/png;base64,PIXELS_MUST_NOT_ESCAPE',
  };
  const pixelBearingResponse = await fetch(`${base}/api/computer-use/realtime-events`, {
    method: 'POST', headers: desktopHeaders, body: JSON.stringify(pixelBearingEvent),
  });
  assert.equal(pixelBearingResponse.status, 400);
  assert.equal((await pixelBearingResponse.json() as { errorCode: string }).errorCode, 'invalid_desktop_realtime_event');
  const canonicalEvents = await fetch(`${base}/api/computer-use/realtime-events`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
  assert.equal(canonicalEvents.events.length, 1);
  assert.equal(canonicalEvents.events[0]?.event, 'desktop.observation.v2');
  assert.equal(JSON.stringify(canonicalEvents).includes('imageDataUrl'), false);
  assert.equal(JSON.stringify(canonicalEvents).includes('PIXELS_MUST_NOT_ESCAPE'), false);

  const unauthenticatedStop = await fetch(`${base}/api/computer-use/stop`, { method: 'POST' });
  assert.equal(unauthenticatedStop.status, 401);
  const stop = await fetch(`${base}/api/computer-use/stop`, { method: 'POST', headers: ownerHeaders });
  assert.equal(stop.status, 200);
  assert.equal(stopSignals, 1);
  assert.equal((await stop.json() as { stopped: boolean }).stopped, true);

  const stoppedEvents = await fetch(`${base}/api/computer-use/events`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
  assert.equal(stoppedEvents.events.some((entry) => entry.type === 'stopped'), true);
  assert.deepEqual(stoppedEvents.events.map((entry) => entry.sequence), [1, 2]);
  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'status_endpoint_honest', 'ready_requires_all_controls', 'runtime_heartbeat_local_only', 'unsafe_action_denied',
      'payload_validation', 'http_device_control_blocked', 'stop_signal_accepted',
      'overlay_events_sanitized', 'safe_command_routing', 'critical_owner_commands_blocked',
      'kill_switch_deactivation_requires_owner_confirmation',
      'owner_session_origin_csrf_required_for_desktop_reports',
      'desktop_header_spoof_rejected',
      'owner_session_required_for_stop',
      'native_safety_bridge_fail_closed',
      'virtual_desktop_negative_coordinates_supported',
      'canonical_realtime_event_order_and_redaction_enforced',
      'no_secret_in_status',
    ],
  }));
} finally {
  resetComputerUseRuntimeForTests();
  if (previousOwnerToken === undefined) delete process.env.EDITH_OWNER_TOKEN;
  else process.env.EDITH_OWNER_TOKEN = previousOwnerToken;
  if (previousOneTime === undefined) delete process.env.EDITH_OWNER_TOKEN_ONE_TIME;
  else process.env.EDITH_OWNER_TOKEN_ONE_TIME = previousOneTime;
  if (previousBridgeToken === undefined) delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
  else process.env.EDITH_DESKTOP_BRIDGE_TOKEN = previousBridgeToken;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}
