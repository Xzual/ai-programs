import {
  EDITH_CONTRACT_AMENDMENT,
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  REALTIME_EVENT_NAMES,
  TASK_CONTRACT_VERSION,
  parseActionDispatchV2,
  parseActionVerificationV2,
  parseDesktopActionV2,
  parseDesktopObservationV2,
  parseDesktopOperatorSessionV2,
  parseRealtimeEnvelopeV2_1,
  parseRetryDecisionV2,
  parseScopedApprovalV2,
  type ActionDispatchV2,
  type ActionVerificationEvidenceV2,
  type ActionVerificationV2,
  type DesktopActionKindV2,
  type DesktopActionV2,
  type DesktopBoundsV2,
  type DesktopExpectedEffectV2,
  type DesktopObservationV2,
  type DesktopOperatorSessionV2,
  type ParseResult,
  type RealtimeEventName,
  type RetryDecisionV2,
  type ScopedApprovalV2,
  type TypedRealtimeEnvelopeV2,
} from './contracts';
import type {
  ComputerActionResult,
  ComputerDesktopAction,
  ComputerDesktopStatus,
  ComputerObservation,
} from './computerDesktopClient';

const V21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;
const ACTION_KINDS: DesktopActionKindV2[] = ['moveMouse', 'clickMouse', 'typeText', 'pressKey', 'hotkey', 'scroll', 'launchApp'];

export class ComputerContractError extends Error {
  constructor(public readonly errorCode: string, message: string) {
    super(message);
    this.name = 'ComputerContractError';
  }
}

export interface DesktopSessionContext {
  sessionId: string;
  startedAt: number;
}

export interface CanonicalActionContext {
  session: DesktopOperatorSessionV2;
  observation: DesktopObservationV2;
  approval: ScopedApprovalV2;
}

export interface CanonicalActionLifecycle {
  action: DesktopActionV2;
  dispatch: ActionDispatchV2;
  verification: ActionVerificationV2;
  retryDecision: RetryDecisionV2;
}

export interface ActionIdentityInput {
  actionId?: string;
  idempotencyKey?: string;
  attempt?: 1 | 2;
}

function parsed<T>(result: ParseResult<T>): T {
  if (result.success === false) throw new ComputerContractError(result.errorCode, result.message);
  return result.value;
}

function iso(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new ComputerContractError('DESKTOP_TIMESTAMP_INVALID', 'Desktop timestamp must be finite.');
  return new Date(milliseconds).toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function capabilities(status: ComputerDesktopStatus) {
  return {
    screenshot: status.screenCapture === 'ready',
    uia: status.uia === 'ready',
    accessibility: status.uia === 'ready',
    ocr: status.ocr === 'ready',
    multiMonitor: status.multiMonitor === 'virtual_desktop',
  };
}

function physical(bounds: { x: number; y: number; width: number; height: number }): DesktopBoundsV2 {
  return { ...bounds, coordinateSpace: 'physical_virtual_desktop' };
}

function logical(bounds: { x: number; y: number; width: number; height: number }, scale: number): DesktopBoundsV2 {
  const safeScale = Number.isFinite(scale) && scale >= 0.5 && scale <= 8 ? scale : 1;
  return {
    x: bounds.x / safeScale,
    y: bounds.y / safeScale,
    width: Math.max(1, Math.round(bounds.width / safeScale)),
    height: Math.max(1, Math.round(bounds.height / safeScale)),
    coordinateSpace: 'logical',
  };
}

export function toDesktopOperatorSessionV2(
  status: ComputerDesktopStatus,
  context: DesktopSessionContext,
  observation?: ComputerObservation,
  now = Date.now(),
): DesktopOperatorSessionV2 {
  const expiresAt = status.sessionExpiresAt ?? now + 1;
  const session: DesktopOperatorSessionV2 = {
    ...V21,
    sessionId: context.sessionId,
    runtime: status.runtime,
    state: status.killSwitch === 'active' ? 'stopped' : observation ? 'observing' : 'planning',
    mode: status.mode,
    killSwitch: status.killSwitch,
    currentObservationId: observation?.observationId,
    currentGeneration: observation?.generation ?? 0,
    capabilities: capabilities(status),
    startedAt: iso(context.startedAt),
    updatedAt: iso(Math.max(context.startedAt, now)),
    expiresAt: iso(expiresAt),
  };
  return parsed(parseDesktopOperatorSessionV2(session, { now: iso(now) }));
}

export function toDesktopObservationV2(
  wire: ComputerObservation,
  session: DesktopOperatorSessionV2,
  now = Date.now(),
): DesktopObservationV2 {
  const scale = wire.scaleFactor;
  const virtual = { x: wire.originX, y: wire.originY, width: wire.width, height: wire.height };
  const observation: DesktopObservationV2 = {
    ...V21,
    observationId: wire.observationId,
    sessionId: session.sessionId,
    generation: wire.generation,
    capturedAt: iso(wire.capturedAt),
    expiresAt: iso(Math.min(wire.expiresAt, Date.parse(session.expiresAt))),
    foreground: {
      hwndFingerprint: wire.windowId,
      processId: wire.windowProcessId,
      logicalBounds: logical(wire.windowBounds, scale),
      physicalBounds: physical(wire.windowBounds),
    },
    virtualDesktop: {
      origin: { x: wire.originX, y: wire.originY },
      logicalBounds: logical(virtual, scale),
      physicalBounds: physical(virtual),
    },
    monitor: {
      monitorId: wire.monitorId,
      origin: { x: wire.monitorBounds.x, y: wire.monitorBounds.y },
      logicalBounds: logical(wire.monitorBounds, scale),
      physicalBounds: physical(wire.monitorBounds),
      dpiScale: scale,
    },
    source: wire.source as DesktopObservationV2['source'],
    confidence: wire.confidence,
    capabilities: {
      screenshot: true,
      uia: wire.uiaAvailable,
      accessibility: wire.uiaAvailable,
      ocr: wire.ocrAvailable,
      multiMonitor: wire.width !== wire.monitorBounds.width || wire.height !== wire.monitorBounds.height,
    },
  };
  const currentSession = { ...session, currentObservationId: wire.observationId, currentGeneration: wire.generation };
  return parsed(parseDesktopObservationV2(observation, {
    now: iso(now),
    latestGeneration: wire.generation,
    session: currentSession,
  }));
}

export function toScopedApprovalV2(
  session: DesktopOperatorSessionV2,
  observation: DesktopObservationV2,
  now = Date.now(),
): ScopedApprovalV2 {
  const approval: ScopedApprovalV2 = {
    ...V21,
    approvalId: `approval-${session.sessionId}`,
    sessionId: session.sessionId,
    observationId: observation.observationId,
    observationGeneration: observation.generation,
    scope: {
      actions: [...ACTION_KINDS],
      physicalBounds: observation.foreground.physicalBounds,
      maxActions: 100,
    },
    grantedBy: 'owner',
    grantedAt: iso(Math.max(Date.parse(session.startedAt), now - 1)),
    expiresAt: iso(Math.min(Date.parse(session.expiresAt), Date.parse(observation.expiresAt))),
    consumedActionIds: [],
    status: 'active',
  };
  return parsed(parseScopedApprovalV2(approval, { now: iso(now), observation }));
}

async function textFingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function expectedEffect(request: ComputerDesktopAction): DesktopExpectedEffectV2 {
  if (request.action === 'moveMouse') return 'cursor_moved';
  if (request.action === 'launchApp') return 'foreground_window_changed';
  return 'visual_change';
}

export async function toDesktopActionV2(
  request: ComputerDesktopAction,
  context: CanonicalActionContext,
  identity: ActionIdentityInput = {},
  now = Date.now(),
): Promise<DesktopActionV2> {
  const deadline = Math.min(now + 5_000, Date.parse(context.observation.expiresAt), Date.parse(context.approval.expiresAt));
  const action: DesktopActionV2 = {
    ...V21,
    actionId: identity.actionId ?? id('action'),
    idempotencyKey: identity.idempotencyKey ?? id('desktop-idem'),
    sessionId: context.session.sessionId,
    approvalId: context.approval.approvalId,
    observationId: context.observation.observationId,
    observationGeneration: context.observation.generation,
    kind: request.action,
    coordinates: request.action === 'moveMouse' || request.action === 'clickMouse' ? { x: request.x, y: request.y } : undefined,
    button: request.action === 'clickMouse' ? request.button ?? 'left' : undefined,
    key: request.action === 'pressKey' ? request.key : undefined,
    keys: request.action === 'hotkey' ? request.keys : undefined,
    textLength: request.action === 'typeText' ? Array.from(request.text).length : undefined,
    textFingerprint: request.action === 'typeText' ? await textFingerprint(request.text) : undefined,
    scrollDelta: request.action === 'scroll' ? request.delta : undefined,
    applicationId: request.action === 'launchApp' ? request.app : undefined,
    expectedEffect: expectedEffect(request),
    deadlineAt: iso(deadline),
    retryBudget: { maxAttempts: 2, attempt: identity.attempt ?? 1, backoffMs: 250 },
  };
  return parsed(parseDesktopActionV2(action, {
    now: iso(now),
    observation: context.observation,
    approval: context.approval,
  }));
}

export function toActionDispatchV2(
  action: DesktopActionV2,
  result: ComputerActionResult,
  now = Date.now(),
): ActionDispatchV2 {
  const dispatch: ActionDispatchV2 = {
    ...V21,
    dispatchId: `dispatch-${result.actionId}`,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    sessionId: action.sessionId,
    approvalId: action.approvalId,
    observationId: action.observationId,
    observationGeneration: action.observationGeneration,
    status: result.injected && result.dispatchStatus === 'dispatched' ? 'dispatched' : 'failed',
    attempt: action.retryBudget.attempt,
    dispatchedAt: iso(now),
    nativeCommandId: result.actionId,
    errorCode: result.injected ? undefined : 'NATIVE_DISPATCH_FAILED',
  };
  return parsed(parseActionDispatchV2(dispatch));
}

export function toFailedActionDispatchV2(
  action: DesktopActionV2,
  errorCode: string,
  now = Date.now(),
): ActionDispatchV2 {
  const dispatch: ActionDispatchV2 = {
    ...V21,
    dispatchId: `dispatch-${action.actionId}`,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    sessionId: action.sessionId,
    approvalId: action.approvalId,
    observationId: action.observationId,
    observationGeneration: action.observationGeneration,
    status: 'failed',
    attempt: action.retryBudget.attempt,
    dispatchedAt: iso(now),
    errorCode,
  };
  return parsed(parseActionDispatchV2(dispatch));
}

export function toActionVerificationV2(
  action: DesktopActionV2,
  dispatch: ActionDispatchV2,
  result: ComputerActionResult,
  postObservation: DesktopObservationV2 | undefined,
  now = Date.now(),
): ActionVerificationV2 {
  const evidence: ActionVerificationEvidenceV2[] = [];
  if (result.verification === 'cursor_position_confirmed') evidence.push({ kind: 'cursor_position', matched: true, observationId: postObservation?.observationId, confidence: 1 });
  if (result.verification === 'post_observation_changed') evidence.push({
    kind: action.expectedEffect === 'foreground_window_changed' ? 'foreground_window_changed' : 'visual_change',
    matched: result.verificationStatus === 'verified',
    observationId: postObservation?.observationId,
    confidence: result.verificationStatus === 'verified' ? 1 : 0.5,
  });
  if (result.verification === 'input_injected_outcome_unverified') evidence.push({ kind: 'input_injected', matched: false, confidence: 0 });
  if (result.verification === 'process_started') evidence.push({ kind: 'process_started', matched: false, confidence: 0.5 });
  const verification: ActionVerificationV2 = {
    ...V21,
    verificationId: `verification-${dispatch.dispatchId}`,
    actionId: action.actionId,
    dispatchId: dispatch.dispatchId,
    expectedEffect: action.expectedEffect,
    preObservationId: action.observationId,
    preObservationGeneration: action.observationGeneration,
    postObservationId: postObservation?.observationId,
    postObservationGeneration: postObservation?.generation,
    status: result.verificationStatus,
    evidence,
    confidence: result.verificationStatus === 'verified' ? 1 : result.verificationStatus === 'partial' ? 0.5 : 0,
    verifiedAt: iso(now),
  };
  return parsed(parseActionVerificationV2(verification));
}

export function toPendingActionVerificationV2(
  action: DesktopActionV2,
  dispatch: ActionDispatchV2,
  errorCode: string,
  now = Date.now(),
): ActionVerificationV2 {
  const verification: ActionVerificationV2 = {
    ...V21,
    verificationId: `verification-${dispatch.dispatchId}`,
    actionId: action.actionId,
    dispatchId: dispatch.dispatchId,
    expectedEffect: action.expectedEffect,
    preObservationId: action.observationId,
    preObservationGeneration: action.observationGeneration,
    status: 'pending_post_observation',
    evidence: [],
    confidence: 0,
    verifiedAt: iso(now),
    errorCode,
  };
  return parsed(parseActionVerificationV2(verification));
}

export function toRetryDecisionV2(
  action: DesktopActionV2,
  verification: ActionVerificationV2,
  now = Date.now(),
): RetryDecisionV2 {
  const succeeded = verification.status === 'verified';
  const decision: RetryDecisionV2 = {
    ...V21,
    decisionId: `decision-${verification.verificationId}`,
    actionId: action.actionId,
    verificationId: verification.verificationId,
    decision: succeeded ? 'succeed' : 'reobserve',
    attempt: action.retryBudget.attempt,
    maxAttempts: action.retryBudget.maxAttempts,
    reasonCode: succeeded ? 'EXPECTED_EFFECT_VERIFIED' : 'POST_ACTION_EFFECT_UNVERIFIED',
    requiresFreshObservation: !succeeded,
    decidedAt: iso(now),
  };
  return parsed(parseRetryDecisionV2(decision));
}

export class DesktopRealtimeEventStream {
  private sequence = 0;

  constructor(
    private readonly streamId: string,
    private readonly correlationId: string,
  ) {}

  emit<K extends RealtimeEventName>(event: K, payload: TypedRealtimeEnvelopeV2<K>['payload'], causationId?: string): TypedRealtimeEnvelopeV2<K> {
    const sequence = ++this.sequence;
    const envelope = {
      schema: EDITH_CONTRACT_SCHEMA,
      version: EDITH_CONTRACT_VERSION,
      event,
      eventId: `${this.streamId}-${sequence}`,
      occurredAt: new Date().toISOString(),
      sequence,
      streamId: this.streamId,
      cursor: sequence,
      correlationId: this.correlationId,
      causationId,
      replayed: false,
      payload,
    } as TypedRealtimeEnvelopeV2<K>;
    return parsed(parseRealtimeEnvelopeV2_1(envelope)) as TypedRealtimeEnvelopeV2<K>;
  }
}

interface LedgerEntry<T> {
  actionId: string;
  binding: string;
  promise: Promise<T>;
}

function idempotencyBinding(action: DesktopActionV2): string {
  return JSON.stringify({
    actionId: action.actionId,
    sessionId: action.sessionId,
    approvalId: action.approvalId,
    observationId: action.observationId,
    observationGeneration: action.observationGeneration,
    kind: action.kind,
    coordinates: action.coordinates,
    button: action.button,
    key: action.key,
    keys: action.keys,
    textLength: action.textLength,
    textFingerprint: action.textFingerprint,
    scrollDelta: action.scrollDelta,
    applicationId: action.applicationId,
    expectedEffect: action.expectedEffect,
    attempt: action.retryBudget.attempt,
  });
}

export class DesktopActionIdempotencyLedger<T> {
  private readonly entries = new Map<string, LedgerEntry<T>>();

  constructor(private readonly maximumEntries = 256) {}

  run(action: DesktopActionV2, execute: () => Promise<T>): { replayed: boolean; result: Promise<T> } {
    const binding = idempotencyBinding(action);
    const existing = this.entries.get(action.idempotencyKey);
    if (existing) {
      if (existing.actionId !== action.actionId || existing.binding !== binding) {
        throw new ComputerContractError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key is already bound to another action.');
      }
      return { replayed: true, result: existing.promise };
    }
    const promise = execute();
    this.entries.set(action.idempotencyKey, { actionId: action.actionId, binding, promise });
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest === 'string') this.entries.delete(oldest);
      else break;
    }
    return { replayed: false, result: promise };
  }
}

export const DESKTOP_REALTIME_EVENTS = {
  observation: REALTIME_EVENT_NAMES.DESKTOP_OBSERVATION,
  actionRequested: REALTIME_EVENT_NAMES.DESKTOP_ACTION_REQUESTED,
  dispatch: REALTIME_EVENT_NAMES.DESKTOP_ACTION_DISPATCH,
  verification: REALTIME_EVENT_NAMES.DESKTOP_ACTION_VERIFICATION,
  retryDecision: REALTIME_EVENT_NAMES.DESKTOP_RETRY_DECISION,
} as const;
