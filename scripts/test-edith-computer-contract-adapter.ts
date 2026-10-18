import assert from 'node:assert/strict';
import {parseDesktopActionV2,parseActionVerificationV2,parseActionDispatchV2,parseRealtimeEnvelopeV2_1} from '../src/edith/contracts';
import express from 'express';
import {createServer} from 'node:http';
import {createOwnerSessionRouter} from '../server/security/ownerSession';
import {createComputerUseRouter,resetComputerUseRuntimeForTests} from '../server/routes/computerUse';
import {
  DESKTOP_REALTIME_EVENTS,
  ComputerContractError,
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
} from '../src/edith/computerContractAdapter';
import type {
  ComputerActionResult,
  ComputerDesktopStatus,
  ComputerObservation,
} from '../src/edith/computerDesktopClient';

const now = Date.now();
const sessionId = 'computer-contract-test-session';
const status: ComputerDesktopStatus = {
  runtime: 'tauri', mode: 'owner_command', available: true,
  screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready',
  ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing',
  targeting: 'window_relative_fallback', uia: 'missing', ocr: 'missing',
  multiMonitor: 'virtual_desktop', verification: 'post_observation_required',
  sessionExpiresAt: now + 60_000, safeMessage: 'Approved fixture session.',
};
const wire: ComputerObservation = {
  observationId: 'observation-contract-7', generation: 7,
  imageDataUrl: 'data:image/png;base64,PIXELS_MUST_NOT_ESCAPE',
  originX: -1920, originY: 0, width: 3840, height: 1080,
  cursorX: -1400, cursorY: 400, capturedAt: now - 100, expiresAt: now + 15_000,
  source: 'windows_gdi_virtual_desktop', confidence: 1,
  windowId: 'hwnd-fingerprint-contract', windowProcessId: 42,
  windowBounds: { x: -1600, y: 100, width: 1000, height: 750 },
  monitorId: 'monitor-negative-origin', monitorBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1.25, coordinateSpace: 'physical_virtual_desktop',
  uiaAvailable: false, ocrAvailable: false,
};

const initialSession = toDesktopOperatorSessionV2(status, { sessionId, startedAt: now - 1_000 }, wire, now);
const observation = toDesktopObservationV2(wire, initialSession, now);
const session = { ...initialSession, currentObservationId: observation.observationId, currentGeneration: observation.generation };
const approval = toScopedApprovalV2(session, observation, now);
assert.equal(observation.virtualDesktop.origin.x, -1920);
assert.equal(observation.foreground.logicalBounds.width, 800);
assert.equal(observation.capabilities.uia, false);
assert.equal(approval.scope.physicalBounds?.x, -1600);

const typedSecret = 'TOP_SECRET_VALUE';
const action = await toDesktopActionV2({ action: 'typeText', text: typedSecret }, { session, observation, approval }, {
  actionId: 'action-contract-1', idempotencyKey: 'desktop-idem-contract-1', attempt: 1,
}, now);
assert.equal('text' in action, false);
assert.equal(action.textLength, typedSecret.length);
assert.equal(action.textFingerprint?.length, 64);
assert.equal(JSON.stringify(action).includes(typedSecret), false);

await assert.rejects(
  () => toDesktopActionV2({ action: 'moveMouse', x: -1400, y: 400 }, {
    session,
    observation: { ...observation, generation: 6 },
    approval,
  }, {}, now),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'DESKTOP_ACTION_APPROVAL_MISMATCH',
);

const nativeResult: ComputerActionResult = {
  actionId: action.actionId, planId: 'plan-contract', stepId: action.actionId,
  action: 'typeText', injected: true, dispatchStatus: 'dispatched', cursorX: -1400, cursorY: 400,
  verification: 'input_injected_outcome_unverified', verificationStatus: 'partial',
  preObservationId: observation.observationId, postObservationId: 'observation-contract-8', attempts: 1,
};
const dispatch = toActionDispatchV2(action, nativeResult, now);
const postObservation = toDesktopObservationV2({
  ...wire,
  observationId: 'observation-contract-8',
  generation: 8,
  capturedAt: now + 100,
  expiresAt: now + 15_000,
}, { ...session, currentObservationId: 'observation-contract-8', currentGeneration: 8 }, now);
const verification = toActionVerificationV2(action, dispatch, nativeResult, postObservation, now);
const retryDecision = toRetryDecisionV2(action, verification, now);
assert.equal(dispatch.status, 'dispatched');
assert.equal(verification.status, 'partial');
assert.equal(retryDecision.decision, 'reobserve');
assert.equal(retryDecision.requiresFreshObservation, true);
const failedDispatch = toFailedActionDispatchV2(action, 'NATIVE_DISPATCH_FAILED', now);
const pendingVerification = toPendingActionVerificationV2(action, failedDispatch, 'NATIVE_DISPATCH_FAILED', now);
const failedRetryDecision = toRetryDecisionV2(action, pendingVerification, now);
assert.equal(failedDispatch.status, 'failed');
assert.equal(pendingVerification.status, 'pending_post_observation');
assert.equal(failedRetryDecision.decision, 'reobserve');

let executions = 0;
const ledger = new DesktopActionIdempotencyLedger<string>();
const first = ledger.run(action, async () => { executions += 1; return 'dispatch-record-1'; });
const duplicate = ledger.run(action, async () => { executions += 1; return 'must-not-run'; });
assert.equal(first.replayed, false);
assert.equal(duplicate.replayed, true);
assert.equal(await first.result, 'dispatch-record-1');
assert.equal(await duplicate.result, 'dispatch-record-1');
assert.equal(executions, 1);
assert.throws(
  () => ledger.run({ ...action, actionId: 'action-contract-conflict' }, async () => 'conflict'),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'IDEMPOTENCY_KEY_CONFLICT',
);
assert.throws(
  () => ledger.run({ ...action, textLength: (action.textLength ?? 0) + 1 }, async () => 'parameter-conflict'),
  (error: unknown) => error instanceof ComputerContractError && error.errorCode === 'IDEMPOTENCY_KEY_CONFLICT',
);

const stream = new DesktopRealtimeEventStream('desktop-stream-contract', action.actionId);
const events = [
  stream.emit(DESKTOP_REALTIME_EVENTS.observation, observation),
  stream.emit(DESKTOP_REALTIME_EVENTS.actionRequested, action),
  stream.emit(DESKTOP_REALTIME_EVENTS.dispatch, dispatch),
  stream.emit(DESKTOP_REALTIME_EVENTS.verification, verification),
  stream.emit(DESKTOP_REALTIME_EVENTS.retryDecision, retryDecision),
];
assert.deepEqual(events.map((event) => event.cursor), [1, 2, 3, 4, 5]);
assert.deepEqual(events.map((event) => event.event), [
  'desktop.observation.v2',
  'desktop.action.requested.v2',
  'desktop.action.dispatch.v2',
  'desktop.action.verification.v2',
  'desktop.retry.decision.v2',
]);
const serializedEvents = JSON.stringify(events);
assert.equal(serializedEvents.includes('imageDataUrl'), false);
assert.equal(serializedEvents.includes('PIXELS_MUST_NOT_ESCAPE'), false);
assert.equal(serializedEvents.includes(typedSecret), false);

const atomic=await toDesktopActionV2({action:'dragMouse',dragStart:{x:-1400,y:400},dragEnd:{x:-1300,y:450},dragDurationMs:300},{session,observation,approval},{},now);
const atomicContext={now:new Date(now).toISOString(),observation,approval};
assert.equal(atomic.retryBudget.maxAttempts,1);
assert.equal(parseDesktopActionV2(atomic,atomicContext).success,true);
for(const patch of [{dragEnd:{x:2000,y:400}},{dragDurationMs:99},{dragDurationMs:1501},{coordinates:{x:-1400,y:400}},{key:'A'},{unknown:'bad'},{retryBudget:{maxAttempts:2,attempt:1,backoffMs:0}},{dragStart:{x:-1400,y:400,unknown:1}},{observationGeneration:6},{deadlineAt:new Date(now-1).toISOString()}])assert.equal(parseDesktopActionV2({...atomic,...patch},atomicContext).success,false);
assert.equal(parseDesktopActionV2(atomic,{...atomicContext,approval:{...approval,scope:{...approval.scope,actions:['clickMouse']}}}).success,false);
assert.equal(parseDesktopActionV2(atomic,{...atomicContext,approval:{...approval,scope:{...approval.scope,physicalBounds:{x:-1410,y:390,width:30,height:30,coordinateSpace:'physical_virtual_desktop'}}}}).success,false);
const doubleClick=await toDesktopActionV2({action:'doubleClickMouse',x:-1400,y:400},{session,observation,approval},{},now);
assert.equal(parseDesktopActionV2(doubleClick,atomicContext).success,true);
assert.equal(parseDesktopActionV2({...doubleClick,button:'middle'},atomicContext).success,false);
assert.equal(parseDesktopActionV2({...doubleClick,dragEnd:{x:-1300,y:450}},atomicContext).success,false);
assert.equal(parseDesktopActionV2({...action,expectedEffect:'visual_change',retryBudget:{maxAttempts:2,attempt:1,backoffMs:250}},atomicContext).success,true,'Old typed visual_change shape remains valid');
const atomicLedger=new DesktopActionIdempotencyLedger<number>();let atomicRuns=0;
assert.equal(await atomicLedger.run(atomic,async()=>++atomicRuns).result,1);
assert.equal(await atomicLedger.run(atomic,async()=>++atomicRuns).result,1);
assert.throws(()=>atomicLedger.run({...atomic,dragEnd:{x:-1290,y:450}},async()=>2),/another action/);
assert.throws(()=>atomicLedger.run({...atomic,dragDurationMs:301},async()=>2),/another action/);
const interrupted=toActionDispatchV2(atomic,{...nativeResult,actionId:atomic.actionId,action:'dragMouse',dispatchStatus:'failed',partialInputInjected:true,releaseConfirmed:true,errorCode:'NATIVE_DISPATCH_INTERRUPTED'},now);
assert.equal(interrupted.status,'failed');assert.equal(interrupted.partialInputInjected,true);
assert.equal(parseActionDispatchV2({...interrupted,status:'dispatched'}).success,false);
assert.equal(parseActionDispatchV2({...interrupted,partialInputInjected:false,releaseConfirmed:false,status:'dispatched'}).success,false);
const readback={source:'uia' as const,windowId:wire.windowId,windowProcessId:wire.windowProcessId,preTextFingerprint:'a'.repeat(64),postTextFingerprint:'b'.repeat(64),expectedTextFingerprint:action.textFingerprint!,matched:true};
const textVerified=toActionVerificationV2(action,dispatch,{...nativeResult,verificationStatus:'verified',textReadback:readback},postObservation,now+200,observation);
const textContext={action,preObservation:observation,postObservation};
assert.equal(parseActionVerificationV2(textVerified,textContext).success,true);
assert.equal(parseActionVerificationV2(textVerified).success,false);
for(const changed of [{...textVerified,evidence:[{kind:'visual_change',matched:true}]},{...textVerified,evidence:[{kind:'input_injected',matched:true}]},{...textVerified,evidence:[{...textVerified.evidence.at(-1),matched:false}]},{...textVerified,evidence:[{...textVerified.evidence.at(-1),expectedTextFingerprint:'c'.repeat(64)}]},{...textVerified,postObservationGeneration:7}])assert.equal(parseActionVerificationV2(changed,textContext).success,false);
assert.equal(parseActionVerificationV2(textVerified,{...textContext,postObservation:{...postObservation,foreground:{...postObservation.foreground,processId:999}}}).success,false);
assert.equal(parseActionVerificationV2(textVerified,{...textContext,postObservation:{...postObservation,foreground:{...postObservation.foreground,hwndFingerprint:'other-window'}}}).success,false);
assert.equal(parseActionVerificationV2({...textVerified,expectedEffect:'visual_change'},textContext).success,false);
const focusTarget={windowId:'hwnd:focus-contract',processId:77,imagePathFingerprint:'d'.repeat(64),observationId:observation.observationId,observationGeneration:observation.generation};
const focusApproval={...approval,scope:{...approval.scope,actions:['focusApp' as const],targetIds:[focusTarget.windowId]}};
const focusedAction=await toDesktopActionV2({action:'focusApp',applicationId:'spotify',focusTarget},{session,observation,approval:focusApproval},{},now);
const focusOptions={now:new Date(now).toISOString(),observation,approval:focusApproval};
assert.equal(parseDesktopActionV2(focusedAction,focusOptions).success,true);
for(const patch of [{applicationId:'other'},{expectedEffect:'foreground_window_changed'},{expectedEffect:'process_started'},{coordinates:{x:1,y:1}},{focusTarget:{...focusTarget,processId:0}},{focusTarget:{...focusTarget,imagePathFingerprint:'path'}},{focusTarget:{...focusTarget,imagePath:'/private/path'}},{focusTarget:{...focusTarget,observationGeneration:6}},{retryBudget:{maxAttempts:2,attempt:1,backoffMs:0}},{sessionId:'wrong-session'},{deadlineAt:new Date(now-1).toISOString()}])assert.equal(parseDesktopActionV2({...focusedAction,...patch},focusOptions).success,false);
for(const scope of [{...focusApproval.scope,actions:['clickMouse' as const]},{...focusApproval.scope,targetIds:undefined},{...focusApproval.scope,targetIds:['another-window']}])assert.equal(parseDesktopActionV2(focusedAction,{...focusOptions,approval:{...focusApproval,scope}}).success,false);
for(const patch of [{status:'revoked' as const},{approvalId:'other-approval'},{expiresAt:new Date(now-1).toISOString()},{consumedActionIds:Array.from({length:100},(_,i)=>`consumed-focus-${i}`)}])assert.equal(parseDesktopActionV2(focusedAction,{...focusOptions,approval:{...focusApproval,...patch}}).success,false);
const focusedPost={...postObservation,observationId:'focus-post-contract',foreground:{...postObservation.foreground,hwndFingerprint:focusTarget.windowId,processId:focusTarget.processId}};
const focusedResult={...nativeResult,action:'focusApp',actionId:focusedAction.actionId,verification:'input_injected_outcome_unverified' as const,verificationStatus:'verified' as const,focusReadback:{source:'native_operator' as const,applicationId:'spotify' as const,windowId:focusTarget.windowId,windowProcessId:focusTarget.processId,imagePathFingerprint:focusTarget.imagePathFingerprint,matched:true}};
const focusedDispatch=toActionDispatchV2(focusedAction,focusedResult,now);
const focusedVerification=toActionVerificationV2(focusedAction,focusedDispatch,focusedResult,focusedPost,now+200,observation);
const focusContext={action:focusedAction,preObservation:observation,postObservation:focusedPost,dispatch:focusedDispatch};
assert.equal(parseActionVerificationV2(focusedVerification,focusContext).success,true);
assert.equal(parseActionVerificationV2(focusedVerification).success,false);
assert.equal(parseActionVerificationV2(focusedVerification,{...focusContext,preObservation:{...observation,foreground:{...observation.foreground,hwndFingerprint:focusTarget.windowId,processId:focusTarget.processId}}}).success,true,'Already focused no-op still needs a fresh matching post observation');
for(const patch of [{postObservation:{...focusedPost,sessionId:'other-session'}},{postObservation:{...focusedPost,foreground:{...focusedPost.foreground,processId:88}}},{postObservation:{...focusedPost,foreground:{...focusedPost.foreground,hwndFingerprint:'other-window'}}},{action:{...focusedAction,applicationId:'steam'}},{action:{...focusedAction,focusTarget:{...focusTarget,imagePathFingerprint:'e'.repeat(64)}}}])assert.equal(parseActionVerificationV2(focusedVerification,{...focusContext,...patch}).success,false);
for(const evidence of [[{kind:'process_started',matched:true}],[{kind:'visual_change',matched:true}],[{...focusedVerification.evidence.at(-1),imagePathFingerprint:'e'.repeat(64)}],[{...focusedVerification.evidence.at(-1),matched:false}]])assert.equal(parseActionVerificationV2({...focusedVerification,evidence},focusContext).success,false);
const focusLedger=new DesktopActionIdempotencyLedger<number>();let focusRuns=0;
assert.equal(await focusLedger.run(focusedAction,async()=>++focusRuns).result,1);assert.equal(await focusLedger.run(focusedAction,async()=>++focusRuns).result,1);
for(const focusTargetPatch of [{windowId:'changed-window'},{processId:88},{imagePathFingerprint:'e'.repeat(64)},{observationGeneration:6}])assert.throws(()=>focusLedger.run({...focusedAction,focusTarget:{...focusTarget,...focusTargetPatch}},async()=>2),/another action/);
assert.throws(()=>focusLedger.run({...focusedAction,deadlineAt:new Date(now+4000).toISOString()},async()=>2),/another action/);
const focusStream=new DesktopRealtimeEventStream('focus-context-stream',focusedAction.actionId);
const focusEvents=[focusStream.emit(DESKTOP_REALTIME_EVENTS.observation,observation),focusStream.emit(DESKTOP_REALTIME_EVENTS.actionRequested,focusedAction),focusStream.emit(DESKTOP_REALTIME_EVENTS.dispatch,focusedDispatch),focusStream.emit(DESKTOP_REALTIME_EVENTS.observation,focusedPost),focusStream.emit(DESKTOP_REALTIME_EVENTS.verification,focusedVerification)];
assert.equal(parseRealtimeEnvelopeV2_1(focusEvents[4],{desktopVerificationContext:focusContext}).success,true);
assert.equal(parseActionVerificationV2(focusedVerification,{...focusContext,dispatch:undefined}).success,false);
assert.equal(parseActionVerificationV2(focusedVerification,{...focusContext,dispatch:{...focusedDispatch,status:'failed'}}).success,false);
const textStream=new DesktopRealtimeEventStream('text-context-stream',action.actionId);
const textEvents=[textStream.emit(DESKTOP_REALTIME_EVENTS.observation,observation),textStream.emit(DESKTOP_REALTIME_EVENTS.actionRequested,action),textStream.emit(DESKTOP_REALTIME_EVENTS.observation,postObservation),textStream.emit(DESKTOP_REALTIME_EVENTS.verification,textVerified)];
assert.equal(parseRealtimeEnvelopeV2_1(textEvents[3]).success,false);
assert.equal(parseRealtimeEnvelopeV2_1(textEvents[3],{desktopVerificationContext:textContext}).success,true);
assert.equal(parseRealtimeEnvelopeV2_1(textEvents[3],{desktopVerificationContext:{...textContext,postObservation:{...postObservation,sessionId:'wrong-session'}}}).success,false);
assert.equal(parseRealtimeEnvelopeV2_1({...textEvents[3],payload:{...textVerified,verifiedAt:new Date(now+60_000).toISOString()}},{desktopVerificationContext:textContext}).success,false);
for(const event of events)assert.equal(parseRealtimeEnvelopeV2_1(event).success,true,'Old desktop lifecycle envelope remains valid');
const missingStream=new DesktopRealtimeEventStream('missing-context-stream',action.actionId);
assert.throws(()=>missingStream.emit(DESKTOP_REALTIME_EVENTS.verification,textVerified),(error:unknown)=>error instanceof ComputerContractError&&error.errorCode==='ACTION_TEXT_CONTEXT_REQUIRED');
assert.equal(missingStream.emit(DESKTOP_REALTIME_EVENTS.observation,observation).cursor,1,'Failed context must not consume a cursor');
// Exercise the mounted production route: context comes only from its accepted
// owner-bound journal. A caller-supplied context cannot substitute for it.
resetComputerUseRuntimeForTests();
const app=express();app.use(express.json());app.use(createOwnerSessionRouter());app.use(createComputerUseRouter());
const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const base=`http://127.0.0.1:${address.port}`;
const savedToken=process.env.EDITH_OWNER_TOKEN,savedOneTime=process.env.EDITH_OWNER_TOKEN_ONE_TIME;
process.env.EDITH_OWNER_TOKEN='text-context-fixture-owner-token';process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
try{
  const owner=async()=>{const res=await fetch(`${base}/api/security/session`,{method:'POST',headers:{authorization:'Bearer text-context-fixture-owner-token',origin:base},signal:AbortSignal.timeout(5000)});assert.equal(res.status,201);const body=await res.json() as {session:{csrfToken:string}};return {'content-type':'application/json',cookie:res.headers.get('set-cookie')!.split(';',1)[0],origin:base,'sec-fetch-site':'same-origin','x-edith-csrf-token':body.session.csrfToken,'x-edith-desktop-runtime':'tauri-v1'};};
  const firstOwner=await owner();
  const post=async(event:unknown,headers=firstOwner)=>fetch(`${base}/api/computer-use/realtime-events`,{method:'POST',headers,body:JSON.stringify(event),signal:AbortSignal.timeout(5000)});
  assert.equal((await post({...textEvents[3],desktopVerificationContext:textContext})).status,400,'Caller context cannot create authoritative records');
  for(const event of textEvents.slice(0,3))assert.equal((await post(event)).status,202);
  assert.equal((await post({...textEvents[3],payload:{...textVerified,evidence:[{...textVerified.evidence.at(-1),windowProcessId:999}]}})).status,400,'Forged PID rejected');
  assert.equal((await post({...textEvents[3],payload:{...textVerified,verifiedAt:new Date(now+60_000).toISOString()}})).status,400,'Expired context rejected');
  assert.equal((await post(textEvents[3])).status,202,'Owner-bound independent context accepted');
  assert.equal((await post({...focusEvents[4],desktopVerificationContext:focusContext})).status,400);
  for(const event of focusEvents.slice(0,4))assert.equal((await post(event)).status,202);
  assert.equal((await post({...focusEvents[4],payload:{...focusedVerification,evidence:[{...focusedVerification.evidence.at(-1),applicationId:'steam'}]}})).status,400);
  assert.equal((await post(focusEvents[4])).status,202,'Focus authoritative context accepted');
  const wrongSession={...postObservation,observationId:'wrong-session-post',sessionId:'other-desktop-session'};
  const nextStream=new DesktopRealtimeEventStream('wrong-session-route',action.actionId);
  const nextEvent=nextStream.emit(DESKTOP_REALTIME_EVENTS.observation,wrongSession);
  assert.equal((await post(nextEvent)).status,202);
  assert.equal((await post({...textEvents[3],streamId:'wrong-session-route',cursor:2,sequence:2,eventId:'wrong-session-verification',payload:{...textVerified,postObservationId:wrongSession.observationId,evidence:[{...textVerified.evidence.at(-1),observationId:wrongSession.observationId}]}})).status,400);
  const secondOwner=await owner();
  assert.equal((await post({...focusEvents[4],streamId:'another-focus-owner-stream',cursor:1,sequence:1},secondOwner)).status,400,'Rotated owner cannot reuse focus context');
  assert.equal((await post({...textEvents[3],streamId:'another-owner-stream',cursor:1,sequence:1},secondOwner)).status,400,'Rotated owner cannot reuse the old authoritative context');
  assert.equal((await post(textEvents[3],firstOwner)).status,401,'Old owner session is invalidated');
}finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  if(savedToken===undefined)delete process.env.EDITH_OWNER_TOKEN;else process.env.EDITH_OWNER_TOKEN=savedToken;
  if(savedOneTime===undefined)delete process.env.EDITH_OWNER_TOKEN_ONE_TIME;else process.env.EDITH_OWNER_TOKEN_ONE_TIME=savedOneTime;
  resetComputerUseRuntimeForTests();
}
console.log(JSON.stringify({
  success: true,
  checks: [
    'wire_to_v21_session_observation_approval',
    'timestamp_and_dpi_boundary_conversion',
    'raw_typed_text_redacted_to_sha256_fingerprint',
    'canonical_generation_and_approval_fail_closed',
    'dispatch_is_not_effect_verification',
    'partial_verification_requires_reobserve',
    'failed_dispatch_completes_fail_closed_lifecycle',
    'idempotency_duplicate_executes_once',
    'idempotency_conflict_rejected',
    'idempotency_parameter_rebind_rejected',
    'ordered_desktop_realtime_lifecycle',
    'screenshot_pixels_and_typed_secret_absent_from_events',
    'atomic_strict_parameters_bounds_generation_approval_deadline',
    'atomic_single_attempt_and_idempotency_all_fields',
    'partial_dispatch_and_unconfirmed_release_not_completed',
    'text_readback_same_window_pid_hash_and_context_required',
    'input_and_visual_change_cannot_verify_text_insertion',
    'realtime_context_forwarded_only_for_verification',
    'production_route_authoritative_owner_session_context',
    'missing_forged_expired_wrong_owner_session_context_rejected',
    'focus_exact_target_scope_generation_deadline_and_single_attempt',
    'focus_same_window_noop_requires_fresh_independent_identity',
    'focus_context_idempotency_and_foreground_evidence_not_launch',
  ],
}, null, 2));
