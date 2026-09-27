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
import { computerTaskAcknowledgement, parseComputerCommand } from '../src/edith/computerCommandService';
import { interactionSafetyService } from '../src/edith/interactionSafetyService';
import { computerActionService } from '../src/edith/computerActionService';
import { consumeSseChunk } from '../src/edith/sseStream';
import { createKillSwitchRouter, isValidKillSwitchDeactivationConfirmation } from '../server/routes/killSwitch';

resetComputerUseRuntimeForTests();
assert.equal(validateComputerUseAction({ action: 'moveMouse', x: 100, y: 200 }), null);
assert.equal(validateComputerUseAction({ action: 'click', x: 100, y: 200, button: 'left' }), null);
assert.equal(validateComputerUseAction({ action: 'typeText', text: 'EDITH_COMPUTER_USE_OK' }), null);
assert.equal(validateComputerUseAction({ action: 'launchApp', app: 'notepad' }), null);
assert.match(validateComputerUseAction({ action: 'launchApp', app: 'powershell' }) ?? '', /allowlist/i);
assert.match(validateComputerUseAction({ action: 'shell', command: 'format' }) ?? '', /unsafe/i);
assert.match(validateComputerUseAction({ action: 'clickMouse', x: -1, y: 2 }) ?? '', /nonnegative/i);
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
app.use(createComputerUseRouter({ activateStop: () => { stopSignals += 1; } }));
app.use(createKillSwitchRouter());
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const desktopHeaders = { 'content-type': 'application/json', 'x-edith-desktop-runtime': 'tauri-v1' };

try {
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

  const unconfirmedDeactivate = await fetch(`${base}/api/edith/kill-switch/deactivate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(unconfirmedDeactivate.status, 409);
  assert.equal((await unconfirmedDeactivate.json() as { errorCode: string }).errorCode, 'owner_confirmation_required');

  const rejectedReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(rejectedReport.status, 403);

  const incompleteRuntimeReport = await fetch(`${base}/api/computer-use/runtime`, {
    method: 'POST',
    headers: desktopHeaders,
    body: JSON.stringify({
      runtime: 'tauri', mode: 'owner_command', available: true,
      screenCapture: 'ready', mouseControl: 'error', keyboardControl: 'ready',
      ownerCommandMode: true, killSwitch: 'inactive', overlay: 'in_app',
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
      ownerCommandMode: true, killSwitch: 'inactive', overlay: 'in_app',
      sessionExpiresAt: Date.now() + 60_000, safeMessage: 'Owner-approved local session is active.',
    }),
  });
  assert.equal(runtimeReport.status, 200);
  const reportedStatus = (await runtimeReport.json() as { status: Record<string, unknown> }).status;
  assert.equal(reportedStatus.runtime, 'tauri');
  assert.equal(reportedStatus.overlay, 'ready');
  assert.match(JSON.stringify(reportedStatus.limitations), /primary display/i);
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

  const event = createComputerOperatorEvent('clicking', 'Safe target click.', { x: 100, y: 200 });
  const eventResponse = await fetch(`${base}/api/computer-use/events`, {
    method: 'POST', headers: desktopHeaders, body: JSON.stringify(event),
  });
  assert.equal(eventResponse.status, 202);
  const events = await fetch(`${base}/api/computer-use/events`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
  assert.equal(events.events.some((entry) => entry.type === 'clicking' && entry.x === 100 && entry.y === 200), true);
  assert.equal(JSON.stringify(events).includes('imageDataUrl'), false);

  const stop = await fetch(`${base}/api/computer-use/stop`, { method: 'POST' });
  assert.equal(stop.status, 200);
  assert.equal(stopSignals, 1);
  assert.equal((await stop.json() as { stopped: boolean }).stopped, true);

  const stoppedEvents = await fetch(`${base}/api/computer-use/events`).then((response) => response.json()) as { events: Array<Record<string, unknown>> };
  assert.equal(stoppedEvents.events.some((entry) => entry.type === 'stopped'), true);
  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'status_endpoint_honest', 'ready_requires_all_controls', 'runtime_heartbeat_local_only', 'unsafe_action_denied',
      'payload_validation', 'http_device_control_blocked', 'stop_signal_accepted',
      'overlay_events_sanitized', 'safe_command_routing', 'critical_owner_commands_blocked',
      'kill_switch_deactivation_requires_owner_confirmation',
      'no_secret_in_status',
    ],
  }));
} finally {
  resetComputerUseRuntimeForTests();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
