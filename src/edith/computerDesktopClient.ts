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
  registerValidatedOcrReadback,
  isValidatedComputerOcrReadback,
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
  DesktopFocusTargetV2,
  DesktopOperatorSessionV2,
  ScopedApprovalV2,
  SemanticTargetV2,
  TypedRealtimeEnvelopeV2,
} from './contracts';
import { EDITH_CONTRACT_AMENDMENT, TASK_CONTRACT_VERSION, parseSemanticTargetV2,parseDesktopFocusTargetV2,parseScopedApprovalV2,parseTaskStatus } from './contracts';

export interface ComputerDesktopStatus {
  scopedStopContract?: 'edith.computer.expected-session-stop/1';
  runtime: 'tauri' | 'unbound';
  mode: 'read_only' | 'owner_command' | 'disabled' | 'error';
  available: boolean;
  screenCapture: 'ready' | 'missing' | 'permission_required' | 'error';
  mouseControl: 'ready' | 'missing' | 'permission_required' | 'error';
  keyboardControl: 'ready' | 'missing' | 'permission_required' | 'error';
  ownerCommandMode: boolean;
  killSwitch: 'active' | 'inactive' | 'unknown';
  overlay: 'in_app' | 'missing';
  nativeOverlayReady?: boolean;
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
  | {action:'focusApp';applicationId:'spotify'|'steam'|'explorer';focusTarget:DesktopFocusTargetV2}
  | { action: 'moveMouse' | 'clickMouse'; x: number; y: number; button?: 'left' | 'right' }
  | { action: 'doubleClickMouse'; x:number;y:number;button?:'left'|'right' }
  | { action: 'dragMouse';dragStart:{x:number;y:number};dragEnd:{x:number;y:number};dragDurationMs:number;button?:'left'|'right';destinationTarget?:SemanticTargetV2 }
  | { action: 'typeText'; text: string }
  | { action: 'pressKey'; key: string }
  | { action: 'hotkey'; keys: string[] }
  | { action: 'scroll'; delta: number }
  | { action: 'launchApp'; app: SafeDesktopApp };

export type ComputerDesktopAction = ComputerDesktopActionPayload & {
  target?: SemanticTargetV2;
  actionId?: string;
  idempotencyKey?: string;
  attempt?: 1 | 2;
};

export interface ComputerOcrReadback {
  source:'native_operator';kind:'ocr_semantic_transition';targetId:string;canonicalActionId:string;
  preObservationId:string;postObservationId:string;preGeneration:number;postGeneration:number;
  windowId:string;windowProcessId:number;imagePathFingerprint:string;
  preTextFingerprint:string;postTextFingerprint:string;expectedTextFingerprint:string;
  matched:boolean;observedAt:number;
}
export interface ComputerOcrLocateOptions {
  postcondition:{kind:'unique_text_transition';beforeText:string;afterText:string};workflowId?:string;
}
export interface ComputerActionResult {
  actionId: string;
  planId: string;
  stepId: string;
  action: string;
  injected: boolean;
  dispatchStatus: 'dispatched' | 'failed';
  partialInputInjected?: boolean;
  releaseConfirmed?: boolean;
  errorCode?: string;
  textReadback?: {source:'uia';windowId:string;windowProcessId:number;preTextFingerprint:string;postTextFingerprint:string;expectedTextFingerprint:string;matched:boolean};
  ocrReadback?:ComputerOcrReadback;
  focusReadback?:{source:'native_operator';applicationId:'spotify'|'steam'|'explorer';windowId:string;windowProcessId:number;imagePathFingerprint:string;matched:boolean};
  cursorX: number;
  cursorY: number;
  verification: 'cursor_position_confirmed' | 'input_injected_outcome_unverified' | 'process_started' | 'post_observation_changed';
  verificationStatus: 'verified' | 'partial' | 'pending_post_observation';
  preObservationId: string;
  postObservationId?: string;
  attempts: number;
  launchedProcessId?: number;
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
const explorerOperations = new Map<string,string>();
let workflowReservation:{sessionId:string;workflowId:string}|undefined;
function requireWorkflowAccess(sessionId:string,workflowId?:string):void{
  if(workflowReservation&&(workflowReservation.sessionId!==sessionId||workflowReservation.workflowId!==workflowId))throw new Error('APP_WORKFLOW_RESOURCE_BUSY');
}
export async function reserveComputerWorkflow(sessionId:string,workflowId:string,deadlineAt:string):Promise<void>{
  assertComputerSessionActive(sessionId);requireWorkflowAccess(sessionId,workflowId);
  const receipt=await invokeRequired<{workflowId:string}>('computer_workflow_reserve',{sessionId,workflowId,deadlineAt});
  assertComputerSessionActive(sessionId);
  if(receipt.workflowId!==workflowId)throw new Error('APP_WORKFLOW_RESERVATION_INVALID');
  workflowReservation={sessionId,workflowId};
}
export async function releaseComputerWorkflow(sessionId:string,workflowId:string):Promise<void>{
  try{await invokeRequired('computer_workflow_release',{sessionId,workflowId});}finally{
    if(workflowReservation?.sessionId===sessionId&&workflowReservation.workflowId===workflowId)workflowReservation=undefined;
  }
}
interface ActiveCanonicalSession {
  startedAt: number;
  session: DesktopOperatorSessionV2;
  observation?: DesktopObservationV2;
  approval?: ScopedApprovalV2;
  stream: DesktopRealtimeEventStream;
}

const canonicalSessions = new Map<string, ActiveCanonicalSession>();
interface LocalOcrTarget {
  active:ActiveCanonicalSession;before:ComputerObservation;target:SemanticTargetV2;
  windowId:string;windowProcessId:number;imagePathFingerprint:string;expiresAt:number;
  preTextFingerprint:string;expectedTextFingerprint:string;workflowId?:string;consumed:boolean;
}
const localOcrTargets=new Map<string,LocalOcrTarget>();
const sha256Metadata=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameOcrTarget=(left:SemanticTargetV2,right:SemanticTargetV2)=>JSON.stringify(left)===JSON.stringify(right);
function ocrIntentText(value:unknown):string {
  if(typeof value!=='string')throw new Error('OCR_TRANSITION_INTENT_INVALID');
  const text=value.trim();
  if(Array.from(text).length<1||Array.from(text).length>160||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text))throw new Error('OCR_TRANSITION_INTENT_INVALID');
  return text;
}
function requireOcrFacts(sessionId:string,facts:LocalOcrTarget):void {
  requireCurrentSession(sessionId,facts.active);
  if(facts.expiresAt<=Date.now())throw new Error('OCR_TARGET_EXPIRED');
  requireWorkflowAccess(sessionId,facts.workflowId);
}
const actionLedger = new DesktopActionIdempotencyLedger<ComputerActionResult>();
let sessionEpoch = 0;

function requireCurrentSession(sessionId: string, active: ActiveCanonicalSession): void {
  if (sessionStopFacts.get(active)?.cancelled) throw new Error('desktop_session_stopped_or_expired: owned session cancelled.');
  if (canonicalSessions.get(sessionId) !== active || Date.parse(active.session.expiresAt) <= Date.now()) {
    throw new Error('desktop_session_stopped_or_expired: native action cancelled.');
  }
}

async function invokeRequired<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriShell()) throw new Error(browserStatus.safeMessage);
  const result = await invokeDesktopCommand<T>(command, args);
  if (result === undefined) throw new Error(`Desktop command ${command} returned no result.`);
  return result;
}

export async function getComputerDesktopStatus(): Promise<ComputerDesktopStatus> {
  return isTauriShell() ? invokeRequired('computer_status') : browserStatus;
}

export interface ComputerMonitor {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
  active: boolean;
  dpiScale: number | null;
}

export async function getComputerMonitors(sessionId: string): Promise<ComputerMonitor[]> {
  const active = canonicalSessions.get(sessionId);
  if (!active) throw new Error('desktop_contract_session_missing');
  requireCurrentSession(sessionId, active);
  const monitors = await invokeRequired<ComputerMonitor[]>('computer_monitors', { sessionId });
  requireCurrentSession(sessionId, active);
  return monitors;
}

export interface ComputerAppWindow { app: string; windowId: string; processId: number; title: string }
export async function inspectComputerApp(sessionId: string, app: 'spotify' | 'steam' | 'explorer'): Promise<ComputerAppWindow[]> {
  const active = canonicalSessions.get(sessionId);
  if (!active) throw new Error('desktop_contract_session_missing');
  requireCurrentSession(sessionId, active);
  const windows = await invokeRequired<ComputerAppWindow[]>('computer_app_windows', { sessionId, app });
  requireCurrentSession(sessionId, active);
  return windows;
}

export interface ComputerControlState {
  targetId:string;name:string;automationId:string;controlType:number;x:number;y:number;width:number;height:number;
  value:string|null;toggle:number|null;rangeValue:number|null;rangeMin:number|null;rangeMax:number|null;selected:boolean|null;
}
export function assertComputerSessionActive(sessionId:string):number{
  const active=canonicalSessions.get(sessionId);if(!active)throw new Error('desktop_contract_session_missing');
  requireCurrentSession(sessionId,active);return Date.parse(active.session.expiresAt);
}
export async function getComputerAppSnapshot(sessionId:string,workflowId?:string):Promise<ComputerControlState[]>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active||!before)throw new Error('desktop_contract_observation_missing');requireCurrentSession(sessionId,active);
  const controls=await invokeRequired<ComputerControlState[]>('computer_app_snapshot',{sessionId,observationId:before.observationId,generation:before.generation,workflowId});
  requireCurrentSession(sessionId,active);
  if(latestObservation.get(sessionId)!==before||before.expiresAt<=Date.now())throw new Error('stale_observation');
  if(!Array.isArray(controls)||controls.length>64)throw new Error('app_control_budget_exceeded');
  if(controls.some(c=>!c||typeof c.targetId!=='string'||!/^[a-zA-Z0-9:_-]+:[a-f0-9]{64}$/.test(c.targetId)||
    typeof c.name!=='string'||c.name.length>4096||typeof c.automationId!=='string'||c.automationId.length>4096||
    !Number.isSafeInteger(c.controlType)||![c.x,c.y,c.width,c.height].every(Number.isSafeInteger)||c.width<=0||c.height<=0||
    !(c.value===null||typeof c.value==='string'&&c.value.length<=4096)||
    ![c.rangeValue,c.rangeMin,c.rangeMax].every(v=>v===null||typeof v==='number'&&Number.isFinite(v))||
    !(c.toggle===null||[0,1,2].includes(c.toggle))||!(c.selected===null||typeof c.selected==='boolean')))throw new Error('app_control_state_invalid');
  return controls;
}
export function computerControlTarget(sessionId:string,control:ComputerControlState):SemanticTargetV2{
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active?.observation||!before)throw new Error('desktop_contract_observation_missing');requireCurrentSession(sessionId,active);
  const parsed=parseSemanticTargetV2({contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,targetId:control.targetId,
    observationId:before.observationId,observationGeneration:before.generation,provenance:'uia',confidence:1,runtimeIdFingerprint:control.targetId.split(':').at(-1),physicalBounds:{x:control.x,y:control.y,width:control.width,height:control.height,coordinateSpace:'physical_virtual_desktop'}},active.observation);
  if(parsed.success===false)throw new Error(parsed.errorCode);return parsed.value;
}
export async function locateComputerGameTarget(sessionId:string,workflowId:string):Promise<SemanticTargetV2>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active?.observation||!before)throw new Error('desktop_contract_observation_missing');
  requireCurrentSession(sessionId,active);
  const target=await invokeRequired<{targetId:string;controlType:number;x:number;y:number;width:number;height:number}>('computer_locate',{sessionId,observationId:before.observationId,generation:before.generation,workflowId,query:'__native_steam_game_entry__'});
  requireCurrentSession(sessionId,active);
  if(latestObservation.get(sessionId)!==before||before.expiresAt<=Date.now())throw new Error('stale_observation');
  if(![50007,50029].includes(target.controlType))throw new Error('APP_GAME_TARGET_UNSUPPORTED');
  const parsed=parseSemanticTargetV2({contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,targetId:target.targetId,
    observationId:before.observationId,observationGeneration:before.generation,provenance:'uia',confidence:1,
    runtimeIdFingerprint:target.targetId.split(':').at(-1),physicalBounds:{x:target.x,y:target.y,width:target.width,height:target.height,coordinateSpace:'physical_virtual_desktop'}},active.observation);
  if(parsed.success===false)throw new Error(parsed.errorCode);
  if(parsed.value.provenance!=='uia'||parsed.value.confidence!==1||parsed.value.runtimeIdFingerprint!==parsed.value.targetId.split(':').at(-1))throw new Error('APP_GAME_TARGET_UNSUPPORTED');
  return parsed.value;
}
export async function openComputerInstalledApp(sessionId:string,app:'spotify'|'steam'|'explorer',operationId:string,idempotencyKey:string,deadlineAt:string,workflowId?:string):Promise<{app:string;windowId:string;processId:number;launchRequested:boolean;startedProcessId?:number|null;source:'installed_app_operator'}>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId);if(!active)throw new Error('desktop_contract_session_missing');requireCurrentSession(sessionId,active);
  const receipt=await invokeRequired<Awaited<ReturnType<typeof openComputerInstalledApp>>>('computer_app_open',{sessionId,app,operationId,idempotencyKey,deadlineAt,workflowId});
  requireCurrentSession(sessionId,active);
  if(receipt.app!==app||receipt.source!=='installed_app_operator'||!Number.isSafeInteger(receipt.processId)||receipt.processId<=0)throw new Error('app_open_identity_unverified');
  return receipt;
}
export async function setComputerAppVolume(sessionId:string,targetId:string,volume:number,operationId:string,idempotencyKey:string,deadlineAt:string,workflowId?:string):Promise<{source:'semantic_range_pattern';targetId:string;requestedVolume:number;observedValue:number;minimum:number;maximum:number;matched:boolean}>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);if(!active||!before)throw new Error('desktop_contract_observation_missing');requireCurrentSession(sessionId,active);
  const receipt=await invokeRequired<Awaited<ReturnType<typeof setComputerAppVolume>>>('computer_app_volume',{sessionId,observationId:before.observationId,generation:before.generation,targetId,volume,operationId,idempotencyKey,deadlineAt,workflowId});
  requireCurrentSession(sessionId,active);if(latestObservation.get(sessionId)!==before||before.expiresAt<=Date.now())throw new Error('stale_observation');
  if(receipt.source!=='semantic_range_pattern'||receipt.targetId!==targetId||receipt.requestedVolume!==volume||receipt.matched!==true||
    ![receipt.observedValue,receipt.minimum,receipt.maximum].every(Number.isFinite)||receipt.maximum<=receipt.minimum||
    Math.abs(100*(receipt.observedValue-receipt.minimum)/(receipt.maximum-receipt.minimum)-volume)>0.001)throw new Error('APP_VOLUME_UNVERIFIED');
  return receipt;
}
export async function runComputerAppWorkflow(sessionId:string,request:import('./computerAppWorkflows').ComputerAppWorkflowRequest,identity?:import('./computerAppWorkflows').ComputerAppWorkflowIdentity):Promise<import('./computerAppWorkflows').ComputerAppWorkflowResult>{
  return (await import('./computerAppWorkflows')).runDefaultComputerAppWorkflow(sessionId,request,identity);
}
export interface ComputerExplorerClaim {
  operationId:string;operation:'copy'|'move'|'undo'|'find';reverseOf?:'copy'|'move';sourceName:string;expiresAt:number;
  sourceParentFingerprint:string;destinationParentFingerprint?:string;quarantine:boolean;
  taskId:string;bindingId:string;taskState:string;
}
export interface ComputerTaskReference {taskId:string;bindingId:string;taskState:string}
type ComputerTaskIntent=Extract<import('./computerAppWorkflows').ComputerAppWorkflowRequest,{app:'spotify'|'steam'}>;
export async function registerComputerTaskSession(sessionId:string,workflowId:string,intent:ComputerTaskIntent,evidencePolicyId?:SteamReadPolicyId):Promise<void>{
  if(evidencePolicyId!==undefined)return registerSteamEvidenceSession({sessionId,workflowId,intent,evidencePolicyId});
  requireWorkflowAccess(sessionId,workflowId);const expiry=assertComputerSessionActive(sessionId);
  const row=await invokeRequired<{registered:boolean;reservationId:string;expiresAt:number}>('computer_task_register',{sessionId,workflowId,intent});
  assertComputerSessionActive(sessionId);
  if(row.registered!==true||row.reservationId!==workflowId||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=Date.now()||row.expiresAt>expiry||Object.keys(row).some(k=>!['registered','reservationId','expiresAt'].includes(k)))throw new Error('APP_TASK_SESSION_INVALID');
}
function boundedTaskCommandView(value:unknown):ComputerTaskReference{
  if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['bindingId','taskId','state','workflowId','operationId','expiresAt','taskBinding','physicalAcceptance'].includes(k)))throw new Error('APP_TASK_BINDING_INVALID');
  return computerTaskReference(value);
}
export async function bindComputerTask(sessionId:string,workflowId:string,reference:ComputerTaskReference):Promise<ComputerTaskReference>{
  requireWorkflowAccess(sessionId,workflowId);assertComputerSessionActive(sessionId);
  const row=boundedTaskCommandView(await invokeRequired('computer_task_bind',{sessionId,workflowId,bindingId:reference.bindingId}));
  assertComputerSessionActive(sessionId);if(row.taskId!==reference.taskId||row.bindingId!==reference.bindingId)throw new Error('APP_TASK_BINDING_INVALID');return row;
}

export interface OwnedComputerSessionOutcome {
  state: 'pending_approval'|'active'|'terminal_unresolved'|'native_latched'|'native_quiescent';
  backendCleanup: 'not_requested'|'pending'|'complete'|'unresolved';
  error?: 'OWNED_SESSION_CANCELLED'|'OWNED_SESSION_ADMISSION_FAILED'|'OWNED_SESSION_CAPACITY'|'OWNED_SESSION_INVALID_REQUEST'|'NATIVE_STOP_INVALID_REQUEST'|'NATIVE_STOP_SCOPE_MISMATCH'|'NATIVE_STOP_SCOPE_UNAVAILABLE'|'NATIVE_STOP_UNRESOLVED';
}
export interface OwnedComputerSession {
  readonly ready: Promise<string>;
  cancel(): Promise<OwnedComputerSessionOutcome>;
  getState(): OwnedComputerSessionOutcome;
}
interface OwnedStopFacts {
  cleanupAttempt?: object;
  sessionId: string; active?: ActiveCanonicalSession; cancelled: boolean; quiescent: boolean;
  generation?: number; latchedAt?: string; state: OwnedComputerSessionOutcome['state'];
  backendCleanup: OwnedComputerSessionOutcome['backendCleanup']; error?: OwnedComputerSessionOutcome['error'];
  closing?: Promise<OwnedComputerSessionOutcome>;
}
interface OwnedApproval {
  beginIssued?: boolean;
  detach?: () => void;
  cancelled: boolean; settled: boolean; cleanupAttempted?: boolean; facts?: OwnedStopFacts; error?: OwnedComputerSessionOutcome['error'];
}
const ownedApprovals = new Set<OwnedApproval>();
const sessionStopFacts = new WeakMap<ActiveCanonicalSession, OwnedStopFacts>();
// Retain terminal identity without retaining candidate data or permitting reuse.
const terminalSteamSessions = new Set<string>();
function ownedFacts(sessionId: string, active: ActiveCanonicalSession): OwnedStopFacts {
  let facts = sessionStopFacts.get(active);
  if (!facts) {facts = {sessionId, active, cancelled: false, quiescent: false, state: 'active', backendCleanup: 'not_requested'}; sessionStopFacts.set(active, facts);}
  return facts;
}
function ownedOutcome(facts: OwnedStopFacts): OwnedComputerSessionOutcome {
  return {state: facts.state, backendCleanup: facts.backendCleanup, ...(facts.error ? {error: facts.error} : {})};
}
// Inspect only own data. Count compact JSON bytes without stringifying native
// objects (which could invoke toJSON/getters), recursion or a positive cache.
function scopedStopStatusCompatible(raw: unknown): boolean {
  const encoder = new TextEncoder(), active = new Set<object>();
  const stack: Array<{value: unknown; exit?: boolean}> = [{value: raw}];
  let bytes = 0, runtime: unknown, contract: unknown;
  const add = (count: number) => {bytes += count; if (bytes > 65536) throw false;};
  const textBytes = (value: string) => {if (value.length > 65536) throw false; return encoder.encode(JSON.stringify(value)).length;};
  try {
    if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype) return false;
    while (stack.length) {
      const item = stack.pop()!, value = item.value;
      if (item.exit) {active.delete(value as object); continue;}
      if (value === null) {add(4); continue;}
      if (typeof value === 'string') {add(textBytes(value)); continue;}
      if (typeof value === 'boolean') {add(value ? 4 : 5); continue;}
      if (typeof value === 'number') {if (!Number.isFinite(value)) return false; add(JSON.stringify(value).length); continue;}
      if (typeof value !== 'object' || active.has(value)) return false;
      const array = Array.isArray(value);
      if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false;
      active.add(value); stack.push({value, exit: true});
      const keys = Reflect.ownKeys(value);
      if (keys.length > 65537 || keys.some(key => typeof key !== 'string')) return false;
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (!length || !Object.hasOwn(length, 'value') || !Number.isInteger(length.value) || length.value < 0 || length.value > 65536 || keys.length !== length.value + 1) return false;
        add(2 + Math.max(0, length.value - 1));
        for (let index = 0; index < length.value; index++) {
          const d = Object.getOwnPropertyDescriptor(value, String(index));
          if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return false;
          stack.push({value: d.value});
        }
      } else {
        add(2 + Math.max(0, keys.length - 1));
        for (const key of keys as string[]) {
          const d = Object.getOwnPropertyDescriptor(value, key);
          if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return false;
          add(textBytes(key) + 1);
          if (value === raw && key === 'runtime') runtime = d.value;
          if (value === raw && key === 'scopedStopContract') contract = d.value;
          stack.push({value: d.value});
        }
      }
    }
    return runtime === 'tauri' && contract === 'edith.computer.expected-session-stop/1';
  } catch {return false;}
}
async function hasScopedStopCompatibility(): Promise<boolean> {
  try {return scopedStopStatusCompatible(await invokeRequired<unknown>('computer_status'));}
  catch {return false;}
}
function ownedReceipt(raw: unknown, facts: OwnedStopFacts): NativeComputerStopResult | undefined {
  try {
    const r = steamClosed(raw, ['nativeSessionId','originalGeneration','latchedGeneration','observedAt','state']);
    if (r.nativeSessionId !== facts.sessionId || !steamInteger(r.originalGeneration, 0, Number.MAX_SAFE_INTEGER - 1) ||
      !steamInteger(r.latchedGeneration, 1) || r.latchedGeneration !== r.originalGeneration + 1 ||
      !['native_latched','native_quiescent'].includes(r.state as string) || typeof r.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt ||
      (facts.generation !== undefined && (facts.generation !== r.originalGeneration || facts.latchedAt !== r.observedAt))) return;
    return r as unknown as NativeComputerStopResult;
  } catch {return;}
}
function consumeOwnedReceipt(raw: unknown, facts: OwnedStopFacts): void {
  if (facts.quiescent) return;
  const receipt = ownedReceipt(raw, facts);
  if (!receipt) {facts.state = 'terminal_unresolved'; facts.error = 'NATIVE_STOP_UNRESOLVED'; return;}
  facts.generation = receipt.originalGeneration!; facts.latchedAt = receipt.observedAt!;
  facts.cancelled = true; facts.state = receipt.state === 'native_quiescent' ? 'native_quiescent' : 'native_latched'; facts.error = undefined;
  if (facts.active && canonicalSessions.get(facts.sessionId) === facts.active) {
    canonicalSessions.delete(facts.sessionId); latestObservation.delete(facts.sessionId); explorerOperations.delete(facts.sessionId);
    for (const [id, target] of localOcrTargets) if (target.active === facts.active) localOcrTargets.delete(id);
  }
  if (receipt.state !== 'native_quiescent') return;
  facts.quiescent = true;
  terminalSteamSessions.add(facts.sessionId);
  for (const scope of steamEvidenceScopes.values()) if (scope.task.stop === facts) {scope.phase = 'ended'; scope.quiescent = true;}
}
async function cleanupOwnedBackend(facts: OwnedStopFacts): Promise<void> {
  if (!facts.quiescent) return;
  const tasks = [...steamEvidenceTasks.values()].filter(task => task.stop === facts);
  facts.backendCleanup = tasks.length ? 'pending' : 'not_requested';
  let failed = false;
  for (const task of tasks) if (!task.cleaned) {try {await steamCancelEvidenceTask(task);} catch {failed = true;}}
  if (tasks.length) facts.backendCleanup = failed ? 'unresolved' : 'complete';
}
async function stopOwnedFacts(facts: OwnedStopFacts): Promise<OwnedComputerSessionOutcome> {
  facts.cancelled = true;
  if (facts.closing) return facts.closing;
  const attempt = {}, originalId = facts.sessionId;
  facts.cleanupAttempt = attempt;
  const work = async () => {
    if (!facts.quiescent) {
      facts.state = 'terminal_unresolved'; facts.error = 'NATIVE_STOP_UNRESOLVED';
      try {
        const compatible = await hasScopedStopCompatibility();
        if (!facts.quiescent && compatible && facts.cleanupAttempt === attempt && facts.sessionId === originalId &&
          (!facts.active || !canonicalSessions.has(originalId) || canonicalSessions.get(originalId) === facts.active)) {
          const raw = await invokeRequired('computer_stop', {expectedSessionId: originalId});
          consumeOwnedReceipt(raw, facts);
        }
      } catch (error) {
        if (!facts.quiescent) {
          facts.state = 'terminal_unresolved';
          facts.error = typeof error === 'string' && ['NATIVE_STOP_INVALID_REQUEST','NATIVE_STOP_SCOPE_MISMATCH','NATIVE_STOP_SCOPE_UNAVAILABLE'].includes(error)
            ? error as OwnedComputerSessionOutcome['error'] : 'NATIVE_STOP_UNRESOLVED';
        }
      }
    }
    await cleanupOwnedBackend(facts);
    return ownedOutcome(facts);
  };
  facts.closing = work().finally(() => {if (facts.cleanupAttempt === attempt) {facts.closing = undefined; facts.cleanupAttempt = undefined;}});
  return facts.closing;
}
/** Local cancellation is intent, not dialog dismissal. At most 16 supervisors
 * retain unresolved native invocations; they outlive the component until settlement.
 * No caller-supplied IDs/receipts or implicit global STOP enter this API. */
export function createOwnedComputerSession(localSignal?: AbortSignal): OwnedComputerSession {
  const signal = localSignal instanceof AbortSignal ? localSignal : undefined;
  const invalidSignal = localSignal !== undefined && !signal;
  for (const approval of ownedApprovals) if (approval.settled && approval.facts?.quiescent && ![...steamEvidenceTasks.values()].some(task => task.stop === approval.facts && !task.cleaned)) {approval.detach?.(); ownedApprovals.delete(approval);}
  const approval: OwnedApproval = {cancelled: false, settled: false};
  let rejectCancellation: (error: string) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {rejectCancellation = reject;});
  const getState = (): OwnedComputerSessionOutcome => approval.facts ? ownedOutcome(approval.facts) :
    {state: approval.settled ? 'terminal_unresolved' : 'pending_approval', backendCleanup: 'not_requested', ...(approval.error ? {error: approval.error} : {})};
  const cancel = async () => {
    approval.cancelled = true; rejectCancellation('OWNED_SESSION_CANCELLED');
    signal?.removeEventListener('abort', onAbort);
    if (approval.facts) {approval.cleanupAttempted = true; return stopOwnedFacts(approval.facts);}
    return getState();
  };
  const onAbort = () => {void cancel();};
  const work = async () => {
    if (invalidSignal) {approval.settled = true; approval.error = 'OWNED_SESSION_INVALID_REQUEST'; throw 'OWNED_SESSION_INVALID_REQUEST';}
    if (ownedApprovals.size >= 16 || terminalSteamSessions.size >= 64 || [...ownedApprovals].some(a => (!a.settled || a.cancelled || a.facts?.cancelled) && !a.facts?.quiescent)) {
      approval.settled = true; approval.error = 'OWNED_SESSION_CAPACITY'; throw 'OWNED_SESSION_CAPACITY';
    }
    if (signal?.aborted) {approval.settled = true; approval.error = 'OWNED_SESSION_CANCELLED'; throw 'OWNED_SESSION_CANCELLED';}
    ownedApprovals.add(approval);
    signal?.addEventListener('abort', onAbort, {once: true});
    approval.detach = () => signal?.removeEventListener('abort', onAbort);
    const epoch = sessionEpoch, startedAt = Date.now();
    try {
      const compatible = await hasScopedStopCompatibility();
      if (approval.cancelled || epoch !== sessionEpoch) throw 'OWNED_SESSION_CANCELLED';
      if (!compatible) throw 'OWNED_SESSION_ADMISSION_FAILED';
      approval.beginIssued = true;
      const raw = await invokeRequired<unknown>('computer_begin');
      if (!nativeTaskId(raw) || terminalSteamSessions.has(raw) || [...ownedApprovals].some(a => a !== approval && a.facts?.sessionId === raw)) throw 'OWNED_SESSION_ADMISSION_FAILED';
      const facts: OwnedStopFacts = {sessionId: raw, cancelled: approval.cancelled, quiescent: false, state: 'active', backendCleanup: 'not_requested'};
      approval.facts = facts;
      if (approval.cancelled || epoch !== sessionEpoch) {approval.cancelled = true; throw 'OWNED_SESSION_CANCELLED';}
      const status = await getComputerDesktopStatus();
      if (approval.cancelled || facts.cancelled || epoch !== sessionEpoch) {approval.cancelled = true; throw 'OWNED_SESSION_CANCELLED';}
      const session = toDesktopOperatorSessionV2(status, {sessionId: raw, startedAt}, undefined, Date.now());
      const active: ActiveCanonicalSession = {startedAt, session, stream: new DesktopRealtimeEventStream(`desktop-${raw}`, raw)};
      facts.active = active; sessionStopFacts.set(active, facts); canonicalSessions.set(raw, active);
      return raw;
    } catch (error) {
      approval.cancelled = true;
      approval.error = error === 'OWNED_SESSION_CANCELLED' ? error : 'OWNED_SESSION_ADMISSION_FAILED';
      if (approval.facts && !approval.cleanupAttempted) {approval.cleanupAttempted = true; await stopOwnedFacts(approval.facts);}
      throw approval.error;
    } finally {
      approval.settled = true;
      if (!approval.beginIssued) ownedApprovals.delete(approval);
      if (approval.cancelled) signal?.removeEventListener('abort', onAbort);
    }
  };
  const ready = Promise.race([work(), cancelled]);
  // The supervisor may outlive a discarded UI; keep rejection handled internally.
  void ready.catch(() => undefined);
  return Object.freeze({ready, cancel, getState});
}

// This separate read path never enters observe/action/profile state. Native remains
// the authority for the original owner, held root, build association and policy TTL.
export const STEAM_READ_POLICY_ID = 'steam-noncontent-read-20261016-v1' as const;
export type SteamReadPolicyId = typeof STEAM_READ_POLICY_ID;
export const STEAM_READ_STATES = Object.freeze(['Library MAIN pre','DETAIL MAIN positive','same-root sidebar','same-root Properties','same-root settings','same-root overlay','same-root other panel'] as const);
export type SteamReadState = typeof STEAM_READ_STATES[number];
export type SteamReadRef = string;
export type SteamReadBegin = {version:1;op:'begin';sessionId:string;workflowId:string;bindingId:string;policyId:SteamReadPolicyId};
export type SteamReadSample = {version:1;op:'sample';readRef:SteamReadRef;state:SteamReadState};
export type SteamReadEnd = {version:1;op:'end';readRef:SteamReadRef};
export interface SteamReadBeginResult {schema:'edith.steam.read-session/1';status:'ready';readRef:SteamReadRef;expiresAt:number;allowedStates:SteamReadState[];candidateOnly:true;profileApproved:false}
export interface SteamReadEndResult {schema:'edith.steam.read-session/1';status:'ended';readRef:SteamReadRef;quiescent:boolean;candidateOnly:true;profileApproved:false}
export type SteamReadRecord = {nodeId:number;ancestorIds:number[]} & (
  {propertyId:30003|30157|30173;variant:'I4';value:number} |
  {propertyId:30010|30019|30022|30174|30079;variant:'BOOL';value:boolean} |
  {propertyId:30024|30107|30101|30102;variant:'BSTR';value:string});
export interface SteamReadCandidate {
  schema:'edith.steam.read-candidate/1';status:'candidate';readRef:SteamReadRef;sampleGeneration:number;state:SteamReadState;observedAt:number;expiresAt:number;
  candidateOnly:true;profileApproved:false;sourcePolicySha256:'FC4CD1597B941E10E00B6FA6EA70211E5FE4D013DCD5636456B7439C100C6699';
  sourceContractSha256:'D977C0D12AC0508B07DA80F6CA7852F502D18212F934C0EA973FF2E2C75095EA';nativeBuildId:string;policyId:SteamReadPolicyId;policyVersion:1;producer:'native_uia';
  coverage:{complete:true;view:'raw';nodeCount:number};records:SteamReadRecord[];
}
export interface SteamEvidenceTaskRequest {sessionId:string;workflowId:string;idempotencyKey:string;deadlineAt:string;intent:{app:'steam';workflow:'game_detail';gameName:string}}
const steamReadErrors = ['STEAM_READ_INVALID_REQUEST','STEAM_READ_POLICY_UNAVAILABLE','STEAM_READ_SCOPE_UNAVAILABLE','STEAM_READ_SCOPE_EXPIRED','STEAM_READ_SCOPE_CHANGED','STEAM_READ_BUSY','STEAM_READ_REPLAY','STEAM_READ_UNSUPPORTED','STEAM_READ_TIMEOUT','STEAM_READ_ENDED','STEAM_READ_CAPACITY'] as const;
export type SteamReadError = typeof steamReadErrors[number];
function steamReadFail(code:SteamReadError):never { throw code; }
function steamReadError(error:unknown):SteamReadError {return typeof error==='string'&&steamReadErrors.includes(error as SteamReadError)?error as SteamReadError:'STEAM_READ_UNSUPPORTED';}
function steamClosed(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)steamReadFail('STEAM_READ_INVALID_REQUEST');
  const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
  if(own.length!==keys.length||keys.some(k=>!Object.hasOwn(descriptors,k))||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))steamReadFail('STEAM_READ_INVALID_REQUEST');
  return value as Record<string,unknown>;
}
function steamArray(value:unknown,max:number):unknown[] {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max||Reflect.ownKeys(value).length!==value.length+1)steamReadFail('STEAM_READ_INVALID_REQUEST');
  for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))steamReadFail('STEAM_READ_INVALID_REQUEST');}return value;
}
function steamResponse(value:unknown,keys:readonly string[]):Record<string,unknown> {
  try{return steamClosed(value,keys);}catch{steamReadFail('STEAM_READ_UNSUPPORTED');}
}
const steamInteger=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const steamRef=(v:unknown):v is string=>typeof v==='string'&&/^steam-read:[a-f0-9]{64}$/.test(v);
const steamState=(v:unknown):v is SteamReadState=>typeof v==='string'&&STEAM_READ_STATES.includes(v as SteamReadState);
function steamByteBound(value:unknown,max:number):void {if(new TextEncoder().encode(JSON.stringify(value)).length>max)steamReadFail('STEAM_READ_INVALID_REQUEST');}
function steamIntent(value:unknown):SteamEvidenceTaskRequest['intent'] {
  const r=steamClosed(value,['app','workflow','gameName']),name=r.gameName;
  if(r.app!=='steam'||r.workflow!=='game_detail'||typeof name!=='string'||!name.trim()||Array.from(name).length>160||new TextEncoder().encode(name).length>640||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(name))steamReadFail('STEAM_READ_INVALID_REQUEST');
  return {app:'steam',workflow:'game_detail',gameName:name};
}
interface SteamEvidenceTask {sessionId:string;workflowId:string;active:ActiveCanonicalSession;stop:OwnedStopFacts;reservation?:{sessionId:string;workflowId:string};expiresAt:number;reference?:ComputerTaskReference;begun:boolean;cleaned:boolean;creationIssued?:boolean;bootstrapPending?:boolean;deferredCleanup?:boolean}
interface SteamEvidenceScope {task:SteamEvidenceTask;expiresAt:number;generation:number;used:Set<SteamReadState>;phase:'ready'|'blocked'|'ended';inFlight:boolean;quiescent:boolean;buildId?:string}
const steamEvidenceTasks=new Map<string,SteamEvidenceTask>(),steamEvidenceScopes=new Map<SteamReadRef,SteamEvidenceScope>();
const steamTaskKey=(sessionId:string,workflowId:string)=>`${sessionId}/${workflowId}`;
function steamAdmissionBusy():boolean {
  return [...ownedApprovals].some(a=>(!a.settled||a.cancelled||a.facts?.cancelled)&&!a.facts?.quiescent) ||
    [...steamEvidenceScopes.values()].some(s=>!s.quiescent) ||
    [...steamEvidenceTasks.values()].some(task=>task.begun&&!task.stop.quiescent&&![...steamEvidenceScopes.values()].some(scope=>scope.task===task));
}
function steamCurrent(task:SteamEvidenceTask):void {
  if(task.stop.cancelled)steamReadFail('STEAM_READ_SCOPE_CHANGED');
  if(canonicalSessions.get(task.sessionId)!==task.active||Date.parse(task.active.session.expiresAt)<=Date.now())steamReadFail('STEAM_READ_SCOPE_CHANGED');
  if(task.expiresAt<=Date.now())steamReadFail('STEAM_READ_SCOPE_EXPIRED');
  if(task.cleaned||workflowReservation?.sessionId!==task.sessionId||workflowReservation.workflowId!==task.workflowId)steamReadFail('STEAM_READ_SCOPE_CHANGED');
}
function steamPrune():void {
  for(const [ref,scope]of steamEvidenceScopes)if(scope.task.cleaned&&scope.expiresAt<=Date.now()&&scope.quiescent&&!scope.inFlight)steamEvidenceScopes.delete(ref);
  for(const [key,task]of steamEvidenceTasks)if(task.cleaned&&task.expiresAt<=Date.now()&&![...steamEvidenceScopes.values()].some(s=>s.task===task))steamEvidenceTasks.delete(key);
}
async function steamInvoke(evidence:SteamReadBegin|SteamReadSample|SteamReadEnd):Promise<unknown> {
  try{return await invokeRequired('computer_steam_diagnostic_capture',{evidence});}catch(error){steamReadFail(steamReadError(error));}
}
async function registerSteamEvidenceSession(value:unknown):Promise<void> {
  const r=steamClosed(value,['sessionId','workflowId','intent','evidencePolicyId']),intent=steamIntent(r.intent);
  if(!nativeTaskId(r.sessionId)||!nativeTaskId(r.workflowId)||r.evidencePolicyId!==STEAM_READ_POLICY_ID)steamReadFail('STEAM_READ_INVALID_REQUEST');steamByteBound(r,4096);
  if(terminalSteamSessions.has(r.sessionId))steamReadFail('STEAM_READ_SCOPE_CHANGED');
  if(terminalSteamSessions.size>=64)steamReadFail('STEAM_READ_CAPACITY');
  const key=steamTaskKey(r.sessionId,r.workflowId);if(steamEvidenceTasks.has(key))steamReadFail('STEAM_READ_REPLAY');
  steamPrune();if(steamAdmissionBusy())steamReadFail('STEAM_READ_BUSY');
  if(workflowReservation?.sessionId!==r.sessionId||workflowReservation.workflowId!==r.workflowId)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
  const active=canonicalSessions.get(r.sessionId);if(!active)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
  const task:SteamEvidenceTask={sessionId:r.sessionId,workflowId:r.workflowId,active,stop:ownedFacts(r.sessionId,active),reservation:workflowReservation,expiresAt:Math.min(Date.parse(active.session.expiresAt),Date.now()+30000),begun:false,cleaned:false};steamCurrent(task);
  steamPrune();if(steamEvidenceTasks.size>=16)steamReadFail('STEAM_READ_CAPACITY');steamEvidenceTasks.set(key,task);
  try {
    const row=steamResponse(await invokeRequired('computer_task_register',{sessionId:r.sessionId,workflowId:r.workflowId,intent,evidencePolicyId:STEAM_READ_POLICY_ID}),['registered','reservationId','expiresAt']);steamCurrent(task);
    if(row.registered!==true||row.reservationId!==r.workflowId||!steamInteger(row.expiresAt,1)||row.expiresAt<=Date.now()||row.expiresAt>task.expiresAt)steamReadFail('STEAM_READ_UNSUPPORTED');task.expiresAt=row.expiresAt;
  }catch(error){steamReadFail(steamReadError(error));}
}
function steamBinding(value:unknown,task:SteamEvidenceTask,created:boolean,cleanupOnly=false):ComputerTaskReference {
  const r=steamResponse(value,created?['success','bindingId','taskId','workflowId','state','expiresAt','taskBinding','physicalAcceptance']:['bindingId','taskId','state']);
  if(!nativeTaskId(r.taskId)||!nativeTaskId(r.bindingId)||!['QUEUED','RUNNING'].includes(r.state as string))steamReadFail('STEAM_READ_UNSUPPORTED');
  if(created){if(r.success!==true||r.workflowId!==task.workflowId||r.taskBinding!=='registered'||r.physicalAcceptance!==false||!steamInteger(r.expiresAt,1)||!cleanupOnly&&r.expiresAt<=Date.now()||r.expiresAt>task.expiresAt)steamReadFail('STEAM_READ_UNSUPPORTED');task.expiresAt=r.expiresAt;}
  if(task.reference&&(r.bindingId!==task.reference.bindingId||r.taskId!==task.reference.taskId))steamReadFail('STEAM_READ_UNSUPPORTED');
  return {taskId:r.taskId,bindingId:r.bindingId,taskState:r.state as string};
}
/** Register/create/bind only. Caller must supply the actual authorized intent;
 * this never starts a session, opens Steam, observes, dispatches or finishes a task. */
export async function createSteamEvidenceTask(value:SteamEvidenceTaskRequest):Promise<ComputerTaskReference> {
  let bootstrapTask:SteamEvidenceTask|undefined;
  const r=steamClosed(value,['sessionId','workflowId','idempotencyKey','deadlineAt','intent']),intent=steamIntent(r.intent);
  if(!nativeTaskId(r.sessionId)||!nativeTaskId(r.workflowId)||!nativeTaskId(r.idempotencyKey)||typeof r.deadlineAt!=='string'||!Number.isFinite(Date.parse(r.deadlineAt))||new Date(r.deadlineAt).toISOString()!==r.deadlineAt||Date.parse(r.deadlineAt)<=Date.now())steamReadFail('STEAM_READ_INVALID_REQUEST');
  if(terminalSteamSessions.has(r.sessionId))steamReadFail('STEAM_READ_SCOPE_CHANGED');
  if(terminalSteamSessions.size>=64)steamReadFail('STEAM_READ_CAPACITY');
  steamPrune();if(steamAdmissionBusy())steamReadFail('STEAM_READ_BUSY');
  try {
    const active=canonicalSessions.get(r.sessionId);if(!active)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
    if(Date.parse(r.deadlineAt)>Date.parse(active.session.expiresAt))steamReadFail('STEAM_READ_INVALID_REQUEST');
    await reserveComputerWorkflow(r.sessionId,r.workflowId,r.deadlineAt);
    await registerComputerTaskSession(r.sessionId,r.workflowId,intent,STEAM_READ_POLICY_ID);
    const task=steamEvidenceTasks.get(steamTaskKey(r.sessionId,r.workflowId))!;task.expiresAt=Math.min(task.expiresAt,Date.parse(r.deadlineAt));steamCurrent(task);
    bootstrapTask=task;task.creationIssued=true;task.bootstrapPending=true;
    const response=await ownerMutationFetch('/api/computer-use/workflows',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':r.idempotencyKey},body:JSON.stringify({workflowId:r.workflowId,sessionId:r.sessionId,request:intent})});
    if(!response.ok)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
    // Save only a validated identity from this actual HTTP invocation, even if
    // cancellation won while its response/body was pending. It is cleanup-only
    // until the original current/expiry guards pass; no late native bind follows.
    task.reference=steamBinding(await response.json(),task,true,task.stop.cancelled);steamCurrent(task);
    const bound=steamBinding(await invokeRequired('computer_task_bind',{sessionId:r.sessionId,workflowId:r.workflowId,bindingId:task.reference.bindingId}),task,false);steamCurrent(task);task.reference=bound;return {...bound};
  }catch(error){steamReadFail(steamReadError(error));}
  finally{
    if(bootstrapTask){
      bootstrapTask.bootstrapPending=false;
      if(bootstrapTask.deferredCleanup&&bootstrapTask.stop.quiescent&&bootstrapTask.reference){
        bootstrapTask.deferredCleanup=false;void cleanupOwnedBackend(bootstrapTask.stop);
      }
    }
  }
}
function steamCaptureRequest(value:unknown,op:'begin'|'sample'|'end'):Record<string,unknown> {
  const keys=op==='begin'?['version','op','sessionId','workflowId','bindingId','policyId']:op==='sample'?['version','op','readRef','state']:['version','op','readRef'];const r=steamClosed(value,keys);
  if(r.version!==1||r.op!==op)steamReadFail('STEAM_READ_INVALID_REQUEST');
  if(op==='begin'){if(![r.sessionId,r.workflowId,r.bindingId].every(nativeTaskId)||r.policyId!==STEAM_READ_POLICY_ID)steamReadFail('STEAM_READ_INVALID_REQUEST');}
  else if(!steamRef(r.readRef)||op==='sample'&&!steamState(r.state))steamReadFail('STEAM_READ_INVALID_REQUEST');steamByteBound({evidence:r},2048);return r;
}
export async function beginSteamEvidenceRead(value:SteamReadBegin):Promise<SteamReadBeginResult> {
  const r=steamCaptureRequest(value,'begin'),task=steamEvidenceTasks.get(steamTaskKey(r.sessionId as string,r.workflowId as string));
  if(!task?.reference||task.reference.bindingId!==r.bindingId)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');steamCurrent(task);
  if(task.begun)steamReadFail('STEAM_READ_REPLAY');task.begun=true;
  let raw:unknown;
  try {
    raw=await steamInvoke(r as SteamReadBegin);const row=steamClosed(raw,['schema','status','readRef','expiresAt','allowedStates','candidateOnly','profileApproved']);
    const states=steamArray(row.allowedStates,7);
    if(row.schema!=='edith.steam.read-session/1'||row.status!=='ready'||!steamRef(row.readRef)||!steamInteger(row.expiresAt,1)||row.expiresAt>task.expiresAt||row.candidateOnly!==true||row.profileApproved!==false||states.length!==7||states.some((s,i)=>s!==STEAM_READ_STATES[i])||steamEvidenceScopes.has(row.readRef))steamReadFail('STEAM_READ_UNSUPPORTED');steamCurrent(task);
    if(row.expiresAt<=Date.now())steamReadFail('STEAM_READ_SCOPE_EXPIRED');steamByteBound(row,2048);
    steamEvidenceScopes.set(row.readRef,{task,expiresAt:row.expiresAt,generation:0,used:new Set(),phase:'ready',inFlight:false,quiescent:false});
    return JSON.parse(JSON.stringify(row)) as SteamReadBeginResult;
  }catch(error){
    // A returned but undeliverable grant must still be revoked. Revocation is not
    // proof of worker closure, so failure never releases the original reservation.
    if(!task.stop.quiescent&&raw&&typeof raw==='object'){const d=Object.getOwnPropertyDescriptor(raw,'readRef');if(d&&steamRef(d.value)){
      if(!steamEvidenceScopes.has(d.value))steamEvidenceScopes.set(d.value,{task,expiresAt:task.expiresAt,generation:0,used:new Set(),phase:'ended',inFlight:false,quiescent:false});
      try{await endSteamEvidenceRead({version:1,op:'end',readRef:d.value});}catch{/* Keep the unresolved grant fenced; cleanup by original task can retry revocation only. */}
    }}
    steamReadFail(steamReadError(error)==='STEAM_READ_INVALID_REQUEST'?'STEAM_READ_UNSUPPORTED':steamReadError(error));
  }
}
const steamFrameworks=['Chrome','Win32','WPF','XAML','WinForm','WinForms'];
const steamProviderWords=['Microsoft','Windows','UI','UIA','UIAutomation','Automation','Provider','Proxy','MSAA','Chrome','Chromium','Valve','Steam','Win32','WPF','XAML','WinForm','WinForms','Core','Native','Client','Accessibility','Legacy','Universal'];
const steamIdentityWords=['Microsoft','Windows','Chrome','Chromium','Valve','Steam','Win32','WPF','XAML','WinForm','WinForms'];
const steamAria:Record<string,readonly string[]>={modal:['false','true'],busy:['false','true'],readonly:['false','true'],expanded:['false','true'],selected:['false','true'],disabled:['false','true'],multiselectable:['false','true'],required:['false','true'],atomic:['false','true'],hidden:['false','true'],orientation:['horizontal','vertical'],live:['off','polite','assertive'],current:['false','true','page','step','location','date','time'],haspopup:['false','true','menu','listbox','tree','grid','dialog'],level:['1','2','3','4','5','6','7','8','9']};
function steamPermittedBstr(property:unknown,value:unknown):boolean {
  if(typeof value!=='string'||value.length>160||!/^[\x20-\x7e]*$/.test(value))return false;
  if(property===30024)return steamFrameworks.includes(value);
  if(property===30107){const words=value.split(' ');return words.length>=2&&words.length<=12&&words.every(w=>steamProviderWords.includes(w))&&words.some(w=>w==='Provider'||w==='Proxy')&&words.some(w=>steamIdentityWords.includes(w));}
  if(property===30101)return value==='main';if(property!==30102)return false;if(value==='')return true;
  const parts=(value.endsWith(';')?value.slice(0,-1):value).split(';');if(parts.length>15)return false;const seen=new Set<string>();
  for(const part of parts){const m=/^([a-z]+)=([a-z0-9]+)$/.exec(part);if(!m||seen.has(m[1])||!Object.hasOwn(steamAria,m[1])||!steamAria[m[1]].includes(m[2]))return false;seen.add(m[1]);}return true;
}
function steamCandidate(value:unknown,scope:SteamEvidenceScope,request:SteamReadSample):SteamReadCandidate {
  const r=steamClosed(value,['schema','status','readRef','sampleGeneration','state','observedAt','expiresAt','candidateOnly','profileApproved','sourcePolicySha256','sourceContractSha256','nativeBuildId','policyId','policyVersion','producer','coverage','records']),coverage=steamClosed(r.coverage,['complete','view','nodeCount']);
  if(r.schema!=='edith.steam.read-candidate/1'||r.status!=='candidate'||r.readRef!==request.readRef||r.sampleGeneration!==scope.generation||r.state!==request.state||!steamInteger(r.observedAt)||r.observedAt>Date.now()||r.expiresAt!==scope.expiresAt||r.observedAt>=scope.expiresAt||r.candidateOnly!==true||r.profileApproved!==false||r.sourcePolicySha256!=='FC4CD1597B941E10E00B6FA6EA70211E5FE4D013DCD5636456B7439C100C6699'||r.sourceContractSha256!=='D977C0D12AC0508B07DA80F6CA7852F502D18212F934C0EA973FF2E2C75095EA'||typeof r.nativeBuildId!=='string'||!/^[a-f0-9]{64}$/.test(r.nativeBuildId)||scope.buildId&&scope.buildId!==r.nativeBuildId||r.policyId!==STEAM_READ_POLICY_ID||r.policyVersion!==1||r.producer!=='native_uia'||coverage.complete!==true||coverage.view!=='raw'||!steamInteger(coverage.nodeCount,1,512))steamReadFail('STEAM_READ_UNSUPPORTED');
  const records=steamArray(r.records,512*12),nodes=new Map<number,{path:number[];props:Map<number,unknown>}>();if(!records.length)steamReadFail('STEAM_READ_UNSUPPORTED');let lastNode=-1,lastProperty=-1;
  for(const value of records){const fact=steamClosed(value,['nodeId','ancestorIds','propertyId','variant','value']),ancestry=steamArray(fact.ancestorIds,32);
    if(!steamInteger(fact.nodeId,0,coverage.nodeCount-1)||!steamInteger(fact.propertyId)||!ancestry.length||ancestry[0]!==0||ancestry.at(-1)!==fact.nodeId||ancestry.some((v,i)=>!steamInteger(v,0,fact.nodeId as number)||i>0&&(v as number)<=(ancestry[i-1] as number))||fact.nodeId<lastNode||fact.nodeId===lastNode&&fact.propertyId<=lastProperty)steamReadFail('STEAM_READ_UNSUPPORTED');lastNode=fact.nodeId;lastProperty=fact.propertyId;
    let node=nodes.get(fact.nodeId);if(!node){node={path:ancestry as number[],props:new Map()};nodes.set(fact.nodeId,node);}else if(JSON.stringify(node.path)!==JSON.stringify(ancestry))steamReadFail('STEAM_READ_UNSUPPORTED');
    if(fact.variant==='I4'){if(!(fact.propertyId===30003&&steamInteger(fact.value,50000,50040)||fact.propertyId===30157&&(fact.value===0||steamInteger(fact.value,80000,80004))||fact.propertyId===30173&&(fact.value===0||steamInteger(fact.value,80050,80059))))steamReadFail('STEAM_READ_UNSUPPORTED');}
    else if(fact.variant==='BOOL'){if(![30010,30019,30022,30174,30079].includes(fact.propertyId)||typeof fact.value!=='boolean'||fact.propertyId===30019&&fact.value!==false)steamReadFail('STEAM_READ_UNSUPPORTED');}
    else if(fact.variant!=='BSTR'||!steamPermittedBstr(fact.propertyId,fact.value))steamReadFail('STEAM_READ_UNSUPPORTED');node.props.set(fact.propertyId,fact.value);
  }
  if(nodes.size!==coverage.nodeCount)steamReadFail('STEAM_READ_UNSUPPORTED');let main:number|undefined;
  for(let i=0;i<nodes.size;i++){const n=nodes.get(i);if(!n)steamReadFail('STEAM_READ_UNSUPPORTED');
    if(i>0){const parent=n.path.slice(0,-1),prior=nodes.get(i-1)!;if(JSON.stringify(parent)!==JSON.stringify(prior.path.slice(0,parent.length)))steamReadFail('STEAM_READ_UNSUPPORTED');}
    if(n.path.some((id,d)=>JSON.stringify(nodes.get(id)?.path)!==JSON.stringify(n.path.slice(0,d+1))))steamReadFail('STEAM_READ_UNSUPPORTED');
    const eligible=[50007,50029].includes(n.props.get(30003) as number);if([30003,30010,30019,30022,30157,30173,30174].some(p=>!n.props.has(p))||n.props.has(30079)!==eligible)steamReadFail('STEAM_READ_UNSUPPORTED');
    if(n.props.get(30157)===80002&&n.props.get(30022)===false){if(main!==undefined||n.props.get(30003)!==50033)steamReadFail('STEAM_READ_UNSUPPORTED');main=i;}
  }
  if(main===undefined||main===0)steamReadFail('STEAM_READ_UNSUPPORTED');for(const[id,n]of nodes)if([30024,30107,30101,30102].some(p=>n.props.has(p)!==(id===main)))steamReadFail('STEAM_READ_UNSUPPORTED');
  steamByteBound(r,65536);scope.buildId=r.nativeBuildId;return JSON.parse(JSON.stringify(r)) as SteamReadCandidate;
}
export async function sampleSteamEvidenceRead(value:SteamReadSample):Promise<SteamReadCandidate> {
  const r=steamCaptureRequest(value,'sample') as SteamReadSample,scope=steamEvidenceScopes.get(r.readRef);if(!scope)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');steamSampleCurrent(scope);
  if(scope.phase==='ended')steamReadFail('STEAM_READ_ENDED');if(scope.phase==='blocked')steamReadFail('STEAM_READ_UNSUPPORTED');if(scope.inFlight)steamReadFail('STEAM_READ_BUSY');if(scope.used.has(r.state))steamReadFail('STEAM_READ_REPLAY');
  scope.used.add(r.state);scope.generation++;scope.inFlight=true;scope.quiescent=false;
  try {const raw=await steamInvoke(r);steamSampleCurrent(scope);const candidate=steamCandidate(raw,scope,r);steamSampleCurrent(scope);return candidate;}
  catch(error){if(steamScopePhase(scope)!=='ended')scope.phase='blocked';const code=steamReadError(error);steamReadFail(code==='STEAM_READ_INVALID_REQUEST'?'STEAM_READ_UNSUPPORTED':code);}finally{scope.inFlight=false;}
}
function steamScopePhase(scope:SteamEvidenceScope):SteamEvidenceScope['phase'] {return scope.phase;}
function steamSampleCurrent(scope:SteamEvidenceScope):void {steamCurrent(scope.task);if(scope.expiresAt<=Date.now())steamReadFail('STEAM_READ_SCOPE_EXPIRED');if(scope.phase==='ended')steamReadFail('STEAM_READ_ENDED');}
export async function endSteamEvidenceRead(value:SteamReadEnd):Promise<SteamReadEndResult> {
  const r=steamCaptureRequest(value,'end') as SteamReadEnd,scope=steamEvidenceScopes.get(r.readRef);if(scope)scope.phase='ended';
  if(scope?.task.stop.quiescent)return {schema:'edith.steam.read-session/1',status:'ended',readRef:r.readRef,quiescent:true,candidateOnly:true,profileApproved:false};
  try {const row=steamClosed(await steamInvoke(r),['schema','status','readRef','quiescent','candidateOnly','profileApproved']);if(row.schema!=='edith.steam.read-session/1'||row.status!=='ended'||row.readRef!==r.readRef||typeof row.quiescent!=='boolean'||row.candidateOnly!==true||row.profileApproved!==false)steamReadFail('STEAM_READ_UNSUPPORTED');if(scope)scope.quiescent=scope.task.stop.quiescent||row.quiescent;return {...row,quiescent:scope?.task.stop.quiescent||row.quiescent} as unknown as SteamReadEndResult;}
  catch(error){const code=steamReadError(error);steamReadFail(code==='STEAM_READ_INVALID_REQUEST'?'STEAM_READ_UNSUPPORTED':code);}
}
/** End first, await actual native quiescence, then cancel the unfinished genuine
 * task and release its reservation. Never stop an existing user's session. */
export async function cleanupSteamEvidenceRead(readRef:SteamReadRef):Promise<SteamReadEndResult> {
  const ended=await endSteamEvidenceRead({version:1,op:'end',readRef}),scope=steamEvidenceScopes.get(readRef);if(!ended.quiescent&&!scope?.task.stop.quiescent)steamReadFail('STEAM_READ_BUSY');if(!scope||scope.task.cleaned)return ended;
  await steamCancelEvidenceTask(scope.task);return ended;
}
/** Also permits cleanup of a revoked, undeliverable begin result without leaking
 * its opaque reference. It cannot declare an unknown native worker quiescent. */
export async function cleanupSteamEvidenceTask(sessionId:string,workflowId:string):Promise<void> {
  if(!nativeTaskId(sessionId)||!nativeTaskId(workflowId))steamReadFail('STEAM_READ_INVALID_REQUEST');
  const task=steamEvidenceTasks.get(steamTaskKey(sessionId,workflowId));if(!task)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');if(task.cleaned)return;
  const scopes=[...steamEvidenceScopes.entries()].filter(([,s])=>s.task===task);
  if(!task.stop.quiescent){
    if(task.begun&&!scopes.length)steamReadFail('STEAM_READ_BUSY');
    for(const [readRef]of scopes)if(!(await endSteamEvidenceRead({version:1,op:'end',readRef})).quiescent)steamReadFail('STEAM_READ_BUSY');
  }
  await steamCancelEvidenceTask(task);
}
async function steamCancelEvidenceTask(task:SteamEvidenceTask):Promise<void> {
  if(!task.reference){
    if(task.bootstrapPending){task.deferredCleanup=true;steamReadFail('STEAM_READ_BUSY');}
    if(task.creationIssued&&task.stop.cancelled)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
    // No usable backend identity was admitted. Revoke only the actual original
    // reservation; never invent a binding to claim that an unknown row cancelled.
    if(task.begun&&!task.stop.quiescent)steamReadFail('STEAM_READ_BUSY');
    try{
      if(task.stop.quiescent){if(task.reservation&&workflowReservation===task.reservation)workflowReservation=undefined;}
      else await releaseComputerWorkflow(task.sessionId,task.workflowId);
      task.cleaned=true;return;
    }catch(error){steamReadFail(steamReadError(error));}
  }
  try {
    const response=await ownerMutationFetch(`/api/computer-use/workflows/${encodeURIComponent(task.reference!.bindingId)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)steamReadFail('STEAM_READ_SCOPE_UNAVAILABLE');
    const row=steamClosed(await response.json(),['success','bindingId','taskId','workflowId','state','expiresAt','taskBinding','physicalAcceptance']);
    if(row.success!==true||row.bindingId!==task.reference!.bindingId||row.taskId!==task.reference!.taskId||row.workflowId!==task.workflowId||row.state!=='CANCELLED'||!steamInteger(row.expiresAt,1)||row.expiresAt>task.expiresAt||row.taskBinding!=='registered'||row.physicalAcceptance!==false)steamReadFail('STEAM_READ_UNSUPPORTED');
    if(task.stop.quiescent){
      if(task.reservation&&workflowReservation===task.reservation)workflowReservation=undefined;
    }else await releaseComputerWorkflow(task.sessionId,task.workflowId);
    task.cleaned=true;
  }catch(error){const code=steamReadError(error);steamReadFail(code==='STEAM_READ_INVALID_REQUEST'?'STEAM_READ_UNSUPPORTED':code);}
}
export async function finishComputerTask(sessionId:string,workflowId:string,reference:ComputerTaskReference):Promise<ComputerTaskReference>{
  requireWorkflowAccess(sessionId,workflowId);assertComputerSessionActive(sessionId);
  const row=boundedTaskCommandView(await invokeRequired('computer_task_finish',{sessionId,workflowId,bindingId:reference.bindingId}));
  assertComputerSessionActive(sessionId);if(row.taskId!==reference.taskId||row.bindingId!==reference.bindingId||row.taskState!=='COMPLETED')throw new Error('APP_TASK_NOT_COMPLETED');
  return readComputerTaskCompletion(sessionId,reference);
}
export async function cancelComputerTask(sessionId:string,workflowId:string,reference:ComputerTaskReference):Promise<void>{
  requireWorkflowAccess(sessionId,workflowId);assertComputerSessionActive(sessionId);
  const row=boundedTaskCommandView(await invokeRequired('computer_task_cancel',{sessionId,workflowId,bindingId:reference.bindingId}));
  assertComputerSessionActive(sessionId);if(row.taskId!==reference.taskId||row.bindingId!==reference.bindingId)throw new Error('APP_TASK_BINDING_INVALID');
}
const nativeTaskId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(v);
export function computerTaskReference(value:unknown):ComputerTaskReference{
  if(!value||typeof value!=='object')throw new Error('APP_TASK_BINDING_INVALID');
  const row=value as Record<string,unknown>,state=row.taskState??row.state;
  if(!nativeTaskId(row.taskId)||!nativeTaskId(row.bindingId)||typeof state!=='string'||parseTaskStatus(state).success===false)throw new Error('APP_TASK_BINDING_INVALID');
  return {taskId:row.taskId,bindingId:row.bindingId,taskState:state};
}
export async function readComputerTaskState(sessionId:string,reference:ComputerTaskReference,signal?:AbortSignal):Promise<ComputerTaskReference>{
  assertComputerSessionActive(sessionId);const active=canonicalSessions.get(sessionId)!;
  const response=await ownerMutationFetch(`/api/computer-use/workflows/${encodeURIComponent(reference.bindingId)}`,{signal});
  requireCurrentSession(sessionId,active);if(!response.ok)throw new Error('APP_TASK_READBACK_REJECTED');
  const row=await response.json();requireCurrentSession(sessionId,active);const current=computerTaskReference(row);
  if(row.success!==true||row.taskBinding!=='registered'||row.physicalAcceptance!==false||current.taskId!==reference.taskId||current.bindingId!==reference.bindingId)throw new Error('APP_TASK_BINDING_INVALID');
  return current;
}
export async function readComputerTaskCompletion(sessionId:string,reference:ComputerTaskReference):Promise<ComputerTaskReference>{
  assertComputerSessionActive(sessionId);const active=canonicalSessions.get(sessionId)!,bound=computerTaskReference(reference);
  // Files can finish its independent effect before the native task proof arrives.
  // Read only for 2s, well inside the 30s reservation and 5s proof freshness;
  // this does not renew either authority or repeat any command/input.
  const deadline=performance.now()+2000,controller=new AbortController();
  const pending=(state:string)=>['QUEUED','RUNNING','VERIFYING'].includes(state);
  const guard=()=>{requireCurrentSession(sessionId,active);if(performance.now()>=deadline)throw new Error('APP_TASK_NOT_COMPLETED');};
  let cancelWait:(reason:unknown)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{cancelWait=reject;});
  // Also race the transport/body promise: even a broken transport that ignores
  // AbortSignal cannot hold the barrier beyond its deadline or a local STOP.
  const watchdog=setInterval(()=>{try{guard();}catch(error){cancelWait(error);controller.abort();}},20);
  const guarded=async<T>(work:()=>Promise<T>):Promise<T>=>{
    guard();try{const value=await Promise.race([work(),interrupted]);guard();return value;}catch(error){guard();throw error;}
  };
  try{
    for(let poll=0;poll<21;poll++){
      const current=await guarded(()=>readComputerTaskState(sessionId,bound,controller.signal));
      if(current.taskState!=='COMPLETED'&&!pending(current.taskState))throw new Error('APP_TASK_NOT_COMPLETED');
      const activity=await guarded(()=>ownerMutationFetch(`/api/edith/tasks/${encodeURIComponent(bound.taskId)}/activity`,{signal:controller.signal}));
      if(!activity.ok)throw new Error('APP_TASK_PROOF_UNAVAILABLE');
      const proof=await guarded(()=>activity.json());
      if(!proof||typeof proof!=='object'||proof.success!==true||proof.taskId!==bound.taskId||typeof proof.status!=='string'||parseTaskStatus(proof.status).success===false||proof.status!=='COMPLETED'&&!pending(proof.status))throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
      const verification=proof.verification;
      let required:Array<{id:string;status:string}>=[];
      if(verification!==undefined&&verification!==null){
        if(typeof verification!=='object'||verification.taskId!==bound.taskId||verification.status!=='PASS'||!Array.isArray(verification.checks)||verification.checks.some((check:unknown)=>!check||typeof check!=='object'||!nativeTaskId((check as {id?:unknown}).id)||!['PASS','FAIL','PARTIAL','RETRYABLE'].includes(String((check as {status?:unknown}).status))||typeof (check as {required?:unknown}).required!=='boolean'))throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
        required=verification.checks.filter((check:{required:boolean})=>check.required===true);
        if(required.length<2||required.some(check=>check.status!=='PASS')||!required.some(check=>check.id==='native-session-ledger')||!required.some(check=>check.id==='native-required-postcondition'))throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
      }
      if(proof.status==='COMPLETED'&&(verification===undefined||verification===null))throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
      if(current.taskState==='COMPLETED'){
        if(proof.status!=='COMPLETED')throw new Error('APP_TASK_REQUIRED_PROOF_UNVERIFIED');
        return current;
      }
      await guarded(()=>new Promise<void>(resolve=>setTimeout(resolve,100)));
    }
    throw new Error('APP_TASK_NOT_COMPLETED');
  }finally{clearInterval(watchdog);controller.abort();}
}
export async function getComputerExplorerText(sessionId:string,workflowId:string,operationId:string,intent:'source_parent'|'destination_parent'|'source_name'|'quarantine_name'|'quarantine_parent'):Promise<string>{
  requireWorkflowAccess(sessionId,workflowId);assertComputerSessionActive(sessionId);
  const text=await invokeRequired<string>('computer_explorer_text',{sessionId,workflowId,operationId,intent});assertComputerSessionActive(sessionId);
  if(typeof text!=='string'||!text.length||text.length>32768||/[\u0000-\u001f]/.test(text))throw new Error('EXPLORER_APPROVED_TEXT_INVALID');return text;
}
export async function exchangeComputerExplorer(sessionId:string,operationId:string,action:'check'|'quarantine'|'readback'|'finish'|'cancel',workflowId?:string):Promise<Record<string,unknown>>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId);
  if(!active)throw new Error('desktop_contract_session_missing');requireCurrentSession(sessionId,active);
  const response=await invokeRequired<Record<string,unknown>>('computer_explorer_exchange',{sessionId,operationId,action,workflowId});
  requireCurrentSession(sessionId,active);return response;
}
export async function consumePendingComputerExplorer(sessionId:string,deadlineAt?:number):Promise<import('./computerAppWorkflows').ComputerAppWorkflowResult|null>{
  const active=canonicalSessions.get(sessionId);if(!active)throw new Error('desktop_contract_session_missing');requireCurrentSession(sessionId,active);
  if(explorerOperations.has(sessionId))return null;
  if(workflowReservation)return null;
  const workflowId=`explorer-poll-${crypto.randomUUID()}`;
  await reserveComputerWorkflow(sessionId,workflowId,new Date(Math.min(Date.parse(active.session.expiresAt),Date.now()+30_000,deadlineAt??Infinity)).toISOString());
  try{
  const claim=await invokeRequired<ComputerExplorerClaim|null>('computer_explorer_claim',{sessionId,workflowId});requireCurrentSession(sessionId,active);
  if(claim===null)return null;
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(claim.operationId)||!['copy','move','undo','find'].includes(claim.operation)||!Number.isFinite(claim.expiresAt)||claim.expiresAt<=Date.now()||
    typeof claim.sourceName!=='string'||!claim.sourceName.length||claim.sourceName.length>255||/[\\/\u0000-\u001f]/.test(claim.sourceName)||typeof claim.quarantine!=='boolean'||
    !/^[a-f0-9]{64}$/.test(claim.sourceParentFingerprint)||(claim.operation!=='find'||claim.destinationParentFingerprint!==undefined)&&!/^[a-f0-9]{64}$/.test(claim.destinationParentFingerprint??'')||
    (claim.operation==='undo'?!['copy','move'].includes(claim.reverseOf??''):claim.reverseOf!==undefined)||claim.quarantine!==(claim.operation==='undo'&&claim.reverseOf==='copy')||
    Object.keys(claim).some(k=>!['operationId','operation','reverseOf','sourceName','sourceParentFingerprint','destinationParentFingerprint','expiresAt','quarantine','taskId','bindingId','taskState'].includes(k)))throw new Error('EXPLORER_CLAIM_INVALID');
  computerTaskReference(claim);
  explorerOperations.set(sessionId,claim.operationId);
  try{return await (await import('./computerAppWorkflows')).executeClaimedComputerExplorer(sessionId,claim,workflowId);}finally{explorerOperations.delete(sessionId);}
  }finally{await releaseComputerWorkflow(sessionId,workflowId);}
}
export async function prepareComputerExplorerTransport(sessionId:string,deadlineAt:number):Promise<void>{
  requireWorkflowAccess(sessionId);assertComputerSessionActive(sessionId);
  // A real authenticated empty poll establishes transport freshness only.
  // It does not assert Explorer readiness or a GUI effect.
  for(let poll=0;poll<=8;poll++){
    if(Date.now()>=deadlineAt)throw new Error('APP_WORKFLOW_EXPIRED');
    const pending=await consumePendingComputerExplorer(sessionId,deadlineAt);
    requireWorkflowAccess(sessionId);assertComputerSessionActive(sessionId);
    if(pending&&pending.status!=='verified')throw new Error('EXPLORER_PRIOR_EFFECT_UNVERIFIED');
    // A completed prior GUI job can take longer than the 15s health TTL.
    // Repoll until an actual empty response makes the following execute fresh.
    if(pending===null)return;
  }
  throw new Error('EXPLORER_POLL_BUDGET_EXHAUSTED');
}

export async function locateComputerTarget(sessionId:string,query:string,options?:ComputerOcrLocateOptions):Promise<SemanticTargetV2>{
  requireWorkflowAccess(sessionId,options?.workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active?.observation || !before)throw new Error('desktop_contract_observation_missing');
  const assertLocateCurrent=()=>{
    requireCurrentSession(sessionId,active);
    if(latestObservation.get(sessionId)!==before||before.expiresAt<=Date.now())throw new Error('stale_observation');
  };
  assertLocateCurrent();
  let target:{targetId:string;x:number;y:number;width:number;height:number};
  try{
    target=await invokeRequired('computer_locate',{sessionId,observationId:before.observationId,generation:before.generation,query,workflowId:options?.workflowId});
  }catch(error){
    assertLocateCurrent();
    const code=error instanceof Error?error.message:typeof error==='string'?error:undefined;
    if(!options||!['UIA_TARGET_NOT_FOUND','UIA_PROVIDER_UNAVAILABLE'].includes(code??''))throw error;
    if(options.postcondition?.kind!=='unique_text_transition')throw new Error('OCR_TRANSITION_INTENT_INVALID');
    const boundedQuery=ocrIntentText(query),beforeText=ocrIntentText(options.postcondition.beforeText),afterText=ocrIntentText(options.postcondition.afterText);
    if(beforeText===afterText)throw new Error('OCR_TRANSITION_INTENT_INVALID');
    const row=await invokeRequired<{target:SemanticTargetV2;windowId:string;windowProcessId:number;imagePathFingerprint:string;expiresAt:number}>('computer_locate_ocr',{
      sessionId,observationId:before.observationId,generation:before.generation,query:boundedQuery,
      postcondition:{kind:'unique_text_transition',beforeText,afterText},workflowId:options.workflowId,
    });
    assertLocateCurrent();
    if(!row||Object.keys(row).some(key=>!['target','windowId','windowProcessId','imagePathFingerprint','expiresAt'].includes(key)))throw new Error('OCR_TARGET_METADATA_INVALID');
    const parsed=parseSemanticTargetV2(row.target,active.observation);
    if(parsed.success===false)throw new Error(parsed.errorCode);
    const issued=parsed.value,bounds=issued.physicalBounds;
    if(Object.keys(issued).some(key=>!['contractVersion','amendment','targetId','observationId','observationGeneration','provenance','confidence','textFingerprint','physicalBounds'].includes(key))
      ||issued.provenance!=='ocr'||!/^ocr-[A-Za-z0-9:_-]{1,156}$/.test(issued.targetId)||issued.confidence!==1||!sha256Metadata(issued.textFingerprint)
      ||!bounds||Object.keys(bounds).some(key=>!['x','y','width','height','coordinateSpace'].includes(key))||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)||bounds.width>4096||bounds.height>4096
      ||row.windowId!==before.windowId||row.windowProcessId!==before.windowProcessId||!Number.isSafeInteger(row.windowProcessId)||row.windowProcessId<=0
      ||!sha256Metadata(row.imagePathFingerprint)||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=Date.now()
      ||row.expiresAt>Math.min(before.capturedAt+5000,before.expiresAt,Date.parse(active.session.expiresAt)))throw new Error('OCR_TARGET_METADATA_INVALID');
    const [queryFingerprint,preTextFingerprint,expectedTextFingerprint]=await Promise.all([textFingerprint(boundedQuery),textFingerprint(beforeText),textFingerprint(afterText)]);
    assertLocateCurrent();
    if(row.expiresAt<=Date.now()||issued.textFingerprint!==queryFingerprint)throw new Error('OCR_TARGET_METADATA_INVALID');
    const saved=Object.freeze({...issued,physicalBounds:Object.freeze({...bounds})});
    const facts:LocalOcrTarget={active,before,target:saved,windowId:row.windowId,windowProcessId:row.windowProcessId,imagePathFingerprint:row.imagePathFingerprint,
      expiresAt:row.expiresAt,preTextFingerprint,expectedTextFingerprint,workflowId:options.workflowId,consumed:false};
    requireOcrFacts(sessionId,facts);localOcrTargets.set(issued.targetId,facts);
    return {...saved,physicalBounds:{...saved.physicalBounds!}};
  }
  assertLocateCurrent();
  const parsed=parseSemanticTargetV2({contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,targetId:target.targetId,
    observationId:before.observationId,observationGeneration:before.generation,provenance:'uia',confidence:1,
    runtimeIdFingerprint:target.targetId.split(':').at(-1),physicalBounds:{x:target.x,y:target.y,width:target.width,height:target.height,coordinateSpace:'physical_virtual_desktop'}},active.observation);
  if(parsed.success===false)throw new Error(parsed.errorCode);
  return parsed.value;
}
export async function locateComputerFocusTarget(sessionId:string,applicationId:'spotify'|'steam'|'explorer',workflowId?:string):Promise<DesktopFocusTargetV2>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active?.observation||!active.approval||!before)throw new Error('desktop_contract_observation_missing');
  requireCurrentSession(sessionId,active);
  const target=await invokeRequired<DesktopFocusTargetV2>('computer_focus_target',{sessionId,observationId:before.observationId,generation:before.generation,app:applicationId,workflowId});
  requireCurrentSession(sessionId,active);
  if(latestObservation.get(sessionId)!==before||before.expiresAt<=Date.now())throw new Error('stale_observation');
  const parsed=parseDesktopFocusTargetV2(target,active.observation);
  if(parsed.success===false)throw new Error(parsed.errorCode);
  // The current local owner session grants a focus action only to the exact
  // window identity issued by native. A fresh observation restores other scopes.
  const approval={...active.approval,scope:{...active.approval.scope,actions:['focusApp' as const],targetIds:[target.windowId]}};
  const checked=parseScopedApprovalV2(approval,{observation:active.observation});
  if(checked.success===false)throw new Error(checked.errorCode);
  active.approval=checked.value;
  return parsed.value;
}
export async function readComputerText(sessionId:string,workflowId?:string):Promise<string>{
  requireWorkflowAccess(sessionId,workflowId);
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active || !before)throw new Error('desktop_contract_observation_missing');
  requireCurrentSession(sessionId,active);
  const text=await invokeRequired<string>('computer_read_text',{sessionId,observationId:before.observationId,generation:before.generation,workflowId});
  requireCurrentSession(sessionId,active);
  if(latestObservation.get(sessionId)!==before || before.expiresAt<=Date.now())throw new Error('stale_observation');
  return text;
}
async function textFingerprint(text:string):Promise<string>{
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function exactInsertion(before:string,after:string,inserted:string):boolean{
  if(!inserted || after.length!==before.length+inserted.length)return false;
  let offset=0;while(offset<before.length&&before[offset]===after[offset])offset++;
  return after.slice(offset,offset+inserted.length)===inserted && after.slice(offset+inserted.length)===before.slice(offset);
}
export async function readComputerOcr(sessionId:string):Promise<{observationId:string;generation:number;originX:number;originY:number;result:{text:string;words:Array<{text:string;x:number;y:number;width:number;height:number}>}}>{
  const active=canonicalSessions.get(sessionId),before=latestObservation.get(sessionId);
  if(!active || !before)throw new Error('desktop_contract_observation_missing');
  requireCurrentSession(sessionId,active);
  const result=await invokeRequired<Awaited<ReturnType<typeof readComputerOcr>>>('computer_ocr',{sessionId,observationId:before.observationId,generation:before.generation});
  requireCurrentSession(sessionId,active);
  if(latestObservation.get(sessionId)!==before || before.expiresAt<=Date.now() || result.observationId!==before.observationId || result.generation!==before.generation)throw new Error('stale_observation');
  return result;
}

export async function beginComputerSession(): Promise<string> {
  const epoch = sessionEpoch;
  const startedAt = Date.now();
  const sessionId = await invokeRequired<string>('computer_begin');
  const status = await getComputerDesktopStatus();
  if (epoch !== sessionEpoch) throw new Error('desktop_session_stopped_or_expired: approval cancelled.');
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
  workflowId?:string,
): Promise<{ wire: ComputerObservation; canonical: DesktopObservationV2 }> {
  requireWorkflowAccess(sessionId,workflowId);
  const active = canonicalSessions.get(sessionId);
  if (!active) throw new Error('desktop_contract_session_missing: start an approved session first.');
  requireCurrentSession(sessionId,active);
  const wire = await invokeRequired<ComputerObservation>(command, { sessionId,workflowId });
  requireCurrentSession(sessionId, active);
  const status = await getComputerDesktopStatus();
  requireCurrentSession(sessionId, active);
  const session = toDesktopOperatorSessionV2(status, { sessionId, startedAt: active.startedAt }, wire, Date.now());
  const canonical = toDesktopObservationV2(wire, session, Date.now());
  const approval = toScopedApprovalV2(session, canonical, Date.now());
  active.session = { ...session, currentObservationId: canonical.observationId, currentGeneration: canonical.generation };
  active.observation = canonical;
  active.approval = approval;
  latestObservation.set(sessionId, wire);
  for(const [id,facts] of localOcrTargets){
    if(facts.active===active&&(!facts.consumed||facts.expiresAt<=Date.now()))localOcrTargets.delete(id);
  }
  if (reportObservation) {
    await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.observation, canonical));
  }
  return { wire, canonical };
}

export async function observeComputer(sessionId: string,workflowId?:string): Promise<ComputerObservation> {
  return (await captureComputer(sessionId, 'computer_observe', true,workflowId)).wire;
}

export async function getComputerScreenshot(sessionId: string): Promise<ComputerObservation> {
  return (await captureComputer(sessionId, 'computer_screenshot', true)).wire;
}

export async function actOnComputer(sessionId: string, request: ComputerDesktopAction,workflowId?:string): Promise<ComputerActionResult> {
  requireWorkflowAccess(sessionId,workflowId);
  const before = latestObservation.get(sessionId);
  if (!before || before.expiresAt <= Date.now()) {
    throw new Error('stale_observation: observe immediately before acting.');
  }
  const active = canonicalSessions.get(sessionId);
  if (!active?.observation || !active.approval) throw new Error('desktop_contract_observation_missing: canonical observation and approval are required.');
  requireCurrentSession(sessionId,active);
  const preCanonical=active.observation;
  const ocrRequested=request.target?.provenance==='ocr'||request.target?.targetId.startsWith('ocr-');
  const ocrFacts=ocrRequested&&request.target?localOcrTargets.get(request.target.targetId):undefined;
  if(ocrRequested){
    if(!ocrFacts||!request.target||!sameOcrTarget(request.target,ocrFacts.target)||ocrFacts.active!==active||ocrFacts.before!==before
      ||ocrFacts.workflowId!==workflowId||ocrFacts.consumed||request.action!=='clickMouse'||(request.button??'left')!=='left'||(request.attempt??1)!==1)throw new Error('OCR_TARGET_ACTION_INVALID');
    requireOcrFacts(sessionId,ocrFacts);
  }
  const action = await toDesktopActionV2(request, {
    session: active.session,
    observation: active.observation,
    approval: active.approval,
  }, {
    actionId: request.actionId,
    idempotencyKey: request.idempotencyKey,
    attempt: request.attempt,
  });
  requireCurrentSession(sessionId,active);
  if(ocrFacts){
    requireOcrFacts(sessionId,ocrFacts);
    action.retryBudget={...action.retryBudget,maxAttempts:1,attempt:1};
    action.deadlineAt=new Date(Math.min(Date.parse(action.deadlineAt),ocrFacts.expiresAt)).toISOString();
  }
  const scheduled = actionLedger.run(action, async () => {
    const requestedEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.actionRequested, action, active.observation?.observationId);
    await reportComputerRealtimeEvent(requestedEvent);
    requireCurrentSession(sessionId, active);
    if (before.expiresAt <= Date.now() || latestObservation.get(sessionId) !== before) {
      throw new Error('stale_observation: target changed while awaiting dispatch.');
    }
    if(ocrFacts){
      requireOcrFacts(sessionId,ocrFacts);
      if(ocrFacts.consumed||localOcrTargets.get(ocrFacts.target.targetId)!==ocrFacts)throw new Error('OCR_TARGET_ACTION_INVALID');
      ocrFacts.consumed=true;
    }
    let nativeResult: ComputerActionResult;
    let preText:string|undefined;
    try {
      if(request.action==='typeText'){
        try{preText=await readComputerText(sessionId,workflowId);}catch{preText=undefined;}
        requireCurrentSession(sessionId,active);
        if(before.expiresAt<=Date.now()||latestObservation.get(sessionId)!==before)throw new Error('stale_observation: text readback changed the action context.');
      }
      nativeResult = await invokeRequired<ComputerActionResult>('computer_action', {
        sessionId,
        workflowId,
        ...(explorerOperations.has(sessionId)&&request.actionId?.startsWith(`explorer-${explorerOperations.get(sessionId)}-`)?{explorerOperationId:explorerOperations.get(sessionId)}:{}),
        request: {
          ...request,
          actionId: action.actionId,
          planId: `plan-${sessionId}`,
          stepId: action.actionId,
          observationId: action.observationId,
          observationGeneration: action.observationGeneration,
          expectedEffect: action.expectedEffect,
          maxAttempts: action.retryBudget.maxAttempts,
          attempt: action.retryBudget.attempt,
          idempotencyKey: action.idempotencyKey,
          approvalId:action.approvalId,
          deadlineAt: action.deadlineAt,
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
    requireCurrentSession(sessionId, active);
    if(ocrFacts&&(nativeResult.actionId!==action.actionId||nativeResult.preObservationId!==before.observationId||nativeResult.action!=='clickMouse'||nativeResult.attempts!==1))throw new Error('OCR_DISPATCH_IDENTITY_INVALID');
    const dispatch = toActionDispatchV2(action, nativeResult);
    const dispatchEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.dispatch, dispatch, requestedEvent.eventId);
    await reportComputerRealtimeEvent(dispatchEvent);

    let post: { wire: ComputerObservation; canonical: DesktopObservationV2 } | undefined;
    try {
      post = await captureComputer(sessionId, 'computer_screenshot', false,workflowId);
    } catch {
      post = undefined;
    }
    requireCurrentSession(sessionId, active);
    const freshPost = Boolean(post && post.wire.generation > before.generation
      && post.wire.capturedAt >= before.capturedAt && post.wire.expiresAt > Date.now());
    const cursorVerified = freshPost && request.action === 'moveMouse'
      && post?.wire.windowId === before.windowId
      && post?.wire.cursorX === request.x
      && post?.wire.cursorY === request.y;
    // A changed foreground window can be an unrelated user action. Require the
    // launched child identity, rather than upgrading any window change to success.
    const windowVerified = freshPost && request.action === 'launchApp'
      && Number.isSafeInteger(nativeResult.launchedProcessId)
      && nativeResult.launchedProcessId! > 0
      && post?.wire.windowProcessId === nativeResult.launchedProcessId;
    let focusReadback:ComputerActionResult['focusReadback'];
    if(request.action==='focusApp'&&freshPost&&post&&dispatch.status==='dispatched'
      &&nativeResult.focusReadback?.matched===true&&nativeResult.focusReadback.applicationId===request.applicationId
      &&nativeResult.focusReadback.windowId===request.focusTarget.windowId&&nativeResult.focusReadback.windowProcessId===request.focusTarget.processId
      &&nativeResult.focusReadback.imagePathFingerprint===request.focusTarget.imagePathFingerprint
      &&post.wire.windowId===request.focusTarget.windowId&&post.wire.windowProcessId===request.focusTarget.processId){
      try{
        const identity=await invokeRequired<DesktopFocusTargetV2>('computer_focus_target',{sessionId,observationId:post.wire.observationId,generation:post.wire.generation,app:request.applicationId,workflowId});
        requireCurrentSession(sessionId,active);
        const parsed=parseDesktopFocusTargetV2(identity,post.canonical);
        if(parsed.success&&identity.windowId===request.focusTarget.windowId&&identity.processId===request.focusTarget.processId&&identity.imagePathFingerprint===request.focusTarget.imagePathFingerprint&&latestObservation.get(sessionId)===post.wire&&post.wire.expiresAt>Date.now())focusReadback={source:'native_operator',applicationId:request.applicationId,windowId:identity.windowId,windowProcessId:identity.processId,imagePathFingerprint:identity.imagePathFingerprint,matched:true};
      }catch{focusReadback=undefined;}
    }
    let ocrReadback:ComputerOcrReadback|undefined;
    if(ocrFacts&&freshPost&&post&&dispatch.status==='dispatched'&&nativeResult.injected===true&&nativeResult.partialInputInjected!==true
      &&nativeResult.releaseConfirmed!==false&&post.wire.windowId===ocrFacts.windowId&&post.wire.windowProcessId===ocrFacts.windowProcessId){
      try{
        requireOcrFacts(sessionId,ocrFacts);
        const receipt=await invokeRequired<ComputerOcrReadback>('computer_ocr_readback',{sessionId,targetId:ocrFacts.target.targetId,canonicalActionId:action.actionId,
          postObservationId:post.wire.observationId,generation:post.wire.generation,workflowId});
        requireOcrFacts(sessionId,ocrFacts);
        if(latestObservation.get(sessionId)!==post.wire||post.wire.expiresAt<=Date.now()||localOcrTargets.get(ocrFacts.target.targetId)!==ocrFacts)throw new Error('stale_observation');
        const keys=['source','kind','targetId','canonicalActionId','preObservationId','postObservationId','preGeneration','postGeneration','windowId','windowProcessId','imagePathFingerprint','preTextFingerprint','postTextFingerprint','expectedTextFingerprint','matched','observedAt'];
        if(!receipt||Object.keys(receipt).length!==keys.length||Object.keys(receipt).some(key=>!keys.includes(key))
          ||receipt.source!=='native_operator'||receipt.kind!=='ocr_semantic_transition'||receipt.matched!==true
          ||receipt.targetId!==ocrFacts.target.targetId||receipt.canonicalActionId!==action.actionId||receipt.preObservationId!==before.observationId||receipt.postObservationId!==post.wire.observationId
          ||receipt.preGeneration!==before.generation||receipt.postGeneration!==post.wire.generation
          ||receipt.windowId!==ocrFacts.windowId||receipt.windowProcessId!==ocrFacts.windowProcessId||receipt.imagePathFingerprint!==ocrFacts.imagePathFingerprint
          ||![receipt.preTextFingerprint,receipt.postTextFingerprint,receipt.expectedTextFingerprint].every(sha256Metadata)
          ||receipt.preTextFingerprint!==ocrFacts.preTextFingerprint||receipt.expectedTextFingerprint!==ocrFacts.expectedTextFingerprint||receipt.postTextFingerprint!==ocrFacts.expectedTextFingerprint
          ||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<post.wire.capturedAt||receipt.observedAt>Date.now()||Date.now()-receipt.observedAt>5000)throw new Error('OCR_READBACK_UNBOUND');
        ocrReadback=Object.freeze({...receipt});registerValidatedOcrReadback(ocrReadback,()=>canonicalSessions.get(sessionId)===active&&latestObservation.get(sessionId)===post!.wire&&Math.min(ocrFacts.expiresAt,post!.wire.expiresAt,Date.parse(action.deadlineAt))>Date.now()&&Date.parse(active.session.expiresAt)>Date.now());
      }catch{ocrReadback=undefined;}
    }
    if(ocrFacts)localOcrTargets.delete(ocrFacts.target.targetId);
    let textReadback:ComputerActionResult['textReadback'];
    if(request.action==='typeText' && preText!==undefined && freshPost && post
      && dispatch.status==='dispatched' && nativeResult.partialInputInjected!==true
      && post.wire.windowId===before.windowId && post.wire.windowProcessId===before.windowProcessId
      && Number.isSafeInteger(before.windowProcessId)&&before.windowProcessId>0){
      try{
        const postText=await readComputerText(sessionId,workflowId);
        const matched=exactInsertion(preText,postText,request.text);
        if(matched){
          const [preTextFingerprint,postTextFingerprint]=await Promise.all([textFingerprint(preText),textFingerprint(postText)]);
          requireCurrentSession(sessionId,active);
          if(latestObservation.get(sessionId)!==post.wire||post.wire.expiresAt<=Date.now())throw new Error('stale_observation');
          textReadback={source:'uia',windowId:post.wire.windowId,windowProcessId:post.wire.windowProcessId,preTextFingerprint,postTextFingerprint,expectedTextFingerprint:action.textFingerprint!,matched:true};
        }
      }catch{textReadback=undefined;}
    }
    requireCurrentSession(sessionId,active);
    const visualChanged = !['moveMouse', 'launchApp','typeText','focusApp'].includes(request.action)
      && Boolean(post && post.wire.imageDataUrl !== before.imageDataUrl);
    const result: ComputerActionResult = {
      ...nativeResult,
      // Readback is generated locally from independent UIA calls, never accepted
      // from a dispatch receipt or persisted as raw document text.
      textReadback,
      focusReadback,
      ocrReadback,
      verification: cursorVerified ? 'cursor_position_confirmed'
        : windowVerified || visualChanged || ocrReadback?.matched ? 'post_observation_changed'
          : nativeResult.verification,
      verificationStatus: post ? (dispatch.status==='dispatched'&&(cursorVerified || windowVerified || textReadback?.matched || focusReadback?.matched || ocrReadback?.matched) ? 'verified' : 'partial') : 'pending_post_observation',
      postObservationId: post?.wire.observationId,
    };
    if(post)await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.observation,post.canonical,dispatchEvent.eventId));
    requireCurrentSession(sessionId,active);
    const verification = toActionVerificationV2(action, dispatch, result, post?.canonical,Date.now(),preCanonical);
    const verificationEvent = active.stream.emit(DESKTOP_REALTIME_EVENTS.verification, verification, dispatchEvent.eventId);
    await reportComputerRealtimeEvent(verificationEvent);
    const retryDecision = toRetryDecisionV2(action, verification);
    await reportComputerRealtimeEvent(active.stream.emit(DESKTOP_REALTIME_EVENTS.retryDecision, retryDecision, verificationEvent.eventId));
    return { ...result, canonicalLifecycle: { action, dispatch, verification, retryDecision } };
  });
  const result = await scheduled.result;
  requireCurrentSession(sessionId,active);
  if(ocrFacts&&result.ocrReadback&&!isValidatedComputerOcrReadback(result.ocrReadback))throw new Error('OCR_TARGET_EXPIRED');
  return scheduled.replayed ? { ...result, idempotencyReplayed: true } : result;
}

export interface NativeComputerStopResult {
  nativeSessionId:string|null; originalGeneration:number|null; latchedGeneration:number|null;
  observedAt:string|null; state:'native_latched'|'native_quiescent'|'unknown';
}
export async function stopComputer(): Promise<NativeComputerStopResult> {
  const activeIds=new Set(canonicalSessions.keys());
  const ownedStops = new Set<OwnedStopFacts>([
    ...[...steamEvidenceTasks.values()].filter(task=>canonicalSessions.get(task.sessionId)===task.active).map(task=>task.stop),
    ...[...ownedApprovals].flatMap(approval=>approval.facts?[approval.facts]:[]),
  ]);
  // Explicit global cancellation intent survives an unknown/lost native receipt.
  // It is not a closure witness and does not select an unrelated replacement.
  for (const facts of ownedStops) if (!facts.quiescent) {
    facts.cancelled = true; facts.state = 'terminal_unresolved'; facts.error = 'NATIVE_STOP_UNRESOLVED';
  }
  sessionEpoch += 1;
  // Invalidate pending awaits before waiting on the native stop command.
  latestObservation.clear();
  canonicalSessions.clear();
  localOcrTargets.clear();
  workflowReservation=undefined;
  explorerOperations.clear();
  const unknown:NativeComputerStopResult={nativeSessionId:null,originalGeneration:null,latchedGeneration:null,observedAt:null,state:'unknown'};
  if (!isTauriShell()) return unknown;
  const result=await invokeDesktopCommand<NativeComputerStopResult>('computer_stop');
  for (const facts of ownedStops) if (ownedReceipt(result, facts)) consumeOwnedReceipt(result, facts);
  if(!result || !['nativeSessionId','originalGeneration','latchedGeneration','observedAt','state'].every(k=>Object.hasOwn(result,k))
    || Object.keys(result).length!==5 || !['native_latched','native_quiescent','unknown'].includes(result.state)) return unknown;
  if(result.state==='unknown')return unknown;
  if(typeof result.nativeSessionId!=='string'||!activeIds.has(result.nativeSessionId)
    || !Number.isSafeInteger(result.originalGeneration)||Number(result.originalGeneration)<0
    || !Number.isSafeInteger(result.latchedGeneration)|| result.latchedGeneration!==Number(result.originalGeneration)+1
    || typeof result.observedAt!=='string'||!Number.isFinite(Date.parse(result.observedAt))
    || new Date(result.observedAt).toISOString()!==result.observedAt)return unknown;
  return result;
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
  let filePollInFlight = false;
  const report = async () => {
    try {
      const status = await getComputerDesktopStatus();
      if (!cancelled) await reportComputerRuntimeStatus(status);
      const current = [...canonicalSessions.entries()].find(([,active]) => Date.parse(active.session.expiresAt)>Date.now());
      if (!cancelled && status.ownerCommandMode && current && !filePollInFlight && !workflowReservation) {
        filePollInFlight = true;
        try {
          requireCurrentSession(current[0],current[1]);
          await invokeRequired('computer_file_open_pending',{sessionId:current[0]});
          requireCurrentSession(current[0],current[1]);
          await consumePendingComputerExplorer(current[0]);
        } finally { filePollInFlight = false; }
      }
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
