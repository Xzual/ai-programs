import assert from 'node:assert/strict';
import path from 'node:path';
import type {WebSocket as ServerWebSocket} from 'ws';
import {VoiceSkillDispatch} from '../src/edith/voiceSkillDispatch';
import {TaskContinuationAdapter} from '../src/edith/taskContinuationAdapter';
import {DurableStateStore} from '../server/advanced/durableStateStore';
import {Phase4IdempotencyStore} from '../server/routes/phase4IdempotencyStore';
import {taskService} from '../src/edith/taskService';
import {executorService} from '../src/edith/executor';
import {killSwitchService} from '../src/edith/killSwitch';
import type {TrustedVoiceDispatchHooksV1,PersistedTaskAdmissionV1} from '../src/edith/taskHudContracts';

const root=process.env.EDITH_TEST_DATA_DIR!;assert.ok(root&&process.env.EDITH_TEST_MODE==='true');
let active=true,workspace='voice-hud-fixture',executionCalls=0;
const owner=(id:string)=>active&&id==='owner-fixture';
const continuation=new TaskContinuationAdapter(new DurableStateStore(path.join(root,'continuation-fixture.db')),owner,()=>workspace);
const dispatch=new VoiceSkillDispatch(new Phase4IdempotencyStore(path.join(root,'idem-fixture.db')),async()=>({skillId:'system_status',objective:'Read system health status and verify report.',toolIds:['system_monitor']}),owner,continuation);
const transcript={ownerSessionBindingId:'owner-fixture',voiceSessionId:'voice-fixture:1',utteranceId:'utterance-1',text:'sistem durumunu göster',isFinal:true};
const events:PersistedTaskAdmissionV1[]=[];
const hooks:TrustedVoiceDispatchHooksV1={taskAdmission:{assertCurrent:()=>{assert.ok(active,'owner active');return {ownerSessionBindingId:'owner-fixture',workspaceId:workspace,voiceSessionId:'voice-fixture:1',utteranceId:'utterance-1',commandSequence:1};}},onTaskAdmitted:value=>{continuation.assertHudRead(value.taskId,'owner-fixture','voice-hud-fixture');events.push(value);}};
let release!:()=>void;let entered=false;const oldExecute=executorService.executeTask;
executorService.executeTask=async(taskId:string)=>{executionCalls++;entered=true;await new Promise<void>(resolve=>release=resolve);return {success:false,taskId,status:'NOOP',iterations:0,toolCalls:0,reports:[],task:taskService.getTask(taskId)};};
try{
 const pending=(dispatch.dispatch as (t:typeof transcript,h?:TrustedVoiceDispatchHooksV1)=>Promise<Record<string,unknown>>)(transcript,hooks);
 for(let i=0;i<200&&!entered;i++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(entered,true,'executor reached while held');
 assert.equal(events.length,1,'REAL_HUD_ADMISSION_MUST_PRECEDE_HELD_EXECUTOR_COMPLETION');
 assert.equal(taskService.getTask(events[0].taskId)?.id,events[0].taskId);
 release();const first=await pending;
 const repeated=await (dispatch.dispatch as (t:typeof transcript,h?:TrustedVoiceDispatchHooksV1)=>Promise<Record<string,unknown>>)(transcript,hooks);
 assert.equal(repeated.taskId,first.taskId);assert.equal(executionCalls,1);assert.equal(events.length,1);
 console.log(JSON.stringify({pass:true,earlyPersistedAdmission:true,duplicateNoSecondTask:true,executorCalls:executionCalls}));
}finally{release?.();executorService.executeTask=oldExecute;killSwitchService.deactivate('fixture-cleanup');}

// Regression: HUD presentation must never enter the execution dispatcher or close voice.
const {ManagedVoiceSession}=await import('../server/voice/voiceSessionManager');
const {WebSocket}=await import('ws');
const {isHudPresentationV1}=await import('../src/edith/taskHudContracts');
import type {GeminiLiveCallbacks} from '../server/voice/types';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const frames:any[]=[];const callbackHistory:GeminiLiveCallbacks[]=[];let presentationDispatches=0,providerCloses=0,providerConnects=0;
const fakeSocket={readyState:WebSocket.OPEN,send(raw:string){frames.push(JSON.parse(raw));}} as ServerWebSocket;
const fakeProvider={async connect(cb:GeminiLiveCallbacks){providerConnects++;callbackHistory.push(cb);cb.onReady('sdk-fixture');return {sendAudio(){},endAudioStream(){},close(){providerCloses++;}};}};
const managed=new ManagedVoiceSession(fakeSocket,()=>fakeProvider,()=>'',()=>true,{ownerSessionBindingId:'owner-fixture',dispatch:async()=>{presentationDispatches++;return {outcome:'configuration_required'};}});
try{
 await managed.start();const generation=frames.find(frame=>frame.type==='session:ready').generation;
 callbackHistory[0].onUserTranscript('Paneli kapat',false,'hide-1');await tick();
 assert.equal(presentationDispatches,0,'PRESENTATION_MUST_BYPASS_EXECUTION_DISPATCH');
 const hidden=frames.find(frame=>frame.type==='hud:presentation');assert.equal(isHudPresentationV1(hidden),true);assert.equal(hidden.action,'hide');assert.equal(hidden.commandSequence,1);assert.equal(hidden.generation,generation);
 assert.equal(providerCloses,0);assert.equal(providerConnects,1);assert.equal(managed.isLiveReady(),true);
 callbackHistory[0].onUserTranscript('Paneli kapat',false,'hide-1');await tick();assert.equal(frames.filter(frame=>frame.type==='hud:presentation').length,1);
 callbackHistory[0].onUserTranscript('Jarvis ne yapıyorsun?',true,'show-1');await tick();assert.equal(frames.filter(frame=>frame.type==='hud:presentation').length,1);
 callbackHistory[0].onUserTranscript('Jarvis ne yapıyorsun?',false,'show-1');await tick();assert.equal(frames.filter(frame=>frame.type==='hud:presentation').at(-1).action,'show_current');assert.equal(presentationDispatches,0);
 const canonicalBefore=frames.filter(frame=>frame.type==='skill:task_admitted'||frame.type==='hud:presentation'||frame.type==='skill:result').length;
 callbackHistory[0].onAssistantTranscript('model invented task completed',false);callbackHistory[0].onAudio('AAA=','audio/pcm;rate=24000');
 assert.equal(frames.filter(frame=>frame.type==='skill:task_admitted'||frame.type==='hud:presentation'||frame.type==='skill:result').length,canonicalBefore,'Provider narrative never becomes canonical task data');
 managed.interrupt();await tick();const newer=callbackHistory.at(-1)!;
 newer.onUserTranscript('Paneli kapat',false,'hide-1');await tick();assert.equal(frames.filter(frame=>frame.type==='hud:presentation').length,2,'Reconnect cannot replay old final as a new command');
 assert.equal(presentationDispatches,0);
 console.log(JSON.stringify({pass:true,presentationBypassesDispatch:true,duplicateAndPartialNoEffect:true,reconnectOldFinalDropped:true,providerNarrativeCannotCreateCanonicalTaskData:true}));
}finally{managed.stop('fixture_cleanup');}

// The client must accept only the two closed wire schemas, then fence delivery by session/order.
const {parseVoiceLiveServerEvent}=await import('../src/edith/voiceLiveClient');
const admitted={schemaVersion:1,type:'skill:task_admitted',generation:1,voiceSessionId:'voice-client:1',utteranceId:'client-1',commandSequence:1,taskId:'task-fixture',skillId:'system_status',revision:1,eventSequence:1,admittedAt:'2026-10-17T00:00:00.000Z'};
assert.deepEqual(parseVoiceLiveServerEvent(JSON.stringify(admitted)),admitted,'CLIENT_MUST_PARSE_REAL_ADMISSION');
const {VoiceHudEventReceiver}=await import('../src/edith/voiceLiveClient');
const deliveries:unknown[]=[];
const receiver=new VoiceHudEventReceiver({onTaskAdmitted:event=>deliveries.push(event),onPresentation:event=>deliveries.push(event)});
const hide={schemaVersion:1,type:'hud:presentation',generation:1,voiceSessionId:'voice-client:1',utteranceId:'client-2',commandSequence:2,action:'hide'};
assert.equal(receiver.receive(admitted),false);assert.equal(receiver.bindSession('voice-client:1',1),true);
assert.equal(receiver.receive(admitted),true);assert.equal(receiver.receive(admitted),false);
assert.equal(receiver.bindSession('voice-client:1',1),true);assert.equal(receiver.receive(admitted),false,'Repeated ready cannot clear ordering fence');
assert.equal(receiver.receive(JSON.stringify(hide)),true);assert.equal(receiver.receive({...admitted,commandSequence:1}),false);
for(const malformed of [{...admitted,extra:'injected'},{...hide,taskId:'task-fixture'},{...admitted,revision:0},{...admitted,commandSequence:2.5},{...admitted,taskId:'../private'},{...admitted,admittedAt:'2026-10-17'},{...hide,generation:0}]){
 assert.equal(parseVoiceLiveServerEvent(JSON.stringify(malformed)),undefined);assert.equal(receiver.receive(malformed),false);
}
assert.equal(receiver.receive({...admitted,commandSequence:3,generation:2}),false);assert.equal(receiver.receive({...admitted,commandSequence:3,voiceSessionId:'wrong'}),false);
assert.equal(receiver.receive({...admitted,commandSequence:2}),false,'Conflicting same sequence is rejected');
receiver.clear();assert.equal(receiver.receive({...admitted,commandSequence:3}),false);assert.equal(deliveries.length,2);
console.log(JSON.stringify({pass:true,closedClientSchemas:true,typedSessionOrderFence:true,hideBlocksLateAdmission:true}));

const {classifyHudCommand}=await import('../server/voice/hudCommands');
for(const text of ['Jarvis ne yapıyorsun','Jarvis ne yapiyorsun','ne yapıyorsun','ne yapiyorsun','  Ｊａｒｖｉｓ ne yapıyorsun?!  '])assert.equal(classifyHudCommand(text),'show_current');
for(const text of ['Paneli kapat','Jarvis paneli kapat.'])assert.equal(classifyHudCommand(text),'hide');
for(const text of ['sonra Paneli kapat','Paneli kapat ve analiz yap','ne yapıyorsun bana söyle','Jarvis, ne yapıyorsun',null])assert.equal(classifyHudCommand(text),undefined);

// Dispatch boundary negatives use real persistence and planning; only execution is mocked.
const intent={skillId:'system_status',objective:'Read system health status and verify report.',toolIds:['system_monitor']};
let calls=0;
executorService.executeTask=async(taskId:string)=>{calls++;return {success:false,taskId,status:'NOOP',iterations:0,toolCalls:0,reports:[],task:taskService.getTask(taskId)};};
const makeTranscript=(id:string)=>({...transcript,utteranceId:id});
const makeHooks=(id:string,notify:(value:Readonly<PersistedTaskAdmissionV1>)=>void=()=>{}):TrustedVoiceDispatchHooksV1=>({taskAdmission:{assertCurrent:()=>({ownerSessionBindingId:'owner-fixture',workspaceId:workspace,voiceSessionId:'voice-fixture:1',utteranceId:id,commandSequence:3})},onTaskAdmitted:notify});
try{
 let notifications=0;const throws=makeHooks('throw-notify',value=>{notifications++;continuation.assertHudRead(value.taskId,'owner-fixture',workspace);throw Error('synthetic notification failure');});
 const first=await dispatch.dispatch(makeTranscript('throw-notify'),throws);const second=await dispatch.dispatch(makeTranscript('throw-notify'),throws);
 assert.equal(first.taskId,second.taskId);assert.equal(calls,1);assert.equal(notifications,1);
 const legacy=await dispatch.dispatch(makeTranscript('legacy-no-hud'),{onTaskAdmitted:()=>notifications++});assert.equal(notifications,1);
 assert.throws(()=>continuation.assertHudRead(String(legacy.taskId),'owner-fixture',workspace));

 // Only the binding seam fails. The actual persisted task is reported honestly and never planned.
 const broken=new TaskContinuationAdapter(new DurableStateStore(path.join(root,'binding-failed.db')),owner,()=>workspace);
 broken.admitHudTask=()=>{throw Error('synthetic binding unavailable');};
 const failing=new VoiceSkillDispatch(new Phase4IdempotencyStore(path.join(root,'binding-idem.db')),async()=>intent,owner,broken);
 const before=taskService.listTasks().length,executed=calls;
 const failed=await failing.dispatch(makeTranscript('binding-fail'),makeHooks('binding-fail',()=>notifications++));
 assert.equal(failed.reasonCode,'TASK_HUD_BINDING_FAILED');assert.equal(failed.taskCreated,true);assert.equal(taskService.getTask(String(failed.taskId))?.plan,undefined);
 assert.equal(taskService.listTasks().length,before+1);assert.equal(calls,executed);assert.equal(notifications,1);
 assert.equal((await failing.dispatch(makeTranscript('binding-fail'),makeHooks('binding-fail'))).taskId,failed.taskId);assert.equal(taskService.listTasks().length,before+1);

 for(const kind of ['owner','workspace','kill'] as const){
  let resolveIntent!:(value:typeof intent)=>void;
  const held=new VoiceSkillDispatch(new Phase4IdempotencyStore(path.join(root,`race-${kind}.db`)),()=>new Promise(resolve=>resolveIntent=resolve),owner,continuation);
  const baseline=taskService.listTasks().length;
  const pending=held.dispatch(makeTranscript(`race-${kind}`),makeHooks(`race-${kind}`));
  if(kind==='owner')active=false;else if(kind==='workspace')workspace='workspace-changed';else killSwitchService.activate('synthetic await race','fixture');
  resolveIntent(intent);await assert.rejects(pending);assert.equal(taskService.listTasks().length,baseline);assert.equal(calls,executed);
  active=true;workspace='voice-hud-fixture';killSwitchService.deactivate('fixture-cleanup');
 }
 const baseline=taskService.listTasks().length;
 await assert.rejects(dispatch.dispatch(makeTranscript('wrong-context'),makeHooks('different-id')),/TASK_HUD_STALE_SCOPE/);assert.equal(taskService.listTasks().length,baseline);
 console.log(JSON.stringify({pass:true,notificationFailureStillOnce:true,bindingFailureNoPlanOrExecution:true,legacyNoHintOrHudEnrollment:true,ownerWorkspaceKillAwaitRaces:true,contextMismatchRejected:true}));
}finally{executorService.executeTask=oldExecute;active=true;workspace='voice-hud-fixture';killSwitchService.deactivate('fixture-cleanup');}

// A newer hide fences the old hint/result without revoking the old task's genuine scope.
const raceFrames:any[]=[];let raceCallbacks!:GeminiLiveCallbacks,finish!:()=>void,capturedHooks:TrustedVoiceDispatchHooksV1|undefined,raceAuthority=true;
const raceSocket={readyState:WebSocket.OPEN,send(raw:string){raceFrames.push(JSON.parse(raw));}} as ServerWebSocket;
const raceSession=new ManagedVoiceSession(raceSocket,()=>({async connect(cb){raceCallbacks=cb;cb.onReady('sdk-race');return {sendAudio(){},endAudioStream(){},close(){}};}}),()=>'',()=>raceAuthority,{ownerSessionBindingId:'owner-fixture',workspaceId:()=>workspace,dispatch:async(_t,h)=>{capturedHooks=h;await new Promise<void>(resolve=>finish=resolve);return {outcome:'attention_required',taskId:'task-fixture'};}});
try{
 await raceSession.start();raceCallbacks.onUserTranscript('sistem durumunu göster',false,'race-command');await tick();assert.ok(capturedHooks?.taskAdmission);
 const scope=capturedHooks.taskAdmission.assertCurrent();assert.equal(scope.commandSequence,1);
 raceCallbacks.onUserTranscript('Paneli kapat',false,'race-hide');
 assert.deepEqual(capturedHooks.taskAdmission.assertCurrent(),scope,'Hide does not cancel or mutate captured task scope');
 capturedHooks.onTaskAdmitted?.({taskId:'task-fixture',skillId:'system_status',revision:1,eventSequence:1,admittedAt:'2026-10-17T00:00:00.000Z'});
 finish();await tick();assert.equal(raceFrames.filter(e=>e.type==='skill:task_admitted'||e.type==='skill:result').length,0);assert.equal(raceFrames.find(e=>e.type==='hud:presentation').commandSequence,2);
 raceAuthority=false;assert.throws(()=>capturedHooks!.taskAdmission!.assertCurrent(),/OWNER_SESSION_REQUIRED/);
 console.log(JSON.stringify({pass:true,acceptedFinalSequenceBeforeAwait:true,newerHideDropsOldHintAndCompletion:true,hideDoesNotCancelTaskScope:true,revokedAuthorityRejected:true}));
}finally{finish?.();raceSession.stop('fixture_cleanup');}

// End-to-end composition below is all in-process: real manager -> real dispatcher -> real binding.
const integratedFrames:any[]=[];let integratedCallbacks!:GeminiLiveCallbacks,integratedRelease!:()=>void,integratedEntered=false;
const integratedSocket={readyState:WebSocket.OPEN,send(raw:string){integratedFrames.push(JSON.parse(raw));}} as ServerWebSocket;
const integrated=new ManagedVoiceSession(integratedSocket,()=>({async connect(cb){integratedCallbacks=cb;cb.onReady('sdk-integrated');return {sendAudio(){},endAudioStream(){},close(){}};}}),()=>'',()=>true,{ownerSessionBindingId:'owner-fixture',workspaceId:()=>workspace,dispatch:(t,h)=>dispatch.dispatch(t,h)});
executorService.executeTask=async(taskId:string)=>{integratedEntered=true;await new Promise<void>(resolve=>integratedRelease=resolve);return {success:false,taskId,status:'NOOP',iterations:0,toolCalls:0,reports:[],task:taskService.getTask(taskId)};};
try{
 await integrated.start();integratedCallbacks.onUserTranscript('sistem durumunu göster',false,'integrated-1');
 for(let i=0;i<200&&!integratedEntered;i++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(integratedEntered,true);const event=integratedFrames.find(e=>e.type==='skill:task_admitted');
 const {isVoiceTaskAdmittedV1}=await import('../src/edith/taskHudContracts');assert.equal(isVoiceTaskAdmittedV1(event),true);
 continuation.assertHudRead(event.taskId,'owner-fixture',workspace);assert.equal(integratedFrames.some(e=>e.type==='skill:result'),false);
 integrated.stop('fixture_stop_before_completion');integratedRelease();await tick();assert.equal(integratedFrames.some(e=>e.type==='skill:result'),false);
 console.log(JSON.stringify({pass:true,actualManagerDispatcherBindingComposition:true,realEarlyWireAdmission:true,stopDropsLateCompletion:true}));
}finally{integratedRelease?.();integrated.stop('fixture_cleanup');executorService.executeTask=oldExecute;}

let noWorkspaceCallbacks!:GeminiLiveCallbacks,noWorkspaceHooks:TrustedVoiceDispatchHooksV1|undefined;
const noWorkspaceFrames:any[]=[];
const noWorkspace=new ManagedVoiceSession({readyState:WebSocket.OPEN,send(raw:string){noWorkspaceFrames.push(JSON.parse(raw));}} as ServerWebSocket,()=>({async connect(cb){noWorkspaceCallbacks=cb;cb.onReady('sdk-missing-workspace');return {sendAudio(){},endAudioStream(){},close(){}};}}),()=>'',()=>true,{ownerSessionBindingId:'owner-fixture',workspaceId:()=>undefined,dispatch:async(_t,h)=>{noWorkspaceHooks=h;return {outcome:'configuration_required'};}});
try{
 await noWorkspace.start();noWorkspaceCallbacks.onUserTranscript('sistem durumunu göster',false,'missing-workspace');await tick();
 assert.equal(noWorkspaceHooks,undefined);assert.equal(noWorkspaceFrames.some(e=>e.type==='skill:task_admitted'),false);
 noWorkspaceCallbacks.onUserTranscript('Paneli kapat',false);assert.equal(noWorkspaceFrames.some(e=>e.type==='hud:presentation'),false,'No guessed final lineage in production composition');
 console.log(JSON.stringify({pass:true,missingWorkspaceNoFabricatedAdmission:true,missingStableFinalIdDropped:true}));
}finally{noWorkspace.stop('fixture_cleanup');}

// P1 VOICE-GENERATION-MUTE-01: both entry paths must preserve later ordinary conversation.
// Actual manager/dispatcher/admission persistence, fake provider/socket; only executor is held.
const outputResults:boolean[]=[];
for(const mode of ['presentation','admission'] as const){
 const outputFrames:any[]=[];let outputCallbacks!:GeminiLiveCallbacks,outputOwner=true,connects=0,closes=0,heldExecutor=false,releaseOutput:(()=>void)|undefined;
 const outputDispatch=new VoiceSkillDispatch(new Phase4IdempotencyStore(path.join(root,`output-${mode}.db`)),async text=>text==='sistem durumunu göster'?intent:undefined,owner,continuation);
 const outputSession=new ManagedVoiceSession({readyState:WebSocket.OPEN,send(raw:string){outputFrames.push(JSON.parse(raw));}} as ServerWebSocket,()=>({async connect(cb){connects++;outputCallbacks=cb;cb.onReady('sdk-output');return {sendAudio(){},endAudioStream(){},close(){closes++;}};}}),()=>'',()=>outputOwner,{ownerSessionBindingId:'owner-fixture',workspaceId:()=>workspace,dispatch:(t,h)=>outputDispatch.dispatch(t,h)});
 executorService.executeTask=async(taskId:string)=>{heldExecutor=true;await new Promise<void>(resolve=>releaseOutput=resolve);return {success:false,taskId,status:'NOOP',iterations:0,toolCalls:0,reports:[],task:taskService.getTask(taskId)};};
 try{
  await outputSession.start();const baseline=taskService.listTasks().length;
  outputCallbacks.onUserTranscript(mode==='presentation'?'Paneli kapat':'sistem durumunu göster',false,`output-${mode}-1`);
  if(mode==='admission'){
   for(let i=0;i<200&&!heldExecutor;i++)await new Promise(resolve=>setTimeout(resolve,2));
   assert.equal(heldExecutor,true);const actual=outputFrames.find(e=>e.type==='skill:task_admitted');assert.ok(actual);continuation.assertHudRead(actual.taskId,'owner-fixture',workspace);
  }else{await tick();assert.equal(heldExecutor,false);assert.equal(outputFrames.filter(e=>e.type==='hud:presentation').length,1);}
  const canonicalCount=outputFrames.filter(e=>e.type==='skill:task_admitted'||e.type==='hud:presentation').length;
  outputCallbacks.onAssistantTranscript('provider claims task complete',false);outputCallbacks.onAudio('AAA=','audio/pcm;rate=24000');
  assert.equal(outputFrames.filter(e=>e.type==='skill:task_admitted'||e.type==='hud:presentation').length,canonicalCount,'Unattributed narrative cannot create progress or verified report');
  outputCallbacks.onUserTranscript('Bugün nasılsın?',false,`output-${mode}-ordinary`);await tick();
  const ordinaryStart=outputFrames.length;
  outputCallbacks.onState('thinking');outputCallbacks.onAssistantTranscript('İyiyim, sen nasılsın?',false);outputCallbacks.onAudio('AAA=','audio/pcm;rate=24000');outputCallbacks.onState('speaking');
  const ordinary=outputFrames.slice(ordinaryStart);
  const forwarded=ordinary.some(e=>e.type==='transcript:assistant'&&e.text==='İyiyim, sen nasılsın?')&&ordinary.some(e=>e.type==='audio:chunk')&&ordinary.some(e=>e.type==='status'&&e.state==='thinking')&&ordinary.some(e=>e.type==='status'&&e.state==='speaking');
  outputResults.push(forwarded);console.log(JSON.stringify({mode,ordinaryTextAudioStatesForwarded:forwarded,providerConnections:connects,providerCloses:closes}));
  assert.equal(connects,1);assert.equal(closes,0);assert.equal(outputSession.isLiveReady(),true);assert.equal(taskService.listTasks().length,baseline+(mode==='admission'?1:0));
  assert.equal(outputFrames.some(e=>e.type==='skill:result'&&e.outcome==='completed'),false,'Provider claims cannot produce a verified spoken/task report');
  releaseOutput?.();await tick();
  outputOwner=false;const revokedStart=outputFrames.length;outputCallbacks.onAssistantTranscript('revoked',false);outputCallbacks.onAudio('AAA=','audio/pcm;rate=24000');outputCallbacks.onState('speaking');assert.equal(outputFrames.length,revokedStart);
  outputSession.stop('fixture_stop');const stoppedStart=outputFrames.length;outputCallbacks.onAssistantTranscript('stale',false);outputCallbacks.onAudio('AAA=','audio/pcm;rate=24000');assert.equal(outputFrames.length,stoppedStart);
 }finally{releaseOutput?.();outputSession.stop('fixture_cleanup');executorService.executeTask=oldExecute;}
}
assert.deepEqual(outputResults,[true,true],'PRESENTATION_AND_GENUINE_ADMISSION_MUST_PRESERVE_SUBSEQUENT_ORDINARY_VOICE');
console.log(JSON.stringify({pass:true,presentationThenOrdinaryConversation:true,genuineAdmissionThenOrdinaryConversation:true,noForcedReconnect:true,providerNarrativeNeverCanonical:true,revokedAndStoppedOutputsBlocked:true}));
