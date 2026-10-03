import assert from 'node:assert/strict';
import {
  DESKTOP_REALTIME_EVENTS,
  ComputerContractError,
  DesktopActionIdempotencyLedger,
  DesktopRealtimeEventStream,
  toActionDispatchV2,
  toActionVerificationV2,
  toDesktopActionV2,
  toDesktopObservationV2,
  toDesktopOperatorSessionV2,
  toFailedActionDispatchV2,
  toPendingActionVerificationV2,
  toRetryDecisionV2,
  toScopedApprovalV2,
} from '../src/edith/computerContractAdapter';
import type {
  ComputerActionResult,
  ComputerDesktopStatus,
  ComputerObservation,
} from '../src/edith/computerDesktopClient';

const now = Date.now();
const sessionId = 'computer-contract-test-session';
const status: ComputerDesktopStatus = {
  runtime: 'tauri', mode: 'owner_command', available: true,
  screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready',
  ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing',
  targeting: 'window_relative_fallback', uia: 'missing', ocr: 'missing',
  multiMonitor: 'virtual_desktop', verification: 'post_observation_required',
  sessionExpiresAt: now + 60_000, safeMessage: 'Approved fixture session.',
};
const wire: ComputerObservation = {
  observationId: 'observation-contract-7', generation: 7,
  imageDataUrl: 'data:image/png;base64,PIXELS_MUST_NOT_ESCAPE',
  originX: -1920, originY: 0, width: 3840, height: 1080,
  cursorX: -1400, cursorY: 400, capturedAt: now - 100, expiresAt: now + 15_000,
  source: 'windows_gdi_virtual_desktop', confidence: 1,
  windowId: 'hwnd-fingerprint-contract', windowProcessId: 42,
  windowBounds: { x: -1600, y: 100, width: 1000, height: 750 },
  monitorId: 'monitor-negative-origin', monitorBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1.25, coordinateSpace: 'physical_virtual_desktop',
  uiaAvailable: false, ocrAvailable: false,
};

const initialSession = toDesktopOperatorSessionV2(status, { sessionId, startedAt: now - 1_000 }, wire, now);
const observation = toDesktopObservationV2(wire, initialSession, now);
const session = { ...initialSession, currentObservationId: observation.observationId, currentGeneration: observation.generation };
const approval = toScopedApprovalV2(session, observation, now);
assert.equal(observation.virtualDesktop.origin.x, -1920);
assert.equal(observation.foreground.logicalBounds.width, 800);
assert.equal(observation.capabilities.uia, false);
assert.equal(approval.scope.physicalBounds?.x, -1600);

const typedSecret = 'TOP_SECRET_VALUE';
const action = await toDesktopActionV2({ action: 'typeText', text: typedSecret }, { session, observation, approval }, {
  actionId: 'action-contract-1', idempotencyKey: 'desktop-idem-contract-1', attempt: 1,
}, now);
assert.equal('text' in action, false);
assert.equal(action.textLength, typedSecret.length);
assert.equal(action.textFingerprint?.length, 64);
assert.equal(JSON.stringify(action).includes(typedSecret), false);

await assert.rejects(
  () => toDesktopActionV2({ action: 'moveMouse', x: -1400, y: 400 }, {
    session,
    observation: { ...observation, generation: 6 },
    approval,
  }, {}, now),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'DESKTOP_ACTION_APPROVAL_MISMATCH',
);

const nativeResult: ComputerActionResult = {
  actionId: action.actionId, planId: 'plan-contract', stepId: action.actionId,
  action: 'typeText', injected: true, dispatchStatus: 'dispatched', cursorX: -1400, cursorY: 400,
  verification: 'input_injected_outcome_unverified', verificationStatus: 'partial',
  preObservationId: observation.observationId, postObservationId: 'observation-contract-8', attempts: 1,
};
const dispatch = toActionDispatchV2(action, nativeResult, now);
const postObservation = toDesktopObservationV2({
  ...wire,
  observationId: 'observation-contract-8',
  generation: 8,
  capturedAt: now + 100,
  expiresAt: now + 15_000,
}, { ...session, currentObservationId: 'observation-contract-8', currentGeneration: 8 }, now);
const verification = toActionVerificationV2(action, dispatch, nativeResult, postObservation, now);
const retryDecision = toRetryDecisionV2(action, verification, now);
assert.equal(dispatch.status, 'dispatched');
assert.equal(verification.status, 'partial');
assert.equal(retryDecision.decision, 'reobserve');
assert.equal(retryDecision.requiresFreshObservation, true);
const failedDispatch = toFailedActionDispatchV2(action, 'NATIVE_DISPATCH_FAILED', now);
const pendingVerification = toPendingActionVerificationV2(action, failedDispatch, 'NATIVE_DISPATCH_FAILED', now);
const failedRetryDecision = toRetryDecisionV2(action, pendingVerification, now);
assert.equal(failedDispatch.status, 'failed');
assert.equal(pendingVerification.status, 'pending_post_observation');
assert.equal(failedRetryDecision.decision, 'reobserve');

let executions = 0;
const ledger = new DesktopActionIdempotencyLedger<string>();
const first = ledger.run(action, async () => { executions += 1; return 'dispatch-record-1'; });
const duplicate = ledger.run(action, async () => { executions += 1; return 'must-not-run'; });
assert.equal(first.replayed, false);
assert.equal(duplicate.replayed, true);
assert.equal(await first.result, 'dispatch-record-1');
assert.equal(await duplicate.result, 'dispatch-record-1');
assert.equal(executions, 1);
assert.throws(
  () => ledger.run({ ...action, actionId: 'action-contract-conflict' }, async () => 'conflict'),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'IDEMPOTENCY_KEY_CONFLICT',
);
assert.throws(
  () => ledger.run({ ...action, textLength: (action.textLength ?? 0) + 1 }, async () => 'parameter-conflict'),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'IDEMPOTENCY_KEY_CONFLICT',
);

const stream = new DesktopRealtimeEventStream('desktop-stream-contract', action.actionId);
const events = [
  stream.emit(DESKTOP_REALTIME_EVENTS.observation, observation),
  stream.emit(DESKTOP_REALTIME_EVENTS.actionRequested, action),
  stream.emit(DESKTOP_REALTIME_EVENTS.dispatch, dispatch),
  stream.emit(DESKTOP_REALTIME_EVENTS.verification, verification),
  stream.emit(DESKTOP_REALTIME_EVENTS.retryDecision, retryDecision),
];
assert.deepEqual(events.map((event) => event.cursor), [1, 2, 3, 4, 5]);
assert.deepEqual(events.map((event) => event.event), [
  'desktop.observation.v2',
  'desktop.action.requested.v2',
  'desktop.action.dispatch.v2',
  'desktop.action.verification.v2',
  'desktop.retry.decision.v2',
]);
const serializedEvents = JSON.stringify(events);
assert.equal(serializedEvents.includes('imageDataUrl'), false);
assert.equal(serializedEvents.includes('PIXELS_MUST_NOT_ESCAPE'), false);
assert.equal(serializedEvents.includes(typedSecret), false);

console.log(JSON.stringify({
  success: true,
  checks: [
    'wire_to_v21_session_observation_approval',
    'timestamp_and_dpi_boundary_conversion',
    'raw_typed_text_redacted_to_sha256_fingerprint',
    'canonical_generation_and_approval_fail_closed',
    'dispatch_is_not_effect_verification',
    'partial_verification_requires_reobserve',
    'failed_dispatch_completes_fail_closed_lifecycle',
    'idempotency_duplicate_executes_once',
    'idempotency_conflict_rejected',
    'idempotency_parameter_rebind_rejected',
    'ordered_desktop_realtime_lifecycle',
    'screenshot_pixels_and_typed_secret_absent_from_events',
  ],
}, null, 2));
