import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {normalizeNativeSourceChunk,CrossDeviceDesktopBridge,NATIVE_SOURCE_CHUNK_BYTES,validateNativeProducerIntent} from '../src/edith/crossDeviceDesktopBridge';
import {parseOutboundChunk,NATIVE_CHUNK_BYTES,parseReceiverPinRegistration,parseTransferChunkRead,parseReceiverCommit} from '../server/mobile/nativeProducerContract';
import fs,{readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {CrossDeviceLiveViewSessionV2} from '../src/edith/contracts';
import {sendFile,parseFileSendResult,actOnFile} from '../src/edith/filesClient';
import {clearOwnerSessionMemory} from '../src/edith/ownerMutationClient';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
let checks=0;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.alloc(NATIVE_SOURCE_CHUNK_BYTES,0x41), sourceSha=sha(bytes);
const expected={sourceHandle:'native-held-source',chunkIndex:0,offsetBytes:0,maximumBytes:NATIVE_SOURCE_CHUNK_BYTES,expectedSourceSha256:sourceSha,expectedChunkSha256:sourceSha,expectedSizeBytes:bytes.length};
const raw={sourceHandle:expected.sourceHandle,chunkIndex:0,offsetBytes:0,chunkBytes:bytes.length,bytesTransferred:bytes.length,totalBytes:bytes.length,percent:100,chunkSha256:sourceSha,fileSha256:sourceSha,bytesBase64:bytes.toString('base64'),completed:true};
const normalized=await normalizeNativeSourceChunk(raw,expected);
assert.equal(normalized.bytesRead,NATIVE_CHUNK_BYTES);assert.equal(normalized.nextOffsetBytes,bytes.length);checks+=2;
const lineage={contractVersion:2 as const,amendment:'2.1' as const,ownerSessionBindingId:'owner',workspaceId:'space',sessionId:'session',sourceDeviceId:'desktop',targetDeviceId:'mobile'};
// R4 consumer fixtures: synthetic transport/native responses; no physical delivery claim.
const sendFileId='f'.repeat(64);
const sendManifest={contractVersion:2 as const,amendment:'2.1' as const,transferId:'send-transfer',sizeBytes:bytes.length,chunkSizeBytes:53248,totalChunks:1,fileSha256:sourceSha,chunks:[{index:0,offsetBytes:0,sizeBytes:bytes.length,sha256:sourceSha}]};
const sendDescriptor={contractVersion:2 as const,amendment:'2.1' as const,transferId:'send-transfer',fileName:'fixture.txt',mediaType:'text/plain',sizeBytes:bytes.length,sha256:sourceSha,direction:'download' as const,status:'transferring' as const,sourceDeviceId:'desktop',targetDeviceId:'mobile',chunkManifest:sendManifest,encryption:{contractVersion:2 as const,amendment:'2.1' as const,algorithm:'AES-256-GCM' as const,keyId:'session',keyFingerprint:'c'.repeat(64),nonceStrategy:'per_chunk_random' as const,authenticated:true as const,aadContext:'mobile-transfer:send-transfer:mobile'},resume:{contractVersion:2 as const,amendment:'2.1' as const,resumable:true,nextChunkIndex:0,completedChunkIndexes:[],retryCount:0,maxRetries:5,acknowledgedBytes:0,resumeCheckpointId:'initial-checkpoint'}};
const acceptedSend={success:true,fileId:sendFileId,transferId:sendDescriptor.transferId,descriptor:sendDescriptor,completed:false};
assert.equal(parseFileSendResult(acceptedSend,sendFileId,'mobile').completed,false);checks++;
for(const bad of [{...acceptedSend,fileId:'e'.repeat(64)},{...acceptedSend,completed:true},{...acceptedSend,transferId:'other'},{...acceptedSend,unexpected:true},{...acceptedSend,descriptor:{...sendDescriptor,targetDeviceId:'foreign'}},{...acceptedSend,descriptor:{...sendDescriptor,direction:'upload'}},{...acceptedSend,descriptor:{...sendDescriptor,sizeBytes:0}},{...acceptedSend,descriptor:{...sendDescriptor,chunkManifest:{...sendManifest,totalChunks:2}}}]) {assert.throws(()=>parseFileSendResult(bad,sendFileId,'mobile'));checks++;}
const previousFetch=globalThis.fetch, previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
let sendPosts=0;
try {
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{origin:'http://127.0.0.1'}}});clearOwnerSessionMemory();
 globalThis.fetch=async(input,init)=>{
   if(String(input)==='/api/security/session')return new Response(JSON.stringify({session:{csrfToken:'synthetic-only'}}));
   assert.equal(String(input),`/api/files/${sendFileId}/send`);assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{deviceId:'mobile'});
   const headers=new Headers(init?.headers);assert.equal(headers.get('x-idempotency-key'),'same-request-key');assert.equal(headers.get('X-EDITH-CSRF-Token'),'synthetic-only');assert.equal(init?.credentials,'include');sendPosts++;
   return new Response(JSON.stringify(acceptedSend),{status:202});
 };
 assert.equal((await sendFile(sendFileId,{deviceId:'mobile',idempotencyKey:'same-request-key'})).transferId,'send-transfer');checks++;
 await assert.rejects(sendFile(sendFileId,{deviceId:'',idempotencyKey:'same-request-key'}));
 await assert.rejects(actOnFile(sendFileId,'send'));
 const localAbort=new AbortController();localAbort.abort();await assert.rejects(sendFile(sendFileId,{deviceId:'mobile',idempotencyKey:'same-request-key',signal:localAbort.signal}));assert.equal(sendPosts,1);checks+=4;
} finally {globalThis.fetch=previousFetch;clearOwnerSessionMemory();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete (globalThis as any).window;}
const sendNow=Date.now(),sendExpiry=new Date(sendNow+60000).toISOString();
const sendOps:string[]=[];let checkpointPatch:Record<string,unknown>={},nativeSendAvailable=true;
const manifestCanonical=(v:any):string=>Array.isArray(v)?`[${v.map(manifestCanonical).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${manifestCanonical(x)}`).join(',')}}`:JSON.stringify(v);
const checkpointBase={schema:'edith.native-mobile/1',transferId:'send-transfer',manifestDigest:sha(Buffer.from(manifestCanonical(sendManifest))),checkpointId:'actual-checkpoint',completedChunkIndexes:[],acknowledgedBytes:0,nextChunkIndex:0,expiresAt:sendExpiry,status:'transferring'};
const sendFetcher=async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/kill-switch')?{state:{active:false}}:String(input).endsWith('/desktop-producer/status')?{success:true,data:{configured:true}}:String(input).endsWith('/devices')?{success:true,data:{devices:[{device:{deviceId:'first-device'},trust:{status:'trusted'},ownerBinding:{workspaceId:'space',ownerSessionId:'owner',expiresAt:sendExpiry}},{device:{deviceId:'mobile'},trust:{status:'trusted'},ownerBinding:{workspaceId:'space',ownerSessionId:'owner',expiresAt:sendExpiry}}]}}:{success:true,data:{}}));
const sendBridge=new CrossDeviceDesktopBridge({now:()=>sendNow,tauriAvailable:()=>true,fetcher:sendFetcher,ownerFetch:sendFetcher,ownerSession:async()=>({csrfToken:'synthetic-only'}),invoke:async<T>(command:string,args?:Record<string,unknown>)=>{
 if(command==='cross_device_native_status')return {pcToMobileTransfer:nativeSendAvailable?'available':'unavailable',controlPlaneConnected:nativeSendAvailable} as T;
 const request=args?.request as Record<string,unknown>;sendOps.push(String(request.operation));
 if(request.operation==='bootstrap'){assert.equal(request.deviceId,'mobile');return {status:201,body:{success:true,data:{session:{...lineage,expiresAt:sendExpiry}}}} as T;}
 assert.deepEqual(request,{operation:'transfer_checkpoint',transferId:'send-transfer'});return {status:200,body:{success:true,data:{...checkpointBase,...checkpointPatch}}} as T;
}});
await sendBridge.refreshFileSendCandidates();assert.deepEqual(sendOps,[]);checks++;
const preparedSend=await sendBridge.prepareFileSendTarget('mobile');assert.deepEqual(sendOps,['bootstrap']);checks++;
nativeSendAvailable=false;await assert.rejects(sendBridge.recheckFileSendTarget(preparedSend));checks++;nativeSendAvailable=true;
assert.equal((await sendBridge.readFileSendCheckpoint(preparedSend,sendDescriptor)).durableReceiverCommit,false);checks++;
checkpointPatch={completedChunkIndexes:[0],acknowledgedBytes:bytes.length,nextChunkIndex:1};assert.equal((await sendBridge.readFileSendCheckpoint(preparedSend,sendDescriptor)).durableReceiverCommit,false);checks++;
checkpointPatch={...checkpointPatch,status:'completed'};assert.equal((await sendBridge.readFileSendCheckpoint(preparedSend,sendDescriptor)).durableReceiverCommit,true);checks++;
for(const patch of [{transferId:'foreign'},{manifestDigest:'e'.repeat(64)},{checkpointId:'../bad'},{acknowledgedBytes:1},{completedChunkIndexes:[0,0]},{nextChunkIndex:1},{status:'completed'},{expiresAt:new Date(sendNow-1).toISOString()},{expiresAt:new Date(sendNow+61000).toISOString()},{extra:'forged'}]) {checkpointPatch=patch;await assert.rejects(sendBridge.readFileSendCheckpoint(preparedSend,sendDescriptor));checks++;}
const beforeScopeClear=sendOps.length;await assert.rejects(sendBridge.readFileSendCheckpoint({...preparedSend},sendDescriptor));
sendBridge.clearFileSendTarget();await assert.rejects(sendBridge.readFileSendCheckpoint(preparedSend,sendDescriptor));assert.equal(sendOps.length,beforeScopeClear);assert.equal(sendOps.includes('cancel_transfer'),false);checks+=4;
const cardReference={cardId:'original-card',source:{type:'research' as const,id:'original-result'}};
const cardFixture={...lineage,cardId:'original-card',kind:'research',title:'Own result',summary:'Synthetic producer response',outcome:'partial',provenance:{sourceType:'research',sourceId:'original-result',observedAt:new Date(sendNow).toISOString(),verified:false},preview:{redacted:true},artifactRefs:[],actions:[],revision:1,createdAt:new Date(sendNow).toISOString(),updatedAt:new Date(sendNow).toISOString()};
let cardPatch:Record<string,unknown>={},cardStatus=201,cardSuccess=true;
const cardBridge=new CrossDeviceDesktopBridge({tauriAvailable:()=>false,fetcher:sendFetcher,ownerFetch:async()=>new Response(JSON.stringify({success:cardSuccess,data:{card:{...cardFixture,...cardPatch}}}),{status:cardStatus})});
assert.equal((await cardBridge.publishResultCard('mobile',cardReference)).shared.cardId,'original-card');checks++;
for(const patch of [{cardId:'foreign-card'},{targetDeviceId:'foreign-target'},{provenance:{...cardFixture.provenance,sourceType:'task'}},{provenance:{...cardFixture.provenance,sourceId:'foreign-result'}}]) {cardPatch=patch;await assert.rejects(cardBridge.publishResultCard('mobile',cardReference),/requested source and target/);checks++;}
cardPatch={};for(const status of [200,202]){cardStatus=status;await assert.rejects(cardBridge.publishResultCard('mobile',cardReference),/publication was rejected/);checks++;}
cardStatus=201;cardSuccess=false;await assert.rejects(cardBridge.publishResultCard('mobile',cardReference),/publication was rejected/);checks++;
const outbound={schema:'edith.native-mobile/1',lineage,transferId:'transfer',manifestDigest:'b'.repeat(64),checkpointId:'checkpoint',index:normalized.chunkIndex,offsetBytes:normalized.offsetBytes,sourceHandle:normalized.sourceHandle,sizeBytes:normalized.bytesRead,chunkSha256:normalized.chunkSha256,fileSha256:normalized.sourceSha256,bytesBase64:normalized.bytesBase64};
assert.equal(parseOutboundChunk(outbound).success,true);assert.ok(Buffer.byteLength(JSON.stringify(outbound))<=75000);checks+=2;
for(const patch of [{sourceHandle:'replaced'},{chunkIndex:1},{offsetBytes:1},{fileSha256:'c'.repeat(64)},{chunkSha256:'d'.repeat(64)},{chunkBytes:1},{completed:false},{percent:99},{bytesBase64:Buffer.alloc(bytes.length,0x42).toString('base64')},{bytesBase64:raw.bytesBase64+'\n'},{unexpected:'field'}]){
  await assert.rejects(normalizeNativeSourceChunk({...raw,...patch},expected));checks++;
}
assert.equal(parseOutboundChunk({...outbound,bytesBase64:Buffer.alloc(bytes.length,0x42).toString('base64')}).success,false);checks++;
const calls:string[]=[];
let release!:()=>void;
const stopPending=new Promise<void>(resolve=>{release=resolve;});
const bridge=new CrossDeviceDesktopBridge({tauriAvailable:()=>true,stopComputer:async()=>{calls.push('native_latch');await stopPending;return {nativeSessionId:null,originalGeneration:null,latchedGeneration:null,observedAt:null,state:'unknown'};},invoke:async(command)=>{calls.push(command);return undefined;},ownerFetch:async()=>new Response('{}')});
const stopping=bridge.emergencyStop();
assert.equal(calls[0],'native_latch');checks++;release();await stopping;
// Bootstrap suspended before invoke must fail after STOP, rather than mint a late local scope.
let resolveOwner!:(v:{csrfToken:string})=>void;
const owner=new Promise<{csrfToken:string}>(r=>{resolveOwner=r;});
const status={runtime:'windows',pcToMobileTransfer:'available',mobileToPcInbox:'available',liveView:'available',pcStatus:'available',controlPlaneConnected:true};
const fetcher=async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).endsWith('/kill-switch')?{state:{active:false}}:String(input).endsWith('/desktop-producer/status')?{success:true,data:{configured:true}}:{success:true,data:{devices:[]}}));
const lateCalls:string[]=[];
const late=new CrossDeviceDesktopBridge({tauriAvailable:()=>true,fetcher,ownerFetch:fetcher,ownerSession:()=>owner,stopComputer:async()=>({nativeSessionId:null,originalGeneration:null,latchedGeneration:null,observedAt:null,state:'unknown'}),invoke:async<T>(command:string)=>{lateCalls.push(command);return status as T;}});
const opening=late.openProducerSession('mobile');
await new Promise(r=>setTimeout(r,0));
await late.emergencyStop();resolveOwner({csrfToken:'fixture-only'});
await assert.rejects(opening,/Native scope was revoked/);assert.equal(lateCalls.includes('cross_device_producer_ingest'),false);checks+=2;
await assert.rejects(late.startLiveView('mobile'),/Select an observed native window/);checks++;
const now=Date.now(), expiresAt=new Date(now+60_000).toISOString();
const reverse={...lineage,sourceDeviceId:'mobile',targetDeviceId:'desktop'};
const session:CrossDeviceLiveViewSessionV2={...reverse,liveViewId:'live',expiresAt,status:'approved',ownerApproved:true,continuousAutoStream:false,controlAuthority:false,framePolicy:{maxFramesPerSecond:2,maxWidth:1280,maxHeight:720},overlayCapabilities:{cursor:true,click:false,target:false,operatorState:true}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
const metadata={...reverse,liveViewId:'live',frameId:'frame',sequence:1,observedAt:new Date(now).toISOString(),width:1,height:1,operatorState:'observing',containsPixels:false};
const operations:string[]=[];
const liveFetcher=async(input:RequestInfo|URL)=>{
 const u=String(input);return new Response(JSON.stringify(u.endsWith('/kill-switch')?{state:{active:false}}:u.endsWith('/desktop-producer/status')?{success:true,data:{configured:true}}:u.endsWith('/request')||u.endsWith('/approve')||u.endsWith('/stop')?{success:true,data:{liveView:session}}:{success:true,data:{devices:[]}}));
};
const live=new CrossDeviceDesktopBridge({now:()=>now,tauriAvailable:()=>true,fetcher:liveFetcher,ownerFetch:liveFetcher,ownerSession:async()=>({csrfToken:'fixture-only'}),stopComputer:async()=>({nativeSessionId:null,originalGeneration:null,latchedGeneration:null,observedAt:null,state:'unknown'}),invoke:async<T>(command:string,args?:Record<string,unknown>)=>{
 if(command==='cross_device_native_status')return {...status,nativeCaptureAdapter:'available'} as T;
 if(command==='cross_device_live_view_start')return session as T;
 if(command==='cross_device_live_view_frame')return {metadata,frameRef:'native-frame-ref',transport:{mimeType:'image/png',sizeBytes:png.length,sha256:sha(png),bytesBase64:png.toString('base64')}} as T;
 if(command==='cross_device_producer_ingest'){
   const r=args!.request as Record<string,unknown>;operations.push(String(r.operation));
   if(r.operation==='bootstrap')return {status:201,body:{success:true,data:{session:{...lineage,expiresAt}}}} as T;
   const nativeControl={schema:'edith.native-mobile/1',lineage,transferId:'transfer',manifestDigest:'b'.repeat(64),checkpointId:'checkpoint'};
   if(r.operation==='register_receiver') {
     assert.deepEqual(r,{operation:'register_receiver',transferId:'transfer',manifestDigest:'b'.repeat(64),checkpointId:'checkpoint'});
     assert.equal(parseReceiverPinRegistration({...nativeControl,destinationHandle:'native-owned-destination',receiverGeneration:1,expiresAt}).success,true);checks+=2;
     return {status:201,body:{success:true,data:{checkpoint:{status:'transferring'}}}} as T;
   }
   if(r.operation==='receive_chunk') {
     assert.deepEqual(r,{operation:'receive_chunk',transferId:'transfer',index:0});
     assert.equal(parseTransferChunkRead({...nativeControl,index:0,offsetBytes:0}).success,true);checks+=2;
     return {status:202,body:{success:true,data:{checkpoint:{status:'transferring'}}}} as T;
   }
   if(r.operation==='commit_receiver') {
     assert.deepEqual(r,{operation:'commit_receiver',transferId:'transfer'});
     assert.equal(parseReceiverCommit({...nativeControl,sizeBytes:bytes.length,sha256:sourceSha,destinationHandle:'native-owned-destination',commitId:'native-generated-commit',committedAt:new Date(now).toISOString()}).success,true);checks+=2;
     return {status:200,body:{success:true,data:{checkpoint:{status:'completed'}}}} as T;
   }
   assert.deepEqual(r,{operation:'publish_frame',liveViewId:'live',frameRef:'native-frame-ref'});checks++;
   return {status:202,body:{success:true,data:{frameId:'frame',sequence:1,expiresAt:new Date(now+2000).toISOString()}}} as T;
 }return undefined;
}});
await live.startLiveView('mobile',{observationId:'actual-observed-fixture',observationGeneration:1,publicRegion:[0,0,10,10],exclusions:[],leaseGeneration:1});
const delivered=await live.pullLiveViewFrame();assert.equal(delivered.frameRef,'native-frame-ref');assert.equal(live.liveViewVerifiedByBackend,true);assert.deepEqual(operations,['bootstrap','publish_frame']);checks+=3;
const intents=[{operation:'register_receiver',transferId:'transfer',manifestDigest:'b'.repeat(64),checkpointId:'checkpoint'},{operation:'receive_chunk',transferId:'transfer',index:0},{operation:'commit_receiver',transferId:'transfer'}] as const;
for(const intent of intents) {validateNativeProducerIntent(intent);checks++;await live.relayNativeProducerIntent(intent);}
for(const invalid of [{...intents[0],destinationHandle:'forged'},{...intents[0],manifestDigest:'B'.repeat(64)},{...intents[1],index:512},{...intents[1],index:-1},{...intents[1],index:0.1},{...intents[2],receipt:{committed:true}},{...intents[2],bytesBase64:'YQ=='},{...intents[2],transferId:'../escape'}]) {
 assert.throws(()=>validateNativeProducerIntent(invalid));checks++;
 const before=operations.length;await assert.rejects(live.relayNativeProducerIntent(invalid as any));assert.equal(operations.length,before);checks++;
}
// Source inspection only: binds spellings/serde camelCase annotations to current native enum.
const nativeSource=readFileSync(new URL('../src-tauri/src/cross_device.rs',import.meta.url),'utf8');
const nativeCompact=nativeSource.replace(/\s/g,'');
for(const [variant,fields] of [['RegisterReceiver','transfer_id:String,manifest_digest:String,checkpoint_id:String'],['ReceiveChunk','transfer_id:String,index:u32'],['CommitReceiver','transfer_id:String']]) {
 assert.ok(nativeCompact.includes(`#[serde(rename_all="camelCase")]${variant}{${fields}}`)||nativeCompact.includes(`#[serde(rename_all="camelCase")]${variant}{${fields},}`));checks++;
}
function rustFunctionBody(source:string,name:string):string {
  const match=new RegExp(`\\bfn\\s+${name}\\s*\\(`).exec(source);assert.ok(match,`Actual native function ${name} missing`);
  const start=source.indexOf('{',match.index);assert.ok(start>=0);
  let depth=0,string=false,escape=false,lineComment=false,blockComment=0;
  for(let i=start;i<source.length;i++) {
    const c=source[i],next=source[i+1];
    if(lineComment){if(c==='\n')lineComment=false;continue;}
    if(blockComment){if(c==='/'&&next==='*'){blockComment++;i++;}else if(c==='*'&&next==='/'){blockComment--;i++;}continue;}
    if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
    if(c==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(c==='/'&&next==='*'){blockComment=1;i++;continue;}
    if(c==='"'){string=true;continue;}
    if(c==='{')depth++;if(c==='}'&&--depth===0)return source.slice(start,i+1);
  }throw Error(`Native function ${name} body incomplete`);
}
// Integration source inspection is deliberately distinct from OS execution or
// Rust metadata compilation. Native workers/locks/privacy effects remain SIM.
const computerSource=readFileSync(new URL('../src-tauri/src/computer.rs',import.meta.url),'utf8');
const retirementBody=rustFunctionBody(computerSource,'native_retirement_body');
const retireNative=rustFunctionBody(computerSource,'retire_native_session');
const finishNative=rustFunctionBody(computerSource,'finish_native_termination');
const watchdog=rustFunctionBody(computerSource,'safety_watchdog');
const safetyHttp=rustFunctionBody(computerSource,'native_safety_json');
const latchNative=rustFunctionBody(computerSource,'safety_latch_scope');
const phaseNative=rustFunctionBody(computerSource,'publish_stop_phase');
const stopMonitor=rustFunctionBody(computerSource,'native_stop_monitor');
const beginNative=rustFunctionBody(computerSource,'computer_begin');
const abandonedNative=rustFunctionBody(computerSource,'retire_abandoned_registration');
const stopNative=rustFunctionBody(computerSource,'computer_stop');
const retireCompact=retireNative.replace(/\s/g,''),finishCompact=finishNative.replace(/\s/g,''),phaseCompact=phaseNative.replace(/\s/g,'');
let sourceInspectionChecks=0;
for(const field of ['schema','safetySessionRef','nativeSessionId','nativeBootNonce','originalGeneration']) {assert.ok(retirementBody.includes(`"${field}"`));sourceInspectionChecks++;}
assert.deepEqual(Array.from(retirementBody.matchAll(/"([A-Za-z][A-Za-z0-9]*)"\s*:/g),m=>m[1]).sort(),['schema','safetySessionRef','nativeSessionId','nativeBootNonce','originalGeneration'].sort());sourceInspectionChecks++;
assert.ok(retireNative.includes('native-safety/session/retire')&&safetyHttp.includes('/api/computer-use/{route}'));sourceInspectionChecks++;
assert.ok(safetyHttp.toLowerCase().includes('x-edith-safety-session')&&retireCompact.includes('Some(&original.safety_session_ref)'));sourceInspectionChecks++;
assert.ok(finishNative.includes('native_carrier_quiescent'));sourceInspectionChecks++;
assert.ok(finishNative.includes('retire_native_session'));sourceInspectionChecks++;
assert.ok(watchdog.includes('finish_native_termination'));sourceInspectionChecks++;
assert.ok(retireCompact.indexOf('letbody=native_retirement_body(original)')<retireCompact.indexOf('forattemptin0..3'));sourceInspectionChecks++;
assert.ok(retireCompact.includes('Some(&body)')&&retireCompact.includes('forattemptin0..3'));sourceInspectionChecks++;
assert.ok(retireCompact.indexOf('now_ms()>=original.expires_at_ms')<retireCompact.indexOf('native_safety_json('));sourceInspectionChecks++;
assert.ok(retireCompact.includes('native_time(&response["expiresAt"])?==original.expires_at_ms'));sourceInspectionChecks++;
assert.ok(finishCompact.includes('letquiet={matchdispatch.try_lock()')&&finishCompact.includes('native_carrier_quiescent()')&&finishCompact.includes('active_cleanup.load(Ordering::SeqCst)==0'));sourceInspectionChecks++;
assert.ok(finishCompact.indexOf('ifquiet{')<finishCompact.indexOf('retire_native_session('));sourceInspectionChecks++;
assert.ok(finishCompact.includes('ifscope.quiescent_at.is_none()')&&phaseCompact.includes('scope.quiescent_at.as_ref().ok_or("NATIVE_QUIESCENCE_NOT_OBSERVED")?'));sourceInspectionChecks++;
assert.ok(latchNative.indexOf('generation.compare_exchange(')<latchNative.indexOf('bridge.safety.lock()')&&latchNative.indexOf('stopped.store(true')<latchNative.indexOf('bridge.safety.lock()'));sourceInspectionChecks++;
assert.ok(finishCompact.indexOf('native_cleanup_epoch(')<finishCompact.indexOf('publish_stop_phase_retry('));sourceInspectionChecks++;
assert.ok(stopMonitor.includes('generation.load(Ordering::SeqCst)')&&stopMonitor.includes('stopped.load(Ordering::SeqCst)')&&stopMonitor.includes('original.original_generation'));sourceInspectionChecks++;
assert.ok(stopMonitor.includes('Duration::from_millis(5)')&&!stopMonitor.includes('safety_poll')&&!stopMonitor.includes('native_safety_json'));sourceInspectionChecks++;
assert.ok(beginNative.indexOf('native_stop_monitor(')>=0&&beginNative.indexOf('native_stop_monitor(')<beginNative.indexOf('native_overlay::show('));sourceInspectionChecks++;
assert.ok(beginNative.includes('Arc::clone(&state.stopped)')&&beginNative.includes('Arc::clone(&state.session_generation)'));sourceInspectionChecks++;
assert.ok(abandonedNative.includes('finish_native_termination(&bridge,&original,&dispatch,false)'));sourceInspectionChecks++;
assert.ok(beginNative.includes('retire_abandoned_registration(')&&beginNative.includes('Native approval cancelled by STOP'));sourceInspectionChecks++;
assert.ok(stopNative.indexOf('NativeCleanupPending::new(')<stopNative.indexOf('stopped.store(true')&&stopNative.indexOf('NativeCleanupPending::new(')<stopNative.indexOf('advance_stop_generation('));sourceInspectionChecks++;
assert.ok(stopNative.indexOf('drop(cleanup)')>stopNative.indexOf('overlay.take()')&&stopNative.indexOf('drop(cleanup)')>stopNative.indexOf('record_native_stop('));sourceInspectionChecks++;
assert.ok(stopNative.includes('active_cleanup.load(Ordering::SeqCst)==0'));sourceInspectionChecks++;
assert.ok(stopNative.indexOf('native_iso(now_ms())')<stopNative.indexOf('native_cleanup_epoch('));sourceInspectionChecks++;
const beginCompact=beginNative.replace(/\s/g,'');
const pendingCounter='active_cleanup.load(Ordering::SeqCst)!=0';
assert.ok(beginCompact.indexOf(pendingCounter)>=0&&beginCompact.indexOf(pendingCounter)<beginCompact.indexOf('MessageBoxW('));sourceInspectionChecks++;
assert.ok(beginCompact.slice(beginCompact.indexOf('if!approved'),beginCompact.indexOf('letmutsession_nonce')).includes(pendingCounter));sourceInspectionChecks++;
assert.ok(beginCompact.slice(beginCompact.indexOf('letmutcurrent='),beginCompact.indexOf('compare_exchange(')).includes(pendingCounter));sourceInspectionChecks++;
assert.ok(beginCompact.lastIndexOf(pendingCounter)>beginCompact.indexOf('compare_exchange(')&&beginCompact.lastIndexOf(pendingCounter)<beginCompact.lastIndexOf('Ok(id)'));sourceInspectionChecks++;
const stopEpoch=rustFunctionBody(nativeSource,'stop_epoch').replace(/\s/g,'');
assert.ok(stopEpoch.includes('ifepoch!=self.epoch{return;}'));sourceInspectionChecks++;
assert.ok(stopEpoch.includes('active.store(false')&&stopEpoch.includes('pixels.lock()'));sourceInspectionChecks++;
assert.ok(stopEpoch.indexOf('active.store(false')<stopEpoch.indexOf('pixels.lock()'));sourceInspectionChecks++;
assert.ok(stopEpoch.includes('pixels.take()'));sourceInspectionChecks++;
assert.ok(nativeCompact.includes('implDropforRetainedPixels{fndrop(&mutself){clear_owned_bytes(&mutself.bytes);}}'));sourceInspectionChecks++;
assert.ok(nativeCompact.includes('std::ptr::write_volatile(byte,0)'));sourceInspectionChecks++;
assert.ok(nativeSource.includes('Arc::downgrade(&privacy.memory)')&&nativeSource.includes('register_carrier_stop_hook(privacy.candidate.session_generation'));sourceInspectionChecks++;
console.log(JSON.stringify({suite:'native-lifecycle-source-inspection',checks:sourceInspectionChecks,result:'PASS',sourceInspectionOnly:true,nativeExecuted:false,metadataCompiled:false,physical:false}));
console.log(JSON.stringify({suite:'native-producer-binding',checks,result:'PASS',nativeEvidence:'SIM',physical:false,decodedByteIntegrity:'actual',strictBackendParser:'actual',nativeWindowsCallsExecuted:false}));

// The existing runner reads the user's runtime DB. This fixture instead confines
// every backend configuration/data path to a freshly created, owned temp root.
if(process.env.EDITH_BINDING_REPORT_ROOT){
  console.log(JSON.stringify({suite:'native-producer-binding-guarded-mode',result:'PASS',mode:'synthetic-only',mountedIntegration:'NOT_RUN_NETWORK_FORBIDDEN',physicalNative:false}));
} else {
const isolatedRoot=fs.mkdtempSync(path.join(os.tmpdir(),'edith-native-binding-integration-'));
const dataPath=path.join(isolatedRoot,'Data'), configPath=path.join(isolatedRoot,'workspace.json');
const directories={chatHistoryPath:path.join(isolatedRoot,'Conversations'),logsPath:path.join(isolatedRoot,'Logs'),dataPath,backupPath:path.join(isolatedRoot,'Backups'),exportsPath:path.join(isolatedRoot,'Exports')};
for(const directory of Object.values(directories))fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(configPath,JSON.stringify({schemaVersion:1,workspaceId:'SIM-native-binding-workspace',deviceId:'SIM-native-binding-device',workspaceRoot:isolatedRoot,obsidianVaultPath:'',...directories,portableMode:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
process.env.EDITH_TEST_MODE='true';process.env.EDITH_TEST_DATA_DIR=dataPath;
process.env.EDITH_WORKSPACE_CONFIG_PATH=configPath;process.env.EDITH_WORKSPACE_ROOT=isolatedRoot;
try {
  // Fresh executions of the actual existing mounted backend suites, not reuse
  // of a historical verdict. Their native receipts remain explicitly SIM.
  await import('./test-edith-native-mobile-bytes');
  await import('./test-edith-native-stop-receipts');
  const {FileService}=await import('../server/files/fileService');
  const nativeFiles=await import('../server/files/nativeFileActions');
  const {nativeManifestDigest,parseSourcePinManifest}=await import('../server/mobile/nativeProducerContract');
  const filesRoot=path.join(isolatedRoot,'own-files');fs.mkdirSync(filesRoot);
  const files=new FileService(()=>[{id:'workspace',path:filesRoot}]);
  let filesChecks=0;
  nativeFiles.claimNativeFileOpen();
  for(const bom of [false,true]) {
    const text='genuine public fixture', raw=Buffer.concat([bom?Buffer.from([0xef,0xbb,0xbf]):Buffer.alloc(0),Buffer.from(text)]);
    const fileName=bom?'bom.txt':'plain.txt', transferId=bom?'SIM-own-bom':'SIM-own-plain';fs.writeFileSync(path.join(filesRoot,fileName),raw);
    const fileId=files.search(fileName).files[0].id;
    const pin=nativeFiles.requestNativeTransferPin(files,{fileId,ownerBindingId:'SIM-own-owner',transferId,targetDeviceId:'SIM-mobile',expiresAt:new Date(Date.now()+10_000).toISOString()},()=>{});
    const job=nativeFiles.claimNativeFileOpen()!;assert.equal(job.operation,'transfer_pin');filesChecks++;
    const source=nativeFiles.nativeFileOpenSource(job.operationId) as any;
    assert.equal(source.contentSha256,sha(raw));filesChecks++;
    assert.equal(files.resolveNativeFile(fileId).contentSha256,sha(Buffer.from(text)));filesChecks++;
    const manifest={contractVersion:2,amendment:'2.1',transferId,sizeBytes:raw.length,chunkSizeBytes:NATIVE_CHUNK_BYTES,totalChunks:1,fileSha256:sha(raw),chunks:[{index:0,offsetBytes:0,sizeBytes:raw.length,sha256:sha(raw)}]};
    const sourceManifest={schema:'edith.native-mobile/1',lineage,transferId,sourceHandle:'SIM-owned-handle',manifest,manifestDigest:nativeManifestDigest(manifest as any),sourceIdentityDigest:source.sourceIdentityDigest,sourceGeneration:1,fileName,mediaType:'text/plain',expiresAt:new Date(Date.now()+10_000).toISOString()};
    assert.equal(parseSourcePinManifest(sourceManifest).success,true);filesChecks++;
    nativeFiles.finishNativeFileOpen(job.operationId,{operation:'transfer_pin',operationId:job.operationId,fileId,ownerBindingId:'SIM-own-owner',transferId,targetDeviceId:'SIM-mobile',claimNonce:source.claimNonce,sourceIdentityDigest:source.sourceIdentityDigest,source:'native_operator',sourceHandle:'SIM-owned-handle',contentSha256:sha(raw),sourceManifest});
    assert.equal((await pin).contentSha256,sha(raw));filesChecks++;
    const rejected=nativeFiles.requestNativeTransferPin(files,{fileId,ownerBindingId:'SIM-own-owner',transferId:transferId+'-wrong',targetDeviceId:'SIM-mobile',expiresAt:new Date(Date.now()+10_000).toISOString()},()=>{}).then(()=>{throw Error('WRONG_PIN_ACCEPTED');},e=>e);
    const wrongJob=nativeFiles.claimNativeFileOpen()!, wrongSource=nativeFiles.nativeFileOpenSource(wrongJob.operationId) as any;
    assert.throws(()=>nativeFiles.finishNativeFileOpen(wrongJob.operationId,{operation:'transfer_pin',operationId:wrongJob.operationId,fileId,ownerBindingId:'SIM-own-owner',transferId:transferId+'-wrong',targetDeviceId:'SIM-mobile',claimNonce:bom?wrongSource.claimNonce:'wrong-claim',sourceIdentityDigest:wrongSource.sourceIdentityDigest,source:'native_operator',sourceHandle:'SIM-owned-handle',contentSha256:bom?sha(Buffer.from(text)):sha(raw),sourceManifest}),/FILES_NATIVE_TRANSFER_PIN_UNVERIFIED/);filesChecks++;
    assert.match((await rejected).message,/FILES_NATIVE_TRANSFER_PIN_UNVERIFIED/);filesChecks++;
  }
  const {NativeStopReceiptRegistry}=await import('../server/computer/nativeStopReceipts');
  let clock=Date.now();
  const owner={actor:'owner' as const,bindingId:'SIM-own-followup',csrfToken:'SIM',createdAt:clock,expiresAt:clock+60_000};
  const registry=new NativeStopReceiptRegistry(()=>clock,()=>owner);
  const original={schema:'edith.native-mobile/1',nativeSessionId:'SIM-original',nativeBootNonce:'SIM-original-boot',ownerBindingId:owner.bindingId,originalGeneration:0,sessionExpiresAt:new Date(clock+60_000).toISOString()};
  const originalScope=registry.register(original,owner);
  const mobile={deviceId:'SIM-mobile',workspaceId:'SIM-workspace',sessionId:'SIM-mobile-session'};
  const accepted=registry.acceptGlobal({...mobile,commandId:'SIM-command',idempotencyKey:'SIM-original-key'});
  const retired={schema:original.schema,safetySessionRef:originalScope.safetySessionRef,nativeSessionId:original.nativeSessionId,nativeBootNonce:original.nativeBootNonce,originalGeneration:0};
  const latched={schema:original.schema,stopRequestId:accepted.stopRequestId,safetySessionRef:originalScope.safetySessionRef,nativeSessionId:original.nativeSessionId,originalGeneration:0,latchedGeneration:1,observedAt:new Date(clock).toISOString(),phase:'latched'};
  let lifecycleChecks=0;
  assert.throws(()=>registry.receipt({...latched,phase:'quiescent',quiescentAt:new Date(clock).toISOString()}));lifecycleChecks++;
  registry.receipt(latched);clock++;
  registry.receipt({...latched,phase:'quiescent',quiescentAt:new Date(clock).toISOString()});
  // Drop the first retirement acknowledgement, then retry the identical original.
  registry.retire(retired);
  const retry=registry.retire(retired);assert.equal(retry.expiresAt,originalScope.expiresAt);lifecycleChecks++;
  assert.throws(()=>registry.register(original,owner));lifecycleChecks++;
  assert.throws(()=>registry.safety(originalScope.safetySessionRef));lifecycleChecks++;
  const newer=registry.register({...original,nativeSessionId:'SIM-next',originalGeneration:2},owner);
  assert.notEqual(newer.safetySessionRef,originalScope.safetySessionRef);lifecycleChecks++;
  const next=registry.acceptGlobal({...mobile,commandId:'SIM-next-command',idempotencyKey:'SIM-next-key'});
  assert.equal(registry.safety(newer.safetySessionRef)!.stopRequestId,next.stopRequestId);lifecycleChecks++;
  assert.equal(registry.project(accepted.stopRequestId,mobile).state,'native_quiescent');lifecycleChecks++;
  assert.equal(registry.project(accepted.stopRequestId,mobile).expiresAt,accepted.expiresAt);lifecycleChecks++;
  assert.throws(()=>registry.receipt({...latched,stopRequestId:next.stopRequestId}));lifecycleChecks++;
  assert.throws(()=>registry.retire({...retired,nativeBootNonce:'SIM-different-boot'}));lifecycleChecks++;
  assert.throws(()=>registry.retire({...retired,originalGeneration:2}));lifecycleChecks++;
  assert.throws(()=>registry.retire({...retired,noNextInput:true}));lifecycleChecks++;
  console.log(JSON.stringify({suite:'native-producer-integration-followup',result:'PASS',additionalFilesChecks:filesChecks,additionalRegistryChecks:lifecycleChecks,existingMountedBytesSuite:'fresh PASS',existingMountedSafetySuite:'fresh PASS',byteFixture:'genuine BOM/nonBOM queue/source/receipt',retirementFixture:'actual HTTP headers/ref/boot/generation/idempotency/lostACK/order/newsession',nativeReceipts:'SIM',physicalNative:false,userDatabaseRead:false}));
} finally {
  const resolved=path.resolve(isolatedRoot), temporary=path.resolve(os.tmpdir());
  if(path.dirname(resolved)!==temporary||!path.basename(resolved).startsWith('edith-native-binding-integration-'))throw Error('SIM_FIXTURE_CLEANUP_SCOPE_INVALID');
  const {getEdithPersistenceStore}=await import('../src/edith/persistence');
  const fixtureStore=getEdithPersistenceStore();
  if(path.resolve(fixtureStore.getPaths().dataDir)!==path.resolve(dataPath))throw Error('SIM_PERSISTENCE_SCOPE_INVALID');
  fixtureStore.close?.();
  fs.rmSync(resolved,{recursive:true,force:true});
  assert.equal(fs.existsSync(resolved),false);
  console.log(JSON.stringify({suite:'native-binding-owned-fixture-cleanup',result:'PASS',fixturePersistenceClosed:true,removedOwnedTempRoot:true,userDatabaseRead:false}));
}
}
