import assert from 'node:assert/strict';
import * as client from '../src/edith/computerDesktopClient';
import { clearOwnerSessionMemory } from '../src/edith/ownerMutationClient';

// Software boundary fixtures only: no native provider, app, UI, network or user data.
const api = client as unknown as Record<string, (...args: any[]) => Promise<any>>;
assert.equal(typeof api.createSteamEvidenceTask, 'function', 'Evidence-only authority bootstrap is required');
assert.equal(typeof api.beginSteamEvidenceRead, 'function');
assert.equal(typeof api.sampleSteamEvidenceRead, 'function');
assert.equal(typeof api.endSteamEvidenceRead, 'function');
assert.equal(typeof api.cleanupSteamEvidenceRead, 'function');
assert.equal(typeof api.cleanupSteamEvidenceTask, 'function', 'A refused begin must be cleanable without exposing an undelivered reference');
assert.equal(typeof (client as any).createOwnedComputerSession, 'function', 'Actual raw begin ID needs a bounded private cancellation supervisor');
const policy = 'steam-noncontent-read-20261016-v1';
const states = ['Library MAIN pre', 'DETAIL MAIN positive', 'same-root sidebar', 'same-root Properties', 'same-root settings', 'same-root overlay', 'same-root other panel'];
let now = 2_000_000_000_000, serial = 0, session = '', workflow = '', expires = 0, generation = 0;
let calls: {command: string; args?: any}[] = [], posts: {url: string; body: any; headers: Headers; credentials?: RequestCredentials}[] = [];
let mutateBegin: (v: any) => any = v => v, mutateSample: (v: any) => any = v => v, mutateCreate: (v: any) => any = v => v, mutateBind: (v: any) => any = v => v, mutateEnd: (v: any) => any = v => v;
let sampleGate: Promise<void> | undefined, quiescent = true, failure: unknown, registerFailure: unknown, checks = 0;
let approvalGate: Promise<void> | undefined, statusGate: Promise<void> | undefined, statusFailure: unknown;
let mutateStop: (v: any) => any = v => v, stopFailure: unknown, cancelFailure = false;
let stopGate: Promise<void> | undefined;
let beginFailure: unknown;
let createGate: Promise<void> | undefined, jsonGate: Promise<void> | undefined;
let mutateStatus: (value: any) => any = value => value;
let statusGateAfterBegin = false, statusFailureAfterBegin = false;
const stopReceipt = (id: string, state = 'native_quiescent') => ({nativeSessionId: id, originalGeneration: 0, latchedGeneration: 1, observedAt: new Date(now).toISOString(), state});
const originalNow = Date.now, originalFetch = globalThis.fetch, originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const ref = () => 'steam-read:' + serial.toString(16).padStart(64, '0');
const binding = () => ({bindingId: `binding-${serial}`, taskId: `task-${serial}`, workflowId: workflow, state: 'QUEUED', expiresAt: expires, taskBinding: 'registered', physicalAcceptance: false});
function candidate(state: string) {
  const rows = [
    [30003, 'I4', 50033], [30010, 'BOOL', true], [30019, 'BOOL', false], [30022, 'BOOL', false],
    [30024, 'BSTR', 'Chrome'], [30101, 'BSTR', 'main'], [30102, 'BSTR', 'busy=false;'],
    [30107, 'BSTR', 'Chrome UIA Provider'], [30157, 'I4', 80002], [30173, 'I4', 0], [30174, 'BOOL', false],
  ];
  return {schema: 'edith.steam.read-candidate/1', status: 'candidate', readRef: ref(), sampleGeneration: ++generation, state, observedAt: now, expiresAt: expires,
    candidateOnly: true, profileApproved: false, sourcePolicySha256: 'FC4CD1597B941E10E00B6FA6EA70211E5FE4D013DCD5636456B7439C100C6699', sourceContractSha256: 'D977C0D12AC0508B07DA80F6CA7852F502D18212F934C0EA973FF2E2C75095EA', nativeBuildId: 'b'.repeat(64), policyId: policy, policyVersion: 1, producer: 'native_uia', coverage: {complete: true, view: 'raw', nodeCount: 2}, records: [
      ...rows.filter(([, variant]) => variant !== 'BSTR').map(([propertyId, variant, value]) => ({nodeId: 0, ancestorIds: [0], propertyId, variant, value: propertyId === 30003 ? 50032 : propertyId === 30157 ? 0 : value})),
      ...rows.map(([propertyId, variant, value]) => ({nodeId: 1, ancestorIds: [0, 1], propertyId, variant, value})),
    ]};
}
const json = (v: unknown) => new Response(JSON.stringify(v), {headers: {'Content-Type': 'application/json'}});
Object.defineProperty(globalThis, 'window', {configurable: true, value: {location: {origin: 'http://127.0.0.1:49999'}, __TAURI__: {core: {invoke: async (command: string, args?: any) => {
  calls.push({command, args});
  if (command === 'computer_begin') {const issued = session; if (approvalGate) await approvalGate; if (beginFailure !== undefined) throw beginFailure; return issued;}
  if (command === 'computer_status') {const afterBegin = calls.at(-2)?.command === 'computer_begin'; if (statusGate && (!statusGateAfterBegin || afterBegin)) await statusGate; if (statusFailure !== undefined && (!statusFailureAfterBegin || afterBegin)) throw statusFailure; return mutateStatus({runtime: 'tauri', scopedStopContract: 'edith.computer.expected-session-stop/1', mode: 'owner_command', available: true, screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready', ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing', sessionExpiresAt: now + 300000, safeMessage: 'Software fixture only'});}
  if (command === 'computer_stop') {if (stopGate && args?.expectedSessionId) await stopGate; if (stopFailure !== undefined) throw stopFailure; return mutateStop(args?.expectedSessionId ? stopReceipt(args.expectedSessionId) : {nativeSessionId: null, originalGeneration: null, latchedGeneration: null, observedAt: null, state: 'unknown'});}
  if (command === 'computer_workflow_reserve') return {workflowId: args.workflowId};
  if (command === 'computer_workflow_release') return true;
  if (command === 'computer_task_register') {if (registerFailure !== undefined) throw registerFailure; expires = now + (args.evidencePolicyId === undefined ? 60000 : 30000); return {registered: true, reservationId: args.workflowId, expiresAt: expires};}
  if (command === 'computer_task_bind') return mutateBind({bindingId: binding().bindingId, taskId: binding().taskId, state: 'RUNNING'});
  if (command === 'computer_task_cancel') return {bindingId: binding().bindingId, taskId: binding().taskId, state: 'CANCELLED'};
  assert.equal(command, 'computer_steam_diagnostic_capture', 'No action/observe/open/focus/finish path allowed');
  assert.deepEqual(Object.keys(args), ['evidence']);
  const e = args.evidence;
  if (e.op === 'begin') return mutateBegin({schema: 'edith.steam.read-session/1', status: 'ready', readRef: ref(), expiresAt: expires, allowedStates: [...states], candidateOnly: true, profileApproved: false});
  if (e.op === 'end') return mutateEnd({schema: 'edith.steam.read-session/1', status: 'ended', readRef: e.readRef, quiescent, candidateOnly: true, profileApproved: false});
  if (sampleGate) await sampleGate;
  if (failure !== undefined) throw failure;
  return mutateSample(candidate(e.state));
}}}}});
Date.now = () => now;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === '/api/security/session') return json({session: {actor: 'owner', csrfToken: 'software-memory-csrf', createdAt: 'fixture', expiresAt: 'fixture'}});
  const body = JSON.parse(String(init?.body)); posts.push({url, body, headers: new Headers(init?.headers), credentials: init?.credentials});
  if (url.endsWith('/cancel')) return cancelFailure ? new Response('', {status: 503}) : json({success: true, ...binding(), state: 'CANCELLED'});
  assert.equal(url, '/api/computer-use/workflows'); const created = mutateCreate({success: true, ...binding()});
  if (createGate) await createGate; const response = json(created);
  if (jsonGate) {const gate = jsonGate; Object.defineProperty(response, 'json', {value: async () => {await gate; return created;}});}
  return response;
}) as typeof fetch;
async function fresh() {
  if (session) {try {await api.cleanupSteamEvidenceTask(session, workflow);} catch (error) {assert.equal(error, 'STEAM_READ_SCOPE_UNAVAILABLE');}}
  await client.stopComputer(); now += 60000; serial++; session = `session-${serial}`; workflow = `workflow-${serial}`; generation = 0;
  mutateBegin = v => v; mutateSample = v => v; mutateCreate = v => v; mutateBind = v => v; mutateEnd = v => v; sampleGate = undefined; failure = undefined; registerFailure = undefined; quiescent = true; calls = []; posts = []; clearOwnerSessionMemory();
  assert.equal(await client.beginComputerSession(), session);
  return {sessionId: session, workflowId: workflow, idempotencyKey: `request-${serial}`, deadlineAt: new Date(now + 30000).toISOString(), intent: {app: 'steam', workflow: 'game_detail', gameName: '  Authorized software fixture intent  '}};
}
async function ready() {const args = await fresh(); const task = await api.createSteamEvidenceTask(args); const result = await api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: task.bindingId, policyId: policy}); return result;}
const sample = (state = states[0]) => api.sampleSteamEvidenceRead({version: 1, op: 'sample', readRef: ref(), state});
const end = () => api.endSteamEvidenceRead({version: 1, op: 'end', readRef: ref()});
async function rejects(p: Promise<unknown>, code: string) {await assert.rejects(p, e => e === code); checks++;}
async function flush() {for (let i = 0; i < 25; i++) await Promise.resolve();}
async function owned() {const a = await fresh(); const handle = (client as any).createOwnedComputerSession(); assert.equal(await handle.ready, session); return {a, handle};}
try {
  {
    mutateStatus = value => {delete value.scopedStopContract; return value;}; await fresh();
    assert.deepEqual(calls.map(c => c.command), ['computer_begin', 'computer_status']);
    assert.equal((await client.stopComputer()).state, 'unknown'); assert.deepEqual(calls.at(-1), {command: 'computer_stop', args: undefined});
    mutateStatus = value => value; checks += 3;
  }
  {
    await fresh(); mutateStatus = value => {delete value.scopedStopContract; return value;};
    const start = calls.length, handle = (client as any).createOwnedComputerSession();
    const result = await handle.ready.then(() => 'UNSAFE_OLD_NATIVE_BEGIN', (e: unknown) => e);
    if (result === 'UNSAFE_OLD_NATIVE_BEGIN') {const beforeCancel = calls.length; await handle.cancel(); console.log(JSON.stringify({expectedRedOldNative: true, ownedCommands: calls.slice(start).map(c => c.command), cleanupCommands: calls.slice(beforeCancel).map(c => c.command), realNative: false}));}
    assert.equal(result, 'OWNED_SESSION_ADMISSION_FAILED');
    assert.equal(calls.slice(start).some(c => c.command === 'computer_begin' || c.command === 'computer_stop'), false);
    mutateStatus = value => value; checks += 2;
  }
  {
    let getters = 0;
    const bad: Array<(v: any) => any> = [
      () => null, () => [], () => undefined, v => ({...v, runtime: 'TAURI'}), v => ({...v, runtime: 'unbound'}),
      ...[null, true, 1, {}, ['edith.computer.expected-session-stop/1'], 'edith.computer.expected-session-stop/2', 'edith.computer.expected-session-stop/1 ', 'EDITH.COMPUTER.EXPECTED-SESSION-STOP/1'].map(value => (v: any) => ({...v, scopedStopContract: value})),
      v => Object.assign(Object.create({scopedStopContract: v.scopedStopContract}), {runtime: 'tauri'}),
      v => Object.assign(Object.create(null), v),
      v => Object.defineProperty(v, 'scopedStopContract', {enumerable: true, get: () => {getters++; return 'edith.computer.expected-session-stop/1';}}),
      v => ({...v, extra: Object.defineProperty({}, 'private', {enumerable: true, get: () => {getters++; return 'PRIVATE_NEVER_READ';}})}),
      v => Object.defineProperty(v, 'toJSON', {enumerable: true, get: () => {getters++; return () => {getters++; return {};};}}),
      v => ({...v, toJSON: () => {getters++; return {};}}),
      v => Object.defineProperty(v, 'hidden', {value: 'PRIVATE_NEVER_SERIALIZE', enumerable: false}),
      v => ({...v, [Symbol('private')]: true}), v => {v.extra = v; return v;},
      v => ({...v, extra: [, 1]}), v => {const array: any = [1]; array.extra = true; return {...v, extra: array};},
      ...[NaN, Infinity, -Infinity, BigInt(1), undefined, Symbol('private'), () => 1, new Date()].map(value => (v: any) => ({...v, extra: value})),
      v => ({...v, extra: '🚀'.repeat(20000)}), v => ({...v, extra: '\u0000'.repeat(11000)}),
      v => ({...v, ['x'.repeat(65536)]: 0}),
    ];
    for (const alter of bad) {
      mutateStatus = v => v; await fresh(); mutateStatus = alter; const start = calls.length;
      const handle = (client as any).createOwnedComputerSession(); await rejects(handle.ready, 'OWNED_SESSION_ADMISSION_FAILED');
      assert.deepEqual(calls.slice(start).map(c => c.command), ['computer_status']);
      await handle.cancel(); assert.equal(calls.slice(start).some(c => c.command === 'computer_begin' || c.command === 'computer_stop'), false); checks += 2;
    }
    assert.equal(getters, 0); mutateStatus = v => v; checks++;
  }
  {
    await fresh(); const handle = (client as any).createOwnedComputerSession(); await handle.ready;
    const bad = [(v: any) => {delete v.scopedStopContract; return v;}, (v: any) => ({...v, scopedStopContract: 'unsupported'}), () => {throw new Error('PRIVATE_STATUS_TRANSPORT');}];
    for (const alter of bad) {mutateStatus = alter; const start = calls.length; const result = await handle.cancel(); assert.equal(result.state, 'terminal_unresolved'); assert.equal(result.error, 'NATIVE_STOP_UNRESOLVED'); assert.deepEqual(calls.slice(start).map(c => c.command), ['computer_status']); checks += 3;}
    mutateStatus = v => ({...v, available: false, ownerCommandMode: false, killSwitch: 'active', mode: 'disabled', sessionExpiresAt: now - 1});
    assert.equal((await handle.cancel()).state, 'native_quiescent', 'Compatibility permits cleanup after kill/expiry/inactive readiness'); mutateStatus = v => v; checks++;
  }
  {
    await fresh(); const start = calls.length; statusFailure = new Error('PRIVATE_COMPAT_TRANSPORT');
    const handle = (client as any).createOwnedComputerSession(); await rejects(handle.ready, 'OWNED_SESSION_ADMISSION_FAILED'); statusFailure = undefined;
    assert.deepEqual(calls.slice(start).map(c => c.command), ['computer_status']);
    const next = (client as any).createOwnedComputerSession(); await next.ready; assert.equal((await next.cancel()).state, 'native_quiescent', 'Known pre-begin refusal leaves no invented native fence'); checks += 2;
  }
  for (const size of [65536, 65537]) {
    await fresh(); mutateStatus = v => {const empty = {...v, padding: ''}; const overhead = new TextEncoder().encode(JSON.stringify(empty)).length; return {...empty, padding: 'x'.repeat(size - overhead)};};
    const start = calls.length, handle = (client as any).createOwnedComputerSession();
    if (size === 65536) {await handle.ready; assert.equal((await handle.cancel()).state, 'native_quiescent');}
    else {await rejects(handle.ready, 'OWNED_SESSION_ADMISSION_FAILED'); assert.deepEqual(calls.slice(start).map(c => c.command), ['computer_status']);}
    mutateStatus = v => v; checks += 2;
  }
  for (const action of ['abort', 'global']) {
    await fresh(); const start = calls.length; let release!: () => void; statusGate = new Promise<void>(r => {release = r;});
    const controller = new AbortController(), handle = (client as any).createOwnedComputerSession(controller.signal); const result = handle.ready.catch((e: unknown) => e); await flush();
    if (action === 'abort') controller.abort(); else await client.stopComputer(); statusGate = undefined; release();
    assert.equal(await result, 'OWNED_SESSION_CANCELLED'); await flush(); assert.equal(calls.slice(start).filter(c => c.command === 'computer_begin').length, 0);
    assert.equal(calls.slice(start).filter(c => c.command === 'computer_stop').length, action === 'global' ? 1 : 0); checks += 3;
  }
  {
    const {handle} = await owned(); let release!: () => void; statusGate = new Promise<void>(r => {release = r;}); const start = calls.length;
    const pending = handle.cancel(); await flush(); const original = session; mutateStop = () => stopReceipt(original); await client.stopComputer();
    mutateStatus = v => {delete v.scopedStopContract; return v;}; statusGate = undefined; release();
    assert.equal((await pending).state, 'native_quiescent'); assert.deepEqual(calls.slice(start).filter(c => c.command === 'computer_stop').map(c => c.args), [undefined]);
    mutateStop = v => v; mutateStatus = v => v; checks += 2;
  }
  {
    await fresh(); let release!: () => void; approvalGate = new Promise<void>(r => {release = r;});
    const signal = new AbortController(), handle = (client as any).createOwnedComputerSession(signal.signal);
    const readyResult = handle.ready.catch((e: unknown) => e); await flush(); signal.abort();
    assert.equal((await handle.cancel()).state, 'pending_approval'); assert.equal(calls.some(c => c.command === 'computer_stop'), false);
    release(); approvalGate = undefined; await flush(); assert.equal(await readyResult, 'OWNED_SESSION_CANCELLED');
    assert.equal((await handle.cancel()).state, 'native_quiescent');
    assert.deepEqual(calls.filter(c => c.command === 'computer_stop').map(c => c.args), [{expectedSessionId: session}]);
    assert.equal(calls.filter(c => c.command === 'computer_status').length, 3, 'Legacy setup, owned compatibility and cleanup compatibility only; abandoned raw ID must never enter admission status/canonical'); checks += 5;
  }
  {
    await fresh(); statusFailure = new Error('PRIVATE_STATUS_PROVIDER'); statusFailureAfterBegin = true; const handle = (client as any).createOwnedComputerSession();
    await rejects(handle.ready, 'OWNED_SESSION_ADMISSION_FAILED'); statusFailure = undefined; statusFailureAfterBegin = false;
    assert.equal(handle.getState().state, 'native_quiescent'); assert.deepEqual(calls.at(-1)?.args, {expectedSessionId: session}); checks += 2;
  }
  {await fresh(); const n = calls.length; const controller = new AbortController(); controller.abort(); const handle = (client as any).createOwnedComputerSession(controller.signal); await rejects(handle.ready, 'OWNED_SESSION_CANCELLED'); assert.equal(calls.length, n); checks++;}
  {await fresh(); const n = calls.length; const handle = (client as any).createOwnedComputerSession({expectedSessionId: session}); await rejects(handle.ready, 'OWNED_SESSION_INVALID_REQUEST'); assert.equal(calls.length, n); assert.equal((await handle.cancel()).state, 'terminal_unresolved'); checks += 2;}
  {
    const {a, handle} = await owned(); const t = await api.createSteamEvidenceTask(a); mutateBegin = () => {throw 'STEAM_READ_UNSUPPORTED';};
    await rejects(api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy}), 'STEAM_READ_UNSUPPORTED');
    await rejects(api.cleanupSteamEvidenceTask(session, workflow), 'STEAM_READ_BUSY');
    mutateStop = v => ({...v, state: 'native_latched'}); assert.equal((await handle.cancel()).state, 'native_latched');
    await rejects(api.cleanupSteamEvidenceTask(session, workflow), 'STEAM_READ_BUSY'); mutateStop = v => v;
    const closed = await handle.cancel(); assert.equal(closed.state, 'native_quiescent'); assert.equal(closed.backendCleanup, 'complete');
    await api.cleanupSteamEvidenceTask(session, workflow); assert.equal(posts.filter(p => p.url.endsWith('/cancel')).length, 1);
    await rejects(api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy}), 'STEAM_READ_SCOPE_CHANGED'); checks += 4;
    // Even a later native/legacy ID reuse cannot reopen this original evidence session.
    await client.beginComputerSession(); await rejects(api.createSteamEvidenceTask({...a, workflowId: 'reused-terminal-session'}), 'STEAM_READ_SCOPE_CHANGED');
  }
  for (const alter of [(v: any) => ({...v, nativeSessionId: 'foreign-native'}), (v: any) => ({...v, originalGeneration: Number.MAX_SAFE_INTEGER, latchedGeneration: Number.MAX_SAFE_INTEGER + 1}), (v: any) => ({...v, extra: true}), (v: any) => ({...v, observedAt: '2026-10-16'}), () => ({nativeSessionId: null, originalGeneration: null, latchedGeneration: null, observedAt: null, state: 'unknown'})]) {
    const {handle} = await owned(); mutateStop = alter;
    const n = calls.length; const result = await handle.cancel(stopReceipt(session) as any);
    assert.equal(result.state, 'terminal_unresolved'); assert.equal(calls.length, n + 2, 'Fresh native status plus scoped STOP; caller-provided shape cannot authorize closure');
    mutateStop = v => v; assert.equal((await handle.cancel()).state, 'native_quiescent'); checks += 3;
  }
  {
    const {handle} = await owned(); mutateStop = v => ({...v, state: 'native_latched'}); await handle.cancel();
    mutateStop = v => ({...v, originalGeneration: 1, latchedGeneration: 2}); assert.equal((await handle.cancel()).state, 'terminal_unresolved');
    mutateStop = v => v; assert.equal((await handle.cancel()).state, 'native_quiescent'); const n = calls.length;
    mutateStop = () => ({state: 'unknown'}); assert.equal((await handle.cancel()).state, 'native_quiescent'); assert.equal(calls.length, n); mutateStop = v => v; checks += 4;
  }
  {
    const {handle} = await owned(), originalId = session; let release!: () => void;
    statusGate = new Promise<void>(r => {release = r;}); const pendingCancel = handle.cancel(); await flush(); statusGate = undefined;
    session = 'foreign-session-' + serial;
    await client.beginComputerSession(); await client.reserveComputerWorkflow(session, 'foreign-workflow', new Date(now + 30000).toISOString());
    stopFailure = 'NATIVE_STOP_SCOPE_MISMATCH'; release(); const result = await pendingCancel; stopFailure = undefined;
    assert.equal(result.state, 'terminal_unresolved'); assert.equal(result.error, 'NATIVE_STOP_SCOPE_MISMATCH');
    assert.deepEqual(calls.at(-1)?.args, {expectedSessionId: originalId}); assert.equal(client.assertComputerSessionActive(session), now + 300000);
    await assert.rejects(client.reserveComputerWorkflow(session, 'other-foreign-workflow', new Date(now + 30000).toISOString()), /APP_WORKFLOW_RESOURCE_BUSY/);
    assert.equal((await handle.cancel()).state, 'native_quiescent'); assert.equal(client.assertComputerSessionActive(session), now + 300000);
    await client.releaseComputerWorkflow(session, 'foreign-workflow'); checks += 6;
  }
  {
    await fresh(); let release!: () => void; statusGate = new Promise<void>(r => {release = r;}); statusGateAfterBegin = true;
    const handle = (client as any).createOwnedComputerSession(); const rejected = handle.ready.catch((e: unknown) => e); await flush();
    const oldId = session; const result = await handle.cancel(); assert.equal(result.state, 'native_quiescent');
    statusGate = undefined; statusGateAfterBegin = false; session = 'replacement-after-status-' + serial; await client.beginComputerSession(); release(); await flush();
    assert.equal(await rejected, 'OWNED_SESSION_CANCELLED'); assert.equal(client.assertComputerSessionActive(session), now + 300000);
    assert.deepEqual(calls.filter(c => c.command === 'computer_stop').map(c => c.args), [{expectedSessionId: oldId}]); checks += 4;
  }
  {
    const {a, handle} = await owned(); await api.createSteamEvidenceTask(a); cancelFailure = true;
    const result = await handle.cancel(); assert.equal(result.state, 'native_quiescent'); assert.equal(result.backendCleanup, 'unresolved');
    const n = calls.length; mutateStop = () => ({state: 'unknown'}); cancelFailure = false;
    assert.equal((await handle.cancel()).backendCleanup, 'complete'); assert.equal(calls.length, n); mutateStop = v => v; checks += 4;
  }
  {
    const {a, handle} = await owned(); const t = await api.createSteamEvidenceTask(a); mutateBegin = () => {throw 'STEAM_READ_TIMEOUT';};
    await rejects(api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy}), 'STEAM_READ_TIMEOUT');
    const originalId = session; mutateStop = () => stopReceipt(originalId); const n = calls.filter(c => c.command === 'computer_stop').length;
    assert.equal((await client.stopComputer()).state, 'native_quiescent'); mutateStop = v => v;
    assert.equal(handle.getState().state, 'native_quiescent'); await api.cleanupSteamEvidenceTask(session, workflow);
    assert.equal(calls.filter(c => c.command === 'computer_stop').length, n + 1); checks += 3;
  }
  {
    const {a, handle} = await owned(); const t = await api.createSteamEvidenceTask(a);
    await api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy});
    let release!: () => void; sampleGate = new Promise<void>(r => {release = r;}); const pending = sample().catch((e: unknown) => e); await flush();
    let releaseStop!: () => void; stopGate = new Promise<void>(r => {releaseStop = r;}); const first = handle.cancel(), second = handle.cancel();
    assert.equal(handle.getState().state, 'terminal_unresolved'); await flush(); assert.equal(calls.filter(c => c.command === 'computer_stop').length, 1); releaseStop(); await Promise.all([first, second]); stopGate = undefined;
    release(); assert.equal(await pending, 'STEAM_READ_SCOPE_CHANGED'); sampleGate = undefined; quiescent = false;
    assert.equal((await end()).quiescent, true); assert.equal(handle.getState().state, 'native_quiescent'); quiescent = true; checks += 4;
  }
  {
    const {a, handle} = await owned(); const t = await api.createSteamEvidenceTask(a); let release!: () => void;
    mutateBegin = value => new Promise(resolve => {release = () => resolve(value);});
    const pending = api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy}).catch(e => e);
    await flush(); assert.equal((await handle.cancel()).state, 'native_quiescent'); release();
    assert.equal(await pending, 'STEAM_READ_SCOPE_CHANGED'); assert.equal(calls.filter(c => c.command === 'computer_steam_diagnostic_capture' && c.args.evidence.op === 'end').length, 0, 'An already closed original must not synthesize or revoke a late read reference');
    await api.cleanupSteamEvidenceTask(session, workflow); checks += 3;
  }
  {
    await fresh(); const handle = (client as any).createOwnedComputerSession(); await handle.ready;
    mutateStop = () => stopReceipt(session, 'native_latched'); await client.stopComputer(); mutateStop = v => v;
    const n = calls.length; const blocked = (client as any).createOwnedComputerSession();
    await rejects(blocked.ready, 'OWNED_SESSION_CAPACITY'); assert.equal(calls.length, n); assert.equal((await handle.cancel()).state, 'native_quiescent'); checks += 2;
  }
  for (const mode of ['unknown', 'transport']) {
    const {handle} = await owned(); if (mode === 'transport') stopFailure = new Error('Software lost stop transport');
    if (mode === 'transport') await assert.rejects(client.stopComputer(), /Software lost stop transport/); else assert.equal((await client.stopComputer()).state, 'unknown');
    stopFailure = undefined; assert.equal(handle.getState().state, 'terminal_unresolved');
    const n = calls.length; const blocked = (client as any).createOwnedComputerSession(); await rejects(blocked.ready, 'OWNED_SESSION_CAPACITY'); assert.equal(calls.length, n);
    assert.equal((await handle.cancel()).state, 'native_quiescent'); checks += 4;
  }
  {
    const {handle} = await owned(); let release!: () => void; stopGate = new Promise<void>(r => {release = r;});
    const oldAttempt = handle.cancel(), originalId = session; await flush(); mutateStop = () => stopReceipt(originalId);
    assert.equal((await client.stopComputer()).state, 'native_quiescent');
    mutateStop = () => ({nativeSessionId: null, originalGeneration: null, latchedGeneration: null, observedAt: null, state: 'unknown'});
    release(); assert.equal((await oldAttempt).state, 'native_quiescent'); stopGate = undefined; mutateStop = v => v;
    assert.equal(handle.getState().state, 'native_quiescent'); checks += 3;
  }
  for (const stage of ['response', 'json']) {
    const {a, handle} = await owned(); let release!: () => void; const gate = new Promise<void>(r => {release = r;});
    if (stage === 'response') createGate = gate; else jsonGate = gate;
    const pending = api.createSteamEvidenceTask(a).catch(e => e); await flush();
    const stopped = await handle.cancel(); assert.equal(stopped.state, 'native_quiescent');
    assert.equal(stopped.backendCleanup, 'unresolved', stage + ' in flight is not proof of backend cancellation');
    release(); createGate = undefined; jsonGate = undefined; assert.equal(await pending, 'STEAM_READ_SCOPE_CHANGED');
    await flush(); assert.equal((await handle.cancel()).backendCleanup, 'complete'); assert.equal(posts.filter(p => p.url.endsWith('/cancel')).length, 1); checks += 5;
  }
  const args = await fresh(); await api.createSteamEvidenceTask(args);
  assert.deepEqual(calls.slice(0, 5).map(c => c.command), ['computer_begin', 'computer_status', 'computer_workflow_reserve', 'computer_task_register', 'computer_task_bind']);
  assert.deepEqual(calls[3].args, {sessionId: session, workflowId: workflow, intent: args.intent, evidencePolicyId: policy});
  assert.deepEqual(posts[0].body, {workflowId: workflow, sessionId: session, request: args.intent});
  assert.equal(posts[0].credentials, 'include'); assert.equal(posts[0].headers.get('x-edith-csrf-token'), 'software-memory-csrf'); assert.equal(posts[0].headers.get('x-idempotency-key'), args.idempotencyKey); checks += 5;
  await fresh(); await client.registerComputerTaskSession(session, workflow, {app: 'steam', workflow: 'open'});
  assert.deepEqual(Object.keys(calls.at(-1)!.args), ['sessionId', 'workflowId', 'intent']); checks++;
  await rejects(api.registerComputerTaskSession(session, workflow, {app: 'steam', workflow: 'game_detail', gameName: 'fixture'}, null), 'STEAM_READ_INVALID_REQUEST');
  for (const alter of [(a: any) => ({...a, unknown: true}), (a: any) => ({...a, intent: {...a.intent, observationId: 'fake'}}), (a: any) => ({...a, intent: {...a.intent, gameName: ''}}), (a: any) => ({...a, intent: {...a.intent, gameName: '\ud800'}})]) {const a = await fresh(); const n = calls.length; await rejects(api.createSteamEvidenceTask(alter(a)), 'STEAM_READ_INVALID_REQUEST'); assert.equal(calls.length, n);}
  for (const key of ['extra', 'state', 'workflowId', 'expiresAt']) {const a = await fresh(); mutateCreate = v => key === 'extra' ? {...v, extra: 'private fixture'} : {...v, [key]: key === 'expiresAt' ? expires + 1 : 'wrong'}; await rejects(api.createSteamEvidenceTask(a), 'STEAM_READ_UNSUPPORTED');}
  {const a = await fresh(); mutateBind = v => ({...v, workflowId: 'wrong'}); await rejects(api.createSteamEvidenceTask(a), 'STEAM_READ_UNSUPPORTED');}
  for (const bad of [null, [], {version: 1, op: 'begin'}, {version: 1, op: 'sample', readRef: ref(), state: states[0], sessionId: 'mixed'}, {version: 1, op: 'sample', readRef: 'steam-read:' + 'A'.repeat(64), state: states[0]}]) {await rejects(api.sampleSteamEvidenceRead(bad), 'STEAM_READ_INVALID_REQUEST');}
  await ready(); const accepted = await sample(); assert.equal(accepted.candidateOnly, true); assert.equal(accepted.profileApproved, false); checks++;
  await assert.rejects(client.getComputerAppSnapshot(session, workflow), /desktop_contract_observation_missing/);
  assert.throws(() => client.computerControlTarget(session, accepted as any), /desktop_contract_observation_missing/); checks++;
  const beforeReplay = calls.length; await rejects(sample(), 'STEAM_READ_REPLAY'); assert.equal(calls.length, beforeReplay);
  for (const s of states.slice(1)) await sample(s); await api.cleanupSteamEvidenceRead(ref()); assert.equal(calls.filter(c => c.command === 'computer_task_finish').length, 0); assert(posts.some(p => p.url.endsWith('/cancel'))); assert(calls.some(c => c.command === 'computer_workflow_release')); checks++;
  const malformed: ((v: any) => any)[] = [v => ({...v, screenshot: 'private'}), v => ({...v, profileApproved: true}), v => ({...v, sampleGeneration: 0}), v => ({...v, sampleGeneration: 2}), v => ({...v, state: states[1]}), v => ({...v, expiresAt: expires + 1}), v => ({...v, observedAt: expires}), v => ({...v, readRef: 'steam-read:' + 'f'.repeat(64)}), v => ({...v, nativeBuildId: 'bad'}), v => ({...v, sourcePolicySha256: 'a'.repeat(64)}), v => ({...v, coverage: {...v.coverage, complete: false}}), v => ({...v, coverage: {...v.coverage, nodeCount: 513}}), v => ({...v, records: [v.records[0], ...v.records]}), v => ({...v, records: v.records.map((r: any) => r.propertyId === 30019 ? {...r, value: true} : r)}), v => ({...v, records: v.records.map((r: any) => r.propertyId === 30024 ? {...r, value: 'Chrome private'} : r)}), v => ({...v, records: v.records.map((r: any) => r.propertyId === 30107 ? {...r, value: 'Chrome UIA Provider extraPrivate'} : r)}), v => ({...v, records: v.records.map((r: any) => r.propertyId === 30102 ? {...r, value: 'busy=false;busy=true'} : r)}), v => ({...v, records: v.records.map((r: any) => r.propertyId === 30101 ? {...r, value: 'document'} : r)}), v => ({...v, records: v.records.map((r: any) => ({...r, ancestorIds: [1, 0]}))}), v => ({...v, records: v.records.map((r: any) => ({...r, privateName: 'not exportable'}))})];
  for (const alter of malformed) {await ready(); mutateSample = alter; await rejects(sample(), 'STEAM_READ_UNSUPPORTED'); const n = calls.length; await rejects(sample(states[1]), 'STEAM_READ_UNSUPPORTED'); assert.equal(calls.length, n); await end();}
  for (const thrown of ['STEAM_READ_TIMEOUT', 'STEAM_READ_SCOPE_CHANGED', new Error('raw private provider fixture'), {message: 'raw private provider fixture'}]) {await ready(); failure = thrown; await rejects(sample(), typeof thrown === 'string' ? thrown : 'STEAM_READ_UNSUPPORTED'); await end();}
  await ready(); mutateSample = v => ({...v, coverage: {...v.coverage, nodeCount: 1}, records: v.records.filter((r: any) => r.nodeId === 1).map((r: any) => ({...r, nodeId: 0, ancestorIds: [0]}))}); await rejects(sample(), 'STEAM_READ_UNSUPPORTED'); await end();
  {const a = await fresh(); const task = await api.createSteamEvidenceTask(a); mutateBegin = v => ({...v, expiresAt: expires - 1000}); await api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: task.bindingId, policyId: policy}); now = expires - 500; const n = calls.length; await rejects(sample(), 'STEAM_READ_SCOPE_EXPIRED'); assert.equal(calls.length, n); await api.cleanupSteamEvidenceRead(ref()); assert(calls.some(c => c.command === 'computer_workflow_release')); checks++;}
  {const a = await fresh(); const task = await api.createSteamEvidenceTask(a); mutateBegin = v => ({...v, expiresAt: expires - 1000}); await api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: task.bindingId, policyId: policy}); await end(); now = expires - 500; await rejects(api.createSteamEvidenceTask({...a, workflowId: 'competing-workflow'}), 'STEAM_READ_UNSUPPORTED'); await api.cleanupSteamEvidenceTask(session, workflow); assert(calls.some(c => c.command === 'computer_workflow_release')); checks++;}
  for (const stage of ['register', 'create']) {const a = await fresh(); if (stage === 'register') registerFailure = 'STEAM_READ_SCOPE_UNAVAILABLE'; else mutateCreate = v => ({...v, success: false}); await rejects(api.createSteamEvidenceTask(a), stage === 'register' ? 'STEAM_READ_SCOPE_UNAVAILABLE' : 'STEAM_READ_UNSUPPORTED'); await api.cleanupSteamEvidenceTask(session, workflow); assert(calls.some(c => c.command === 'computer_workflow_release')); assert.equal(posts.some(p => p.url.endsWith('/cancel')), false); assert.equal(calls.some(c => c.command === 'computer_steam_diagnostic_capture'), false); checks++;}
  for (const bad of [(v: any) => ({...v, extra: 'private'}), (v: any) => ({...v, expiresAt: expires + 1}), (v: any) => ({...v, allowedStates: [...states].reverse()}), (v: any) => ({...v, allowedStates: states.map(s => ({toJSON: () => s}))})]) {
    const a = await fresh(); const t = await api.createSteamEvidenceTask(a); mutateBegin = bad;
    await rejects(api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: t.bindingId, policyId: policy}), 'STEAM_READ_UNSUPPORTED');
    assert(calls.some(c => c.command === 'computer_steam_diagnostic_capture' && c.args.evidence.op === 'end')); await api.cleanupSteamEvidenceTask(session, workflow);
  }
  await ready(); mutateSample = v => ({...v, records: [...v.records, ...v.records.filter((r: any) => r.nodeId === 1 && r.variant !== 'BSTR').map((r: any) => ({...r, nodeId: 2, ancestorIds: [0, 1, 2], value: r.propertyId === 30003 ? 50007 : r.propertyId === 30157 ? 0 : r.value})), {nodeId: 2, ancestorIds: [0, 1, 2], propertyId: 30079, variant: 'BOOL', value: true}].sort((a: any, b: any) => a.nodeId - b.nodeId || a.propertyId - b.propertyId), coverage: {...v.coverage, nodeCount: 3}}); assert.equal((await sample()).coverage.nodeCount, 3); await end(); checks++;
  await ready(); mutateSample = v => {const records = [...v.records]; for (let id = 2; id < 512; id++) for (const r of v.records.filter((r: any) => r.nodeId === 1 && r.variant !== 'BSTR')) records.push({...r, nodeId: id, ancestorIds: [0, id], value: r.propertyId === 30003 ? 50000 : r.propertyId === 30157 ? 0 : r.value}); return {...v, coverage: {...v.coverage, nodeCount: 512}, records};}; await rejects(sample(), 'STEAM_READ_UNSUPPORTED'); await end();
  for (const bad of [(v: any) => ({...v, records: v.records.map((r: any) => r.propertyId === 30010 ? {...r, value: 1} : r)}), (v: any) => ({...v, records: v.records.map((r: any) => r.propertyId === 30003 ? {...r, value: 50041} : r)}), (v: any) => ({...v, observedAt: Number.NaN}), (v: any) => ({...v, coverage: null}), (v: any) => ({...v, records: new Array(1)}), (v: any) => ({...v, records: v.records.map((r: any) => r.propertyId === 30102 ? {...r, value: ' busy=false;'} : r)})]) {await ready(); mutateSample = bad; await rejects(sample(), 'STEAM_READ_UNSUPPORTED'); await end();}
  for (const bad of [(v: any) => ({...v, extra: 'private'}), (v: any) => ({...v, quiescent: 'true'}), (v: any) => ({...v, profileApproved: true}), (v: any) => ({...v, readRef: 'steam-read:' + 'a'.repeat(64)}), (v: any) => ({...v, schema: 'wrong'})]) {await ready(); mutateEnd = bad; await rejects(end(), 'STEAM_READ_UNSUPPORTED'); await rejects(sample(), 'STEAM_READ_ENDED'); mutateEnd = v => v; await end();}
  {const a = await fresh(); await api.createSteamEvidenceTask(a); mutateBegin = v => ({...v, extra: true}); quiescent = false; await rejects(api.beginSteamEvidenceRead({version: 1, op: 'begin', sessionId: session, workflowId: workflow, bindingId: binding().bindingId, policyId: policy}), 'STEAM_READ_UNSUPPORTED'); await client.stopComputer(); now += 60000; const n = calls.length; await rejects(api.createSteamEvidenceTask({...a, deadlineAt: new Date(now + 30000).toISOString()}), 'STEAM_READ_BUSY'); assert.equal(calls.length, n); quiescent = true; await api.cleanupSteamEvidenceTask(session, workflow);}
  await ready(); now = expires; const n = calls.length; await rejects(sample(), 'STEAM_READ_SCOPE_EXPIRED'); assert.equal(calls.length, n); await end();
  await ready(); mutateSample = v => {now = expires; return v;}; await rejects(sample(), 'STEAM_READ_SCOPE_EXPIRED'); await end();
  await ready(); let release!: () => void; sampleGate = new Promise<void>(r => {release = r;}); const pending = sample(); await Promise.resolve(); quiescent = false; const ended = await end(); assert.equal(ended.quiescent, false); const prior = calls.length; await rejects(api.cleanupSteamEvidenceRead(ref()), 'STEAM_READ_BUSY'); assert.equal(calls.slice(prior).some(c => c.command === 'computer_workflow_release'), false); release(); await rejects(pending, 'STEAM_READ_ENDED'); sampleGate = undefined; quiescent = true; await api.cleanupSteamEvidenceRead(ref()); checks++;
  await ready(); sampleGate = new Promise<void>(r => {release = r;}); const stopped = sample(); await Promise.resolve(); await client.stopComputer(); release(); await rejects(stopped, 'STEAM_READ_SCOPE_CHANGED'); sampleGate = undefined; await end();
  await ready(); const p = sample(); await rejects(sample(states[1]), 'STEAM_READ_BUSY'); await p; await end();
  assert.equal(calls.some(c => /observe|screenshot|locate|focus|action|finish|app_open/.test(c.command)), false);
  {const a = await fresh(); beginFailure = new Error('PRIVATE_LOST_NATIVE_RESULT'); const handle = (client as any).createOwnedComputerSession(); await rejects(handle.ready, 'OWNED_SESSION_ADMISSION_FAILED'); beginFailure = undefined;
    assert.equal((await handle.cancel()).state, 'terminal_unresolved'); assert.equal(calls.some(c => c.command === 'computer_stop'), false);
    const n = calls.length; await rejects(api.createSteamEvidenceTask(a), 'STEAM_READ_BUSY'); assert.equal(calls.length, n);
    const blocked = (client as any).createOwnedComputerSession(); await rejects(blocked.ready, 'OWNED_SESSION_CAPACITY'); assert.equal(calls.length, n); checks += 4;}
  console.log(JSON.stringify({status: 'PASS', classification: 'ISOLATED_MOCK_TRANSPORT_CLIENT_ONLY', checks, nativePhysicalAcceptance: false, unknownOrPrivateErrorEcho: false, oldRegistrationBranch: 'PASS'}));
} finally {Date.now = originalNow; globalThis.fetch = originalFetch; clearOwnerSessionMemory(); if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as any).window;}
