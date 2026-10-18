import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createServer,request as httpRequest} from 'node:http';
import {createComputerUseRouter} from '../server/routes/computerUse';
import {BrowserNativeAuthority, browserNativeAuthority,decodeNativePrivate,NATIVE_PRIVATE_ACTIONS,NATIVE_BROWSER_PRIVATE_BASE,nativeBrowserBodyErrorHandler} from '../server/browser/browserNativeAuthority';
import type * as N from '../server/browser/browserNativePrivateContract';
import type {BrowserNativeAuthoritySources} from '../server/browser/browserNativeAuthority';
assert.equal(process.env.EDITH_TEST_MODE,'true');
process.env.EDITH_DESKTOP_BRIDGE_TOKEN=crypto.randomBytes(32).toString('base64url');
const ref=()=>crypto.randomBytes(24).toString('base64url'),d='a'.repeat(64),now=Date.now(),r=ref();
const consent:any={version:1,backendBootRef:r,nativeBootRef:r,enrollmentSourceRef:r,enrollmentChallengeRef:r,enrollmentRecheckRef:r,consentRef:r,nativeSessionRef:r,originalOwnerRef:r,originalTaskRef:r,attemptRef:r,operationRef:r,requestScopeDigest:d,sourceEpochDigest:d,computerSessionGeneration:1,localSessionExpiresAtMs:now+30000,reservationRef:r,reservationGeneration:1,reservationExpiresAtMs:now+30000,nativeStopEpoch:0,confirmationRef:r,confirmationMethod:'win32-scoped-messagebox-yes',approvedAtMs:now,expiresAtMs:now+29000};
const map:any={version:1,backendBootRef:r,nativeBootRef:r,challengeRef:r,mapRef:r,originalTaskRef:r,operationRef:r,actionBatchRef:r,snapshotRef:r,processLaunchRef:r,kernelCreation:'18446744073709551615',executableFingerprint:d,kernelIdentityRef:r,rootIdentityRef:r,contentIdentityRef:r,logicalDocumentRef:r,logicalAncestryDigest:d,logicalRuntimeIdDigest:d,engineInventoryDigest:d,nativeInventoryDigest:d,sourceEpochDigest:d,nativeSessionRef:r,nativeSessionGeneration:1,localConsentRef:r,reservationRef:r,reservationGeneration:1,nativeStopEpoch:0,profile:'exclusive-mainpage-dpi96-v1',transform:{originPhysicalX:0,originPhysicalY:0,widthPhysical:100,heightPhysical:100,dpi:96,dpr:1,visualScale:1},nativeHitTargetRef:r,nativeHitProofDigest:d,measuredAtMs:now,expiresAtMs:now+1000};
const ledger:any={version:1,backendBootRef:r,nativeBootRef:r,challengeRef:r,ledgerRef:r,permitRef:r,operationRef:r,actionBatchRef:r,processLaunchRef:r,kernelIdentityRef:r,viewportMapRef:r,nativeSessionRef:r,nativeSessionGeneration:1,localConsentRef:r,reservationRef:r,reservationGeneration:1,nativeStopEpoch:0,sequence:1,claimedAtMs:now,completedAtMs:now+1,requestedEventCount:2,sentEventCount:2,cleanupRequestedCount:0,cleanupSentCount:0,cursorEffect:false,focusEffect:false,possibleEffect:true,result:'sent'};
const focus:any={version:1,kind:'set-original-foreground',focusActionRef:r,sourceEpochDigest:d,nativeBootRef:r,nativeSessionRef:r,computerSessionGeneration:1,reservationRef:r,reservationGeneration:1,nativeStopEpoch:0,originalRootWindowRef:r,measuredBeforeAtMs:now,measuredAfterAtMs:now+1,expiresAtMs:now+1000,beforeGuardsCurrent:true,afterGuardsCurrent:true,beforeForeground:'managed-edith',afterForeground:'original-chrome',rootAssociationCurrent:true,possibleEffect:true,apiBool:1};
const bodies:Record<NATIVE_ACTION,any>={boot:{version:1,nativeBootNonce:r},source:{version:1,phase:'enrollment',attemptRef:r},associate:{version:1,attemptRef:r,nativeSessionRef:r,enrollmentSourceRef:r,enrollmentChallengeRef:r,enrollmentRecheckRef:r,consentView:consent},map:{challengeRef:r,mapRef:r,mapView:map},check:{bindingRef:r,snapshotRef:r,mapRef:r},consume:{permitRef:r},dispatch:{challengeRef:r,permitRef:r,ledgerRef:r,ledgerView:ledger},verify:{permitRef:r,dispatchRef:r},cancel:{bindingRef:r,reason:'explicit_revoke'},'driver/next':{version:1,operationRef:r},input:{version:1,commandRef:r,approvedInputRef:r},'input/arm':{version:1,commandRef:r,approvedInputRef:r},'focus/source':{version:1,operationRef:r,bindingRef:r},'focus/record':{version:1,operationRef:r,bindingRef:r,focusSourceRef:r,focusRecord:focus}};
type NATIVE_ACTION=typeof NATIVE_PRIVATE_ACTIONS[number];
const rows:{scenario:string;kind:string}[]=[];
const mark=(scenario:string,kind='ACTUAL_HTTP_OR_ISSUER_NEGATIVE')=>rows.push({scenario,kind});
/** Symbolic source ports exercise Node protocol only; no real UIA/SendInput evidence. */
async function simulatedPortsFixture(action:'fill_form'|'scroll'='fill_form',scrollDeltaY=120){
  const authority=new BrowserNativeAuthority('simulated-native-producer');
  const opaque=<T>():T=>Object.freeze(Object.create(null)) as T;
  const attempt=opaque<N.AttemptRef>(),operation=opaque<N.OriginalOperationLookupRef>(),backend=opaque<N.BackendBootRef>(),source=opaque<N.BrowserNativeSourceHandle>(),owner=opaque<N.BrowserOwnerCap>(),batch=opaque<N.PlannedNativeBatchRef>(),target=opaque<N.NativeSourceTargetCap>(),input=opaque<N.NativeSourceInputCap>();
  const attemptAlias=ref(),operationAlias=ref(),ownerAlias=ref(),backendAlias=ref(),launchAlias=ref(),documentAlias=ref(),rootAlias=ref(),text='fixture-🙂',expected=action==='scroll'?1:8+text.length*2,admitted=Date.now();
  let current=true,binding:N.BindingRef|undefined,snapshot:N.SnapshotRef|undefined,sourceSnapshot:N.NativeSourceSnapshotCap|undefined,boot:N.NativeBootRef|undefined,prep=0,capture=0,deadline=admitted+30000;
  const guard=()=>{if(!current||Date.now()>=deadline)throw Error('SIMULATED_SOURCE_LOST');};
  const metadata=()=>{guard();boot??=authority.currentBoot();return {attempt,backendBoot:backend,backendBootLookupRef:backendAlias,nativeBoot:boot!,taskId:'task-original-fixture',originalTaskRef:'task-original-fixture',originalOwnerBinding:'fixture-owner',originalOwnerRef:ownerAlias,request:{action,sessionId:'fixture-session',pageId:'fixture-page',...(action==='scroll'?{scrollDeltaY}:{fieldValues:{'#q':text}}),verificationGoal:'own fixture only',dryRun:false},requestHash:d,toolId:'playwright_browser_agent',admittedAtMs:admitted,operationDeadlineMs:deadline,phase:'running',attemptLookupRef:attemptAlias,operationLookupRef:operationAlias};};
  const producer:any={
    inspectNativeBackendBoot:()=>({backendBoot:backend,backendBootLookupRef:backendAlias}),
    resolveIssuedAttemptLookup:(wire:string)=>{guard();assert.equal(wire,attemptAlias);return attempt;},
    resolveIssuedOperationLookup:(wire:string)=>{guard();assert.equal(wire,operationAlias);return operation;},
    resolveIssuedOperationAttempt:(cap:N.OriginalOperationLookupRef)=>{assert.equal(cap,operation);return attempt;},
    inspectNativeAttempt:metadata,guardOriginalAttempt:(cap:N.AttemptRef)=>{assert.equal(cap,attempt);guard();},
    inspectNativeOperationState:()=>({phase:current?'running':'revoked',started:true,taskId:'task-original-fixture',taskStatus:current?'RUNNING':'CANCELLED',paired:false,canonicalLeafSettled:false,possibleEffect:false,reasonCode:'SIMULATED',operationLookupRef:operationAlias,attemptLookupRef:attemptAlias,operationDeadlineMs:deadline,binding,source}),
    captureNativeAttemptSource:async()=>{guard();capture++;return source;},
    attachNativeBinding:(a:N.AttemptRef,issued:N.NativeAuthorityPort&N.NativeAuthorityIdentityPort,b:N.BindingRef,s:N.BrowserNativeSourceHandle)=>{assert.equal(a,attempt);assert.equal(s,source);assert(issued.verifyIssuedBinding(b,attempt,backend,boot!));binding=b;},
    prepareNativeAttemptBatches:async()=>{guard();return [batch];},
    prepareFreshNativeStep:async()=>{guard();prep++;snapshot=opaque<N.SnapshotRef>();sourceSnapshot=opaque<N.NativeSourceSnapshotCap>();return snapshot;},
    inspectNativePlannedBatch:()=>({attempt,binding,nativeBoot:boot,operationLookupRef:operationAlias,sourceEpochDigest:d,sourceTarget:target,sourceInput:input,snapshot,sourceSnapshot,expectedPrimaryEventCount:expected,expiresAtMs:Math.min(Date.now()+1000,deadline)}),
    guardPreparedSnapshot:(s:N.SnapshotRef,b:N.BindingRef,a:N.AttemptRef,bat:N.PlannedNativeBatchRef)=>{guard();assert.equal(s,snapshot);assert.equal(b,binding);assert.equal(a,attempt);assert.equal(bat,batch);},
    registerNativeDispatchScope:()=>guard(),verifyNativeAttemptPair:async()=>{throw Error('SIMULATION_NO_PAIR');},
    inspectNativeLaunchDescriptor:()=>{guard();return {processLaunchRef:launchAlias,pid:123,canonicalExecutablePath:'C:\\owned-fixture\\chrome.exe',executableSha256:d,launchEpoch:ref(),childProcessAlive:true};},
    inspectNativeTargetDescriptor:()=>{guard();return {targetRef:ref(),semanticDigest:d,tag:'input',type:'text',writable:true,rectCss:{x:10,y:10,width:30,height:20},intendedPointCss:{x:20,y:20},isolatedHitTargetRef:ref(),isolatedHitProofDigest:d,logicalDocumentRef:documentAlias,logicalRootRef:rootAlias,logicalAncestryDigest:d,engineTargetIdentityDigest:d};},
    inspectNativeOperationBudget:()=>({logicalBatches:1,primaryEventCount:expected,cleanupEventBudget:40,utf16Units:action==='scroll'?0:text.length,recordSlots:5,wholeResolutionLimit:2,batches:[{batchRef:ref(),sequence:1,kind:action==='scroll'?'scroll-profile-wheel':'replace-field',primaryEventCount:expected,cleanupEventBudget:40,utf16Units:action==='scroll'?0:text.length}]})
  };
  const engine:any={guardSource:(s:N.BrowserNativeSourceHandle)=>{assert.equal(s,source);guard();},inspectSource:()=>{guard();return {requestHash:d,context:{actor:'fixture-owner',taskId:'task-original-fixture'},deadline,sourceEpochDigest:d,sessionId:'fixture-session',pageId:'fixture-page',request:metadata().request};},inspectSourceIdentity:()=>({attemptRef:attempt,nativeBootRef:boot,owner}),inspectHeldSource:()=>({documentId:documentAlias,launch:{page:{evaluate:async()=>({widthCss:100,heightCss:100,scrollX:0,scrollY:0,dpr:1,visualScale:1,visualOffsetX:0,visualOffsetY:0})}},inventory:{inventoryEpoch:ref(),observedAt:new Date().toISOString(),contextCount:1,pageCount:1,frameCount:1,targetId:'fixture-target',frameId:'fixture-frame',loaderId:'fixture-loader',targetTypes:['page'],dirty:false}}),inspectSnapshot:()=>({sourceEpochDigest:d}),inspectInput:()=>{guard();return {kind:action==='scroll'?'scroll-profile-wheel':'replace-text',...(action==='scroll'?{}:{text}),expectedPrimaryEventCount:expected,targetId:'fixture-target',sourceEpochDigest:d};},inspectPostcondition:()=>{throw Error('SIMULATION_NO_POSTCONDITION');},verifyPostcondition:async()=>{throw Error('SIMULATION_NO_POSTCONDITION');},verifyIssuedPostcondition:()=>false};
  authority.bindSources({producer,engine} as BrowserNativeAuthoritySources);
  const fixtureApp=express();fixtureApp.use(express.json());fixtureApp.use(nativeBrowserBodyErrorHandler);fixtureApp.use(createComputerUseRouter({nativeBrowserAuthority:authority}));
  const fixtureServer=createServer(fixtureApp);await new Promise<void>(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+(fixtureServer.address() as any).port;
  const post=async(action:string,body:unknown)=>{const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  const bootReply=await post('boot',{version:1,nativeBootNonce:ref()});assert.equal(bootReply.status,200);assert.equal(bootReply.body.result.backendBootRef,backendAlias);
  let sourceReply:any,bindingWire:string|undefined,focusSource:any,mapRequest:any,checkReply:any,command:any;
  const enroll=async()=>{sourceReply=(await post('source',{version:1,phase:'enrollment',attemptRef:attemptAlias})).body.result;assert(sourceReply);const again=await post('source',{version:1,phase:'enrollment',attemptRef:attemptAlias});assert.deepEqual(again.body.result,sourceReply);assert.equal(capture,1);return sourceReply;};
  const associate=async()=>{await enroll();const recheck=(await post('source',{version:1,phase:'enrollment_recheck',enrollmentSourceRef:sourceReply.enrollmentSourceRef,enrollmentChallengeRef:sourceReply.enrollmentChallengeRef})).body.result;
    const c={...consent,...sourceReply,enrollmentRecheckRef:recheck.enrollmentRecheckRef,consentRef:ref(),nativeSessionRef:ref(),confirmationRef:ref(),reservationRef:ref(),approvedAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+25000,deadline),localSessionExpiresAtMs:deadline,reservationExpiresAtMs:deadline};delete c.issuedAtMs;delete c.operationDeadlineMs;delete c.confirmationDescription;
    const body={version:1,attemptRef:attemptAlias,nativeSessionRef:c.nativeSessionRef,enrollmentSourceRef:c.enrollmentSourceRef,enrollmentChallengeRef:c.enrollmentChallengeRef,enrollmentRecheckRef:c.enrollmentRecheckRef,consentView:c};const first=await post('associate',body);assert.equal(first.status,200);assert.deepEqual((await post('associate',body)).body,first.body);bindingWire=first.body.result.bindingRef;focusSource=(await post('focus/source',{version:1,operationRef:operationAlias,bindingRef:bindingWire})).body.result;return {body,c};};
  const focusOnce=async()=>{const before=await post('source',{bindingRef:bindingWire});assert.equal(before.status,200);assert.equal(before.body.result.target,null);assert.equal(before.body.result.snapshotRef,null);
    const fr={...focus,...focusSource,focusActionRef:ref(),nativeBootRef:sourceReply.nativeBootRef,nativeSessionRef:association.c.nativeSessionRef,reservationRef:association.c.reservationRef,originalRootWindowRef:focusSource.originalRootWindowRef,measuredBeforeAtMs:Date.now(),measuredAfterAtMs:Date.now(),expiresAtMs:focusSource.expiresAtMs};delete fr.operationRef;delete fr.bindingRef;delete fr.focusSourceRef;delete fr.allowedForeground;
    const body={version:1,operationRef:operationAlias,bindingRef:bindingWire,focusSourceRef:focusSource.focusSourceRef,focusRecord:fr};const reply=await post('focus/record',body);assert.equal(reply.status,200);assert.equal(reply.body.result.outcome,'focused');assert.deepEqual((await post('focus/record',body)).body,reply.body);assert.equal(prep,1);
    const bound=(await post('source',{bindingRef:bindingWire})).body.result;assert(bound.target);assert.notEqual(bound.snapshotRef,null);assert.equal(bound.originalTaskRef,'task-original-fixture');
    const m={...map,backendBootRef:bound.backendBootRef,nativeBootRef:bound.nativeBootRef,challengeRef:bound.mapChallengeRef,mapRef:ref(),originalTaskRef:bound.originalTaskRef,operationRef:operationAlias,actionBatchRef:bound.batchRef,snapshotRef:bound.snapshotRef,processLaunchRef:bound.launch.processLaunchRef,executableFingerprint:bound.launch.executableSha256,logicalDocumentRef:ref(),logicalRuntimeIdDigest:'b'.repeat(64),sourceEpochDigest:bound.sourceEpochDigest,nativeSessionRef:association.c.nativeSessionRef,nativeSessionGeneration:association.c.computerSessionGeneration,localConsentRef:association.c.consentRef,reservationRef:association.c.reservationRef,reservationGeneration:association.c.reservationGeneration,nativeStopEpoch:association.c.nativeStopEpoch,measuredAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+800,bound.expiresAtMs),transform:{...map.transform,originPhysicalX:18,originPhysicalY:97}};
    assert.notEqual(m.logicalDocumentRef,bound.target.logicalDocumentRef);assert.notEqual(m.logicalRuntimeIdDigest,bound.target.engineTargetIdentityDigest);
    for(const key of ['snapshotRef','challengeRef','processLaunchRef','nativeBootRef','sourceEpochDigest'] as const){const value=key==='sourceEpochDigest'?'c'.repeat(64):ref(),bad={...m,[key]:value};assert.equal((await post('map',{challengeRef:bad.challengeRef,mapRef:bad.mapRef,mapView:bad})).status,409);}
    await assert.rejects(authority.claimStep(Object.freeze({}) as N.BindingRef,Object.freeze({}) as N.SnapshotRef,Object.freeze({...m}) as N.NativeMapRef));
    mapRequest={challengeRef:m.challengeRef,mapRef:m.mapRef,mapView:m};const mapAck=await post('map',mapRequest);assert.equal(mapAck.status,200);assert.deepEqual((await post('map',mapRequest)).body,mapAck.body);
    const check={bindingRef:bindingWire,snapshotRef:bound.snapshotRef,mapRef:m.mapRef};checkReply=await post('check',check);assert.equal(checkReply.status,200);assert.deepEqual((await post('check',check)).body,checkReply.body);return {body,m,check};};
  let association:any;
  const prepare=async()=>{association=await associate();return focusOnce();};
  return {authority,post,enroll,associate,prepare,attemptAlias,operationAlias,get association(){return association;},get bindingWire(){return bindingWire;},get checkReply(){return checkReply;},get mapRequest(){return mapRequest;},get sourceReply(){return sourceReply;},get prep(){return prep;},get expected(){return expected;},setLost:()=>{current=false;},setDeadline:(ms:number)=>{deadline=ms;},consume:async()=>{const reply=await post('consume',{permitRef:checkReply.body.result.permitRef});assert.equal(reply.status,200);command=reply.body.result.command;return reply;},get command(){return command;},close:async()=>{if(binding){try{authority.revoke(binding,'explicit_revoke');}catch{}}await new Promise<void>(resolve=>{fixtureServer.closeAllConnections();fixtureServer.close(()=>resolve());});}};
}
const app=express();app.use(express.json({limit:'100kb'}));app.use(nativeBrowserBodyErrorHandler);app.use(createComputerUseRouter());
const isolated=new BrowserNativeAuthority();let capturedPeer:N.PrivateBridgeContext|undefined;
app.post('/own-peer', (req,res)=>{try{capturedPeer=isolated.authenticatePrivateRequest(req);res.json({ok:true});}catch{res.status(401).json({ok:false});}});
const server=createServer(app);
try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+(server.address() as any).port;
  const request=async(action:string,body:any=bodies[action as NATIVE_ACTION],headers:Record<string,string>={},method='POST',suffix='')=>{
    const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/'+action+suffix,{method,headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,...headers},body:method==='GET'?undefined:JSON.stringify(body)});
    return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json() as any};
  };
  // Constructed rejected credential; the accepted bridge token is generated by this test.
  for(const headers of [{authorization:''},{authorization:'Bearer ' + 'synthetic'.repeat(4)},{origin:base},{origin:'https://foreign.invalid'},{forwarded:'for=127.0.0.1'},{'x-forwarded-for':'127.0.0.1'},{'x-forwarded-host':new URL(base).host},{'x-forwarded-proto':'http'},{'x-forwarded-port':'1'},{'x-edith-desktop-runtime':'tauri-v1'}]){assert.equal((await request('boot',bodies.boot,headers)).status,401,JSON.stringify(Object.keys(headers)));assert.equal(browserNativeAuthority.currentBoot(),undefined);mark('denied_auth_header_'+Object.keys(headers)[0]);}
  const hostStatus=await new Promise<number>((resolve,reject)=>{const req=httpRequest(base+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{host:'localhost:'+new URL(base).port,'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end(JSON.stringify(bodies.boot));});assert.equal(hostStatus,401);mark('actual_socket_host_mismatch');
  assert.equal((await request('boot',bodies.boot,{},'GET')).status,405);mark('method_denied');
  assert.equal((await request('boot',bodies.boot,{},'POST','?')).status,400);assert.equal((await request('boot',bodies.boot,{},'POST','?x=1')).status,400);mark('empty_and_populated_query_denied');
  assert.equal((await request('boot',bodies.boot,{'content-type':'text/plain'})).status,415);mark('content_type_denied');
  assert.equal((await request('boot',{version:1,nativeBootNonce:r,extra:'x'.repeat(65536)})).status,413);mark('body_size_denied');
  for(const bad of ['{"nativeBootNonce":"private-canary",', 'null','false','"private-canary"']){
    const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN},body:bad});
    assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');const text=await response.text();assert.deepEqual(JSON.parse(text),{success:false,errorCode:'NATIVE_INPUT_INVALID'});assert(!text.includes('private-canary'));assert(!text.includes('SyntaxError'));
  }mark('actual_global_json_parser_errors_sanitized');
  const oversized=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN},body:JSON.stringify({privateCanary:'x'.repeat(120000)})});assert.equal(oversized.status,413);assert.deepEqual(await oversized.json(),{success:false,errorCode:'NATIVE_BODY_TOO_LARGE'});mark('actual_global_body_parser_oversize_sanitized');
  for(const action of NATIVE_PRIVATE_ACTIONS){
    assert.equal((await request(action,{...bodies[action],unknown:true})).status,400);mark('exact_outer_'+action);
    for(const malformed of [null,[],{},false])assert.equal((await request(action,malformed)).status,400);
  }
  for(const [action,key] of [['associate','consentView'],['map','mapView'],['dispatch','ledgerView'],['focus/record','focusRecord']] as const){assert.equal((await request(action,{...bodies[action],[key]:{...bodies[action][key],unknown:true}})).status,400);mark('exact_nested_'+action);}
  assert.equal((await request('map',{...bodies.map,mapView:{...map,transform:{...map.transform,unknown:true}}})).status,400);mark('exact_transform');
  for(const bad of ['', 'short','a'.repeat(161),'https://caller.invalid','a'.repeat(21),1,null])assert.equal((await request('boot',{version:1,nativeBootNonce:bad})).status,400);mark('bounded_nondata_alias');
  assert.equal((await request('source')).status,503);mark('no_boot_unavailable');
  const boot=await request('boot');assert.equal(boot.status,200);assert.equal(boot.cache,'no-store');assert.deepEqual(Object.keys(boot.body.result).sort(),['backendBootRef','nativeBootRef']);
  const issued=browserNativeAuthority.currentBoot();assert(issued);assert.deepEqual((await request('boot')).body,boot.body);assert.equal(browserNativeAuthority.currentBoot(),issued);mark('boot_live_repeat_same_identity');
  const rotated=await request('boot',{version:1,nativeBootNonce:ref()});assert.equal(rotated.status,200);assert.notEqual(browserNativeAuthority.currentBoot(),issued);assert.equal(rotated.body.result.backendBootRef,boot.body.result.backendBootRef);assert.notEqual(rotated.body.result.nativeBootRef,boot.body.result.nativeBootRef);mark('boot_replacement_changes_identity');
  for(const action of NATIVE_PRIVATE_ACTIONS.filter(v=>v!=='boot')){const response=await request(action);assert.equal(response.status,503,action);assert.equal(response.cache,'no-store');assert.equal(response.body.errorCode,'NATIVE_BROWSER_UNAVAILABLE');assert(!JSON.stringify(response.body).includes(r));mark('forged_valid_transfer_no_authority_'+action);}
  for(const body of [{bindingRef:r},{version:1,phase:'enrollment_recheck',enrollmentSourceRef:r,enrollmentChallengeRef:r}])assert.equal((await request('source',body)).status,503);mark('all_disjoint_source_branches_unavailable');
  assert.equal((await request('source',{bindingRef:r,phase:'enrollment'})).status,400);mark('mixed_source_denied');
  for(const invalid of [{kernelCreation:18446744073709551615},{kernelCreation:'18446744073709551616'},{expiresAtMs:now+1001},{nativeStopEpoch:Infinity},{profile:'caller-profile'}])assert.throws(()=>decodeNativePrivate('map',{...bodies.map,mapView:{...map,...invalid}}));mark('lossless_kernel_profile_freshness_ranges','ACTUAL_DECODER_NEGATIVE');
  for(const invalid of [{sentEventCount:3},{sentEventCount:1},{cleanupSentCount:1},{possibleEffect:false},{sequence:-1},{completedAtMs:now-1}])assert.throws(()=>decodeNativePrivate('dispatch',{...bodies.dispatch,ledgerView:{...ledger,...invalid}}));mark('short_count_is_not_sent','ACTUAL_DECODER_NEGATIVE');
  for(const result of ['partial','unknown'])decodeNativePrivate('dispatch',{...bodies.dispatch,ledgerView:{...ledger,result,sentEventCount:1}});mark('partial_unknown_counts_retained_only_no_proof','VALIDATION_ONLY_NOT_NATIVE_EVIDENCE');
  decodeNativePrivate('focus/record',{...bodies['focus/record'],focusRecord:{...focus,apiBool:0,afterForeground:'other',afterGuardsCurrent:false}});mark('failed_focus_possible_effect_preserved','VALIDATION_ONLY_NOT_NATIVE_EVIDENCE');
  assert.throws(()=>decodeNativePrivate('focus/record',{...bodies['focus/record'],focusRecord:{...focus,possibleEffect:false}}));mark('focus_api_cannot_claim_zero_effect','ACTUAL_DECODER_NEGATIVE');
  assert.throws(()=>decodeNativePrivate('input/arm',{...bodies['input/arm'],targetRef:r}));mark('arm_caller_target_denied','ACTUAL_DECODER_NEGATIVE');
  assert.throws(()=>decodeNativePrivate('consume',Object.assign(Object.create({evil:true}),{permitRef:r})));mark('foreign_prototype_denied','ACTUAL_DECODER_NEGATIVE');
  assert.throws(()=>isolated.registerBoot({} as N.PrivateBridgeContext,r));mark('cloned_peer_denied','ACTUAL_ISSUER_NEGATIVE');
  await fetch(base+'/own-peer',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN},body:'{}'});assert(capturedPeer);
  isolated.registerBoot(capturedPeer!,r);assert.throws(()=>isolated.registerBoot(capturedPeer!,ref()));mark('old_peer_boot_generation_denied','ACTUAL_HTTP_ISSUER_NEGATIVE');
  assert.equal(isolated.supportsStrategy('fill_form'),false);mark('absent_counterparts_never_ready');
  const oldToken=process.env.EDITH_DESKTOP_BRIDGE_TOKEN;process.env.EDITH_DESKTOP_BRIDGE_TOKEN=ref();assert.equal(browserNativeAuthority.currentBoot(),undefined);assert.equal(isolated.currentBoot(),undefined);assert.throws(()=>isolated.registerBoot(capturedPeer!,r));
  assert.equal((await request('boot',bodies.boot,{authorization:'Bearer '+oldToken})).status,401);assert.equal((await request('boot',bodies.boot)).status,200);mark('credential_rotation_invalidates_before_new_request');
  for(const originalTaskRef of ['task-a','task-123-original'])decodeNativePrivate('associate',{...bodies.associate,consentView:{...consent,originalTaskRef}});mark('canonical_task_correlation_not_capability','VALIDATION_ONLY_NOT_NATIVE_EVIDENCE');
}finally{await new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close(error=>error?reject(error):resolve());});}
const simMark=(scenario:string)=>mark(scenario,'SIMULATED_SOURCE_PORTS_ACTUAL_HTTP_NO_NATIVE_PROOF');
{
 const fixture=await simulatedPortsFixture();try{
  await fixture.enroll();const readonlyBefore=await fixture.post('driver/next',{version:1,operationRef:fixture.operationAlias});assert.equal(readonlyBefore.status,200);assert.equal(readonlyBefore.body.result.phase,'enrollment');for(let i=0;i<4;i++)assert.deepEqual((await fixture.post('driver/next',{version:1,operationRef:fixture.operationAlias})).body,readonlyBefore.body);assert.equal(fixture.prep,0);simMark('readonly_driver_does_not_prepare_or_renew');
  const prepared=await fixture.prepare();assert.equal(fixture.prep,1);simMark('one_use_enrollment_focus_fresh_map_permit');
  simMark('distinct_native_UIA_DOM_document_runtime_domains_scoped_map_accepts_and_foreign_snapshot_challenge_launch_boot_epoch_clones_deny');
  assert.equal((await fixture.post('map',{...fixture.mapRequest,mapView:{...prepared.m,originalTaskRef:'task-foreign'}})).status,409);simMark('same_task_join_denies_foreign_id');
  const consumed=await fixture.consume();assert.equal((await fixture.post('consume',{permitRef:fixture.checkReply.body.result.permitRef})).status,409);assert.equal((await fixture.post('check',prepared.check)).status,409);simMark('consume_lost_ack_has_no_second_command');
  const inputReply=await fixture.post('input',{version:1,commandRef:fixture.command.commandRef,approvedInputRef:fixture.command.approvedInputRef});assert.equal(inputReply.status,200);assert.equal(inputReply.body.result.kind,'replace-field');assert.equal(inputReply.body.result.expectedPrimaryEventCount,fixture.expected);assert.deepEqual((await fixture.post('input',{version:1,commandRef:fixture.command.commandRef,approvedInputRef:fixture.command.approvedInputRef})).body,inputReply.body);simMark('original_private_input_repeat_no_renew');
  assert.equal((await fixture.post('input/arm',{version:1,commandRef:fixture.command.commandRef,approvedInputRef:fixture.command.approvedInputRef})).status,503);simMark('replacement_command_never_arms_return');
  const l={...ledger,backendBootRef:prepared.m.backendBootRef,nativeBootRef:prepared.m.nativeBootRef,challengeRef:consumed.body.result.dispatchChallengeRef,ledgerRef:ref(),permitRef:fixture.command.permitRef,operationRef:fixture.operationAlias,actionBatchRef:fixture.command.actionBatchRef,processLaunchRef:prepared.m.processLaunchRef,kernelIdentityRef:prepared.m.kernelIdentityRef,viewportMapRef:prepared.m.mapRef,nativeSessionRef:prepared.m.nativeSessionRef,nativeSessionGeneration:prepared.m.nativeSessionGeneration,localConsentRef:prepared.m.localConsentRef,reservationRef:prepared.m.reservationRef,reservationGeneration:prepared.m.reservationGeneration,nativeStopEpoch:prepared.m.nativeStopEpoch,requestedEventCount:fixture.expected,sentEventCount:fixture.expected,claimedAtMs:Date.now(),completedAtMs:Date.now()};
  const dispatch={challengeRef:l.challengeRef,permitRef:l.permitRef,ledgerRef:l.ledgerRef,ledgerView:l},reply=await fixture.post('dispatch',dispatch);assert.equal(reply.status,200);assert.equal(reply.body.result.safeStatus.status,'unknown');assert.equal(reply.body.result.safeStatus.sentEventCount,fixture.expected);assert.deepEqual((await fixture.post('dispatch',dispatch)).body,reply.body);assert.equal((await fixture.post('dispatch',{...dispatch,ledgerView:{...l,sentEventCount:fixture.expected-1,result:'partial'}})).status,409);simMark('immutable_counted_history_same_ack_changed_upload_denied');
  assert.equal((await fixture.post('verify',{permitRef:l.permitRef,dispatchRef:reply.body.result.dispatchRef})).status,503);assert.equal(fixture.authority.inspectIssuedDispatch({} as N.DispatchRef,{attempt:{} as N.AttemptRef,batch:{} as N.PlannedNativeBatchRef,snapshot:{} as N.SnapshotRef,sourceEpochDigest:d}),undefined);simMark('simulated_native_sent_never_proof_or_pass');
 }finally{await fixture.close();}
}
{
 const fixture=await simulatedPortsFixture();try{
  const prepared=await fixture.prepare(),consumed=await fixture.consume();fixture.setLost();
  const l={...ledger,backendBootRef:prepared.m.backendBootRef,nativeBootRef:prepared.m.nativeBootRef,challengeRef:consumed.body.result.dispatchChallengeRef,ledgerRef:ref(),permitRef:fixture.command.permitRef,operationRef:fixture.operationAlias,actionBatchRef:fixture.command.actionBatchRef,processLaunchRef:prepared.m.processLaunchRef,kernelIdentityRef:prepared.m.kernelIdentityRef,viewportMapRef:prepared.m.mapRef,nativeSessionRef:prepared.m.nativeSessionRef,nativeSessionGeneration:prepared.m.nativeSessionGeneration,localConsentRef:prepared.m.localConsentRef,reservationRef:prepared.m.reservationRef,reservationGeneration:prepared.m.reservationGeneration,nativeStopEpoch:prepared.m.nativeStopEpoch,requestedEventCount:fixture.expected,sentEventCount:fixture.expected-1,result:'partial',claimedAtMs:Date.now(),completedAtMs:Date.now()};
  const reply=await fixture.post('dispatch',{challengeRef:l.challengeRef,permitRef:l.permitRef,ledgerRef:l.ledgerRef,ledgerView:l});assert.equal(reply.status,200);assert.equal(reply.body.result.safeStatus.sentEventCount,fixture.expected-1);assert.equal(reply.body.result.safeStatus.possibleEffect,true);assert.equal(reply.body.result.safeStatus.status,'unknown');assert.equal((await fixture.post('consume',{permitRef:l.permitRef})).status,409);simMark('late_source_owner_task_loss_retains_short_counts_before_denial');
 }finally{await fixture.close();}
}
{
 const fixture=await simulatedPortsFixture();try{await fixture.enroll();fixture.setLost();const bad=await fixture.post('source',{version:1,phase:'enrollment_recheck',enrollmentSourceRef:fixture.sourceReply.enrollmentSourceRef,enrollmentChallengeRef:fixture.sourceReply.enrollmentChallengeRef});assert.equal(bad.status,409);assert.equal(fixture.prep,0);simMark('recheck_source_loss_never_associates_or_maps');}finally{await fixture.close();}
}
for(const delta of [-120,120]){
 const fixture=await simulatedPortsFixture('scroll',delta);try{
  await fixture.prepare();const consumeReply=await fixture.consume();assert.equal(consumeReply.status,200);const consumed=consumeReply.body.result.command,resolved=await fixture.post('input',{version:1,commandRef:consumed.commandRef,approvedInputRef:consumed.approvedInputRef});
  assert.equal(resolved.status,200);assert.equal(resolved.body.result.kind,'scroll-profile-wheel');assert.equal(resolved.body.result.direction,delta<0?'up':'down');assert.equal(resolved.body.result.wheelDelta,delta);assert.equal(resolved.body.result.expectedPrimaryEventCount,1);
  assert.deepEqual((await fixture.post('input',{version:1,commandRef:consumed.commandRef,approvedInputRef:consumed.approvedInputRef})).body,resolved.body);
  assert.equal((await fixture.post('input',{version:1,commandRef:consumed.commandRef,approvedInputRef:consumed.approvedInputRef,wheelDelta:-delta})).status,400);
  assert.equal((await fixture.post('consume',{permitRef:fixture.checkReply.body.result.permitRef})).status,409);
  assert.equal((await fixture.post('input/arm',{version:1,commandRef:consumed.commandRef,approvedInputRef:consumed.approvedInputRef})).status,503);
  assert.equal(fixture.authority.supportsStrategy('scroll'),false);simMark('original_fixed_sign_wheel_'+delta+'_immutable_one_event_no_replay_no_body_override_no_physical_strategy');
 }finally{await fixture.close();}
}

async function actualProducerSourceIntegration(){
  const workflowModule=await import('../src/edith/browserWorkflowService');
  const service=workflowModule.browserWorkflowService;
  const {getBrowserOperatorAdapter,setBrowserOperatorTestOptions}=await import('../src/edith/browserOperatorAdapter');
  const {createOwnerSessionRouter,requireProtectedMutation,getOwnerSession}=await import('../server/security/ownerSession');
  const {createPermissionsRouter}=await import('../server/routes/permissions');
  const {taskService}=await import('../src/edith/taskService');
  const {killSwitchService}=await import('../src/edith/killSwitch');
  const fixtureServer=createServer((req,res)=>{if(req.url!=='/fixture'){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body><form method="get" action="/fixture"><label for="q">Fixture field</label><input id="q" type="search" name="q" value="old"></form></body></html>');});
  await new Promise<void>(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(fixtureServer.address() as any).port;
  const authority=new BrowserNativeAuthority();
  process.env.EDITH_OWNER_TOKEN=ref();process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
  let actor='',attempt:N.AttemptRef|undefined,cookie='',csrf='',ticket:any,sessionId='',pageId='';
  let fixtureGrantId:string|undefined;
  await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:()=>origin+'/fixture'});const adapter=getBrowserOperatorAdapter();
  authority.bindSources({producer:service,engine:adapter.nativeSources});service.configureNativeAuthority(authority);
  const app=express();app.use(express.json());app.use(nativeBrowserBodyErrorHandler);app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createComputerUseRouter({nativeBrowserAuthority:authority}));
  app.post('/own/native-original',...requireProtectedMutation,(req,res)=>{try{const owner=service.captureOwner(req),retained=service.retainNativeWorkflowRequest(req,owner);attempt=service.openNativeOriginal(owner,retained);ticket=service.startNativeOriginal(attempt);res.status(202).json(ticket);}catch{res.status(400).json({success:false});}});
  app.post('/own/dom-page',...requireProtectedMutation,async(req,res)=>{actor=getOwnerSession(req)!.bindingId;const result=await service.run({action:'navigate',url:origin+'/fixture',verificationGoal:'Observe own local fixture'},actor);res.json(result);});
  const apiServer=createServer(app);await new Promise<void>(resolve=>apiServer.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+(apiServer.address() as any).port;
  const privatePost=async(action:string,body:any)=>{const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  const ownerPost=async(url:string,body:any)=>{const response=await fetch(base+url,{method:'POST',headers:{origin:base,cookie,'x-edith-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  try{
   // Registered executors use the actual singleton's attempt/AsyncLocalStorage maps.
   // Reuse that producer and issuer; kill is last because it closes the actual adapter.
   for(const scenario of ['healthy','native_boot','computer_permission','source_successor','expiry','kill'] as const){
    try{
    const login=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(login.status,201);cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json() as any).session.csrfToken;
    const grant=await ownerPost('/api/edith/permissions/grants',{permissions:['network:read','browser:control','computer:control'],toolIds:['browser_workflow','browser_open','browser_search','playwright_browser_agent','computer_action'],ttlMs:600000,reason:'Isolated source and authority integration; no native effects'});assert.equal(grant.status,200);
    fixtureGrantId=grant.body.grant.id;
    const navigation=await ownerPost('/own/dom-page',{});if(navigation.body.success!==true)console.error(JSON.stringify({scenario,actualDomSetupFailure:navigation}));assert.equal(navigation.body.success,true);assert.equal(navigation.body.structuredOutput.browser.nativePhysicalProof,false);sessionId=navigation.body.structuredOutput.browser.sessionId;pageId=navigation.body.structuredOutput.browser.pageId;
    const bootReply=await privatePost('boot',{version:1,nativeBootNonce:ref()});assert.equal(bootReply.status,200);
    const count=taskService.listTasks().length,admission=await ownerPost('/own/native-original',{action:'search',query:'Bounded field',verificationGoal:'Observe exact own field'});assert.equal(admission.status,202);assert.equal(taskService.listTasks().length,count+1);assert.equal(taskService.getTask(ticket.taskId)!.status,'RUNNING');
    const enrollment=await privatePost('source',{version:1,phase:'enrollment',attemptRef:ticket.attemptLookupRef});assert.equal(enrollment.status,200);const v=enrollment.body.result;assert.equal(v.originalTaskRef,ticket.taskId);assert.equal(v.backendBootRef,bootReply.body.result.backendBootRef);assert.deepEqual((await privatePost('source',{version:1,phase:'enrollment',attemptRef:ticket.attemptLookupRef})).body,enrollment.body);
    const recheck=await privatePost('source',{version:1,phase:'enrollment_recheck',enrollmentSourceRef:v.enrollmentSourceRef,enrollmentChallengeRef:v.enrollmentChallengeRef});assert.equal(recheck.status,200);
    const c={...consent,...v,enrollmentRecheckRef:recheck.body.result.enrollmentRecheckRef,consentRef:ref(),nativeSessionRef:ref(),reservationRef:ref(),confirmationRef:ref(),approvedAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+25000,v.operationDeadlineMs),localSessionExpiresAtMs:v.operationDeadlineMs,reservationExpiresAtMs:v.operationDeadlineMs};delete c.confirmationDescription;delete c.issuedAtMs;delete c.operationDeadlineMs;
    const associated=await privatePost('associate',{version:1,attemptRef:v.attemptRef,nativeSessionRef:c.nativeSessionRef,enrollmentSourceRef:c.enrollmentSourceRef,enrollmentChallengeRef:c.enrollmentChallengeRef,enrollmentRecheckRef:c.enrollmentRecheckRef,consentView:c});assert.equal(associated.status,200);
    const b=associated.body.result,focusReply=await privatePost('focus/source',{version:1,operationRef:v.operationRef,bindingRef:b.bindingRef});assert.equal(focusReply.status,200);const f=focusReply.body.result;
    const bound=await privatePost('source',{bindingRef:b.bindingRef});assert.equal(bound.status,200);assert.equal(bound.body.result.target,null);assert.equal(bound.body.result.launch.childProcessAlive,true);assert(bound.body.result.launch.pid>0);assert.equal(bound.body.result.launch.executableSha256.length,64);assert.equal(bound.body.result.inventory.complete,true);assert.equal(bound.body.result.inventory.pageCount,1);assert.equal(bound.body.result.budget.primaryEventCount,10+2*'Bounded field'.length);
    mark('actual_producer_original_owner_task_source_boot_and_held_launch_join','ACTUAL_OWNER_HTTP_ISSUER_OWN_HEADED_DOM_SIMULATED_NATIVE_ONLY');
    const fr={...focus,focusActionRef:ref(),sourceEpochDigest:v.sourceEpochDigest,nativeBootRef:v.nativeBootRef,nativeSessionRef:c.nativeSessionRef,reservationRef:c.reservationRef,originalRootWindowRef:f.originalRootWindowRef,measuredBeforeAtMs:Date.now(),measuredAfterAtMs:Date.now(),expiresAtMs:f.expiresAtMs};
    const focused=await privatePost('focus/record',{version:1,operationRef:v.operationRef,bindingRef:b.bindingRef,focusSourceRef:f.focusSourceRef,focusRecord:fr});assert.equal(focused.status,200);assert.equal(focused.body.result.outcome,'focused');
    const measured=await privatePost('source',{bindingRef:b.bindingRef});assert.equal(measured.status,200);assert(measured.body.result.target);assert.equal(measured.body.result.target.engineTargetIdentityDigest.length,64);assert.equal(measured.body.result.target.isolatedHitProofDigest.length,64);assert.notEqual(measured.body.result.snapshotRef,null);assert.equal(taskService.listTasks().length,count+1);
    mark('actual_source_fresh_snapshot_isolated_target_hit_descriptor_no_native_proof','ACTUAL_OWNER_HTTP_ISSUER_OWN_HEADED_DOM_SIMULATED_FOCUS_ONLY');
    const bs=measured.body.result,nativeDocument=ref();assert.notEqual(nativeDocument,bs.target.logicalDocumentRef);
    const domainMap={...map,backendBootRef:bs.backendBootRef,nativeBootRef:bs.nativeBootRef,challengeRef:bs.mapChallengeRef,mapRef:ref(),originalTaskRef:bs.originalTaskRef,operationRef:bs.operationRef,actionBatchRef:bs.batchRef,snapshotRef:bs.snapshotRef,processLaunchRef:bs.launch.processLaunchRef,executableFingerprint:bs.launch.executableSha256,logicalDocumentRef:nativeDocument,logicalRuntimeIdDigest:'b'.repeat(64),sourceEpochDigest:bs.sourceEpochDigest,nativeSessionRef:c.nativeSessionRef,nativeSessionGeneration:c.computerSessionGeneration,localConsentRef:c.consentRef,reservationRef:c.reservationRef,reservationGeneration:c.reservationGeneration,nativeStopEpoch:c.nativeStopEpoch,measuredAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+800,bs.expiresAtMs)};
    for(const key of ['snapshotRef','challengeRef','processLaunchRef','nativeBootRef'] as const){const bad={...domainMap,[key]:ref()};assert.equal((await privatePost('map',{challengeRef:bad.challengeRef,mapRef:bad.mapRef,mapView:bad})).status,409);}
    const accepted=await privatePost('map',{challengeRef:domainMap.challengeRef,mapRef:domainMap.mapRef,mapView:domainMap});assert.equal(accepted.status,200);assert.equal(accepted.body.result.mapRef,domainMap.mapRef);
    mark('actual_source_issued_snapshot_target_launch_distinct_native_DOM_document_domains_accept_wrong_scope_denies','ACTUAL_OWNER_HTTP_ISSUER_OWN_HEADED_DOM_SIMULATED_NATIVE_MAP_ONLY');
    const checked=await privatePost('check',{bindingRef:b.bindingRef,snapshotRef:bs.snapshotRef,mapRef:domainMap.mapRef});assert.equal(checked.status,200);
    const consumed=await privatePost('consume',{permitRef:checked.body.result.permitRef});assert.equal(consumed.status,200);const commandView=consumed.body.result.command;
    // Read only capabilities actually issued by this fixture's authority; never construct
    // a source, command or batch capability from its public descriptor.
    const issuedLookup=authority as unknown as {lookup<T>(wire:unknown,kind:string):T};
    const command=issuedLookup.lookup<N.BackendConsumedCommandRef>(commandView.commandRef,'command');
    const batch=issuedLookup.lookup<{cap:N.PlannedNativeBatchRef}>(bs.batchRef,'batch').cap;
    authority.assertIssuedObservedCommand({attempt:attempt!,batch,command});
    for(const foreign of [{attempt:{...attempt!} as N.AttemptRef,batch,command},{attempt:attempt!,batch:{...batch} as N.PlannedNativeBatchRef,command},{attempt:attempt!,batch,command:{...command} as N.BackendConsumedCommandRef}])assert.throws(()=>authority.assertIssuedObservedCommand(foreign));
    mark('actual_consumed_command_membership_accepts_only_original_issued_attempt_batch_command','ACTUAL_ISSUED_CAPABILITIES_SIMULATED_NATIVE_MAP_NO_INPUT');
    const bounded=await privatePost('source',{bindingRef:b.bindingRef});assert.equal(bounded.status,200);assert(bounded.body.result.target);assert(bounded.body.result.expiresAtMs<=checked.body.result.expiresAtMs);assert(bounded.body.result.expiresAtMs<=domainMap.expiresAtMs);
    const reread=await privatePost('source',{bindingRef:b.bindingRef});assert.equal(reread.status,200);assert(reread.body.result.expiresAtMs<=checked.body.result.expiresAtMs);
    assert.equal((await privatePost('input/arm',{version:1,commandRef:commandView.commandRef,approvedInputRef:commandView.approvedInputRef})).status,503);
    assert.equal((await privatePost('consume',{permitRef:checked.body.result.permitRef})).status,409);
    mark('consumed_source_descriptor_and_reread_do_not_extend_permit_or_map_deadline_and_replacement_cannot_arm_Return','ACTUAL_ISSUED_CAPABILITIES_SIMULATED_NATIVE_MAP_NO_INPUT');
    if(scenario!=='healthy'){
      // Actual issuer/source/consume boundary only. Native consent/focus/map facts
      // above remain SIM; no measured dispatch/pair or canonical writer is fabricated.
      const issuedScope={attempt:attempt!,batch,command};
      authority.assertIssuedObservedCommand(issuedScope);
      if(scenario==='native_boot'){
        const changed=await privatePost('boot',{version:1,nativeBootNonce:ref()});assert.equal(changed.status,200);assert.notEqual(changed.body.result.nativeBootRef,bootReply.body.result.nativeBootRef);
      }else if(scenario==='computer_permission'){
        const revoked=await fetch(base+'/api/edith/permissions/grants/'+grant.body.grant.id,{method:'DELETE',headers:{origin:base,cookie,'x-edith-csrf-token':csrf}});assert.equal(revoked.status,200);assert.ok((await revoked.json() as any).grant.revokedAt);
      }else if(scenario==='kill'){
        killSwitchService.activate('SIM native publication issuer boundary fixture','fixture');assert.equal(killSwitchService.status().active,true);
      }else if(scenario==='source_successor'){
        const originalSource=service.inspectNativeOperationState(attempt!).source;assert(originalSource);const held=adapter.nativeSources.inspectHeldSource(originalSource);
        // Actual owned document replacement, not an approved causal successor or
        // genuine native navigation. The original command must not adopt it.
        await held.launch.page.goto('about:blank',{waitUntil:'domcontentloaded'});assert.equal(held.launch.page.url(),'about:blank');
      }
      if(scenario==='expiry')await new Promise(resolve=>setTimeout(resolve,Math.max(0,commandView.expiresAtMs-Date.now()+5)));
        assert.throws(()=>authority.assertIssuedObservedCommand(issuedScope),'Original consumed command loses current scope: '+scenario);
        const invalidatedSource=await privatePost('source',{bindingRef:b.bindingRef});
        if(scenario==='expiry'&&invalidatedSource.status===200){
          assert(invalidatedSource.body.result.expiresAtMs<=commandView.expiresAtMs);assert(invalidatedSource.body.result.expiresAtMs<=Date.now(),'Expired descriptive source cannot renew command authority');
        }else assert.equal(invalidatedSource.status,409);
        assert.equal((await privatePost('consume',{permitRef:checked.body.result.permitRef})).status,409);
        assert.equal((await privatePost('input/arm',{version:1,commandRef:commandView.commandRef,approvedInputRef:commandView.approvedInputRef})).status,409);
      if(scenario==='kill')killSwitchService.deactivate('fixture');
      assert.throws(()=>authority.assertIssuedObservedCommand(issuedScope),'Original command cannot revive after invalidation/deadline');
      await new Promise(resolve=>setTimeout(resolve,80));const actualTask=taskService.getTask(ticket.taskId)!;assert.notEqual(actualTask.status,'COMPLETED');assert.notEqual(actualTask.verification?.status,'PASS');
      mark('post_consume_'+scenario+'_original_command_source_replay_and_arm_denied_no_canonical_PASS','ACTUAL_OWNER_HTTP_ISSUER_SOURCE_CONSUME_SIM_NATIVE_FACTS_NO_DISPATCH_OR_PAIR');continue;
    }
    const cancelled=await privatePost('cancel',{bindingRef:b.bindingRef,reason:'explicit_revoke'});assert.equal(cancelled.status,200);assert.equal(cancelled.body.result.safeStatus.possibleEffect,true);
    await new Promise(resolve=>setTimeout(resolve,80));assert.notEqual(taskService.getTask(ticket.taskId)!.status,'COMPLETED');assert.notEqual(taskService.getTask(ticket.taskId)!.verification?.status,'PASS');assert.equal((await privatePost('source',{bindingRef:b.bindingRef})).status,409);mark('actual_original_native_task_simulated_records_cannot_pass_or_replay','ACTUAL_OWNER_HTTP_ISSUER_OWN_HEADED_DOM_SIMULATED_NATIVE_ONLY');
    }finally{
      if(scenario==='kill'&&killSwitchService.status().active)killSwitchService.deactivate('fixture');
      if(fixtureGrantId)await fetch(base+'/api/edith/permissions/grants/'+fixtureGrantId,{method:'DELETE',headers:{origin:base,cookie,'x-edith-csrf-token':csrf}});
      fixtureGrantId=undefined;
      if(sessionId&&actor)try{await adapter.closeSession(sessionId,actor);}catch{}
    }
   }
  }finally{
    await adapter.closeAll();await new Promise<void>(resolve=>{apiServer.closeAllConnections();apiServer.close(()=>resolve());});await new Promise<void>(resolve=>{fixtureServer.closeAllConnections();fixtureServer.close(()=>resolve());});
  }
}
if(process.env.W5_NATIVE_AUTHORITY_PROTOCOL_ONLY!=='true')await actualProducerSourceIntegration();
const report={passed:true,rows,checks:rows.length,serversClosed:true,physicalNativeActions:0,nativePhysicalProofIssued:0,taskPassIssued:0,simulatedPositiveNativeEvidence:0,sourceIntegration:process.env.W5_NATIVE_AUTHORITY_PROTOCOL_ONLY==='true'?'NOT_RUN_SOURCE_COUNTERPART_ACTIVE':'ACTUAL_PRODUCER_OWN_HEADED_DOM_WITH_SIMULATED_NATIVE_TRANSFERS_ONLY_SOURCE_HASH_SNAPSHOTS_REQUIRED'};
Object.assign(report,{postConsumeActualIssuerBoundaryCases:rows.filter(row=>row.scenario.startsWith('post_consume_')).length,nativeFacts:'SIM_CONSENT_FOCUS_MAP_ONLY',genuineControllerAcceptance:'NOT_RUN',genuineMeasuredDispatchCount:0,genuineAggregatePairConsumed:0,canonicalPublicationAttempted:0,sourceSuccessorCoverage:'ACTUAL_OWNED_DOCUMENT_REPLACEMENT_DENIES_ORIGINAL_COMMAND;_APPROVED_NATIVE_CAUSAL_SUCCESSOR_NOT_RUN'});
const out=process.env.W5_HTTP_REPORT_DIR;assert(out);fs.writeFileSync(path.join(out,'authority-runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:rows.length,nativePhysicalProofIssued:0,serversClosed:true}));
