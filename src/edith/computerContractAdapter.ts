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
  type DesktopVerificationContextV2,
  type ParseResult,
  type RealtimeEventName,
  type RetryDecisionV2,
  type ScopedApprovalV2,
  type TypedRealtimeEnvelopeV2,
} from './contracts';
import type {
  ComputerActionResult,
  ComputerOcrReadback,
  ComputerDesktopAction,
  ComputerDesktopStatus,
  ComputerObservation,
} from './computerDesktopClient';
// Internal local pipeline registration: callers supply no receipt proof fields.
const validatedOcrReadbacks=new WeakMap<object,()=>boolean>();
export function registerValidatedOcrReadback(receipt:ComputerOcrReadback,isCurrent:()=>boolean):void {
  validatedOcrReadbacks.set(receipt,isCurrent);
}
export function isValidatedComputerOcrReadback(value:unknown):value is ComputerOcrReadback {
  if(!value||typeof value!=='object')return false;
  return validatedOcrReadbacks.get(value)?.()===true;
}


const V21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;
const ACTION_KINDS: DesktopActionKindV2[] = ['moveMouse', 'clickMouse', 'typeText', 'pressKey', 'hotkey', 'scroll', 'launchApp', 'dragMouse', 'doubleClickMouse'];

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
  if(request.action==='focusApp')return 'foreground_window_focused';
  if (request.action === 'moveMouse') return 'cursor_moved';
  if (request.action === 'launchApp') return 'foreground_window_changed';
  if(request.action==='typeText')return 'text_inserted';
  return 'visual_change';
}

export async function toDesktopActionV2(
  request: ComputerDesktopAction,
  context: CanonicalActionContext,
  identity: ActionIdentityInput = {},
  now = Date.now(),
): Promise<DesktopActionV2> {
  if(request.action==='dragMouse'||request.action==='doubleClickMouse'){
    const allowed=['action','target','actionId','idempotencyKey','attempt','button',...(request.action==='dragMouse'?['dragStart','dragEnd','dragDurationMs','destinationTarget']:['x','y'])];
    if(Object.keys(request).some(key=>!allowed.includes(key)))throw new ComputerContractError('DESKTOP_ATOMIC_PARAMETERS_INVALID','Atomic request contains unknown or irrelevant parameters.');
  }
  if(request.action==='focusApp'&&Object.keys(request).some(key=>!['action','applicationId','focusTarget','actionId','idempotencyKey','attempt'].includes(key)))throw new ComputerContractError('DESKTOP_FOCUS_PARAMETERS_INVALID','Focus request contains irrelevant or unknown parameters.');
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
    target: request.target,
    coordinates: ['moveMouse','clickMouse','doubleClickMouse'].includes(request.action) && 'x' in request ? { x: request.x, y: request.y } : undefined,
    button: request.action === 'clickMouse' || request.action==='doubleClickMouse' || request.action==='dragMouse' ? request.button ?? 'left' : undefined,
    dragStart:request.action==='dragMouse'?request.dragStart:undefined,
    dragEnd:request.action==='dragMouse'?request.dragEnd:undefined,
    dragDurationMs:request.action==='dragMouse'?request.dragDurationMs:undefined,
    destinationTarget:request.action==='dragMouse'?request.destinationTarget:undefined,
    key: request.action === 'pressKey' ? request.key : undefined,
    keys: request.action === 'hotkey' ? request.keys : undefined,
    textLength: request.action === 'typeText' ? Array.from(request.text).length : undefined,
    textFingerprint: request.action === 'typeText' ? await textFingerprint(request.text) : undefined,
    scrollDelta: request.action === 'scroll' ? request.delta : undefined,
    applicationId: request.action === 'launchApp' ? request.app : request.action==='focusApp'?request.applicationId:undefined,
    focusTarget:request.action==='focusApp'?request.focusTarget:undefined,
    expectedEffect: expectedEffect(request),
    deadlineAt: iso(deadline),
    retryBudget: { maxAttempts: request.target?.provenance==='ocr'||request.action==='dragMouse'||request.action==='doubleClickMouse'||request.action==='typeText'||request.action==='focusApp'?1:2, attempt: identity.attempt ?? 1, backoffMs: 250 },
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
  const focusedNoop=action.kind==='focusApp'&&result.focusReadback?.matched===true
    &&result.focusReadback.source==='native_operator'&&result.focusReadback.applicationId===action.applicationId
    &&result.focusReadback.windowId===action.focusTarget?.windowId&&result.focusReadback.windowProcessId===action.focusTarget?.processId
    &&result.focusReadback.imagePathFingerprint===action.focusTarget?.imagePathFingerprint;
  const dispatched=result.dispatchStatus==='dispatched'&&(result.injected||focusedNoop);
  const dispatch: ActionDispatchV2 = {
    ...V21,
    dispatchId: `dispatch-${result.actionId}`,
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    sessionId: action.sessionId,
    approvalId: action.approvalId,
    observationId: action.observationId,
    observationGeneration: action.observationGeneration,
    status: dispatched ? 'dispatched' : 'failed',
    attempt: action.retryBudget.attempt,
    dispatchedAt: iso(now),
    nativeCommandId: result.actionId,
    errorCode:dispatched?undefined:result.errorCode??(result.dispatchStatus==='failed'?'NATIVE_DISPATCH_INTERRUPTED':'NATIVE_DISPATCH_FAILED'),
    partialInputInjected:result.partialInputInjected,
    releaseConfirmed:result.releaseConfirmed,
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
  preObservation?:DesktopObservationV2,
): ActionVerificationV2 {
  const evidence: ActionVerificationEvidenceV2[] = [];
  const ocrAction=action.target?.provenance==='ocr'||action.target?.targetId.startsWith('ocr-');
  const receipt=result.ocrReadback;
  const verifiedOcr=ocrAction&&isValidatedComputerOcrReadback(receipt)&&receipt.matched===true
    &&action.kind==='clickMouse'&&action.button==='left'&&action.retryBudget.attempt===1&&action.retryBudget.maxAttempts===1
    &&dispatch.actionId===action.actionId&&dispatch.sessionId===action.sessionId&&dispatch.observationId===action.observationId&&dispatch.observationGeneration===action.observationGeneration
    &&dispatch.approvalId===action.approvalId&&dispatch.idempotencyKey===action.idempotencyKey&&dispatch.attempt===1
    &&dispatch.status==='dispatched'&&dispatch.partialInputInjected!==true&&dispatch.releaseConfirmed!==false&&result.injected===true
    &&receipt.targetId===action.target?.targetId&&receipt.canonicalActionId===action.actionId
    &&receipt.preObservationId===action.observationId&&receipt.preGeneration===action.observationGeneration
    &&receipt.postObservationId===postObservation?.observationId&&receipt.postGeneration===postObservation?.generation
    &&preObservation?.sessionId===action.sessionId&&postObservation?.sessionId===action.sessionId
    &&preObservation.observationId===receipt.preObservationId&&preObservation.generation===receipt.preGeneration
    &&preObservation.foreground.hwndFingerprint===receipt.windowId&&preObservation.foreground.processId===receipt.windowProcessId
    &&postObservation.foreground.hwndFingerprint===receipt.windowId&&postObservation.foreground.processId===receipt.windowProcessId;
  const status=ocrAction&&result.verificationStatus==='verified'&&!verifiedOcr?'partial':result.verificationStatus;
  if (!ocrAction&&result.verification === 'cursor_position_confirmed') evidence.push({ kind: 'cursor_position', matched: true, observationId: postObservation?.observationId, confidence: 1 });
  if (verifiedOcr) evidence.push({kind:'visual_change',matched:true,source:'native_operator',observationId:postObservation?.observationId,confidence:1});
  else if (result.verification === 'post_observation_changed') evidence.push({
    kind: action.expectedEffect === 'foreground_window_changed' ? 'foreground_window_changed' : 'visual_change',
    matched: status === 'verified',
    observationId: postObservation?.observationId,
    confidence: status === 'verified' ? 1 : 0.5,
  });
  if (result.verification === 'input_injected_outcome_unverified') evidence.push({ kind: 'input_injected', matched: false, confidence: 0 });
  if (result.verification === 'process_started') evidence.push({ kind: 'process_started', matched: false, confidence: 0.5 });
  if(!ocrAction&&result.textReadback)evidence.push({kind:'text_readback',...result.textReadback,observationId:postObservation?.observationId,confidence:result.textReadback.matched?1:0});
  if(!ocrAction&&result.focusReadback)evidence.push({kind:'foreground_window_focused',...result.focusReadback,observationId:postObservation?.observationId,confidence:result.focusReadback.matched?1:0});
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
    status,
    evidence,
    confidence: status === 'verified' ? 1 : status === 'partial' ? 0.5 : 0,
    verifiedAt: iso(now),
  };
  const context:DesktopVerificationContextV2|undefined=preObservation&&postObservation?{action,preObservation,postObservation,dispatch}:undefined;
  return parsed(parseActionVerificationV2(verification,context));
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
  private observations=new Map<string,DesktopObservationV2>();
  private actions=new Map<string,DesktopActionV2>();
  private dispatches=new Map<string,ActionDispatchV2>();

  constructor(
    private readonly streamId: string,
    private readonly correlationId: string,
  ) {}

  emit<K extends RealtimeEventName>(event: K, payload: TypedRealtimeEnvelopeV2<K>['payload'], causationId?: string): TypedRealtimeEnvelopeV2<K> {
    const sequence = this.sequence+1;
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
    const verification=payload as unknown as ActionVerificationV2;
    const action=this.actions.get(verification.actionId),preObservation=this.observations.get(verification.preObservationId),postObservation=this.observations.get(verification.postObservationId??'');
    const context=event===REALTIME_EVENT_NAMES.DESKTOP_ACTION_VERIFICATION&&action&&preObservation&&postObservation?{action,preObservation,postObservation,dispatch:this.dispatches.get(verification.dispatchId)}:undefined;
    const result=parsed(parseRealtimeEnvelopeV2_1(envelope,{desktopVerificationContext:context})) as TypedRealtimeEnvelopeV2<K>;
    this.sequence=sequence;
    if(event===REALTIME_EVENT_NAMES.DESKTOP_OBSERVATION){const observation=payload as unknown as DesktopObservationV2;this.observations.set(observation.observationId,observation);}
    if(event===REALTIME_EVENT_NAMES.DESKTOP_ACTION_REQUESTED){const action=payload as unknown as DesktopActionV2;this.actions.set(action.actionId,action);}
    if(event===REALTIME_EVENT_NAMES.DESKTOP_ACTION_DISPATCH){const dispatch=payload as unknown as ActionDispatchV2;this.dispatches.set(dispatch.dispatchId,dispatch);}
    for(const map of [this.observations,this.actions,this.dispatches])while(map.size>100)map.delete(map.keys().next().value!);
    return result;
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
    target: action.target,
    dragStart:action.dragStart,
    dragEnd:action.dragEnd,
    dragDurationMs:action.dragDurationMs,
    destinationTarget:action.destinationTarget,
    coordinates: action.coordinates,
    button: action.button,
    key: action.key,
    keys: action.keys,
    textLength: action.textLength,
    textFingerprint: action.textFingerprint,
    scrollDelta: action.scrollDelta,
    applicationId: action.applicationId,
    focusTarget:action.focusTarget,
    focusDeadlineAt:action.kind==='focusApp'?action.deadlineAt:undefined,
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
