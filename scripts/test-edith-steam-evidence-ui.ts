import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as client from '../src/edith/computerDesktopClient';
import {clearOwnerSessionMemory} from '../src/edith/ownerMutationClient';

// Actual private controller extracted from mounted source. Native/HTTP boundaries
// are fixtures; this does not mount React or run desktop/UI/network/capture.
const source = fs.readFileSync(new URL('../src/components/ui/edithOS.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('edithOS.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = file.statements.filter(ts.isFunctionDeclaration);
const lifecycle = functions.find(n => n.name?.text === 'createSteamEvidenceUiLifecycle')!;
assert(lifecycle);
const helpers = ['steamEvidenceUiError', 'steamEvidenceUiProjection', 'steamEvidenceUiIntent'].map(name => {
  const node = functions.find(n => n.name?.text === name); assert(node, name); return node.getText(file);
});
const program = ts.transpileModule(helpers.concat(lifecycle.getText(file), 'globalThis.createLifecycle = createSteamEvidenceUiLifecycle;').join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
const states = ['Library MAIN pre','DETAIL MAIN positive','same-root sidebar','same-root Properties','same-root settings','same-root overlay','same-root other panel'];
let now = 2_000_000_000_000, serial = 0, checks = 0;
async function flush() {for (let i = 0; i < 35; i++) await Promise.resolve();}
function deferred() {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};}
function mount(boundaries: Record<string, unknown>, calls: string[]) {
  let locked = false, available = true, view: any, publications = 0;
  const timers = new Map<number, () => void>(); let timerId = 0;
  const context: any = vm.createContext({
    STEAM_READ_STATES: states, STEAM_READ_POLICY_ID: 'steam-noncontent-read-20261016-v1', TextEncoder, AbortController,
    Date: class extends Date {static now() {return now;}}, crypto: {randomUUID: () => 'ui-' + ++serial},
    setTimeout: (f: () => void) => {timers.set(++timerId, f); return timerId;}, clearTimeout: (id: number) => timers.delete(id),
    beginComputerSession: () => {throw new Error('Legacy approval forbidden in evidence path');},
    ...boundaries,
  });
  vm.runInContext(program, context, {timeout: 1000});
  const controller = context.createLifecycle({
    acquire: () => {if (locked || !available) return false; locked = true; return true;},
    release: () => {calls.push('release'); locked = false;},
    publish: (value: any) => {view = value; publications++;},
  });
  return {controller, timers, get locked() {return locked;}, get view() {return view;}, get publications() {return publications;}, set available(value: boolean) {available = value;}};
}
function fixture() {
  const calls: string[] = [], handles: any[] = [];
  let approvalGate: Promise<void> | undefined, createGate: Promise<void> | undefined, beginGate: Promise<void> | undefined, sampleGate: Promise<void> | undefined, cancelGate: Promise<void> | undefined;
  let quiescent = true, backend = 'complete', capability = true, beginError: unknown, createError: unknown, sampleError: unknown;
  let publishCountAtCancel: (() => void) | undefined;
  const ref = 'steam-read:' + 'a'.repeat(64);
  const f = mount({
    createOwnedComputerSession: (signal: AbortSignal) => {
      calls.push('owned'); const number = handles.length + 1;
      let raw = false, cancelled = false, settled = false, state = 'pending_approval', inFlight: Promise<any> | undefined;
      let rejectCancellation!: (reason: unknown) => void;
      const cancelledPromise = new Promise<never>((_, reject) => {rejectCancellation = reject;});
      const outcome = () => ({state, backendCleanup: raw && calls.includes('create') ? backend : 'not_requested', ...(state === 'terminal_unresolved' ? {error: 'OWNED_SESSION_ADMISSION_FAILED'} : {})});
      const cancel = () => {
        calls.push('cancel-' + number); publishCountAtCancel?.(); cancelled = true; rejectCancellation('OWNED_SESSION_CANCELLED');
        if (inFlight) return inFlight;
        if (!raw) {state = settled ? 'terminal_unresolved' : 'pending_approval'; return Promise.resolve(outcome());}
        if (state === 'native_quiescent') return Promise.resolve(outcome());
        const work = async () => {if (cancelGate) await cancelGate; calls.push('scoped-' + number); state = quiescent ? 'native_quiescent' : 'native_latched'; return outcome();};
        inFlight = work().finally(() => {inFlight = undefined;}); return inFlight;
      };
      const approval = async () => {
        if (!capability) {settled = true; state = 'terminal_unresolved'; throw 'OWNED_SESSION_ADMISSION_FAILED';}
        if (approvalGate) await approvalGate;
        raw = true; calls.push('approval-' + number);
        if (cancelled) {await cancel(); settled = true; throw 'OWNED_SESSION_CANCELLED';}
        settled = true; state = 'active'; return 'private-session-' + number;
      };
      signal.addEventListener('abort', () => {void cancel();}, {once: true});
      const ready = Promise.race([approval(), cancelledPromise]); void ready.catch(() => undefined);
      const handle = {ready, cancel, getState: outcome}; handles.push(handle); return handle;
    },
    assertComputerSessionActive: () => now + 300000,
    createSteamEvidenceTask: async (value: any) => {calls.push('create'); assert.equal(value.intent.gameName, '  Authorized fixture game  '); if (createGate) await createGate; if (createError !== undefined) throw createError; return {taskId: 'private-task', bindingId: 'private-binding'};},
    beginSteamEvidenceRead: async () => {calls.push('begin'); if (beginGate) await beginGate; if (beginError !== undefined) throw beginError; return {readRef: ref, expiresAt: now + 1000};},
    sampleSteamEvidenceRead: async (value: any) => {calls.push('sample'); if (sampleGate) await sampleGate; if (sampleError !== undefined) throw sampleError; return {
      schema: 'edith.steam.read-candidate/1', status: 'candidate', readRef: ref, sampleGeneration: 1, state: value.state, observedAt: now, expiresAt: now + 1000,
      candidateOnly: true, profileApproved: false, sourcePolicySha256: 'A'.repeat(64), sourceContractSha256: 'B'.repeat(64), nativeBuildId: 'c'.repeat(64),
      policyId: 'steam-noncontent-read-20261016-v1', policyVersion: 1, producer: 'native_uia', coverage: {complete: true, view: 'raw', nodeCount: 2},
      records: [{nodeId: 1, ancestorIds: [0, 1], propertyId: 30024, variant: 'BSTR', value: 'Chrome'}], privateExtra: 'PRIVATE_NEVER_RENDER',
    };},
  }, calls);
  return {controller: f.controller, calls, handles, timers: f.timers,
    get locked() {return f.locked;}, get view() {return f.view;}, get publications() {return f.publications;},
    set available(v: boolean) {f.available = v;}, set approvalGate(v: Promise<void> | undefined) {approvalGate = v;},
    set createGate(v: Promise<void> | undefined) {createGate = v;}, set beginGate(v: Promise<void> | undefined) {beginGate = v;}, set sampleGate(v: Promise<void> | undefined) {sampleGate = v;}, set cancelGate(v: Promise<void> | undefined) {cancelGate = v;},
    set quiescent(v: boolean) {quiescent = v;}, set backend(v: string) {backend = v;}, set capability(v: boolean) {capability = v;},
    set beginError(v: unknown) {beginError = v;}, set createError(v: unknown) {createError = v;}, set sampleError(v: unknown) {sampleError = v;},
    set atCancel(v: (() => void) | undefined) {publishCountAtCancel = v;},
  };
}
const intent = '  Authorized fixture game  ';
async function ready() {const f = fixture(); await f.controller.start(intent, true); assert.equal(f.view.phase, 'ready'); assert.equal(f.locked, true); return f;}
async function unitTests() {
  {const f = fixture(); await f.controller.start(intent, false); await f.controller.start('', true); f.available = false; await f.controller.start(intent, true); assert.deepEqual(f.calls, []); checks += 3;}
  {const f = await ready(); assert.deepEqual(f.calls.slice(0, 4), ['owned','approval-1','create','begin']); await f.controller.sample(states[0]);
    const rendered = JSON.stringify(f.view); for (const forbidden of ['private-session','private-binding','private-task','steam-read:','Authorized fixture','PRIVATE_NEVER_RENDER']) assert.equal(rendered.includes(forbidden), false);
    assert.equal(f.view.samples[0].records[0].value, 'Chrome'); assert.equal(f.view.profileApproved, false); f.atCancel = () => assert.equal(f.view.samples.length, 0);
    await f.controller.end(); assert.equal(f.view.phase, 'ended'); assert.equal(f.locked, false); assert.equal(f.view.nativeState, 'native_quiescent'); checks += 10;}
  {const f = await ready(); await f.controller.sample(states[0]); f.quiescent = false; await f.controller.end(); assert.equal(f.locked, true); assert.equal(f.view.phase, 'worker_pending'); assert.equal(f.view.samples.length, 0);
    const count = f.calls.length; await f.controller.start(intent, true); assert.equal(f.calls.length, count); f.quiescent = true; await f.controller.end(); assert.equal(f.locked, false); checks += 5;}
  for (const backend of ['pending','unresolved']) {const f = await ready(); f.backend = backend; await f.controller.end(); assert.equal(f.view.nativeState, 'native_quiescent'); assert.equal(f.view.phase, 'backend_pending'); assert.equal(f.locked, true);
    f.backend = 'complete'; await f.controller.end(); assert.equal(f.locked, false); checks += 4;}
  {const f = await ready(); const gate = deferred(); f.cancelGate = gate.promise; const a = f.controller.end(), b = f.controller.end(); await flush(); assert.equal(f.calls.filter(v => v === 'scoped-1').length, 0);
    gate.resolve(); await Promise.all([a,b]); assert.equal(f.calls.filter(v => v === 'scoped-1').length, 1); checks += 2;}
  {const f = await ready(); const gate = deferred(); f.sampleGate = gate.promise; const old = f.controller.sample(states[0]); await f.controller.end(); f.sampleGate = undefined; await f.controller.start(intent, true); await f.controller.sample(states[0]);
    gate.resolve(); await old; assert.equal(f.view.samples.length, 1); assert.equal(f.handles.length, 2); await f.controller.end(); checks += 2;}
  {const f = await ready(); await f.controller.sample(states[0]); const fire = [...f.timers.values()][0]; now += 1001; fire(); assert.equal(f.view.samples.length, 0); await flush(); assert.equal(f.locked, false); checks += 2;}
  {const f = fixture(); const gate = deferred(); f.approvalGate = gate.promise; const start = f.controller.start(intent, true); const count = f.publications; await f.controller.dispose(); await start;
    assert.equal(f.publications, count); assert.equal(f.calls.includes('create'), false); gate.resolve(); await flush(); assert.equal(f.handles[0].getState().state, 'native_quiescent'); assert.equal(f.calls.includes('begin'), false); checks += 4;}
  {const f = fixture(); const gate = deferred(); f.approvalGate = gate.promise; const start = f.controller.start(intent, true); await f.controller.end(); await start; assert.equal(f.view.phase, 'session_pending');
    gate.resolve(); await flush(); assert.equal(f.calls.includes('create'), false); await f.controller.end(); assert.equal(f.locked, false); checks += 3;}
  for (const stage of ['create','begin']) {const f = fixture(); const gate = deferred(); if (stage === 'create') {f.createGate = gate.promise; f.backend = 'unresolved';} else f.beginGate = gate.promise;
    const start = f.controller.start(intent, true); await flush(); const count = f.publications; await f.controller.dispose(); assert.equal(f.publications, count); assert.equal(f.handles[0].getState().state, 'native_quiescent');
    f.backend = 'complete'; gate.resolve(); await start; assert.equal(f.publications, count); if (stage === 'create') assert.equal(f.calls.includes('begin'), false); checks += 3;}
  {const f = fixture(); f.beginError = 'STEAM_READ_UNSUPPORTED'; await f.controller.start(intent, true); assert.equal(f.view.phase, 'ended'); assert.equal(f.view.nativeState, 'native_quiescent'); assert.equal(f.locked, false); checks += 3;}
  {const f = fixture(); f.capability = false; await f.controller.start(intent, true); assert.equal(f.view.phase, 'worker_pending'); assert.equal(f.locked, true); assert.equal(f.view.error, 'OWNED_SESSION_ADMISSION_FAILED'); assert.equal(f.calls.some(v => /approval|scoped|create|begin/.test(v)), false); checks += 4;}
  {const f = await ready(); f.sampleError = new Error('PRIVATE_PROVIDER'); await f.controller.sample(states[0]); await flush(); assert.equal(JSON.stringify(f.view).includes('PRIVATE_PROVIDER'), false); assert.equal(f.view.samples.length, 0); checks += 2;}
  {const f = await ready(); const n = f.calls.length; await f.controller.sample('unknown'); assert.equal(f.calls.length, n); await f.controller.sample(states[0]); await f.controller.sample(states[0]); assert.equal(f.calls.filter(v => v === 'sample').length, 1); await f.controller.statusLost(); assert.equal(f.locked, false); checks += 3;}
  {const f = await ready(); await f.controller.end(); await f.controller.start(intent, true); assert.equal(f.handles.length, 2); assert.equal(f.calls.filter(v => /^approval-/.test(v)).length, 2); await f.controller.end(); checks += 2;}
}
async function actualClientTests() {
  // Same frozen client used by production, with actual helper invocation boundaries
  // mocked. JSON normalization below only bridges the VM test realm's DTO prototypes.
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldFetch = globalThis.fetch, oldNow = Date.now;
  let index = 0, nativeId = '', workflow = '', expires = 0, approvalGate: Promise<void> | undefined, createGate: Promise<void> | undefined;
  let supported = true, refuseRead = false, backendUnavailable = false, lateBody = false;
  const calls: string[] = [], scopedIds: string[] = [], createdBindings = new Map<string, any>();
  const normalize = (value: any) => JSON.parse(JSON.stringify(value));
  const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  Date.now = () => now;
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {location: {origin: 'http://127.0.0.1:49999'}, __TAURI__: {core: {invoke: async (command: string, args?: any) => {
    calls.push(command);
    if (command === 'computer_status') return {runtime: 'tauri', ...(supported ? {scopedStopContract: 'edith.computer.expected-session-stop/1'} : {}), mode: 'owner_command', available: true, ownerCommandMode: true, killSwitch: 'inactive', screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready', overlay: 'missing', sessionExpiresAt: now + 300000, safeMessage: 'Software fixture only'};
    if (command === 'computer_begin') {const issued = nativeId = 'actual-fixture-' + ++index; if (approvalGate) await approvalGate; return issued;}
    if (command === 'computer_stop') {assert.deepEqual(Object.keys(args), ['expectedSessionId']); scopedIds.push(args.expectedSessionId); return {nativeSessionId: args.expectedSessionId, originalGeneration: 0, latchedGeneration: 1, observedAt: new Date(now).toISOString(), state: 'native_quiescent'};}
    if (command === 'computer_workflow_reserve') {workflow = args.workflowId; return {workflowId: workflow};}
    if (command === 'computer_workflow_release') return true;
    if (command === 'computer_task_register') {expires = now + 30000; return {registered: true, reservationId: workflow, expiresAt: expires};}
    if (command === 'computer_task_bind') return {bindingId: 'binding-' + index, taskId: 'task-' + index, state: 'RUNNING'};
    assert.equal(command, 'computer_steam_diagnostic_capture'); const e = args.evidence;
    assert.equal(e.op, 'begin'); if (refuseRead) throw 'STEAM_READ_UNSUPPORTED';
    return {schema: 'edith.steam.read-session/1', status: 'ready', readRef: 'steam-read:' + index.toString(16).padStart(64, '0'), expiresAt: expires, allowedStates: [...states], candidateOnly: true, profileApproved: false};
  }}}}});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push('http:' + (url.endsWith('/cancel') ? 'cancel' : url.endsWith('/session') ? 'auth' : 'create'));
    if (url.endsWith('/session')) return json({session: {actor: 'owner', csrfToken: 'software-csrf', createdAt: 'fixture', expiresAt: 'fixture'}});
    if (url.endsWith('/cancel')) {const bindingId = decodeURIComponent(url.split('/').at(-2)!); return backendUnavailable ? new Response('', {status: 503}) : json({...createdBindings.get(bindingId), state: 'CANCELLED'});}
    assert.equal(url, '/api/computer-use/workflows'); const request = JSON.parse(String(init?.body));
    const row = {success: true, bindingId: 'binding-' + index, taskId: 'task-' + index, workflowId: request.workflowId, state: 'QUEUED', expiresAt: expires, taskBinding: 'registered', physicalAcceptance: false}; createdBindings.set(row.bindingId, row);
    const gate = createGate; if (gate && !lateBody) await gate; const response = json(row);
    if (gate && lateBody) Object.defineProperty(response, 'json', {value: async () => {await gate; return row;}}); return response;
  }) as typeof fetch;
  const make = () => mount({
    createOwnedComputerSession: client.createOwnedComputerSession, assertComputerSessionActive: client.assertComputerSessionActive,
    createSteamEvidenceTask: (v: any) => client.createSteamEvidenceTask(normalize(v)),
    beginSteamEvidenceRead: (v: any) => client.beginSteamEvidenceRead(normalize(v)),
    sampleSteamEvidenceRead: (v: any) => client.sampleSteamEvidenceRead(normalize(v)),
  }, calls);
  try {
    {const f = make(), gate = deferred(); approvalGate = gate.promise; const start = f.controller.start(intent, true); await flush(); const original = nativeId;
      const count = f.publications; await f.controller.dispose(); await start; gate.resolve(); approvalGate = undefined; await flush();
      assert.equal(f.publications, count); assert(scopedIds.includes(original)); assert.equal(calls.includes('computer_workflow_reserve'), false); checks += 3;}
    {const f = make(); refuseRead = true; await f.controller.start(intent, true); refuseRead = false; assert.equal(f.view.phase, 'ended'); assert.equal(f.view.backendCleanup, 'complete'); assert.equal(f.locked, false); checks += 3;}
    for (const body of [false,true]) {const f = make(), gate = deferred(); createGate = gate.promise; lateBody = body; const start = f.controller.start(intent, true); await flush();
      const beforeBind = calls.filter(v => v === 'computer_task_bind').length; await f.controller.end(); assert.equal(f.view.phase, 'backend_pending'); assert.equal(f.locked, true);
      gate.resolve(); createGate = undefined; await start; await flush(); await f.controller.end(); assert.equal(f.view.phase, 'ended'); assert.equal(calls.filter(v => v === 'computer_task_bind').length, beforeBind); checks += 4;}
    {const f = make(); await f.controller.start(intent, true); assert.equal(f.view.phase, 'ready'); backendUnavailable = true; await f.controller.end(); assert.equal(f.view.phase, 'backend_pending'); assert.equal(f.view.nativeState, 'native_quiescent');
      const stops = scopedIds.length; backendUnavailable = false; await f.controller.end(); assert.equal(f.locked, false); assert.equal(scopedIds.length, stops); checks += 4;}
    {const f = make(); supported = false; const n = calls.length; await f.controller.start(intent, true); assert.equal(f.locked, true); assert.equal(f.view.phase, 'worker_pending');
      assert.deepEqual(calls.slice(n), ['computer_status']); checks += 3;}
    assert.equal(calls.some(command => /observe|screenshot|action|focus|locate|finish/.test(command)), false); checks++;
  } finally {Date.now = oldNow; globalThis.fetch = oldFetch; clearOwnerSessionMemory(); if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as any).window;}
}
async function mountedCallbacks() {
  const component = functions.find(n => n.name?.text === 'ComputerUseScreen')!;
  function callback(name: string) {
    let result: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) {
        result = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(component); assert(result, name); return result!.getText(file);
  }
  let unmount = '';
  const findUnmount = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'React.useEffect' && node.arguments[0]?.getText(file).includes('screenMounted.current = true')) {
      const effect = node.arguments[0] as ts.ArrowFunction;
      const cleanup = (effect.body as ts.Block).statements.find(ts.isReturnStatement)?.expression;
      assert(cleanup); unmount = cleanup.getText(file);
    }
    ts.forEachChild(node, findUnmount);
  };
  findUnmount(component); assert(unmount);
  const f = await ready(), effects: string[] = [];
  let globalListener = () => {}, normalId: string | undefined;
  const noop = () => {};
  const globals: any = {
    steamReadLifecycle: f.controller, steamReadLockedRef: {current: true}, evidenceModeRef: {current: true}, regularSessionRef: {current: null},
    screenMounted: {current: true}, stoppingRef: {current: false}, approvalPending: {current: false}, nativeBusyRef: {current: false}, transientEpoch: {current: 0},
    revokedSessionIdsRef: {current: new Set()}, task: null, sessionId: null, timer: 1, Event,
    window: {clearInterval: noop, dispatchEvent: () => {globalListener();}}, nativeMobileConsumerClient: {clear: noop},
    setSteamGameIntent: noop, setSteamReadConfirmed: noop, setStopping: noop, setError: noop, setNativeStopState: noop, setPhase: noop, setApproving: noop,
    setSessionId: (id: string) => {normalId = id;}, record: noop, invalidateTransient: noop, claimTask: () => false, onTaskHandled: undefined,
    stopComputer: async () => {effects.push('explicit-global-stop'); return {state: 'unknown'};}, currentNativeStopState: () => 'unknown',
    refreshStatus: async () => ({ownerCommandMode: true}), verifySafety: async () => {},
    beginComputerSession: async () => {effects.push('fresh-normal-approval'); return 'new-normal-session';},
    observe: async (id: string) => {assert.equal(id, 'new-normal-session'); effects.push('normal-observe');}, executeTask: noop,
  };
  const context = vm.createContext(globals);
  const compile = (code: string) => {const js = ts.transpileModule('globalThis.selectedCallback = (' + code + ');', {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText; vm.runInContext(js, context); return globals.selectedCallback;};
  globalListener = compile(callback('onGlobalStop'));
  const stop = compile(callback('stop'));
  const begin = compile(callback('begin'));
  const cleanup = compile(unmount);
  await begin(); assert.equal(effects.length, 0, 'Read lock rejects normal approval before work');
  await stop(); assert.equal(effects.filter(v => v === 'explicit-global-stop').length, 1); assert.equal(f.locked, false);
  globals.steamReadLockedRef.current = false; cleanup(); assert.equal(effects.filter(v => v === 'explicit-global-stop').length, 1, 'Ended evidence mode must not globally stop a later foreign session');
  globals.screenMounted.current = true; await begin(); assert.equal(normalId, 'new-normal-session'); assert.equal(globals.evidenceModeRef.current, false);
  assert.deepEqual(effects.slice(-2), ['fresh-normal-approval','normal-observe']);
  cleanup(); assert.equal(effects.filter(v => v === 'explicit-global-stop').length, 2, 'Explicit normal mode retains its legacy unmount behavior'); checks += 7;
}
async function statusCallbackTests() {
  const component = functions.find(n => n.name?.text === 'ComputerUseScreen')!;
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'refreshStatus' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(component); assert(callback);
  const callbackProgram = ts.transpileModule('globalThis.refresh = (' + callback!.getText(file) + ');', {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
  const failures: string[] = [];
  for (const outcome of ['rejection', 'inactive', 'healthy'] as const) {
    for (const transition of ['B-pending', 'B-admitted', 'transient-changed', 'same-original', 'original-pending'] as const) {
      const label = outcome + '/' + transition;
      const f = fixture(), intent = '  Authorized fixture game  ';
      const approval = deferred();
      if (transition === 'original-pending') f.approvalGate = approval.promise;
      const startA = f.controller.start(intent, true); await flush();
      if (transition !== 'original-pending') await startA;
      let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
      const pending = new Promise((r, j) => {resolve = r; reject = j;});
      const effects: string[] = [], transientEpoch = {current: 0};
      const globals: any = {steamReadLifecycle: f.controller, transientEpoch,
        getComputerDesktopStatus: () => pending,
        setStatus: () => effects.push('publish-status'), reportComputerRuntimeStatus: async () => {effects.push('report-status');}};
      vm.runInContext(callbackProgram, vm.createContext(globals));
      const refresh = globals.refresh().catch(() => {effects.push('outer-error');});
      let startB: Promise<void> | undefined;
      if (transition.startsWith('B-')) {
        await f.controller.end();
        if (transition === 'B-pending') f.approvalGate = approval.promise;
        startB = f.controller.start(intent, true); await flush();
        if (transition === 'B-admitted') await startB;
      } else if (transition === 'transient-changed') transientEpoch.current++;
      const beforeCalls = f.calls.length, beforePublications = f.publications;
      if (outcome === 'rejection') reject(new Error('PRIVATE_STALE_STATUS'));
      else resolve({available: true, ownerCommandMode: outcome === 'healthy', killSwitch: 'inactive'});
      await refresh; await flush();
      try {
        const stale = transition.startsWith('B-') || transition === 'transient-changed';
        if (stale) {
          assert.deepEqual(f.calls.slice(beforeCalls), [], label + ': no cancellation');
          assert.equal(f.publications, beforePublications, label + ': no lifecycle publication');
          assert.deepEqual(effects, [], label + ': no status/report/outer-error publication');
          assert.equal(f.locked, true, label + ': original or B remains owned');
          assert.equal(f.controller.hasAdmittedSession(), transition !== 'B-pending'); checks += 5;
        } else if (transition === 'same-original' && outcome !== 'healthy') {
          assert.equal(f.locked, false, label + ': valid original loss closes original');
          assert(f.calls.slice(beforeCalls).includes('scoped-1'));
          assert.equal(f.handles.length, 1); checks += 3;
        } else {
          assert.equal(f.locked, true, label + ': pending or healthy original retained');
          assert.deepEqual(f.calls.slice(beforeCalls), []); checks += 2;
        }
      } catch (error) {failures.push(label + ': ' + String(error));}
      approval.resolve(); await Promise.all([startA, startB]); await f.controller.end();
    }
  }
  assert.deepEqual(failures, [], 'Actual refresh callback lifecycle race matrix');
}
async function main() {
  await unitTests(); await actualClientTests(); await mountedCallbacks(); await statusCallbackTests();
  const component = functions.find(n => n.name?.text === 'ComputerUseScreen')!.getText(file);
  for (const name of ['runAction','executeTask','inspectNative','clickIntendedTransition','showFilteredFrame']) {const pos = component.indexOf('const ' + name + ' '); assert(pos >= 0); assert(component.slice(pos,pos+450).includes('steamReadLockedRef.current'));}
  assert.match(component, /Steam kanıt okuması/); assert.match(component, /hasAdmittedSession\(\)/); assert.match(component, /!evidenceModeRef.current/); assert.match(component, /evidenceModeRef.current = false/);
  assert.equal(lifecycle.getText(file).includes('beginComputerSession('), false); assert.equal(lifecycle.getText(file).includes('stopComputer('), false);
  for (const forbidden of ['observeComputer','getComputerScreenshot','runComputerAppWorkflow','actOnComputer','finishComputerTask','reportComputerOperatorEvent','ownerMutationFetch','localStorage','sessionStorage','navigator.clipboard','console.']) assert.equal(lifecycle.getText(file).includes(forbidden), false, forbidden);
  checks += 11;
  console.log(JSON.stringify({status: 'PASS', classification: 'ACTUAL_PRIVATE_UI_LIFECYCLE_AND_FROZEN_CLIENT_MOCK_BOUNDARIES', checks, nativeRuntime: false, renderedUI: false, conservativeAdmissionAmbiguity: 'UNRESOLVED_NO_FAKE_CLOSURE', normalSessionReuse: false}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
