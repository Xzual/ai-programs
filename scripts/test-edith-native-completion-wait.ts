import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createServer} from 'node:http';
import {FileService} from '../server/files/fileService';
import {createFilesRouter} from '../server/routes/files';
import {createComputerUseRouter} from '../server/routes/computerUse';
import {createTasksRouter} from '../server/routes/tasks';
import {createOwnerSessionRouter} from '../server/security/ownerSession';
import {getNativeTaskBinding,digest,pathFingerprint} from '../server/computer/nativeTaskBinding';
import {closeNativeExplorerBridge} from '../server/files/nativeExplorerActions';
import {getMobileRuntime} from '../server/mobile/runtime';
import {taskService} from '../src/edith/taskService';
import {killSwitchService} from '../src/edith/killSwitch';
import {beginComputerSession,stopComputer,readComputerTaskCompletion,computerTaskReference} from '../src/edith/computerDesktopClient';

// Private synthetic native facts/receipts are fixture-only. HTTP routers, producer,
// persisted tasks, independent filesystem readback and default completion client are real.
// No OS input, app launch, live database, build or installation occurs.
assert.equal(process.env.EDITH_TEST_MODE,'true');
const workspace=path.resolve(process.env.EDITH_WORKSPACE_ROOT!);
assert.ok(workspace.includes('edith-isolated-test-'));
const root=path.join(workspace,'completion-files');
for(const p of [root,path.join(root,'src'),path.join(root,'dest')])fs.mkdirSync(p);
const files=new FileService(()=>[{id:'workspace',path:root}]);
const app=express();app.use(express.json());app.use(createOwnerSessionRouter());app.use(createFilesRouter(files));app.use(createComputerUseRouter());app.use(createTasksRouter());
const server=createServer(app),realFetch=globalThis.fetch,oldWindow=globalThis.window;
process.env.EDITH_OWNER_TOKEN='completion-fixture-owner';process.env.EDITH_DESKTOP_BRIDGE_TOKEN='completion-fixture-private';
let serial=0,nativeInput=0,frontendMutations=0,expiry=Date.now()+300000,origin='',ownerHeaders:Record<string,string>={};
const checks:string[]=[],timings:Record<string,number>={};
const nativeHeaders={authorization:'Bearer completion-fixture-private','content-type':'application/json'};
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const call=async(url:string,body?:unknown,headers=ownerHeaders,method=body===undefined?'GET':'POST')=>{const r=await realFetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
const priv=(suffix:string,body?:unknown)=>call('/api/computer-use/native-workflows'+suffix,body,nativeHeaders);
const explorer=(suffix:string,body?:unknown)=>call('/api/computer-use/native-explorer'+suffix,body,nativeHeaders);
const frontendFetch:typeof fetch=async(input,init)=>{const url=new URL(String(input),origin);frontendMutations+=Number((init?.method??'GET').toUpperCase()!=='GET');return realFetch(url,{...init,headers:{...ownerHeaders,...Object.fromEntries(new Headers(init?.headers))}});};
(globalThis as any).window={location:{get origin(){return origin;}},__TAURI__:{core:{invoke:async(command:string)=>{
  if(command==='computer_begin')return 'completion-client-session';
  if(command==='computer_status')return {runtime:'tauri',mode:'owner_command',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:true,killSwitch:'inactive',overlay:'missing',sessionExpiresAt:expiry,safeMessage:'Synthetic fixture.'};
  if(command==='computer_stop')return undefined;
  nativeInput++;throw Error('Unexpected native input: '+command);
}}}};
async function prepare(){globalThis.fetch=frontendFetch;await stopComputer();expiry=Date.now()+300000;return beginComputerSession();}
async function reject(name:string,fn:()=>Promise<unknown>,pattern:RegExp,maximum=800){const start=performance.now();await assert.rejects(fn,pattern,name);const elapsed=performance.now()-start;timings[name]=Math.round(elapsed);assert.ok(elapsed<maximum,name+' must fail within bounded time');checks.push(name);}
try{
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as any).port;
  const loginResponse=await realFetch(origin+'/api/security/session',{headers:{origin,authorization:'Bearer completion-fixture-owner'},method:'POST'});const loginWire=await loginResponse.json() as any;
  assert.equal(loginResponse.status,201);
  ownerHeaders={origin,cookie:loginResponse.headers.get('set-cookie')!.split(';')[0],'content-type':'application/json','x-edith-csrf-token':loginWire.session.csrfToken};
  const owner=(await priv('/owner-context')).data.context;
  const destination=(await call('/api/files/explorer/directories')).data.directories.find((d:any)=>d.relativePath==='dest').id;
  await explorer('/next');
  const name='completion-race.md';fs.writeFileSync(path.join(root,'src',name),'Own isolated completion bytes İstanbul');
  const sourceFileId=files.search(name).files.find(f=>f.relativePath==='src/'+name)!.id;
  const plan=(await call('/api/files/explorer/plans',{operation:'copy',sourceFileId,destinationDirectoryId:destination},{...ownerHeaders,'x-idempotency-key':'completion-race-plan'})).data;
  assert.ok(plan.taskId&&plan.bindingId);const reference=computerTaskReference(plan);
  const nativeSession={source:'native_operator',ownerBindingId:owner.ownerBindingId,sessionId:'completion-private-session',reservationId:'completion-private-reservation',applicationId:'explorer',windowId:'completion-window',processId:4321,imagePathFingerprint:digest('synthetic-explorer-image'),expiresAt:Date.now()+60000};
  assert.equal((await priv('/session',nativeSession)).status,200);
  const associated=await priv('/associate',{operationId:plan.operationId,ownerBindingId:owner.ownerBindingId,sessionId:nativeSession.sessionId,reservationId:nativeSession.reservationId});assert.equal(associated.status,200);
  const ns=associated.data.source,nc=Object.fromEntries(['nonce','taskId','ownerBindingId','sessionId','reservationId','requestDigest'].map(k=>[k,ns[k]]));
  const snapshot=(extra:any={})=>({source:'native_uia_state',observationId:'completion-observation-'+ ++serial,observedAt:Date.now(),applicationId:'explorer',windowId:nativeSession.windowId,processId:nativeSession.processId,imagePathFingerprint:nativeSession.imagePathFingerprint,foreground:true,...extra});
  const action=(await priv('/'+plan.bindingId+'/check',{...nc,pre:snapshot()})).data.result;
  assert.ok(action?.permitNonce);
  const executePromise=call('/api/files/explorer/plans/'+plan.operationId+'/execute',{});
  let job:any;for(let i=0;i<50&&!job;i++){job=(await explorer('/next')).data.job;if(!job)await sleep(5);}assert.equal(job.operationId,plan.operationId);
  const src=(await call('/api/computer-use/native-explorer/'+job.operationId+'/source',undefined,{...nativeHeaders,'x-edith-explorer-claim':job.claimNonce})).data.source;
  const ec=Object.fromEntries(['claimNonce','operationNonce','ownerBindingId','actionId','operation','rootIdentity','sourceIdentity','contentSha256','sourceDirectoryIdentity','destinationDirectoryIdentity'].map(k=>[k,k==='claimNonce'?job.claimNonce:src[k]]));
  const permit=(await explorer('/'+job.operationId+'/check',ec)).data.permit.permitNonce;
  fs.copyFileSync(src.sourcePath,src.destinationPath,fs.constants.COPYFILE_EXCL);
  const rb=await explorer('/'+job.operationId+'/readback',{...ec,permitNonce:permit});assert.equal(rb.status,200);
  assert.equal((await explorer('/'+job.operationId+'/finish',{...ec,permitNonce:permit,source:'native_explorer',postcondition:'gui_action_observed',destinationIdentity:rb.data.readback.destination.identity})).status,200);
  // Critical ordering: await the real execute response BEFORE scheduling final native proof.
  const executed=await executePromise;assert.equal(executed.status,200);assert.equal(executed.data.taskState,'RUNNING');assert.equal(executed.data.state,'verified');
  assert.equal(taskService.getTask(plan.taskId)!.verification?.status,undefined);
  assert.equal(fs.readFileSync(src.destinationPath,'utf8'),fs.readFileSync(src.sourcePath,'utf8'));
  const session=await prepare();let finishPosted=false;
  const delayedFinish=(async()=>{await sleep(240);assert.equal((await priv('/'+plan.bindingId+'/step',{...nc,actionId:action.actionId,permitNonce:action.permitNonce,dispatch:'dispatched',partialInput:false,post:snapshot({folderFingerprint:pathFingerprint(path.dirname(src.destinationPath)),selectedNameFingerprint:digest(name),selectedCount:1})})).status,200);assert.equal((await priv('/'+plan.bindingId+'/finish',nc)).status,200);finishPosted=true;})();
  const completionStart=performance.now();const completed=await readComputerTaskCompletion(session,reference);await delayedFinish;timings.mountedRace=Math.round(performance.now()-completionStart);
  assert.equal(finishPosted,true);assert.equal(completed.taskId,plan.taskId);assert.equal(completed.taskState,'COMPLETED');assert.ok(performance.now()-completionStart>=200);
  checks.push('mounted Files execute returns RUNNING before delayed private native final proof; default client waits for canonical required PASS');
  const canonicalState=(await call('/api/computer-use/workflows/'+plan.bindingId)).data,canonicalProof=(await call('/api/edith/tasks/'+plan.taskId+'/activity')).data;
  assert.equal(canonicalProof.verification.checks.filter((c:any)=>c.required).every((c:any)=>c.status==='PASS'),true);
  await readComputerTaskCompletion(session,reference);checks.push('direct COMPLETED canonical happy path');
  const baseline=JSON.stringify(taskService.getTask(plan.taskId));
  // Response faults are explicit read-only frontend transport fixtures derived from
  // actual canonical views. They never synthesize proof in the public adapter/backend.
  let reads=0,mutations=0,stateReads=0,activityReads=0;
  async function fault(state:any,proof:any,hook?:(url:string,init?:RequestInit)=>Promise<Response|undefined>){const sid=await prepare();reads=stateReads=activityReads=0;globalThis.fetch=async(input,init)=>{const url=String(input);assert.equal((init?.method??'GET').toUpperCase(),'GET');mutations+=Number((init?.method??'GET')!=='GET');reads++;if(url.includes('/activity'))activityReads++;else stateReads++;const custom=await hook?.(url,init);if(custom)return custom;return new Response(JSON.stringify(url.includes('/activity')?proof:state));};return sid;}
  const pending={...canonicalState,state:'RUNNING'},pendingProof={...canonicalProof,status:'RUNNING',verification:undefined};
  let sid=await fault(pending,pendingProof);await reject('persistent pending fixed deadline',()=>readComputerTaskCompletion(sid,reference),/NOT_COMPLETED/,2700);assert.ok(stateReads<=21&&activityReads===stateReads&&stateReads>1);assert.ok(timings['persistent pending fixed deadline']>=1900);
  for(const state of ['CANCELLED','FAILED','BLOCKED','RETRYABLE_FAILURE','PAUSED','BOGUS']){sid=await fault({...canonicalState,state},canonicalProof);await reject('terminal '+state,()=>readComputerTaskCompletion(sid,reference),/APP_TASK_/);assert.ok(stateReads<=1);}
  for(const [label,state,proof] of [
    ['wrong state task ID',{...canonicalState,taskId:'foreign-task'},canonicalProof],
    ['wrong binding ID',{...canonicalState,bindingId:'foreign-binding'},canonicalProof],
    ['wrong activity task ID',canonicalState,{...canonicalProof,taskId:'foreign-task'}],
    ['wrong verification task ID',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,taskId:'foreign-task'}}],
    ['required FAIL',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:canonicalProof.verification.checks.map((c:any)=>({...c,status:'FAIL'}))}}],
    ['missing required proof',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:[]}}],
    ['malformed required flag',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:canonicalProof.verification.checks.map((c:any)=>({...c,required:'true'}))}}],
    ['null required check',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:[null]}}],
    ['unknown nonrequired status',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:[...canonicalProof.verification.checks,{id:'optional-fixture',required:false,status:'BOGUS'}]}}],
    ['empty check ID',canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:canonicalProof.verification.checks.map((c:any)=>({...c,id:''}))}}],
    ['missing completed verification',canonicalState,{...canonicalProof,verification:null}],
    ['completed workflow pending activity',canonicalState,pendingProof],
    ['malformed state',{},canonicalProof],
    ['pending independent FAIL',pending,{...pendingProof,verification:{...canonicalProof.verification,status:'FAIL'}}],
    ['pending independent BLOCKED',pending,{...pendingProof,status:'BLOCKED'}],
    ['pending independent RETRYABLE_FAILURE',pending,{...pendingProof,status:'RETRYABLE_FAILURE'}],
    ['pending unexpected activity state',pending,{...pendingProof,status:'BOGUS'}],
  ] as const){sid=await fault(state,proof);await reject(label,()=>readComputerTaskCompletion(sid,reference),/APP_TASK_/);}
  sid=await fault(canonicalState,{...canonicalProof,verification:{...canonicalProof.verification,checks:[...canonicalProof.verification.checks,{id:'optional-fixture',required:false,status:'FAIL'}]}});assert.equal((await readComputerTaskCompletion(sid,reference)).taskState,'COMPLETED');checks.push('valid optional FAIL preserves required PASS success');
  for(const target of ['state','activity'])for(const phase of ['fetch','body']){let signal:AbortSignal|undefined;sid=await fault(pending,pendingProof,async(url,init)=>{if(url.includes('/activity')!==(target==='activity'))return undefined;signal=init?.signal??undefined;return phase==='fetch'?new Promise<Response>(()=>{}):({ok:true,json:()=>new Promise(()=>{})} as Response);});const label='hanging '+target+' '+phase;await reject(label,()=>readComputerTaskCompletion(sid,reference),/NOT_COMPLETED/,2700);assert.equal(signal?.aborted,true);assert.ok(timings[label]>=1900);}
  for(const status of ['QUEUED','VERIFYING']){let rounds=0;sid=await fault(pending,pendingProof,async url=>{if(!url.includes('/activity'))rounds++;return new Response(JSON.stringify(url.includes('/activity')?(rounds<2?{...pendingProof,status}:canonicalProof):(rounds<2?{...canonicalState,state:status}:canonicalState)));});assert.equal((await readComputerTaskCompletion(sid,reference)).taskState,'COMPLETED');assert.equal(rounds,2);checks.push(status+' may wait to complete');}
  let rounds=0;sid=await fault(pending,canonicalProof,async url=>{if(!url.includes('/activity'))rounds++;return new Response(JSON.stringify(url.includes('/activity')?canonicalProof:rounds===1?pending:canonicalState));});assert.equal((await readComputerTaskCompletion(sid,reference)).taskState,'COMPLETED');assert.equal(rounds,2);checks.push('activity completion races ahead of workflow and requires next canonical state');
  sid=await fault(pending,pendingProof);let stopTimer=setTimeout(()=>{void stopComputer();},40);await reject('local STOP during delay',()=>readComputerTaskCompletion(sid,reference),/stopped_or_expired|session_missing/);clearTimeout(stopTimer);
  sid=await fault(pending,pendingProof,async()=>new Promise<Response>(()=>{}));stopTimer=setTimeout(()=>{void stopComputer();},40);await reject('local STOP during request',()=>readComputerTaskCompletion(sid,reference),/stopped_or_expired|session_missing/);clearTimeout(stopTimer);
  sid=await fault(pending,pendingProof,async()=>({ok:true,json:()=>new Promise(()=>{})} as Response));stopTimer=setTimeout(()=>{void stopComputer();},40);await reject('local STOP during body',()=>readComputerTaskCompletion(sid,reference),/stopped_or_expired|session_missing/);clearTimeout(stopTimer);
  // Native IDs can be reused immediately. The old wait must keep the original
  // canonical session object, even when STOP + begin both finish before watchdog.
  for(const phase of ['delay','body']){
    let releaseBody:(value:unknown)=>void=()=>{};
    sid=await fault(pending,pendingProof,phase==='body'?async()=>({ok:true,json:()=>new Promise(resolve=>{releaseBody=resolve;})} as Response):undefined);
    const oldSessionId=sid;
    const rebound=new Promise<string>((resolve,rejectRebound)=>setTimeout(()=>{void (async()=>{await stopComputer();const fresh=await beginComputerSession();assert.equal(fresh,oldSessionId,'Fixture deliberately reuses exact native session ID');releaseBody(canonicalState);resolve(fresh);})().catch(rejectRebound);},35));
    await reject('STOP immediate same-ID rebind during '+phase,()=>readComputerTaskCompletion(oldSessionId,reference),/stopped_or_expired|session_missing/);
    const fresh=await rebound;globalThis.fetch=frontendFetch;
    assert.equal((await readComputerTaskCompletion(fresh,reference)).taskState,'COMPLETED','Fresh independent wait works after old authority is rejected');
    checks.push('fresh same-ID session independently reads after '+phase+' old wait rejection');
  }
  sid=await fault(pending,pendingProof);const realNow=Date.now;let expiryTimer=setTimeout(()=>{Date.now=()=>expiry+1;},40);try{await reject('local session expiry',()=>readComputerTaskCompletion(sid,reference),/stopped_or_expired|session_missing/);}finally{Date.now=realNow;clearTimeout(expiryTimer);}
  assert.equal(JSON.stringify(taskService.getTask(plan.taskId)),baseline);assert.equal(mutations,0);assert.equal(nativeInput,0);checks.push('completion reads do not input, redispatch or mutate canonical task');
  // Real mounted revocation branches use new private native tasks (no filesystem effect).
  async function freshTask(){globalThis.fetch=frontendFetch;const id='revoke-'+ ++serial;const s={...nativeSession,applicationId:'spotify',sessionId:id,reservationId:id,expiresAt:Date.now()+60000};assert.equal((await priv('/session',s)).status,200);const t=await call('/api/computer-use/workflows',{sessionId:id,workflowId:id,request:{app:'spotify',workflow:'focus'}},{...ownerHeaders,'x-idempotency-key':'completion-'+id});assert.equal(t.status,200);return computerTaskReference(t.data);}
  for(const action of ['cancel','pause','kill','native session expiry','owner loss']){const ref=await freshTask(),local=await prepare();const rejection=assert.rejects(readComputerTaskCompletion(local,ref),/APP_TASK_/);await sleep(35);if(action==='kill')killSwitchService.activate('isolated completion fixture');else if(action==='native session expiry'){const now=Date.now;try{Date.now=()=>now()+61000;const invalid=await priv('/'+ref.bindingId+'/source');assert.equal(invalid.status,409);}finally{Date.now=now;}}else if(action==='owner loss')assert.equal((await call('/api/security/session',undefined,ownerHeaders,'DELETE')).status,200);else assert.equal((await call('/api/edith/tasks/'+ref.taskId+'/'+action,{})).status,200);await rejection;if(action==='kill')killSwitchService.deactivate();checks.push('mounted '+action+' stops pending completion');}
  assert.equal(frontendMutations,0);
  console.log(JSON.stringify({success:true,checks,timings,defaultCompletionClient:true,mountedFilesRace:true,privateSyntheticNativeFixture:true,physicalAcceptance:false,nativeInput,completionMutations:mutations+frontendMutations,actualOwnFilesystemSha256:digest(fs.readFileSync(src.destinationPath,'utf8')),retainedOwnFiles:root}));
}finally{globalThis.fetch=realFetch;await stopComputer().catch(()=>{});(globalThis as any).window=oldWindow;closeNativeExplorerBridge();getNativeTaskBinding().close();getMobileRuntime().realtime.shutdown();server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));console.log(JSON.stringify({cleanup:{serverClosed:!server.listening,globalsRestored:true,nativeRegistryClosed:true,ownTempFilesRetainedForRunner:true}}));}

