import { invokeDesktopCommand, isTauriShell } from './desktopShell';
import { ownerMutationFetch } from './ownerMutationClient';
import type { ComputerOperatorEvent } from './computerOperatorEvents';
import type { SafeDesktopApp } from './computerCommandService';
import {
  DESKTOP_REALTIME_EVENTS,
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
  type CanonicalActionLifecycle,
} from './computerContractAdapter';
import type {
  DesktopObservationV2,
  DesktopOperatorSessionV2,
  ScopedApprovalV2,
  TypedRealtimeEnvelopeV2,
} from './contracts';

export interface ComputerDesktopStatus {
  runtime: 'tauri' | 'unbound';
  mode: 'read_only' | 'owner_command' | 'disabled' | 'error';
  available: boolean;
  screenCapture: 'ready' | 'missing' | 'permission_required' | 'error';
  mouseControl: 'ready' | 'missing' | 'permission_required' | 'error';
  keyboardControl: 'ready' | 'missing' | 'permission_required' | 'error';
  ownerCommandMode: boolean;
  killSwitch: 'active' | 'inactive' | 'unknown';
  overlay: 'in_app' | 'missing';
  targeting?: 'window_relative_fallback' | 'uia_first';
  uia?: 'ready' | 'missing';
  ocr?: 'ready' | 'missing';
  multiMonitor?: 'virtual_desktop' | 'missing';
  verification?: 'post_observation_required' | 'unavailable';
  sessionExpiresAt?: number;
  safeMessage: string;
  lastError?: string | null;
}

export interface ComputerObservation {
  observationId: string;
  generation: number;
  imageDataUrl: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  capturedAt: number;
  expiresAt: number;
  source: string;
  confidence: number;
  windowId: string;
  windowProcessId: number;
  windowBounds: { x: number; y: number; width: number; height: number };
  monitorId: string;
  monitorBounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  coordinateSpace: 'physical_virtual_desktop';
  uiaAvailable: boolean;
  ocrAvailable: boolean;
}

type ComputerDesktopActionPayload =
  | { action: 'moveMouse' | 'clickMouse'; x: number; y: number; button?: 'left' | 'right' }
  | { action: 'typeText'; text: string }
  | { action: 'pressKey'; key: string }
  | { action: 'hotkey'; keys: string[] }
  | { action: 'scroll'; delta: number }
  | { action: 'launchApp'; app: SafeDesktopApp };

export type ComputerDesktopAction = ComputerDesktopActionPayload & {
  actionId?: string;
  idempotencyKey?: string;
  attempt?: 1 | 2;
};

export interface ComputerActionResult {
  actionId: string;
  planId: string;
  stepId: string;
  action: string;
  injected: boolean;
  dispatchStatus: 'dispatched';
  cursorX: number;
  cursorY: number;
  verification: 'cursor_position_confirmed' | 'input_injected_outcome_unverified' | 'process_started' | 'post_observation_changed';
  verificationStatus: 'verified' | 'partial' | 'pending_post_observation';
  preObservationId: string;
  postObservationId?: string;
  attempts: number;
  idempotencyReplayed?: boolean;
  canonicalLifecycle?: CanonicalActionLifecycle;
}

const browserStatus: ComputerDesktopStatus = {
  runtime: 'unbound', mode: 'read_only', available: false,
  screenCapture: 'missing', mouseControl: 'missing', keyboardControl: 'missing',
  ownerCommandMode: false, overlay: 'missing',
  killSwitch: 'unknown',
  safeMessage: 'Desktop Computer Use requires the Tauri application.',
};

const latestObservation = new Map<string, ComputerObservation>();
interface ActiveCanonicalSession {
  startedAt: number;
  session: DesktopOperatorSessionV2;
  observation?: DesktopObservationV2;
  approval?: ScopedApprovalV2;
  stream: DesktopRealtimeEventStream;
}

const canonicalSessions = new Map<string, ActiveCanonicalSession>();
const actionLedger = new DesktopActionIdempotencyLedger<ComputerActionResult>();

async function invokeRequired<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriShell()) throw new Error(browserStatus.safeMessage);
  const result = await invokeDesktopCommand<T>(command, args);
  if (result === undefined) throw new Error(`Desktop command ${command} returned no result.`);
  return result;
}

export async function getComputerDesktopStatus(): Promise<ComputerDesktopStatus> {
  return isTauriShell() ? invokeRequired('computer_status') : browserStatus;
}

export async function beginComputerSession(): Promise<string> {
  const startedAt = Date.now();
  const sessionId = await invokeRequired<string>('computer_begin');
  const status = await getComputerDesktopStatus();
  const session = toDesktopOperatorSessionV2(status, { sessionId, startedAt }, undefined, Date.now());
  canonicalSessions.set(sessionId, {
    startedAt,
    session,
    stream: new DesktopRealtimeEventStream(`desktop-${sessionId}`, sessionId),
  });
  return sessionId;
}

async function captureComputer(
  sessionId: string,
  command: 'computer_observe' | 'computer_screenshot',
  reportObservation: boolean,
): Promise<{ wire: ComputerObservation; canonical: DesktopObservationV2 }> {
  const active = canonicalSessions.get(sessionId);
  if (!active) throw new Error('desktop_contract_session_missing: start an approved session first.');
  const wire = await invokeRequired<ComputerObservation>(command, { sessionId });
  const status = await getComputerDesktopStatus();
  const session = toDesktopOperatorSessionV2(status, { sessionId, startedAt: active.startedAt }, wire, Date.now());
  const canonical = toDesktopObservationV2(wire, session, Date.now());
  const approval = toScopedApprovalV2(session, canonical, Date.now());
  active.session = { ...session, currentObservationId: canonical.observationId, currentGeneration: canonical.generation };
  active.observation = canonical;
  active.approval = approval;
  latestObservation.set(sessionId, wire);
  if (reportObservation) {
    await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.observation, canonical));
  }
  return { wire, canonical };
}

export async function observeComputer(sessionId: string): Promise<ComputerObservation> {
  return (await captureComputer(sessionId, 'computer_observe', true)).wire;
}

export async function getComputerScreenshot(sessionId: string): Promise<ComputerObservation> {
  return (await captureComputer(sessionId, 'computer_screenshot', true)).wire;
}

export async function actOnComputer(sessionId: string, request: ComputerDesktopAction): Promise<ComputerActionResult> {
  const before = latestObservation.get(sessionId);
  if (!before || before.expiresAt <= Date.now()) {
    throw new Error('stale_observation: observe immediately before acting.');
  }
  const active = canonicalSessions.get(sessionId);
  if (!active?.observation || !active.approval) throw new Error('desktop_contract_observation_missing: canonical observation and approval are required.');
  const action = await toDesktopActionV2(request, {
    session: active.session,
    observation: active.observation,
    approval: active.approval,
  }, {
    actionId: request.actionId,
    idempotencyKey: request.idempotencyKey,
    attempt: request.attempt,
  });
  const scheduled = actionLedger.run(action, async () => {
    const requestedEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.actionRequested, action, active.observation?.observationId);
    await reportComputerRealtimeEvent(requestedEvent);
    let nativeResult: ComputerActionResult;
    try {
      nativeResult = await invokeRequired<ComputerActionResult>('computer_action', {
        sessionId,
        request: {
          ...request,
          actionId: action.actionId,
          planId: `plan-${sessionId}`,
          stepId: action.actionId,
          observationId: action.observationId,
          observationGeneration: action.observationGeneration,
          expectedEffect: action.expectedEffect,
          maxAttempts: action.retryBudget.maxAttempts,
        },
      });
    } catch (error) {
      const dispatch = toFailedActionDispatchV2(action, 'NATIVE_DISPATCH_FAILED');
      const dispatchEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.dispatch, dispatch, requestedEvent.eventId);
      await reportComputerRealtimeEvent(dispatchEvent);
      const verification = toPendingActionVerificationV2(action, dispatch, 'NATIVE_DISPATCH_FAILED');
      const verificationEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.verification, verification, dispatchEvent.eventId);
      await reportComputerRealtimeEvent(verificationEvent);
      const retryDecision = toRetryDecisionV2(action, verification);
      await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.retryDecision, retryDecision, verificationEvent.eventId));
      throw error;
    }
    const dispatch = toActionDispatchV2(action, nativeResult);
    const dispatchEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.dispatch, dispatch, requestedEvent.eventId);
    await reportComputerRealtimeEvent(dispatchEvent);

    let post: { wire: ComputerObservation; canonical: DesktopObservationV2 } | undefined;
    try {
      post = await captureComputer(sessionId, 'computer_screenshot', false);
    } catch {
      post = undefined;
    }
    const cursorVerified = request.action === 'moveMouse'
      && post?.wire.cursorX === request.x
      && post?.wire.cursorY === request.y;
    const windowVerified = request.action === 'launchApp' && post?.wire.windowId !== before.windowId;
    const visualChanged = !['moveMouse', 'launchApp'].includes(request.action)
      && Boolean(post && post.wire.imageDataUrl !== before.imageDataUrl);
    const result: ComputerActionResult = {
      ...nativeResult,
      verification: cursorVerified ? 'cursor_position_confirmed'
        : windowVerified || visualChanged ? 'post_observation_changed'
          : nativeResult.verification,
      verificationStatus: post ? (cursorVerified || windowVerified ? 'verified' : 'partial') : 'pending_post_observation',
      postObservationId: post?.wire.observationId,
    };
    const verification = toActionVerificationV2(action, dispatch, result, post?.canonical);
    const verificationEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.verification, verification, dispatchEvent.eventId);
    await reportComputerRealtimeEvent(verificationEvent);
    const retryDecision = toRetryDecisionV2(action, verification);
    await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.retryDecision, retryDecision, verificationEvent.eventId));
    return { ...result, canonicalLifecycle: { action, dispatch, verification, retryDecision } };
  });
  const result = await scheduled.result;
  return scheduled.replayed ? { ...result, idempotencyReplayed: true } : result;
}

export async function stopComputer(): Promise<void> {
  if (isTauriShell()) await invokeDesktopCommand('computer_stop');
  latestObservation.clear();
  canonicalSessions.clear();
}

export async function reportComputerRuntimeStatus(status: ComputerDesktopStatus): Promise<void> {
  if (!isTauriShell()) return;
  const response = await ownerMutationFetch('/api/computer-use/runtime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Desktop-Runtime': 'tauri-v1' },
    body: JSON.stringify(status),
  });
  if (!response.ok) throw new Error(`Computer Use runtime report failed (${response.status}).`);
}

export async function reportComputerOperatorEvent(event: ComputerOperatorEvent): Promise<void> {
  if (!isTauriShell()) return;
  const response = await ownerMutationFetch('/api/computer-use/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Desktop-Runtime': 'tauri-v1' },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Computer Use event report failed (${response.status}).`);
}

export async function reportComputerRealtimeEvent(event: TypedRealtimeEnvelopeV2): Promise<void> {
  if (!isTauriShell()) return;
  const response = await ownerMutationFetch('/api/computer-use/realtime-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Desktop-Runtime': 'tauri-v1' },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Computer Use realtime event report failed (${response.status}).`);
}

export function startComputerRuntimeHeartbeat(intervalMs = 5_000): () => void {
  if (!isTauriShell()) return () => undefined;
  let cancelled = false;
  const report = async () => {
    try {
      const status = await getComputerDesktopStatus();
      if (!cancelled) await reportComputerRuntimeStatus(status);
    } catch (error) {
      console.warn('Computer Use runtime heartbeat failed:', error);
    }
  };
  void report();
  const timer = window.setInterval(() => void report(), Math.max(2_000, intervalMs));
  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}
