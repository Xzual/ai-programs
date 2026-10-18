import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';

// Root's guarded runner must isolate persistence BEFORE any product import.
assert.equal(process.env.EDITH_TEST_MODE,'true','Guarded pre-import test isolation required');
assert.ok(process.env.EDITH_TEST_DATA_DIR,'Guarded disposable persistence required');
const [{default:express},ownerModule,{createFilesRouter},{createComputerUseRouter},{FileService},
 {getMobileRuntime},{killSwitchService},{sha256},contract,nativeContract]=await Promise.all([
 import('express'),import('../server/security/ownerSession'),import('../server/routes/files'),
 import('../server/routes/computerUse'),import('../server/files/fileService'),import('../server/mobile/runtime'),
 import('../src/edith/killSwitch'),import('../server/mobile/crypto'),import('../src/edith/contracts'),
 import('../server/mobile/nativeProducerContract')]);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-files-send-binding-'));
const bom=Buffer.concat([Buffer.from([239,187,191]),Buffer.from('Files send BOM fixture')]);
const filePath=path.join(root,'bom.txt');fs.writeFileSync(filePath,bom);fs.writeFileSync(path.join(root,'other.txt'),'Other fixture');
const service=new FileService(()=>[{id:'workspace',path:root}]);
const app=express();app.use(express.json({limit:'256kb'}));app.use(ownerModule.createOwnerSessionRouter());
let owner:ReturnType<typeof ownerModule.getOwnerSession>;
app.get('/fixture-owner',ownerModule.requireOwnerSession,(req,res)=>{owner=ownerModule.getOwnerSession(req);res.json({success:true});});
app.use(createFilesRouter(service));app.use(createComputerUseRouter());
const server=createServer(app),runtime=getMobileRuntime(),checks:string[]=[];
const originalNow=Date.now;
process.env.EDITH_OWNER_TOKEN='files-send-owned-login-SIM';process.env.EDITH_DESKTOP_BRIDGE_TOKEN='files-send-private-native-SIM';
try{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const login=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer files-send-owned-login-SIM'}});
 assert.equal(login.status,201);const loginBody=await login.json() as any,cookie=login.headers.get('set-cookie')!.split(';')[0];
 const headers={origin,cookie,'content-type':'application/json','x-edith-csrf-token':loginBody.session.csrfToken};
 const privateHeaders={authorization:'Bearer files-send-private-native-SIM','content-type':'application/json'};
 const call=async(route:string,body?:unknown,h:Record<string,string>=headers)=>{
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json() as any};
 };
 assert.equal((await call('/fixture-owner')).status,200);assert.ok(owner);
 const discovered=await call('/api/files/search?q=');assert.equal(discovered.status,200);
 const records=discovered.data.files as Array<{id:string;name:string}>;
 const fileId=records.find(f=>f.name==='bom.txt')!.id,otherId=records.find(f=>f.name==='other.txt')!.id;
 const send=(deviceId:string,key:string,id=fileId,h:Record<string,string>=headers)=>call('/api/files/'+id+'/send',{deviceId},{...h,'x-idempotency-key':key});
 const native='/api/computer-use/native-files';
 const status=async()=>{const r=await call('/api/files/status');assert.equal(r.status,200);assert.equal(r.data.completed,undefined);assert.equal(r.data.receipt,undefined);assert.notEqual(r.data.actions.send,'available');return r.data.actions;};
 let actions=await status();assert.equal(actions.open,'adapter_unavailable');assert.equal(actions.send,'adapter_unavailable');checks.push('status absent poll');
 assert.equal((await call('/api/files/status',undefined,{})).status,401);
 assert.equal((await call('/api/files/status',undefined,{...headers,origin:'http://foreign.invalid'})).status,403);checks.push('status owner and same-origin');
 assert.equal((await call(native+'/next',undefined,{})).status,401);
 actions=await status();assert.equal(actions.send,'adapter_unavailable');checks.push('unauthenticated poll never enables');
 const identities=new Map<string,{signing:ReturnType<typeof generateKeyPairSync>;agreement:ReturnType<typeof generateKeyPairSync>}>();
 const pair=(deviceId:string,bindingId=owner!.bindingId,commands=['file.download'])=>{
  const identity=identities.get(deviceId)??{signing:generateKeyPairSync('ed25519'),agreement:generateKeyPairSync('x25519')};identities.set(deviceId,identity);const {signing,agreement}=identity;
  const offered=runtime.pairing.request({device:{deviceId,displayName:'Files SIM',platform:'android',capabilities:{contractVersion:2,amendment:contract.EDITH_CONTRACT_AMENDMENT,realtime:true,fileTransfer:true,fileTransferEncryption:true,notifications:false,camera:false,microphone:false,computerControl:false,browserControl:false}},signingPublicKeyJwk:signing.publicKey.export({format:'jwk'}) as JsonWebKey,agreementPublicKeyJwk:agreement.publicKey.export({format:'jwk'}) as JsonWebKey,requestedCommands:commands as any});
  const proof=(value:string)=>sign(null,Buffer.from(value),signing.privateKey).toString('base64url');
  runtime.pairing.submitProof(offered.pairing.pairingId,proof(offered.proofPayload));
  runtime.pairing.approve(offered.pairing.pairingId,offered.code,commands as any,{bindingId,expiresAt:new Date(owner!.expiresAt).toISOString()});
  const credential=runtime.pairing.consume(offered.pairing.pairingId,proof(offered.proofPayload+'\nconsume')).credential;
  return runtime.pairing.authenticate(credential.token);
 };
 const context=pair('files-send-device');
 assert.equal((await send(context.credential.deviceId,'unbound')).status,501);checks.push('actual unbound pin501');
 assert.equal((await send('missing-device','missing')).status,403);
 assert.equal((await call('/api/files/'+fileId+'/send',{})).status,400);
 assert.equal((await call('/api/files/'+fileId+'/send',{deviceId:context.credential.deviceId,receipt:{}})).status,400);
 assert.throws(()=>pair('foreign-device','foreign-owner-SIM'),/OWNER_SESSION_BINDING_INVALID/);
 assert.ok((await send(context.credential.deviceId,'no-auth',fileId,{})).status>=400);
 assert.equal((await send(context.credential.deviceId,'wrong-owner',fileId,{...headers,cookie:cookie.split('=')[0]+'=forged'})).status,401);
 assert.ok((await send(context.credential.deviceId,'bad-origin',fileId,{...headers,origin:'http://foreign.invalid'})).status>=400);
 assert.ok((await send(context.credential.deviceId,'bad-csrf',fileId,{...headers,'x-edith-csrf-token':'wrong'})).status>=400);
 assert.ok((await send(context.credential.deviceId,'')).status>=400);checks.push('owner origin csrf idempotency scope');
 const denied=pair('command-denied',owner!.bindingId,['file.upload']);assert.ok((await send(denied.credential.deviceId,'command')).status>=400);
 const stale=pair('stale-device'),staleDevice=runtime.store.getDevice(stale.credential.deviceId)!;
 runtime.store.saveDevice({...staleDevice,trust:{...staleDevice.trust,expiresAt:new Date(originalNow()-1).toISOString()}});
 assert.ok((await send(stale.credential.deviceId,'stale')).status>=400);
 const revoked=pair('revoked-device');runtime.pairing.revokeDevice(revoked.credential.deviceId);assert.ok((await send(revoked.credential.deviceId,'revoked')).status>=400);
 const expired=pair('expired-credential'),credentialRow=runtime.store.listCredentials().find(c=>c.deviceId===expired.credential.deviceId)!;
 runtime.store.saveCredential({...credentialRow,expiresAt:new Date(originalNow()-1).toISOString()});assert.equal((await send(expired.credential.deviceId,'expired')).status,403);
 checks.push('command trust revoke credential deny before pin');
 const pollTime=originalNow();Date.now=()=>pollTime;
 const freshPoll=await call(native+'/next',undefined,privateHeaders);assert.equal(freshPoll.status,200);assert.equal(freshPoll.data.job,null);
 actions=await status();assert.equal(actions.open,'native_adapter_available');assert.equal(actions.send,'native_adapter_available');checks.push('authenticated fresh poll status');
 try{Date.now=()=>pollTime+15000;actions=await status();assert.equal(actions.open,'native_adapter_available');assert.equal(actions.send,'native_adapter_available');Date.now=()=>pollTime+15001;actions=await status();assert.equal(actions.open,'adapter_unavailable');assert.equal(actions.send,'adapter_unavailable');}finally{Date.now=originalNow;}
 checks.push('poll TTL15s');await call(native+'/next',undefined,privateHeaders);
 const pending=send(context.credential.deviceId,'healthy-SIM');
 const claim=async()=>{for(let i=0;i<100;i++){const r=await call(native+'/next',undefined,privateHeaders);assert.equal(r.status,200);if(r.data.job)return r.data.job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('OWNED_PIN_NOT_QUEUED');};
 const job=await claim();assert.equal(job.operation,'transfer_pin');
 assert.equal((await call(native+'/'+job.operationId+'/source',undefined,headers)).status,401);
 const sourceResponse=await call(native+'/'+job.operationId+'/source',undefined,privateHeaders);assert.equal(sourceResponse.status,200);const source=sourceResponse.data.source;
 assert.equal(source.fileId,fileId);assert.equal(source.ownerBindingId,owner!.bindingId);assert.equal(source.targetDeviceId,context.credential.deviceId);assert.equal(source.claimNonce,job.claimNonce);
 assert.equal(source.contentSha256,sha256(bom));assert.notEqual(source.contentSha256,sha256(service.read(fileId).text));assert.equal(source.absolutePath,filePath);
 const lineage={contractVersion:2,amendment:contract.EDITH_CONTRACT_AMENDMENT,ownerSessionBindingId:owner!.bindingId,workspaceId:context.credential.workspaceId,sessionId:context.credential.sessionId,sourceDeviceId:runtime.store.serverId(),targetDeviceId:context.credential.deviceId};
 const manifest={contractVersion:2 as const,amendment:contract.EDITH_CONTRACT_AMENDMENT,transferId:source.transferId,sizeBytes:bom.length,chunkSizeBytes:nativeContract.NATIVE_CHUNK_BYTES,totalChunks:1,fileSha256:sha256(bom),chunks:[{index:0,offsetBytes:0,sizeBytes:bom.length,sha256:sha256(bom)}]};
 // Software-only authenticated private-native SIM assertion. No OS held-pin or delivery claim.
 const sourceManifest={schema:nativeContract.NATIVE_MOBILE_SCHEMA,lineage,transferId:source.transferId,sourceHandle:'Files-held-SIM',sourceIdentityDigest:source.sourceIdentityDigest,sourceGeneration:1,manifest,manifestDigest:nativeContract.nativeManifestDigest(manifest),fileName:'bom.txt',mediaType:'text/plain',expiresAt:source.expiresAt};
 const receipt={operation:'transfer_pin',operationId:job.operationId,fileId,ownerBindingId:owner!.bindingId,transferId:source.transferId,targetDeviceId:context.credential.deviceId,claimNonce:source.claimNonce,sourceIdentityDigest:source.sourceIdentityDigest,source:'native_operator',sourceHandle:sourceManifest.sourceHandle,contentSha256:sha256(bom),sourceManifest};
 assert.equal((await call(native+'/'+job.operationId+'/receipt',{receipt},headers)).status,401);
 assert.equal((await call(native+'/'+job.operationId+'/receipt',{receipt},privateHeaders)).status,200);
 const accepted=await pending;assert.equal(accepted.status,202);assert.equal(accepted.data.completed,false);assert.equal(accepted.data.transferId,source.transferId);assert.notEqual(accepted.data.descriptor.status,'completed');
 const replay=await send(context.credential.deviceId,'healthy-SIM');assert.equal(replay.status,200);assert.equal(replay.data.transferId,accepted.data.transferId);assert.equal(replay.data.completed,false);
 assert.ok((await send(context.credential.deviceId,'healthy-SIM',otherId)).status>=400);checks.push('raw BOM private broker SIM acceptance and idempotency');
 assert.ok((await call(native+'/'+job.operationId+'/receipt',{receipt},privateHeaders)).status>=400);checks.push('receipt one-use');
 for(const [field,value] of [['claimNonce','wrong-claim'],['fileId',otherId],['targetDeviceId','wrong-target'],['ownerBindingId','wrong-owner'],['sourceIdentityDigest',sha256('wrong-source')],['source','browser']] as const){
  const rejected=send(context.credential.deviceId,'receipt-negative-'+field),negativeJob=await claim();
  const current=(await call(native+'/'+negativeJob.operationId+'/source',undefined,privateHeaders)).data.source;
  const currentManifest={...manifest,transferId:current.transferId};
  const currentSourceManifest={...sourceManifest,transferId:current.transferId,manifest:currentManifest,manifestDigest:nativeContract.nativeManifestDigest(currentManifest),sourceIdentityDigest:current.sourceIdentityDigest,expiresAt:current.expiresAt};
  const mismatched={...receipt,operationId:negativeJob.operationId,transferId:current.transferId,claimNonce:current.claimNonce,sourceIdentityDigest:current.sourceIdentityDigest,sourceManifest:currentSourceManifest,[field]:value};
  assert.equal((await call(native+'/'+negativeJob.operationId+'/receipt',{receipt:mismatched},privateHeaders)).data.errorCode,'FILES_NATIVE_TRANSFER_PIN_UNVERIFIED');
  assert.ok((await rejected).status>=400);checks.push('private receipt rejects '+field);
 }
 // Real asynchronous source revalidation; same-size replacement cannot authorize old pin.
 const changedPending=send(context.credential.deviceId,'changed-SIM');const changedJob=await claim();fs.writeFileSync(filePath,Buffer.alloc(bom.length,65));
 assert.equal((await call(native+'/'+changedJob.operationId+'/source',undefined,privateHeaders)).data.errorCode,'FILE_CHANGED');
 assert.equal((await call(native+'/'+changedJob.operationId+'/receipt',{receipt},privateHeaders)).data.errorCode,'FILE_CHANGED');
 assert.ok((await changedPending).status>=400);fs.writeFileSync(filePath,bom);checks.push('async same-size source replacement');
 const expiring=send(context.credential.deviceId,'pin-expiry-SIM'),expiringJob=await claim();const expirySource=(await call(native+'/'+expiringJob.operationId+'/source',undefined,privateHeaders)).data.source;
 try{Date.now=()=>Date.parse(expirySource.expiresAt)+1;assert.equal((await call(native+'/'+expiringJob.operationId+'/receipt',{receipt},privateHeaders)).data.errorCode,'FILES_NATIVE_JOB_EXPIRED');}finally{Date.now=originalNow;}
 assert.ok((await expiring).status>=400);checks.push('async original pin deadline');
 await call(native+'/next',undefined,privateHeaders);const killed=send(context.credential.deviceId,'kill-SIM'),killedJob=await claim();
 killSwitchService.activate('Owned Files send SIM test','test');actions=await status();assert.equal(actions.open,'blocked');assert.equal(actions.send,'blocked');
 assert.equal((await call(native+'/'+killedJob.operationId+'/receipt',{receipt},privateHeaders)).data.errorCode,'KILL_SWITCH_ACTIVE');assert.ok((await killed).status>=400);
 assert.equal((await send(context.credential.deviceId,'after-kill')).status,423);checks.push('async kill and blocked status');
 killSwitchService.deactivate('test');const nextContext=pair(context.credential.deviceId);
 // Actual session/kill retirement removes old intents. Reusing the key must require
 // a fresh pin under the new session, never replay the prior transfer or PASS.
 const changedSession=send(context.credential.deviceId,'healthy-SIM'),nextJob=await claim();
 const nextSource=(await call(native+'/'+nextJob.operationId+'/source',undefined,privateHeaders)).data.source;
 assert.notEqual(nextSource.transferId,accepted.data.transferId);
 const nextManifest={...manifest,transferId:nextSource.transferId};
 const nextSourceManifest={...sourceManifest,lineage:{...lineage,sessionId:nextContext.credential.sessionId},transferId:nextSource.transferId,manifest:nextManifest,manifestDigest:nativeContract.nativeManifestDigest(nextManifest),sourceIdentityDigest:nextSource.sourceIdentityDigest,expiresAt:nextSource.expiresAt};
 const nextReceipt={...receipt,operationId:nextJob.operationId,transferId:nextSource.transferId,claimNonce:nextSource.claimNonce,sourceIdentityDigest:nextSource.sourceIdentityDigest,sourceManifest:nextSourceManifest};
 assert.equal((await call(native+'/'+nextJob.operationId+'/receipt',{receipt:nextReceipt},privateHeaders)).status,200);
 const nextAccepted=await changedSession;assert.equal(nextAccepted.status,202);assert.equal(nextAccepted.data.completed,false);assert.notEqual(nextAccepted.data.transferId,accepted.data.transferId);
 assert.throws(()=>runtime.transfers.createOutboundIntent(context,'healthy-SIM',fileId));checks.push('retired key requires fresh session pin no old replay');
 console.log(JSON.stringify({suite:'files-send-binding',checks,checkCount:checks.length,nativeReceipt:'SOFTWARE_SIM',actualServices:true,nativeOS:'NOT_RUN',receiverCommit:'NOT_RUN separate native-byte suite',completedClaims:0}));
}finally{
 Date.now=originalNow;killSwitchService.deactivate('test');runtime.realtime.shutdown();
 server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
 delete process.env.EDITH_OWNER_TOKEN;delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
 // Guarded fixture retained for root evidence; never recursively remove computed paths.
}
