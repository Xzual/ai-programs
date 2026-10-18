import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createTaskActivityObserver} from '../src/components/tasks/TaskActivityProvider';
import {fetchTaskHudWorkspaceId} from '../src/components/tasks/taskHudWorkspaceScope';
import {fetchTaskHudActivityV1, fetchTaskHudListV1, parseTaskActivityV2, type TaskActivityV2View} from '../src/edith/taskActivityClient';
import type {TaskHudIntent} from '../src/components/tasks/taskHudProjection';
import {LocalVoiceSessionGate, parseVoiceLiveServerEvent} from '../src/edith/voiceLiveClient';
import {EDITH_VOICE_ROOM_MODEL} from '../src/edith/voiceRoomService';

// Synthetic HTTP boundaries only. The actual bridge, strict receiver, canonical
// observer, parsers and scoped GET helpers remain production implementations.
assert(existsSync(new URL('../src/components/tasks/voiceTaskHudBridge.ts', import.meta.url)), 'Production voice HUD consumer bridge must exist');
const {createVoiceTaskHudBridge} = await import('../src/components/tasks/voiceTaskHudBridge');
let groups = 0;
const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function activity(id: string, revision = 1, sequence = 1, title = `Synthetic canonical ${id}`): TaskActivityV2View {
  return parseTaskActivityV2({success: true, contract: {schema: 'edith.shared', version: 2}, data: {
    task: {id, title, objective: 'Synthetic fixture only', priority: 'normal', status: 'RUNNING', contractVersion: 2, revision, eventSequence: sequence},
    progress: {contractVersion: 2, taskId: id, revision, status: 'RUNNING', percent: 20, completedSteps: 0, totalSteps: 0, failedSteps: 0, recoveryAttempts: 0, terminal: false, sources: ['task_status']},
    events: [],
  }});
}
const admission = (sequence = 1, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, type: 'skill:task_admitted', generation: 1, voiceSessionId: 'voice-fixture:1', utteranceId: `utterance-${sequence}`,
  commandSequence: sequence, taskId: 'B', skillId: 'system_status', revision: 2, eventSequence: 1, admittedAt: '2026-10-17T00:00:00.000Z', ...overrides,
});
const presentation = (sequence: number, action: 'show_current' | 'hide', overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, type: 'hud:presentation', generation: 1, voiceSessionId: 'voice-fixture:1', utteranceId: `utterance-${sequence}`, commandSequence: sequence, action, ...overrides,
});
const originalFetch = globalThis.fetch;
const pendingUnhandled: unknown[] = [];
const unhandled = (error: unknown) => { pendingUnhandled.push(error); };
process.on('unhandledRejection', unhandled);

function fixture(readEnabled = true) {
  let workspace: string | undefined = 'workspace-fixture-A', ownerAllowed = true, gateCurrent = true, bridgeCurrent = true, hudMarker = true;
  const records = new Map([['A', activity('A')], ['B', activity('B', 3, 2)]]);
  const calls: Array<{url: string; signal: AbortSignal}> = [];
  const timers = new Map<number, () => void>();
  let timer = 0;
  const intents: TaskHudIntent[] = [];
  const envelope = (data: unknown, scope = workspace) => ({success: true, contract: {schema: 'edith.shared', version: 2}, ...(hudMarker ? {hud: {schemaVersion: 1, view: 'hud-v1', workspaceId: scope}} : {}), data});
  const response = (id: string, scope = workspace) => {
    const row = records.get(id);
    return row ? new Response(JSON.stringify(envelope({task: row.task, progress: row.progress, events: row.events}, scope))) : new Response('{}', {status: 404});
  };
  let readActivity = async (id: string, _signal: AbortSignal) => response(id);
  globalThis.fetch = (async (input, options) => {
    const url = String(input);
    assert.equal(options?.method ?? 'GET', 'GET', 'Presentation must never execute a mutation');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.cache, 'no-store');
    assert(options?.signal instanceof AbortSignal, 'Every read is scoped and cancellable');
    calls.push({url, signal: options.signal});
    if (!ownerAllowed) return new Response('{}', {status: 401});
    if (url === '/api/workspace/status') return new Response(JSON.stringify({success: true, configured: Boolean(workspace), config: {workspaceId: workspace}}));
    if (url === '/api/edith/tasks?view=hud-v1') return new Response(JSON.stringify(envelope({tasks: [...records.values()].map(row => row.task)})));
    const match = /^\/api\/edith\/tasks\/([A-Za-z0-9._:-]+)\/activity\?view=hud-v1$/.exec(url);
    assert(match, `Forbidden unscoped or execution/audio route: ${url}`);
    return readActivity(match[1], options.signal);
  }) as typeof fetch;
  const observer = createTaskActivityObserver({readEnabled, readWorkspace: fetchTaskHudWorkspaceId,
    readList: (signal, scope) => fetchTaskHudListV1(scope, signal), readActivity: (id, signal, scope) => fetchTaskHudActivityV1(id, scope, signal),
    now: () => 2_000_000_000_000, setInterval: callback => {timers.set(++timer, callback); return timer;}, clearInterval: value => {timers.delete(value as number);}});
  const bridge = createVoiceTaskHudBridge({observer, present: intent => intents.push(intent), isCurrent: () => bridgeCurrent});
  const ready = (session = 'voice-fixture:1', generation = 1) => bridge.bindReady(session, generation, () => gateCurrent);
  const start = async () => {observer.start(); await flush(); if (readEnabled) assert.equal(observer.getSnapshot().activity?.task.id, 'A');};
  const finish = () => {bridge.clear(); observer.stop(); assert.equal(timers.size, 0);};
  return {observer, bridge, ready, start, finish, records, calls, intents, timers, response,
    set read(value: typeof readActivity) {readActivity = value;}, set workspace(value: string | undefined) {workspace = value;},
    set owner(value: boolean) {ownerAllowed = value;}, set current(value: boolean) {gateCurrent = value;}, set bridgeCurrent(value: boolean) {bridgeCurrent = value;}, set hudMarker(value: boolean) {hudMarker = value;}};
}

function voiceCallbackFixture(f: ReturnType<typeof fixture>) {
  // Extract the exact production statement, rather than copying its conditions.
  // No import/evaluation of the rest of edithOS or a mounted UI is performed.
  const source = readFileSync(new URL('../src/components/ui/edithOS.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('edithOS.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'VoiceScreen');
  assert(screen?.body, 'Production VoiceScreen function must exist');
  const declaration = screen.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === 'handleServerEvent'));
  assert(declaration && ts.isVariableStatement(declaration), 'Production VoiceScreen handleServerEvent statement must exist');
  const initializer = declaration.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === 'handleServerEvent')?.initializer;
  assert(initializer && ts.isCallExpression(initializer) && initializer.expression.getText(parsed) === 'React.useCallback', 'Expected production callback extraction shape');
  const gate = new LocalVoiceSessionGate(), generation = gate.begin();
  const effects = {captureStarts: 0, captureStops: 0, playbackStops: 0, sessionStops: 0, cryptoCommands: 0, audioPlays: 0, timerClears: 0, uiWrites: 0, socketSends: 0, socketCloses: 0};
  const socket = {send: () => {effects.socketSends++;}, close: () => {effects.socketCloses++;}};
  const socketRef: {current: typeof socket | null} = {current: socket};
  const mountedRef = {current: true};
  const skillResults: unknown[] = [];
  const stateWrite = () => {effects.uiWrites++;};
  const stopLiveSession = (_reason: string) => {effects.sessionStops++; gate.stop(); f.bridge.clear(); socketRef.current = null;};
  const context = vm.createContext({
    React: {useCallback: (callback: unknown) => callback},
    mountedRef, socketRef, localGateRef: {current: gate}, parseVoiceLiveServerEvent,
    assistantProfile: {id: 'jarvis'}, voiceHudBridge: f.bridge,
    stopCapture: () => {effects.captureStops++;}, stopPlayback: () => {effects.playbackStops++;},
    startCapture: async () => {effects.captureStarts++; return false;},
    readyTimerRef: {current: null}, clearTimeout: () => {effects.timerClears++;},
    setVoiceCapabilities: stateWrite, setRoomState: stateWrite, stopLiveSession,
    setVoiceError: stateWrite, setVoiceErrorCode: stateWrite,
    playbackSourcesRef: {current: []}, pendingPlaybackIdleRef: {current: false},
    voiceRoomStateAfterServerStatus: () => {throw Error('Unexpected status branch in HUD fixture');},
    voiceRoomRuntimeStatusAfterServerState: () => {throw Error('Unexpected runtime status branch in HUD fixture');},
    setPartialTranscript: stateWrite, setFinalTranscript: stateWrite, completedTranscriptsRef: {current: new Set<string>()},
    runCryptoVoiceCommand: () => {effects.cryptoCommands++;}, setJarvisReply: stateWrite,
    setSkillResult: (value: unknown) => {effects.uiWrites++; skillResults.push(value);},
    setAudioChunkCount: stateWrite, setLastAudioMimeType: stateWrite, playPcmAudio: () => {effects.audioPlays++;},
  });
  const code = ts.transpileModule(declaration.getText(parsed) + '\nglobalThis.extractedVoiceCallback = handleServerEvent;', {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
  }).outputText;
  vm.runInContext(code, context, {filename: 'production-VoiceScreen-handleServerEvent.js', timeout: 1000});
  const invoke = context.extractedVoiceCallback as (raw: {data: string}, sourceSocket: typeof socket, localGeneration: number) => void;
  const receive = (event: unknown, sourceSocket = socket, localGeneration = generation) => invoke({data: JSON.stringify(event)}, sourceSocket, localGeneration);
  const ready = (overrides: Record<string, unknown> = {}) => ({type: 'session:ready', sessionId: 'voice-fixture:1', generation: 3, personaId: 'jarvis', model: EDITH_VOICE_ROOM_MODEL, ...overrides});
  const reset = () => {for (const key of Object.keys(effects) as Array<keyof typeof effects>) effects[key] = 0;};
  return {gate, generation, effects, socket, mountedRef, skillResults, receive, ready, reset, stop: stopLiveSession};
}

try {
  {const f = fixture();
    assert.equal(f.ready(), false, 'Initial accepted-ready candidate has no canonical scope yet');
    assert.equal(f.calls.length, 0); assert.equal(f.intents.length, 0);
    await f.start();
    const before = f.calls.length;
    assert.equal(f.bridge.receive(presentation(1, 'show_current')), true, 'The first safe workspace snapshot activates the still-current initial ready candidate without a second ready event');
    await flush(); assert(f.calls.length > before, 'Activated candidate performs the actual scoped canonical read');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'A');
    assert.equal(f.intents.at(-1)?.kind, 'show'); f.finish(); groups++;
  }
  {const f = fixture();
    assert.equal(f.ready(), false);
    assert.equal(f.bridge.receive(presentation(1, 'show_current')), false, 'Early scope-unknown event cannot be delivered');
    assert.equal(f.bridge.receive({...presentation(1, 'show_current'), extra: 'malformed'}), false);
    assert.equal(f.bridge.receive(presentation(1, 'show_current', {voiceSessionId: 'wrong-early-session'})), false);
    assert.equal(f.calls.length, 0); assert.equal(f.intents.length, 0);
    await f.start();
    assert.equal(f.bridge.receive(presentation(2, 'show_current')), true, 'An early receive must not destroy the still-current initial ready candidate');
    await flush(); assert.equal(f.observer.getSnapshot().activity?.task.id, 'A'); assert.equal(f.intents.at(-1)?.kind, 'show');
    f.finish(); groups++;
  }
  {const f = fixture();
    assert.equal(f.ready(), false);
    f.current = false;
    await f.start();
    const before = f.calls.length, shown = f.intents.length;
    assert.equal(f.bridge.receive(presentation(1, 'show_current')), false, 'An expired captured gate cannot activate on first workspace discovery');
    f.current = true;
    assert.equal(f.bridge.receive(presentation(2, 'show_current')), false, 'Restoring the gate cannot revive a rejected initial candidate');
    await flush(); assert.equal(f.calls.length, before); assert.equal(f.intents.length, shown); f.finish(); groups++;
  }
  {const f = fixture();
    assert.equal(f.ready(), false, 'No canonical workspace snapshot: ready cannot grant read authority');
    await f.start(); assert.equal(f.ready(), true);
    const held = deferred<Response>(); f.read = async () => held.promise;
    assert.equal(f.bridge.receive(admission()), true);
    assert.equal(f.observer.getSnapshot().selection.kind, 'awaiting-task-link');
    assert.equal(f.observer.getSnapshot().activity, undefined, 'A locator is not task facts');
    await flush();
    assert.equal(f.intents.at(-1)?.kind, 'show');
    assert(!JSON.stringify(f.intents).includes('Synthetic canonical'), 'Presentation contains no task facts');
    held.resolve(f.response('B')); await flush();
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'B'});
    assert.equal(f.observer.getSnapshot().activity?.task.revision, 3);
    assert.equal(f.observer.getSnapshot().activity?.task.eventSequence, 2);
    assert.equal(f.observer.getSnapshot().activity?.progress.percent, 20);
    assert.equal(f.observer.getSnapshot().activity?.task.status, 'RUNNING');
    assert.equal(f.timers.size, 1, 'Voice adds no poller');
    const calls = f.calls.length;
    assert.equal(f.bridge.receive(admission()), false, 'Repeated admission does not refresh or select again');
    assert.equal(f.calls.length, calls);
    assert.equal(f.bridge.receive(presentation(2, 'hide')), true);
    await flush(); assert.equal(f.intents.at(-1)?.kind, 'hide');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B', 'Hide retains completed canonical selection');
    assert.equal(f.calls.length, calls, 'Hide starts no reads, reconnect, mutation or audio request');
    f.bridge.clear(); assert.equal(f.observer.getSnapshot().selection.kind, 'automatic', 'Stop clears voice-owned selection');
    assert.equal(f.bridge.receive(admission(3)), false); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    const before = f.calls.length;
    assert.equal(f.bridge.receive(JSON.stringify(presentation(1, 'show_current'))), true);
    await flush(); assert(f.calls.length > before, 'show_current must re-read canonical scope');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'A');
    assert.equal(f.intents.at(-1)?.kind, 'show'); assert.equal(f.timers.size, 1); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    await f.observer.select({kind: 'explicit', taskId: 'B'});
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B');
    assert.equal(f.bridge.receive(presentation(1, 'show_current')), true); await flush();
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'B'}, 'show_current must preserve manual explicit selection');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B', 'Showing the current HUD cannot retarget manual B to automatic A');
    assert.equal(f.intents.at(-1)?.kind, 'show'); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    assert.equal(f.bridge.receive(admission()), true); await flush();
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'B'});
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B');
    assert.equal(f.bridge.receive(presentation(2, 'show_current')), true); await flush();
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'B'}, 'A newer show_current must preserve the completed canonical admission selection');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B', 'Only a new admission may retarget the current voice task');
    assert.equal(f.intents.at(-1)?.kind, 'show'); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    assert.equal(f.bridge.receive(presentation(3, 'hide')), true);
    assert.equal(f.ready(), true, 'Repeated same ready is harmless');
    const before = f.calls.length, shown = f.intents.length;
    for (const value of [admission(1), presentation(3, 'show_current'), admission(3), presentation(2, 'hide'), {...admission(4), extra: 'not allowed'}, {...admission(4), taskId: '../foreign'}, {...admission(4), revision: 0}, {...admission(4), eventSequence: 0}, {...admission(4), generation: 2}, {...admission(4), voiceSessionId: 'other'}, {...presentation(4, 'show_current'), taskId: 'B'}, {type: 'assistant:transcript', text: 'task completed'}, 'not json', null]) {
      assert.equal(f.bridge.receive(value), false);
    }
    await flush(); assert.equal(f.calls.length, before); assert.equal(f.intents.length, shown);
    assert.equal(f.ready('voice-fixture:2', 2), true);
    assert.equal(f.bridge.receive(presentation(4, 'show_current')), false);
    assert.equal(f.bridge.receive(presentation(1, 'show_current', {voiceSessionId: 'voice-fixture:2', generation: 2})), true);
    await flush(); f.finish(); groups++;
  }
  for (const kind of ['revision', 'sequence', 'other-task', 'denied', 'wrong-workspace'] as const) {
    const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    f.read = async () => {
      if (kind === 'denied') return new Response('{}', {status: 403});
      if (kind === 'other-task') return f.response('A');
      if (kind === 'wrong-workspace') return f.response('B', 'foreign-workspace');
      f.records.set('B', activity('B', kind === 'revision' ? 1 : 3, kind === 'sequence' ? 0 : 2));
      return f.response('B');
    };
    assert.equal(f.bridge.receive(admission()), true); await flush();
    assert.equal(f.observer.getSnapshot().activity, undefined, `${kind}: hint cannot substitute for a matching canonical read`);
    assert.notEqual(f.observer.getSnapshot().state, 'ready');
    assert(!JSON.stringify(f.observer.getSnapshot()).includes('task completed')); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    f.hudMarker = false;
    assert.equal(f.bridge.receive(admission()), true); await flush();
    assert.equal(f.observer.getSnapshot().activity, undefined, 'A server ignoring view=hud-v1 cannot supply canonical HUD facts');
    assert.notEqual(f.observer.getSnapshot().state, 'ready');
    assert(f.calls.every(call => call.url === '/api/workspace/status' || call.url.endsWith('?view=hud-v1')), 'Missing marker must not trigger an unscoped legacy fallback');
    f.finish(); groups++;
  }
  for (const outcome of ['success', 'error'] as const) {
    const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    const held = deferred<Response>(); f.read = async () => held.promise;
    assert.equal(f.bridge.receive(admission()), true); await flush();
    assert.equal(f.bridge.receive(presentation(2, 'hide')), true); await flush();
    const hidden = f.observer.getSnapshot(), shown = f.intents.length;
    if (outcome === 'success') held.resolve(f.response('B')); else held.reject(new Error('SYNTHETIC_OLD_ERROR'));
    await flush(); assert.equal(f.observer.getSnapshot(), hidden, 'Late read cannot update hidden UI');
    assert.equal(f.intents.length, shown); assert.equal(f.intents.at(-1)?.kind, 'hide'); f.finish(); groups++;
  }
  for (const outcome of ['success', 'error'] as const) {
    const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    const held = deferred<Response>(); f.read = async id => id === 'B' ? held.promise : f.response('A');
    f.bridge.receive(admission()); await flush();
    f.bridge.receive(admission(2, {taskId: 'A', revision: 1, eventSequence: 1})); await flush();
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'A');
    const current = f.observer.getSnapshot(), shown = f.intents.length;
    if (outcome === 'success') held.resolve(f.response('B')); else held.reject(new Error('SYNTHETIC_PREVIOUS_COMMAND_ERROR'));
    await flush(); assert.equal(f.observer.getSnapshot(), current); assert.equal(f.intents.length, shown); f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    f.bridge.receive(admission()); await flush(); await f.observer.select({kind: 'explicit', taskId: 'A'});
    f.bridge.clear(); assert.equal(f.observer.getSnapshot().activity?.task.id, 'A');
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'A'}, 'Voice cleanup cannot clear later manual selection'); f.finish(); groups++;
  }
  for (const outcome of ['success', 'error'] as const) {
    const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    const held = deferred<Response>(); f.read = async id => id === 'B' ? held.promise : f.response('A');
    f.bridge.receive(admission()); await flush();
    await f.observer.select({kind: 'explicit', taskId: 'A'});
    const manual = f.observer.getSnapshot();
    if (outcome === 'success') held.resolve(f.response('B')); else held.reject(new Error('SYNTHETIC_PREVIOUS_VOICE_ERROR'));
    await flush(); assert.equal(f.observer.getSnapshot(), manual, 'Manual ownership supersedes pending voice read');
    f.bridge.clear(); assert.equal(f.observer.getSnapshot().activity?.task.id, 'A');
    assert.deepEqual(f.observer.getSnapshot().selection, {kind: 'explicit', taskId: 'A'}); f.finish(); groups++;
  }
  for (const kind of ['local-gate', 'consumer-current', 'stop', 'owner', 'workspace', 'workspace-ABA'] as const) {
    const f = fixture(); await f.start(); assert.equal(f.ready(), true);
    const held = deferred<Response>(); f.read = async () => held.promise;
    f.bridge.receive(admission()); await flush();
    if (kind === 'local-gate') f.current = false;
    else if (kind === 'consumer-current') f.bridgeCurrent = false;
    else if (kind === 'stop') f.observer.stop();
    else if (kind === 'owner') {f.owner = false; await f.observer.refresh(true);}
    else {f.workspace = 'workspace-fixture-B'; f.read = async id => f.response(id); await f.observer.refresh(true); if (kind === 'workspace-ABA') {f.workspace = 'workspace-fixture-A'; await f.observer.refresh(true);}}
    const before = f.observer.getSnapshot(), shown = f.intents.length;
    held.resolve(f.response('B', 'workspace-fixture-A')); await flush();
    assert.equal(f.observer.getSnapshot(), before, `${kind}: late previous authority read discarded`);
    assert.equal(f.intents.length, shown);
    assert.equal(f.bridge.receive(presentation(2, 'show_current')), false, `${kind}: binding cannot outlive captured gate/scope`);
    f.finish(); groups++;
  }
  {const f = fixture(false); await f.start(); assert.equal(f.ready(), false); assert.equal(f.bridge.receive(admission()), false); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); f.finish(); groups++;}
  {const f = fixture(); await f.start(); const c = voiceCallbackFixture(f);
    const quiet = {...c.effects}, foreignSocket = {...c.socket};
    c.receive(c.ready({personaId: 'friday'}));
    c.receive(c.ready(), foreignSocket);
    c.receive(c.ready(), c.socket, c.generation + 1);
    c.receive(c.ready({generation: 0}));
    c.receive(c.ready({generation: undefined}));
    assert.deepEqual(c.effects, quiet, 'Wrong persona/socket/local generation/server generation cannot accept ready');
    assert.equal(c.gate.ownsReady(c.generation, 3), false);
    c.receive(c.ready()); await flush();
    assert.equal(c.gate.ownsReady(c.generation, 3), true);
    assert.equal(c.gate.ready, false, 'Inert startCapture=false never claims microphone readiness');
    assert.equal(c.effects.captureStarts, 1); assert.equal(c.effects.captureStops, 1); assert.equal(c.effects.playbackStops, 1);
    c.reset(); const noHudSideEffects = {...c.effects};
    c.receive(admission(1, {generation: 3}));
    assert.equal(f.observer.getSnapshot().selection.kind, 'awaiting-task-link', 'Production callback routes canonical hint before microphone activation');
    await flush(); assert.equal(f.observer.getSnapshot().activity?.task.id, 'B');
    c.receive(presentation(2, 'hide', {generation: 3})); await flush();
    assert.equal(f.intents.at(-1)?.kind, 'hide');
    assert.equal(f.observer.getSnapshot().activity?.task.id, 'B');
    assert.deepEqual(c.effects, noHudSideEffects, 'Actual HUD callback path does not call capture/playback/crypto/session/socket/timer dependencies');
    assert.equal(f.timers.size, 1);
    const reads = f.calls.length, shown = f.intents.length;
    c.receive(admission(3, {generation: 2}));
    c.receive(admission(3, {generation: 4}));
    c.receive(admission(3, {generation: 3}), foreignSocket);
    c.receive(admission(3, {generation: 3}), c.socket, c.generation + 1);
    c.receive(c.ready({generation: 2, sessionId: 'old-ready'}));
    c.receive(c.ready({generation: 3, sessionId: 'duplicate-ready'}));
    c.receive(c.ready({generation: 4, personaId: 'friday'}));
    c.mountedRef.current = false; c.receive(admission(3, {generation: 3})); c.mountedRef.current = true;
    await flush(); assert.equal(f.calls.length, reads); assert.equal(f.intents.length, shown); assert.deepEqual(c.effects, noHudSideEffects);
    assert.equal(c.gate.ownsReady(c.generation, 3), true, 'Rejected old or mismatched ready cannot replace the current accepted ready');
    c.stop('fixture_stop');
    const stopped = f.observer.getSnapshot(), stoppedReads = f.calls.length, stoppedIntents = f.intents.length, stoppedEffects = {...c.effects};
    c.receive(admission(4, {generation: 3})); await flush();
    assert.equal(f.observer.getSnapshot(), stopped); assert.equal(f.calls.length, stoppedReads); assert.equal(f.intents.length, stoppedIntents); assert.deepEqual(c.effects, stoppedEffects);
    f.finish(); groups++;
  }
  {const f = fixture(); await f.start(); const c = voiceCallbackFixture(f);
    c.receive(c.ready()); await flush();
    // Synthetic local flag only, to reach normal metadata branches. No capture,
    // microphone, provider or playback is started by this fixture.
    assert.equal(c.gate.activateMicrophone(c.generation, true), true);
    c.reset(); const before = f.observer.getSnapshot(), reads = f.calls.length, shown = f.intents.length;
    c.receive({type: 'skill:result', generation: 3, utteranceId: 'result-fixture', outcome: 'completed', taskId: 'NOT-CANONICAL', verificationStatus: 'PASS'});
    c.receive({type: 'transcript:assistant', generation: 3, text: 'Synthetic narrative says task completed', partial: false});
    c.receive({type: 'transcript:user', generation: 3, text: 'Synthetic partial transcript', partial: true});
    await flush(); assert.equal(c.skillResults.length, 1, 'Actual production skill-result display branch was reached');
    assert(c.effects.uiWrites > 0, 'Actual transcript display branches were reached');
    assert.equal(f.observer.getSnapshot(), before, 'Skill results and narrative transcripts never become canonical hints or task facts');
    assert.equal(f.calls.length, reads); assert.equal(f.intents.length, shown);
    assert.equal(c.effects.cryptoCommands, 0, 'Partial transcript never invokes crypto dispatcher');
    assert.equal(c.effects.audioPlays, 0); assert.equal(c.effects.captureStarts, 0); assert.equal(c.effects.sessionStops, 0); assert.equal(c.effects.timerClears, 0); assert.equal(c.effects.socketSends, 0); assert.equal(c.effects.socketCloses, 0);
    c.stop('fixture_stop'); f.finish(); groups++;
  }
  assert.deepEqual(pendingUnhandled, [], 'Cancelled/late canonical reads must consume their errors');
  console.log(JSON.stringify({pass: true, groups, scope: 'Synthetic read-only HTTP fixture; actual bridge/receiver/observer/scoped parsers and AST-extracted production VoiceScreen callback; no live voice/provider/mounted UI/native/audio/task execution acceptance'}));
} finally {
  globalThis.fetch = originalFetch;
  process.removeListener('unhandledRejection', unhandled);
}
