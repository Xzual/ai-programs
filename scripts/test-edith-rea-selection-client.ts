import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {clearOwnerSessionMemory} from '../src/edith/ownerMutationClient';

assert(existsSync(new URL('../src/edith/reaSelectionClient.ts', import.meta.url)), 'Browser-safe REA selection client must exist');
const client = await import('../src/edith/reaSelectionClient');
const {REA_LOCAL_PROFILES, parseReaStatusResponse, parseReaSelectedResponse, parseReaRevokeResponse,
  fetchReaSelectionStatus, selectReaTarget, revokeReaTarget, createReaSelectionController} = client;
let groups = 0;
const profiles = ['static-javascript', 'static-managed', 'app-package', 'native-binary', 'static-apk', 'apk-resources'];
const locator = {id: 'a'.repeat(64), kind: 'file' as const};
const now = 2_000_000_000_000;
const selection = (revision = 1, expiresAt = now + 120000) => ({schemaVersion: 1 as const, selectionRef: `rea_selection_fixture_${revision}`, profile: 'static-javascript' as const, revision, expiresAt});
const status = {schemaVersion: 1 as const, runtimeReady: false as const, outcome: 'configuration_required' as const, reasons: [{kind: 'missing_engine' as const, code: 'REA_RUNTIME_CONFIGURATION_MISSING'}]};
const selected = (value = selection()) => ({success: true, outcome: 'selected', selection: value});
const statusWire = () => ({success: true, ...status});
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), {status: code, headers: {'Content-Type': 'application/json'}});
const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};
const deferred = <T>() => {let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const safeError = (error: unknown) => {assert(error instanceof Error); assert(!/SYNTHETIC_PRIVATE|secret|C:\\|REA_|HTTP\s*\d|api\/|stack/i.test(error.message)); return true;};

assert.deepEqual([...REA_LOCAL_PROFILES], profiles); assert(Object.isFrozen(REA_LOCAL_PROFILES));
assert.deepEqual(parseReaStatusResponse(statusWire()), status);
assert.deepEqual(parseReaSelectedResponse(selected()), selection());
assert.equal(parseReaRevokeResponse({success: true, revoked: true}), true);
for (const value of [null, [], {...statusWire(), extra: 'private'}, {...statusWire(), success: false}, {...statusWire(), runtimeReady: true, outcome: 'ready'}, {...statusWire(), profile: 'static-apk'}, {...statusWire(), reasons: []}, {...statusWire(), reasons: [{kind: 'unknown', code: 'REA_BAD'}]}, {...statusWire(), reasons: [{kind: 'missing_code', code: 'private/path'}]}, {...statusWire(), reasons: [{kind: 'missing_code', code: 'A'.repeat(97)}]}, {...statusWire(), reasons: Array.from({length: 33}, () => status.reasons[0])}]) assert.throws(() => parseReaStatusResponse(value), safeError);
for (const value of [null, {...selected(), success: false}, {...selected(), extra: 1}, {...selected(), outcome: 'completed'}, selected({...selection(), revision: 0}), selected({...selection(), expiresAt: 0}), selected({...selection(), expiresAt: Infinity}), selected({...selection(), selectionRef: '../private'}), selected({...selection(), profile: 'remote-cdp' as 'static-javascript'}), selected({...selection(), schemaVersion: 2 as 1}), selected({...selection(), secret: 'SYNTHETIC_PRIVATE'} as ReturnType<typeof selection>)]) assert.throws(() => parseReaSelectedResponse(value), safeError);
for (const value of [{success: true, revoked: false}, {success: false, revoked: true}, {success: true, revoked: true, selectionRef: 'extra'}]) assert.throws(() => parseReaRevokeResponse(value), safeError);
groups++;

const originalFetch = globalThis.fetch;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {location: {origin: 'https://rea-fixture.invalid'}}});
  const requests: Array<{url: string; options?: RequestInit}> = [];
  let mode: 'good' | '401' | '403' | 'unknown' | 'malformed' | 'wrong-profile' | 'wrong-status' | 'abort-body' = 'good';
  let abortBody: AbortController | undefined;
  clearOwnerSessionMemory();
  globalThis.fetch = (async (input, options) => {
    const url = String(input); requests.push({url, options});
    if (url === '/api/security/session') return json({session: {actor: 'owner', csrfToken: 'synthetic-csrf-token-1234', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString()}});
    assert.equal(options?.credentials, 'include');
    if (mode === '401' || mode === '403') return json({errorCode: 'SYNTHETIC_PRIVATE_ERROR', path: 'C:\\SYNTHETIC_PRIVATE'}, Number(mode));
    if (mode === 'unknown') throw new Error('SYNTHETIC_PRIVATE secret C:\\private');
    if (mode === 'malformed') return json({success: true, secret: 'SYNTHETIC_PRIVATE'});
    if (url === '/api/files/rea/status') {
      assert.equal(options?.method ?? 'GET', 'GET'); assert.equal(options?.cache, 'no-store');
      if (mode === 'abort-body') return {ok: true, status: 200, json: async () => {abortBody!.abort(); return statusWire();}} as Response;
      return json(statusWire());
    }
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('X-EDITH-CSRF-Token'), 'synthetic-csrf-token-1234');
    assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/json');
    if (url === '/api/files/rea/selections') {
      assert.deepEqual(JSON.parse(String(options?.body)), {locator, profile: 'static-javascript'});
      return json(selected(mode === 'wrong-profile' ? {...selection(), profile: 'static-managed' as 'static-javascript'} : selection()), mode === 'wrong-status' ? 200 : 201);
    }
    assert.equal(url, '/api/files/rea/selections/rea_selection_fixture_1/revoke'); assert.equal(options?.body, '{}');
    return json({success: true, revoked: true});
  }) as typeof fetch;
  assert.deepEqual(await fetchReaSelectionStatus(), status);
  assert.deepEqual(await selectReaTarget(locator, 'static-javascript'), selection());
  assert.equal(requests.filter(row => row.url === '/api/security/session').length, 1, 'Actual owner helper acquired the current owner session');
  await revokeReaTarget(selection().selectionRef);
  const beforeInvalid = requests.length;
  await assert.rejects(selectReaTarget({...locator, id: 'C:/private'}, 'static-javascript'), safeError);
  await assert.rejects(selectReaTarget(locator, 'remote-cdp' as 'static-javascript'), safeError);
  await assert.rejects(revokeReaTarget('../private'), safeError);
  assert.equal(requests.length, beforeInvalid, 'Invalid locators/profiles/references never dispatch');
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(fetchReaSelectionStatus(aborted.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await assert.rejects(selectReaTarget(locator, 'static-javascript', aborted.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  await assert.rejects(revokeReaTarget(selection().selectionRef, aborted.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.equal(requests.length, beforeInvalid);
  for (const failure of ['401', '403', 'unknown', 'malformed', 'wrong-profile', 'wrong-status'] as const) {mode = failure; await assert.rejects(selectReaTarget(locator, 'static-javascript'), safeError);}
  mode = 'abort-body'; abortBody = new AbortController();
  await assert.rejects(fetchReaSelectionStatus(abortBody.signal), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  groups++;
} finally {
  globalThis.fetch = originalFetch; clearOwnerSessionMemory();
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else Reflect.deleteProperty(globalThis, 'window');
}

function fixture() {
  let scope: string | undefined = 'observer-A/workspace-A/1', clock = now;
  let select = async (_locator: {id: string; kind: 'file' | 'directory'}, _profile: string, _signal: AbortSignal) => selection();
  let read = async (_signal: AbortSignal) => status;
  let revoke = async (_ref: string, _signal: AbortSignal) => {};
  const calls: string[] = [], signals: AbortSignal[] = [], timers = new Map<number, {callback: () => void; delay: number}>(); let timer = 0, updates = 0;
  const controller = createReaSelectionController({scope: () => scope, now: () => clock,
    setTimeout: (callback, delay) => {timers.set(++timer, {callback, delay}); return timer;}, clearTimeout: id => {timers.delete(id as number);},
    readStatus: signal => {calls.push('status'); signals.push(signal); return read(signal);},
    selectTarget: (value, profile, signal) => {calls.push('select'); signals.push(signal); return select(value, profile, signal);},
    revokeTarget: (ref, signal) => {calls.push(`revoke:${ref}`); signals.push(signal); return revoke(ref, signal);}});
  const unsubscribe = controller.subscribe(() => {updates++;});
  return {controller, calls, signals, timers, get updates() {return updates;}, set scope(value: string | undefined) {scope = value;}, set clock(value: number) {clock = value;},
    set select(value: typeof select) {select = value;}, set read(value: typeof read) {read = value;}, set revoke(value: typeof revoke) {revoke = value;}, finish: () => {unsubscribe(); controller.dispose(); assert.equal(timers.size, 0);}};
}
{const f = fixture(); assert.equal(f.controller.getSnapshot().state, 'idle');
  await f.controller.refreshStatus(); assert.equal(f.controller.getSnapshot().status?.runtimeReady, false);
  await f.controller.select(locator, 'static-javascript'); assert.equal(f.controller.getSnapshot().state, 'selected'); assert.deepEqual(f.controller.getSnapshot().selection, selection()); assert.equal(f.timers.size, 1); assert(f.updates > 0);
  const calls = f.calls.length; f.clock = selection().expiresAt;
  for (const value of [...f.timers.values()]) value.callback();
  assert.equal(f.controller.getSnapshot().state, 'expired'); assert.equal(f.controller.getSnapshot().selection, undefined); assert.equal(f.calls.length, calls, 'Expiry never analyses, refreshes, revokes or renews'); f.finish(); groups++;
}
{const f = fixture(); await f.controller.select(locator, 'static-javascript');
  f.read = async () => {throw new Error('SYNTHETIC_PRIVATE owner status denied');};
  await f.controller.refreshStatus();
  assert.equal(f.controller.getSnapshot().state, 'error');
  assert.equal(f.controller.getSnapshot().selection, undefined, 'A failed status read cannot retain a possibly revoked owner selection');
  assert.equal(f.timers.size, 0); safeError(new Error(f.controller.getSnapshot().error)); f.finish(); groups++;
}
{const f = fixture(); await f.controller.select(locator, 'static-javascript'); const calls = f.calls.length;
  f.clock = selection().expiresAt + 1;
  const expired = f.controller.getSnapshot();
  assert.equal(expired.state, 'expired'); assert.equal(expired.selection, undefined, 'Clock expiry must mask selection even while its timer is suspended');
  assert.equal(f.controller.getSnapshot(), expired, 'Render-time expiry projection has stable identity');
  await f.controller.forget();
  assert.equal(f.calls.length, calls, 'Explicit forget must not post an expired reference'); assert.equal(f.controller.getSnapshot().selection, undefined);
  f.finish(); groups++;
}
for (const outcome of ['success', 'error'] as const) {
  const f = fixture(), old = deferred<ReturnType<typeof selection>>(); f.select = async () => old.promise;
  const pending = f.controller.select(locator, 'static-javascript'); assert.equal(f.controller.getSnapshot().state, 'loading');
  f.select = async () => selection(2); await f.controller.select(locator, 'static-javascript'); await f.controller.forget();
  assert.equal(f.calls.filter(call => call === 'select').length, 1, 'Overlapping mutation is denied, not assumed cancelled by HTTP abort');
  assert.equal(f.controller.getSnapshot().state, 'loading');
  f.controller.invalidate();
  if (outcome === 'success') old.resolve(selection()); else old.reject(new Error('SYNTHETIC_PRIVATE stale error'));
  await pending; assert.equal(f.controller.getSnapshot().selection, undefined);
  await f.controller.select(locator, 'static-javascript'); assert.equal(f.controller.getSnapshot().selection?.revision, 2); f.finish(); groups++;
}
for (const kind of ['scope', 'ABA', 'invalidate', 'dispose'] as const) {
  const f = fixture(), old = deferred<ReturnType<typeof selection>>(); f.select = async () => old.promise;
  const pending = f.controller.select(locator, 'static-javascript');
  if (kind === 'scope') f.scope = 'observer-B/workspace-B/2';
  if (kind === 'ABA') {f.scope = 'observer-B/workspace-B/2'; f.controller.invalidate(); f.scope = 'observer-A/workspace-A/1';}
  if (kind === 'invalidate') f.controller.invalidate();
  if (kind === 'dispose') f.controller.dispose();
  old.resolve(selection()); await pending;
  assert.equal(f.controller.getSnapshot().selection, undefined, `${kind}: late selection cannot restore authority`); assert.equal(f.timers.size, 0); f.finish(); groups++;
}
{const f = fixture(); await f.controller.select(locator, 'static-javascript'); const forgotten = deferred<void>(); f.revoke = async () => forgotten.promise;
  const old = f.controller.forget(); f.controller.invalidate(); f.select = async () => selection(2); await f.controller.select(locator, 'static-javascript');
  assert.equal(f.calls.filter(call => call === 'select').length, 1, 'A pending revoke cannot overlap a new selection after local invalidation');
  forgotten.resolve(); await old; await f.controller.select(locator, 'static-javascript'); assert.equal(f.controller.getSnapshot().selection?.revision, 2); assert(f.calls.includes('revoke:rea_selection_fixture_1')); f.finish(); groups++;
}
{const f = fixture(), old = deferred<typeof status>(); f.read = async () => old.promise;
  const pending = f.controller.refreshStatus(); await f.controller.select(locator, 'static-javascript'); const current = f.controller.getSnapshot();
  old.resolve(status); await pending; assert.equal(f.controller.getSnapshot(), current, 'Late status read cannot clear a newer explicit selection'); f.finish(); groups++;
}
{const f = fixture(); await f.controller.select(locator, 'static-javascript'); const count = f.calls.length; f.controller.dispose(); assert.equal(f.calls.length, count, 'Dispose never revokes or analyses'); assert.equal(f.controller.getSnapshot().selection, undefined); f.finish(); groups++;}
{const f = fixture(); f.scope = undefined; await f.controller.select(locator, 'static-javascript'); assert.equal(f.calls.length, 0); assert.equal(f.controller.getSnapshot().selection, undefined); f.finish(); groups++;}
{const f = fixture(); f.select = async () => {throw new Error('SYNTHETIC_PRIVATE secret C:\\private');}; await f.controller.select(locator, 'static-javascript'); assert.equal(f.controller.getSnapshot().state, 'error'); assert(f.controller.getSnapshot().error); safeError(new Error(f.controller.getSnapshot().error)); f.finish(); groups++;}
const source = readFileSync(new URL('../src/edith/reaSelectionClient.ts', import.meta.url), 'utf8');
assert(!/from\s+['"](?:node:|.*rea(?:Integration)?Contract)/.test(source.replace(/^import type .*$/gm, '')), 'Browser client must not import crypto-backed contract runtimes');
assert(!/localStorage|sessionStorage|indexedDB|rea_analysis|\/execute|\/preflight/.test(source), 'Client owns only selection/status/revoke, never analysis or storage');
await flush();
console.log(JSON.stringify({pass: true, groups, scope: 'Synthetic browser HTTP/owner-session/controller fixtures only; no native/provider/backend/private data execution'}));
