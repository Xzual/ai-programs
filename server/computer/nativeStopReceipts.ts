import { randomUUID } from 'node:crypto';
import { getSoleActiveOwnerSession, type OwnerSessionContext } from '../security/ownerSession';

const SCHEMA = 'edith.native-mobile/1';
const LIMIT = 256;
const RECEIPT_MS = 30_000;
export interface StopMobileScope { deviceId: string; workspaceId: string; sessionId: string }
/** Private server-derived snapshot; native epochs are unrelated to task/mobile revisions. */
export interface NativeSafetyMembership {
  readonly safetySessionRef: string;
  readonly nativeSessionId: string;
  readonly ownerBindingId: string;
  readonly originalGeneration: number;
  readonly nativeBootNonce: string;
  readonly expiresAt: number;
}
interface SafetySession { safetySessionRef: string; nativeSessionId: string; ownerBindingId: string; originalGeneration: number; nativeBootNonce: string; expiresAt: number; revoked: boolean; retired: boolean }
interface StopRequest { stopRequestId: string; scope: 'global'; session?: SafetySession; mobile: StopMobileScope; commandId: string; idempotencyKey: string; acceptedAt: number; expiresAt: number; latched?: Receipt; quiescent?: Receipt }
interface Receipt { schema: string; stopRequestId: string; safetySessionRef: string; nativeSessionId: string; originalGeneration: number; latchedGeneration: number; observedAt: string; phase: 'latched' | 'quiescent'; quiescentAt?: string }
export class NativeStopReceiptError extends Error { constructor(public code: string, public status = 409) { super(code); } }
function fail(code: string, status = 409): never { throw new NativeStopReceiptError(code, status); }
function object(value: unknown, fields: string[], optional: string[] = []): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 8192) fail('NATIVE_STOP_INPUT_INVALID',400);
  const v = value as Record<string, any>;
  if (fields.some(key => !Object.hasOwn(v,key)) || Object.keys(v).some(key => !fields.includes(key) && !optional.includes(key))) fail('NATIVE_STOP_INPUT_INVALID',400);
  return v;
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) fail('NATIVE_STOP_INPUT_INVALID',400); return value; }
function time(value: unknown): number { const ms = typeof value === 'string' ? Date.parse(value) : NaN; if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('NATIVE_STOP_INPUT_INVALID',400); return ms; }
function generation(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) fail('NATIVE_STOP_INPUT_INVALID',400); return Number(value); }

/** RAM correlation of authenticated native assertions; never an input authority or hardware attestation. */
export class NativeStopReceiptRegistry {
  private sessions = new Map<string,SafetySession>();
  private requests = new Map<string,StopRequest>();
  constructor(private now: () => number = Date.now, private owner: () => OwnerSessionContext | undefined = getSoleActiveOwnerSession) {}
  private prune() {
    const now = this.now();
    for (const [key,row] of this.requests) if (row.expiresAt <= now) this.requests.delete(key);
    for (const [key,row] of this.sessions) if (row.expiresAt <= now && ![...this.requests.values()].some(request => request.session === row)) this.sessions.delete(key);
  }
  requireActiveSession(ownerBindingId: string, nativeSessionId: string): Readonly<NativeSafetyMembership> {
    this.prune();
    const owner = this.owner();
    if (!owner || owner.bindingId !== ownerBindingId || owner.expiresAt <= this.now()) fail('NATIVE_SAFETY_OWNER_INVALID',403);
    const rows = [...this.sessions.values()].filter(row => row.ownerBindingId === ownerBindingId && row.nativeSessionId === nativeSessionId && !row.revoked && !row.retired && row.expiresAt > this.now());
    if (!rows.length) fail('NATIVE_SAFETY_SESSION_UNAVAILABLE',410);
    if (rows.length !== 1) fail('NATIVE_SAFETY_SESSION_AMBIGUOUS');
    const row = rows[0];
    return Object.freeze({safetySessionRef:row.safetySessionRef,nativeSessionId:row.nativeSessionId,ownerBindingId:row.ownerBindingId,originalGeneration:row.originalGeneration,nativeBootNonce:row.nativeBootNonce,expiresAt:row.expiresAt});
  }
  assertActiveSession(membership: NativeSafetyMembership): void {
    this.prune();
    if (!membership || typeof membership !== 'object') fail('NATIVE_SAFETY_MEMBERSHIP_INVALID');
    const owner = this.owner();
    if (!owner || owner.bindingId !== membership.ownerBindingId || owner.expiresAt <= this.now()) fail('NATIVE_SAFETY_OWNER_INVALID',403);
    const row = this.sessions.get(membership.safetySessionRef);
    if (!row || row.revoked || row.retired || row.expiresAt <= this.now()) fail('NATIVE_SAFETY_SESSION_UNAVAILABLE',410);
    for (const field of ['safetySessionRef','nativeSessionId','ownerBindingId','originalGeneration','nativeBootNonce','expiresAt'] as const) {
      if (row[field] !== membership[field]) fail('NATIVE_SAFETY_MEMBERSHIP_INVALID');
    }
    const active = this.requireActiveSession(membership.ownerBindingId,membership.nativeSessionId);
    if (active.safetySessionRef !== membership.safetySessionRef) fail('NATIVE_SAFETY_MEMBERSHIP_INVALID');
  }
  register(value: unknown, owner: OwnerSessionContext) {
    this.prune();
    const v = object(value,['schema','nativeSessionId','ownerBindingId','originalGeneration','sessionExpiresAt','nativeBootNonce']);
    if (v.schema !== SCHEMA || id(v.ownerBindingId) !== owner.bindingId || this.owner()?.bindingId !== owner.bindingId) fail('NATIVE_STOP_OWNER_INVALID',403);
    const nativeSessionId = id(v.nativeSessionId), nativeBootNonce = id(v.nativeBootNonce), originalGeneration = generation(v.originalGeneration);
    const expiresAt = Math.min(time(v.sessionExpiresAt),owner.expiresAt,this.now()+300_000);
    if (expiresAt <= this.now()) fail('NATIVE_STOP_EXPIRED',410);
    for (const row of this.sessions.values()) {
      if (row.nativeSessionId === nativeSessionId && row.nativeBootNonce === nativeBootNonce) fail('NATIVE_STOP_SESSION_ALREADY_REGISTERED');
      if (!row.revoked && !row.retired && row.expiresAt > this.now()) fail('NATIVE_STOP_SESSION_ALREADY_ACTIVE');
    }
    if (this.sessions.size >= LIMIT) fail('NATIVE_STOP_CAPACITY',503);
    const row: SafetySession = {safetySessionRef:`safety-${randomUUID()}`,nativeSessionId,nativeBootNonce,ownerBindingId:owner.bindingId,originalGeneration,expiresAt,revoked:false,retired:false};
    this.sessions.set(row.safetySessionRef,row);
    return {safetySessionRef:row.safetySessionRef,expiresAt:new Date(expiresAt).toISOString()};
  }
  acceptGlobal(scope: StopMobileScope & { commandId: string; idempotencyKey: string }) {
    this.prune();
    for (const key of ['deviceId','workspaceId','sessionId','commandId','idempotencyKey'] as const) id(scope[key]);
    const prior = [...this.requests.values()].find(row => row.mobile.deviceId === scope.deviceId && row.mobile.workspaceId === scope.workspaceId && row.mobile.sessionId === scope.sessionId && row.idempotencyKey === scope.idempotencyKey);
    if (prior) { if(prior.commandId !== scope.commandId) fail('NATIVE_STOP_IDEMPOTENCY_CONFLICT'); return this.accepted(prior); }
    if (this.requests.size >= LIMIT) fail('NATIVE_STOP_CAPACITY',503);
    const owner = this.owner();
    const session = [...this.sessions.values()].find(row => !row.revoked && !row.retired && row.expiresAt > this.now() && row.ownerBindingId === owner?.bindingId && owner.expiresAt > this.now());
    const acceptedAt = this.now(), expiresAt = Math.min(acceptedAt+RECEIPT_MS,session?.expiresAt ?? acceptedAt+RECEIPT_MS);
    const row: StopRequest = {stopRequestId:`stop-${randomUUID()}`,scope:'global',session,mobile:{deviceId:scope.deviceId,workspaceId:scope.workspaceId,sessionId:scope.sessionId},commandId:scope.commandId,idempotencyKey:scope.idempotencyKey,acceptedAt,expiresAt};
    this.requests.set(row.stopRequestId,row);
    return this.accepted(row);
  }
  private accepted(row: StopRequest) { return {stopRequestId:row.stopRequestId,state:'backend_accepted' as const,acceptedAt:new Date(row.acceptedAt).toISOString(),expiresAt:new Date(row.expiresAt).toISOString()}; }
  safety(ref: string) {
    this.prune(); const session = this.sessions.get(id(ref));
    if (!session || session.revoked || session.retired || session.expiresAt <= this.now()) fail('NATIVE_STOP_SCOPE_UNAVAILABLE',410);
    const row = [...this.requests.values()].find(request => request.session === session && !request.quiescent);
    if (!row && this.owner()?.bindingId !== session.ownerBindingId) fail('NATIVE_STOP_OWNER_UNAVAILABLE',410);
    return row ? {...this.accepted(row),scope:row.scope,safetySessionRef:ref,nativeSessionId:session.nativeSessionId,originalGeneration:session.originalGeneration} : undefined;
  }
  receipt(value: unknown) {
    this.prune(); const v = object(value,['schema','stopRequestId','safetySessionRef','nativeSessionId','originalGeneration','latchedGeneration','observedAt','phase'],['quiescentAt']);
    const row = this.requests.get(id(v.stopRequestId)), session = row?.session;
    if (!row || !session || session.revoked || row.expiresAt <= this.now()) fail('NATIVE_STOP_REQUEST_UNAVAILABLE',410);
    if(v.schema !== SCHEMA || id(v.safetySessionRef) !== session.safetySessionRef || id(v.nativeSessionId) !== session.nativeSessionId || generation(v.originalGeneration) !== session.originalGeneration || generation(v.latchedGeneration) !== session.originalGeneration+1) fail('NATIVE_STOP_SCOPE_INVALID');
    const observed = time(v.observedAt);
    if(observed < row.acceptedAt || observed > this.now() || observed >= row.expiresAt) fail('NATIVE_STOP_TIME_INVALID');
    if(v.phase !== 'latched' && v.phase !== 'quiescent') fail('NATIVE_STOP_PHASE_INVALID',400);
    if(v.phase === 'latched' && Object.hasOwn(v,'quiescentAt')) fail('NATIVE_STOP_PHASE_INVALID',400);
    if(v.phase === 'quiescent' && (!row.latched || v.observedAt !== row.latched.observedAt || time(v.quiescentAt) < observed || time(v.quiescentAt) > this.now() || time(v.quiescentAt) >= row.expiresAt)) fail('NATIVE_STOP_PHASE_INVALID');
    const prior = row[v.phase];
    if (prior) { if(Object.keys(prior).some(key => prior[key as keyof Receipt] !== v[key]) || Object.keys(v).length !== Object.keys(prior).length) fail('NATIVE_STOP_RECEIPT_CONFLICT'); return {accepted:true,phase:v.phase}; }
    if(v.phase === 'latched' && row.quiescent) fail('NATIVE_STOP_PHASE_REGRESSION');
    row[v.phase] = {...v} as Receipt;
    return {accepted:true,phase:v.phase};
  }
  project(requestId: string, scope: StopMobileScope) {
    this.prune(); const row = this.requests.get(id(requestId));
    if(!row || Object.entries(row.mobile).some(([key,value]) => scope[key as keyof StopMobileScope] !== value)) fail('NATIVE_STOP_NOT_FOUND',404);
    return {...this.accepted(row),state:row.session?.revoked || !row.session ? 'unknown' : row.quiescent ? 'native_quiescent' : row.latched ? 'native_latched' : 'backend_accepted',...(row.latched?{observedAt:row.latched.observedAt}:{}),...(row.quiescent?{quiescentAt:row.quiescent.quiescentAt}:{})};
  }
  /** Release effect membership only; retain original request receipts and identity tombstone until expiry. */
  retire(value: unknown) {
    this.prune();
    const v = object(value,['schema','safetySessionRef','nativeSessionId','nativeBootNonce','originalGeneration']);
    const session = this.sessions.get(id(v.safetySessionRef));
    if (!session || session.revoked || session.expiresAt <= this.now()) fail('NATIVE_STOP_SCOPE_UNAVAILABLE',410);
    if (v.schema !== SCHEMA || id(v.nativeSessionId) !== session.nativeSessionId || id(v.nativeBootNonce) !== session.nativeBootNonce || generation(v.originalGeneration) !== session.originalGeneration) fail('NATIVE_STOP_SCOPE_INVALID');
    session.retired = true;
    return {safetySessionRef:session.safetySessionRef,retired:true as const,expiresAt:new Date(session.expiresAt).toISOString()};
  }
  revoke(ref: string) { const row = this.sessions.get(ref); if(row) row.revoked = true; }
}
export const nativeStopReceipts = new NativeStopReceiptRegistry();
