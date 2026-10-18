import {ownerMutationFetch} from './ownerMutationClient';

export const REA_LOCAL_PROFILES = Object.freeze(['static-javascript', 'static-managed', 'app-package', 'native-binary', 'static-apk', 'apk-resources'] as const);
export type ReaLocalProfile = typeof REA_LOCAL_PROFILES[number];
export interface ReaLocator {id: string; kind: 'file' | 'directory'}
export interface ReaSelectionProjection {
  readonly schemaVersion: 1; readonly selectionRef: string; readonly profile: ReaLocalProfile;
  readonly revision: number; readonly expiresAt: number;
}
const reasonKinds = ['missing_code', 'missing_engine', 'qualification_failed', 'unsupported_operation', 'quota_stop', 'live_user_constraint'] as const;
export interface ReaFalseCompositionStatus {
  readonly schemaVersion: 1; readonly runtimeReady: false; readonly outcome: 'configuration_required';
  readonly reasons: readonly Readonly<{kind: typeof reasonKinds[number]; code: string}>[];
}
export interface ReaSelectionSnapshot {
  readonly state: 'idle' | 'loading' | 'selected' | 'error' | 'expired'; readonly scope?: string;
  readonly selection?: ReaSelectionProjection; readonly status?: ReaFalseCompositionStatus; readonly error: string;
}
const messages = {
  invalid: 'Hedef seçimi yanıtı doğrulanamadı.',
  status: 'Yerel analiz yapılandırması okunamadı.',
  select: 'Hedef seçilemedi. Güncel dosya listesinden yeniden seçim yapın.',
  revoke: 'Seçimin kaldırıldığı doğrulanamadı. Güncel kapsamı yeniden kontrol edin.',
  scope: 'Güncel çalışma alanı doğrulanmadan hedef seçilemez.',
  expired: 'Hedef seçiminin süresi doldu. Yeniden açıkça seçim yapın.',
} as const;
const invalid = (): never => {throw new Error(messages.invalid);};
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function profile(value: unknown): ReaLocalProfile {
  if (typeof value !== 'string' || !(REA_LOCAL_PROFILES as readonly string[]).includes(value)) return invalid();
  return value as ReaLocalProfile;
}
function parseLocator(value: unknown): ReaLocator {
  const row = object(value, ['id', 'kind']);
  if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || row.kind !== 'file' && row.kind !== 'directory') return invalid();
  return Object.freeze({id: row.id, kind: row.kind});
}
function parsed<T>(read: () => T): T {try {return read();} catch {return invalid();}}
export function parseReaStatusResponse(value: unknown): ReaFalseCompositionStatus {
  return parsed(() => {
    const row = object(value, ['success', 'schemaVersion', 'runtimeReady', 'outcome', 'reasons']);
    if (row.success !== true || row.schemaVersion !== 1 || row.runtimeReady !== false || row.outcome !== 'configuration_required'
      || !Array.isArray(row.reasons) || row.reasons.length < 1 || row.reasons.length > 32) return invalid();
    const reasons = row.reasons.map(value => {
      const reason = object(value, ['kind', 'code']);
      if (typeof reason.kind !== 'string' || !(reasonKinds as readonly string[]).includes(reason.kind)
        || typeof reason.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(reason.code)) return invalid();
      return Object.freeze({kind: reason.kind as typeof reasonKinds[number], code: reason.code});
    });
    return Object.freeze({schemaVersion: 1, runtimeReady: false, outcome: 'configuration_required', reasons: Object.freeze(reasons)});
  });
}
export function parseReaSelectedResponse(value: unknown): ReaSelectionProjection {
  return parsed(() => {
    const row = object(value, ['success', 'outcome', 'selection']);
    if (row.success !== true || row.outcome !== 'selected') return invalid();
    const selection = object(row.selection, ['schemaVersion', 'selectionRef', 'profile', 'revision', 'expiresAt']);
    if (selection.schemaVersion !== 1 || !safeId(selection.selectionRef) || !positive(selection.revision) || !positive(selection.expiresAt)) return invalid();
    return Object.freeze({schemaVersion: 1, selectionRef: selection.selectionRef, profile: profile(selection.profile), revision: selection.revision, expiresAt: selection.expiresAt});
  });
}
export function parseReaRevokeResponse(value: unknown): true {
  return parsed(() => {const row = object(value, ['success', 'revoked']); if (row.success !== true || row.revoked !== true) return invalid(); return true;});
}
function assertActive(signal?: AbortSignal): void {if (signal?.aborted) throw new DOMException('İstek iptal edildi.', 'AbortError');}
async function readResponse<T>(request: () => Promise<Response>, expectedStatus: number, parse: (value: unknown) => T, message: string, signal?: AbortSignal): Promise<T> {
  assertActive(signal);
  try {
    const response = await request(); assertActive(signal);
    if (!response.ok || response.status !== expectedStatus) throw new Error(message);
    const body: unknown = await response.json(); assertActive(signal);
    return parse(body);
  } catch {assertActive(signal); throw new Error(message);}
}
/** This endpoint describes static-javascript composition only. It never attests other profiles. */
export function fetchReaSelectionStatus(signal?: AbortSignal): Promise<ReaFalseCompositionStatus> {
  return readResponse(() => fetch('/api/files/rea/status', {credentials: 'include', cache: 'no-store', signal, headers: {Accept: 'application/json'}}), 200, parseReaStatusResponse, messages.status, signal);
}
export async function selectReaTarget(locator: ReaLocator, selectedProfile: ReaLocalProfile, signal?: AbortSignal): Promise<ReaSelectionProjection> {
  assertActive(signal);
  const body = parsed(() => ({locator: parseLocator(locator), profile: profile(selectedProfile)}));
  return readResponse(() => ownerMutationFetch('/api/files/rea/selections', {method: 'POST', signal, headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)}), 201,
    value => {const selection = parseReaSelectedResponse(value); if (selection.profile !== body.profile) return invalid(); return selection;}, messages.select, signal);
}
export async function revokeReaTarget(selectionRef: string, signal?: AbortSignal): Promise<void> {
  assertActive(signal); if (!safeId(selectionRef)) return invalid();
  await readResponse(() => ownerMutationFetch(`/api/files/rea/selections/${encodeURIComponent(selectionRef)}/revoke`, {method: 'POST', signal, headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: '{}'}), 200, parseReaRevokeResponse, messages.revoke, signal);
}

interface ControllerOptions {
  scope(): string | undefined;
  now?(): number;
  setTimeout?(callback: () => void, milliseconds: number): unknown;
  clearTimeout?(timer: unknown): void;
  readStatus?(signal: AbortSignal): Promise<ReaFalseCompositionStatus>;
  selectTarget?(locator: ReaLocator, profile: ReaLocalProfile, signal: AbortSignal): Promise<ReaSelectionProjection>;
  revokeTarget?(selectionRef: string, signal: AbortSignal): Promise<void>;
}
export function createReaSelectionController(options: ControllerOptions) {
  const now = options.now ?? Date.now, schedule = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? (timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  const read = options.readStatus ?? fetchReaSelectionStatus, select = options.selectTarget ?? selectReaTarget, revoke = options.revokeTarget ?? revokeReaTarget;
  const listeners = new Set<() => void>();
  let epoch = 0, disposed = false, mutationPending = false, request: AbortController | undefined, timer: unknown;
  const currentScope = () => {try {const value = options.scope(); return typeof value === 'string' && value.length > 0 ? value : undefined;} catch {return undefined;}};
  let snapshot: ReaSelectionSnapshot = Object.freeze({state: 'idle', scope: currentScope(), error: ''});
  let maskedBase: ReaSelectionSnapshot | undefined, maskedExpired: ReaSelectionSnapshot | undefined;
  const publish = (value: ReaSelectionSnapshot) => {snapshot = Object.freeze(value); maskedBase = undefined; maskedExpired = undefined; for (const listener of listeners) listener();};
  const cancelRead = () => {epoch++; request?.abort(); request = undefined;};
  const clearTimer = () => {if (timer !== undefined) unschedule(timer); timer = undefined;};
  const expired = () => snapshot.selection !== undefined && (maskedBase === snapshot || snapshot.selection.expiresAt <= now());
  const expiryProjection = (): ReaSelectionSnapshot => Object.freeze({state: 'expired', scope: snapshot.scope, status: snapshot.status, error: messages.expired});
  // Reading during render masks a suspended timer without publishing to React.
  // Cache by the underlying immutable snapshot, so repeated reads stay stable.
  const getSnapshot = (): ReaSelectionSnapshot => {
    if (!expired()) return snapshot;
    if (maskedBase !== snapshot) {maskedBase = snapshot; maskedExpired = expiryProjection();}
    return maskedExpired!;
  };
  const dropExpired = () => {if (expired()) {const next = expiryProjection(); cancelRead(); clearTimer(); publish(next);}};
  const invalidate = () => {cancelRead(); clearTimer(); publish({state: 'idle', scope: disposed ? undefined : currentScope(), error: ''});};
  const check = (token: number, scope: string, controller: AbortController): boolean => {
    dropExpired();
    if (disposed || token !== epoch || controller.signal.aborted) return false;
    if (currentScope() !== scope) {invalidate(); return false;}
    return true;
  };
  const begin = () => {
    if (disposed || mutationPending) return undefined;
    dropExpired();
    const scope = currentScope();
    if (scope !== snapshot.scope) invalidate();
    if (!scope) {publish({state: 'error', error: messages.scope}); return undefined;}
    cancelRead(); const controller = new AbortController(); request = controller;
    return {scope, token: epoch, controller};
  };
  const armExpiry = (selection: ReaSelectionProjection, scope: string) => {
    clearTimer();
    const expire = () => {
      if (disposed || snapshot.selection !== selection) return;
      if (currentScope() !== scope) {invalidate(); return;}
      const remaining = selection.expiresAt - now();
      if (remaining > 0) {timer = schedule(expire, Math.min(remaining, 2147483647)); return;}
      cancelRead(); clearTimer(); publish({state: 'expired', scope, status: snapshot.status, error: messages.expired});
    };
    timer = schedule(expire, Math.max(0, Math.min(selection.expiresAt - now(), 2147483647)));
  };
  return {
    getSnapshot,
    subscribe: (listener: () => void) => {if (!disposed) listeners.add(listener); return () => {listeners.delete(listener);};},
    refreshStatus: async (): Promise<void> => {
      const operation = begin(); if (!operation) return;
      const {scope, token, controller} = operation;
      publish({...snapshot, state: 'loading', scope, error: ''});
      try {
        const result = await read(controller.signal); if (!check(token, scope, controller)) return;
        const status = parseReaStatusResponse({success: true, ...result});
        publish({...snapshot, state: snapshot.selection ? 'selected' : 'idle', scope, status, error: ''});
      } catch {if (check(token, scope, controller)) {clearTimer(); publish({state: 'error', scope, error: messages.status});}}
    },
    select: async (locator: ReaLocator, selectedProfile: ReaLocalProfile): Promise<void> => {
      const operation = begin(); if (!operation) return;
      const {scope, token, controller} = operation;
      mutationPending = true; clearTimer(); publish({state: 'loading', scope, status: snapshot.status, error: ''});
      try {
        const body = parsed(() => ({locator: parseLocator(locator), profile: profile(selectedProfile)}));
        const result = await select(body.locator, body.profile, controller.signal); if (!check(token, scope, controller)) return;
        const selection = parseReaSelectedResponse({success: true, outcome: 'selected', selection: result});
        if (selection.profile !== body.profile) return invalid();
        if (selection.expiresAt <= now()) {publish({state: 'expired', scope, status: snapshot.status, error: messages.expired}); return;}
        publish({state: 'selected', scope, selection, status: snapshot.status, error: ''});
        if (check(token, scope, controller) && snapshot.selection === selection) armExpiry(selection, scope);
      } catch {if (check(token, scope, controller)) publish({state: 'error', scope, status: snapshot.status, error: messages.select});}
      finally {mutationPending = false;}
    },
    forget: async (): Promise<void> => {
      if (disposed || mutationPending) return;
      dropExpired();
      const selection = snapshot.selection;
      if (!selection) return;
      const operation = begin(); if (!operation) return;
      const {scope, token, controller} = operation;
      // Never revoke a previous scope's reference after authority changes.
      if (snapshot.selection !== selection) return;
      mutationPending = true; clearTimer(); publish({state: 'loading', scope, status: snapshot.status, error: ''});
      try {await revoke(selection.selectionRef, controller.signal); if (check(token, scope, controller)) publish({state: 'idle', scope, status: snapshot.status, error: ''});}
      catch {if (check(token, scope, controller)) publish({state: 'error', scope, status: snapshot.status, error: messages.revoke});}
      finally {mutationPending = false;}
    },
    invalidate,
    dispose: () => {if (disposed) return; disposed = true; invalidate(); listeners.clear();},
  };
}
