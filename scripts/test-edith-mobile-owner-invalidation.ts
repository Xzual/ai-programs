import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign,randomBytes,createDecipheriv,hkdfSync} from 'node:crypto';

// The coordinator supplies the pre-import filesystem/process/loopback guard.
assert.equal(process.env.EDITH_TEST_MODE,'true');
assert.ok(process.env.EDITH_TEST_DATA_DIR,'Owned test data directory is required before product imports');
const [{default:express},{WebSocket},security,{getMobileRuntime},{MobileRegistryStore},{MobilePairingService},cryptoModule,reconnect,contracts,{createMobilePairingRouter},{getMobileOwnerSessionFixture}]=await Promise.all([
 import('express'),import('ws'),import('../server/security/ownerSession'),import('../server/mobile/runtime'),
 import('../server/mobile/registryStore'),import('../server/mobile/pairingService'),import('../server/mobile/crypto'),
 import('../server/mobile/reconnectContract'),import('../src/edith/contracts'),import('../server/routes/mobilePairing'),import('./helpers/mobile-owner-session-fixture'),
]);
const {MobileCryptoService,sha256,deriveMobileKey}=cryptoModule;
const {P256_SUITE,RECONNECT_SCHEMA,initiationTranscript,reconnectTranscript}=reconnect;
const {TASK_CONTRACT_VERSION,EDITH_CONTRACT_AMENDMENT,EDITH_MOBILE_PROTOCOL_VERSION}=contracts;
const versions={contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,protocolVersion:EDITH_MOBILE_PROTOCOL_VERSION};
const ec=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const descriptor=(key:ReturnType<typeof ec>,algorithm:'ECDSA-P256-SHA256'|'ECDH-P256')=>{const der=key.publicKey.export({format:'der',type:'spki'}) as Buffer;return {contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,algorithm,encoding:'spki_der_base64' as const,value:der.toString('base64'),fingerprint:sha256(der)};};
const proof=(key:ReturnType<typeof ec>,text:string)=>sign('sha256',Buffer.from(text),key.privateKey).toString('base64url');
const denied=/DEVICE_(TRUST_INVALID|CREDENTIAL_INVALID|REPAIR_REQUIRED)|RECONNECT_(ALREADY_CONSUMED|EXPIRED|AUTHORITY_CHANGED)|PAIRING_(OWNER|EXPIRED|NOT_APPROVED|ALREADY|INVALID)/;
type Pairing=InstanceType<typeof MobilePairingService>;
type Store=InstanceType<typeof MobileRegistryStore>;
type Owner=Awaited<ReturnType<typeof getMobileOwnerSessionFixture>>;
function initiation(pairing:Pairing,identity:{deviceId:string;signing:ReturnType<typeof ec>;signingKey:ReturnType<typeof descriptor>}){
 const device=pairing.store.getDevice(identity.deviceId)!;assert.ok(device);const client=ec();
 const request:any={schema:RECONNECT_SCHEMA,...versions,serverId:pairing.store.serverId(),workspaceId:device.trust.workspaceId,deviceId:identity.deviceId,signingKeyFingerprint:identity.signingKey.fingerprint,cryptoSuite:P256_SUITE,clientNonce:randomBytes(32).toString('base64url'),clientAgreementKey:descriptor(client,'ECDH-P256'),issuedAt:new Date().toISOString(),assertionBase64url:''};
 request.assertionBase64url=proof(identity.signing,initiationTranscript(request));return {client,request};
}
function body(identity:{signing:ReturnType<typeof ec>},offer:any){return {schema:RECONNECT_SCHEMA,...versions,reconnectId:offer.reconnectId,challengeId:offer.challengeId,transcriptFingerprint:offer.transcriptFingerprint,assertionBase64url:proof(identity.signing,reconnectTranscript(offer)+'\nconsume')};}
function plaintext(client:ReturnType<typeof ec>,offer:any,result:any){
 const root=deriveMobileKey(client.privateKey,offer.serverAgreementKey,Buffer.from(offer.challengeBase64url,'base64url'),'edith.mobile.reconnect.session.v1|'+sha256(reconnectTranscript(offer)));
 const key=Buffer.from(hkdfSync('sha256',root,Buffer.alloc(0),Buffer.from('edith.mobile.s2c.v1'),32));
 const {nonceBase64url,ciphertextBase64url,authTagBase64url,...header}=result.credentialEnvelope;
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(nonceBase64url,'base64url'));
 decipher.setAAD(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(header).sort(([a],[b])=>a<b?-1:a>b?1:0)))));decipher.setAuthTag(Buffer.from(authTagBase64url,'base64url'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextBase64url,'base64url')),decipher.final()]).toString());
}
function cold(store:Store){const next=new MobileRegistryStore(path.dirname(store.filePath));next.initialize();const crypto=new MobileCryptoService();return {store:next,crypto,pairing:new MobilePairingService(next,crypto)};}

if(process.env.EDITH_OWNER_INVALIDATION_CHILD==='true'){
 const registry=path.resolve(process.env.EDITH_OWNER_INVALIDATION_REGISTRY!),deviceId=process.env.EDITH_OWNER_INVALIDATION_DEVICE!;
 const owned=path.resolve(process.env.EDITH_TEST_DATA_DIR!);assert.ok(registry.startsWith(owned+path.sep));assert.equal(path.basename(registry),'mobile-registry.json');
 const store=new MobileRegistryStore(path.dirname(registry));store.initialize();const device=store.getDevice(deviceId)!;assert.ok(device);
 const pairing=new MobilePairingService(store,new MobileCryptoService()),old=device.ownerBinding.ownerSessionId;
 assert.equal(security.ownerSessionBindingActive(old),false);
 // The owner gate precedes signature verification; a syntactically valid unrelated key must never reach proof acceptance.
 const signing=ec(),identity={deviceId,signing,signingKey:{...descriptor(signing,'ECDSA-P256-SHA256'),fingerprint:device.trust.fingerprint}};
 assert.throws(()=>pairing.beginReconnect(initiation(pairing,identity).request),/DEVICE_TRUST_INVALID/);
 const owner=await getMobileOwnerSessionFixture();try{
  assert.notEqual(owner.context.bindingId,old);assert.equal(security.ownerSessionBindingActive(owner.context.bindingId),true);assert.equal(security.ownerSessionBindingActive(old),false);
  assert.throws(()=>pairing.beginReconnect(initiation(pairing,identity).request),/DEVICE_TRUST_INVALID/);
 }finally{await owner.close();}
 console.log(JSON.stringify({mode:'fresh-child',emptyOwnerDenied:true,newLoginDidNotReviveOldBinding:true,rawCredentialsLogged:false}));
}else{
 const runtime=getMobileRuntime(),app=express();app.use(express.json());app.use(createMobilePairingRouter({runtime}));
 const server=createServer(app);runtime.realtime.handleUpgrade(server);
 const owners:Owner[]=[],sockets:InstanceType<typeof WebSocket>[]=[];const groups:string[]=[];
 let origin='';
 const owner=async()=>{const value=await getMobileOwnerSessionFixture();owners.push(value);return value;};
 const identity=(label:string)=>{const signing=ec(),agreement=ec();return {deviceId:'owner-regression-'+label,signing,agreement,signingKey:descriptor(signing,'ECDSA-P256-SHA256')};};
 type Identity=ReturnType<typeof identity>;
 const post=async(auth:Owner,route:string,payload:unknown,extra:Record<string,string>={})=>{const response=await fetch(origin+route,{method:'POST',headers:{...auth.headers,origin,...extra},body:JSON.stringify(payload)});return {status:response.status,data:await response.json() as any};};
 const prepare=async(auth:Owner,id:Identity,checkAuth=false)=>{
  const offer=runtime.pairing.request({...versions,device:{deviceId:id.deviceId,displayName:'Owned synthetic P256 fixture',platform:'android',capabilities:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,realtime:true,fileTransfer:false,notifications:false,camera:false,microphone:false,computerControl:false,browserControl:false}},supportedSuites:[P256_SUITE],signingKey:id.signingKey,agreementKey:descriptor(id.agreement,'ECDH-P256'),requestedCommands:['task.list','task.detail']} as any);
  runtime.pairing.submitProof(offer.pairing.pairingId,proof(id.signing,offer.proofPayload));const route='/api/edith/mobile/pairings/'+offer.pairing.pairingId+'/approve';
  if(checkAuth){assert.equal((await post(auth,route,{code:offer.code},{'x-edith-csrf-token':'wrong'})).status,403);assert.equal((await post(auth,route,{code:offer.code},{origin:'http://untrusted.invalid'})).status,403);}
  const approved=await post(auth,route,{code:offer.code});assert.equal(approved.status,200);assert.equal(approved.data.success,true);
  return {offer,consume:()=>runtime.pairing.consume(offer.pairing.pairingId,proof(id.signing,offer.proofPayload+'\nconsume'))};
 };
 const pair=async(auth:Owner,label:string)=>{const id=identity(label),pending=await prepare(auth,id);const issued=pending.consume();return {...id,issued};};
 type Device=Awaited<ReturnType<typeof pair>>;
 const connect=async(device:Device)=>{const socket=new WebSocket(origin.replace('http:','ws:')+'/api/mobile/realtime',{headers:{authorization:'Device '+device.issued.credential.token}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('OWNED_WS_OPEN_TIMEOUT')),3000);socket.once('open',()=>{clearTimeout(timer);resolve();});socket.once('error',error=>{clearTimeout(timer);reject(error);});});return socket;};
 const closed=(socket:InstanceType<typeof WebSocket>)=>new Promise<number>((resolve,reject)=>{if(socket.readyState===WebSocket.CLOSED){resolve(4003);return;}const timer=setTimeout(()=>reject(Error('OWNED_WS_CLOSE_TIMEOUT')),3000);socket.once('close',code=>{clearTimeout(timer);resolve(code);});});
 const pending=(device:Device)=>{const request=initiation(runtime.pairing,device),offer=runtime.pairing.beginReconnect(request.request);return {offer,consume:()=>runtime.pairing.consumeReconnect(offer.reconnectId,body(device,offer))};};
 // Fault only our registry's atomic rename. Retain exact original Error identity across retries.
 function renameFault(targets:readonly string[]){
  const original=fs.renameSync,registry=path.resolve(runtime.store.filePath),errors=new Map(targets.map(id=>[id,Object.assign(new Error('OWNED_REVOKE_RENAME_'+id),{code:'EPERM'})]));const counts=new Map<string,number>();
  fs.renameSync=((from:any,to:any)=>{if(path.resolve(String(to))!==registry)return original(from,to);assert.equal(path.dirname(path.resolve(String(from))),path.dirname(registry));const document=JSON.parse(fs.readFileSync(from,'utf8'));const target=targets.find(id=>document.devices.some((row:any)=>row.device.deviceId===id&&row.trust.status==='revoked'));if(target){counts.set(target,(counts.get(target)??0)+1);throw errors.get(target);}return original(from,to);}) as typeof fs.renameSync;
  return {errors,counts,restore:()=>{fs.renameSync=original;}};
 }
 const assertDead=(device:Device,context:ReturnType<Pairing['authenticate']>,offer:ReturnType<typeof pending>)=>{
  assert.equal(runtime.crypto.hasSession(device.issued.credential.sessionId),false);
  assert.throws(()=>runtime.pairing.authenticate(device.issued.credential.token),denied);
  assert.throws(()=>runtime.pairing.acceptCommand(context,'task.list',1),denied);
  assert.throws(()=>runtime.pairing.rotate(context),denied);
  assert.throws(()=>runtime.pairing.beginReconnect(initiation(runtime.pairing,device).request),denied);
  assert.throws(()=>offer.consume(),denied);assert.equal(runtime.crypto.hasSession(offer.offer.nextSessionId),false);
 };
 const noSuccess=(reply:{status:number;data:any;setCookie:string|null})=>{assert.equal(reply.status,503);assert.equal(reply.data.success,false);assert.equal(reply.data.errorCode,'owner_invalidation_incomplete');assert.match(reply.setCookie??'',/edith_owner_session=;/);assert.match(reply.setCookie??'',/Expires=Thu, 01 Jan 1970/i);};
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
  for(const [mode,index]of [['logout',0],['logout',1],['rotation',0],['rotation',1],['expiry',1]] as const){
   const auth=await owner(),binding=auth.context.bindingId,devices=await Promise.all([0,1,2].map(i=>pair(auth,mode+'-'+index+'-'+i)));
   const ordered=runtime.store.listDevices().filter(d=>d.ownerBinding.ownerSessionId===binding).map(row=>devices.find(d=>d.deviceId===row.device.deviceId)!);assert.equal(ordered.length,3);
   const contexts=ordered.map(d=>runtime.pairing.authenticate(d.issued.credential.token)),offers=ordered.map(pending),live=[];
   for(const device of ordered)live.push(await connect(device));const closing=live.map(closed);assert.equal(runtime.realtime.status().connectedDevices,3);
   const traversal=runtime.store.listDevices().filter(d=>d.ownerBinding.ownerSessionId===binding);assert.equal(traversal.length,3);const target=traversal[index].device.deviceId,fault=renameFault([target]),audit:any[]=[];
   const originalAudit=(runtime.pairing as any).audit,originalBatch=runtime.pairing.revokeOwnerBinding.bind(runtime.pairing);let primary:unknown;
   (runtime.pairing as any).audit=function(...args:any[]){audit.push(args);return originalAudit.apply(this,args);};
   runtime.pairing.revokeOwnerBinding=(id:string)=>{try{return originalBatch(id);}catch(error){primary=error;throw error;}};
   const now=Date.now;
   try{if(mode==='expiry'){Date.now=()=>auth.context.expiresAt+1;assert.equal(security.ownerSessionBindingActive(binding),false);}else noSuccess(await(mode==='logout'?auth.logout():auth.rotate()));}
   finally{Date.now=now;fault.restore();(runtime.pairing as any).audit=originalAudit;runtime.pairing.revokeOwnerBinding=originalBatch;}
   assert.equal(primary,fault.errors.get(target));assert.equal(fault.counts.get(target),process.platform==='win32'?4:1);
   assert.equal(security.ownerSessionBindingActive(binding),false);assert.equal((await auth.request('/api/security/session')).status,401);
   assert.deepEqual(await Promise.all(closing),[4003,4003,4003]);assert.equal(runtime.realtime.status().connectedDevices,0);assert.equal(runtime.realtime.status().retainedEvents,0);
   ordered.forEach((device,i)=>assertDead(device,contexts[i],offers[i]));
   assert.equal(runtime.store.getDevice(target)!.trust.status,'trusted','Failed durable revoke remains on disk; owner gate and memory fence deny');
   assert.equal(audit.filter(row=>row[0]==='mobile.device.revoked'&&row[1]===target).length,0);
   for(const device of ordered.filter(d=>d.deviceId!==target)){assert.equal(runtime.store.getDevice(device.deviceId)!.trust.status,'revoked');assert.equal(audit.filter(row=>row[0]==='mobile.device.revoked'&&row[1]===device.deviceId).length,1);}
   await auth.close();groups.push(mode+'-'+index+'-all-devices-denied');
  }
  // Multiple failures retain the first identity while still visiting every device.
  {
   const auth=await owner(),devices=[];for(let i=0;i<3;i++)devices.push(await pair(auth,'batch-'+i));
   const order=runtime.store.listDevices().filter(d=>d.ownerBinding.ownerSessionId===auth.context.bindingId).map(d=>d.device.deviceId),fault=renameFault(order.slice(0,2));
   try{assert.throws(()=>runtime.pairing.revokeOwnerBinding(auth.context.bindingId),error=>error===fault.errors.get(order[0]));}finally{fault.restore();}
   for(const id of order.slice(0,2))assert.equal(fault.counts.get(id),process.platform==='win32'?4:1);
   for(const device of devices)assert.equal(runtime.crypto.hasSession(device.issued.credential.sessionId),false);
   assert.equal(runtime.store.getDevice(order[2])!.trust.status,'revoked');assert.equal((await auth.logout()).status,200);await auth.close();groups.push('batch-first-error-all-attempts');
  }
  // Independent real runtime cleanup stages: realtime persistence and transfer faults cannot strand keys/sockets.
  {
   const auth=await owner(),devices=[];for(let i=0;i<3;i++)devices.push(await pair(auth,'cleanup-'+i));
   const live=[];for(const device of devices)live.push(await connect(device));const closing=live.map(closed);
   const realtime=runtime.realtime as any,connection=[...realtime.connections.values()][0] as any,close=connection.socket.close,persist=realtime.persist,transfer=runtime.transfers.invalidateOwner.bind(runtime.transfers),cross=runtime.crossDevice.invalidateOwnerBinding.bind(runtime.crossDevice);let attemptedRealtime=0,attemptedTransfer=0,attemptedCross=0;
   connection.socket.close=()=>{throw Error('OWNED_SOCKET_CLOSE_FAULT');};realtime.persist=()=>{attemptedRealtime++;throw Error('OWNED_REALTIME_PERSIST_FAULT');};runtime.transfers.invalidateOwner=()=>{attemptedTransfer++;throw Error('OWNED_TRANSFER_CLEANUP_FAULT');};runtime.crossDevice.invalidateOwnerBinding=id=>{attemptedCross++;return cross(id);};
   try{noSuccess(await auth.logout());}finally{connection.socket.close=close;realtime.persist=persist;runtime.transfers.invalidateOwner=transfer;runtime.crossDevice.invalidateOwnerBinding=cross;}
   assert.equal(attemptedRealtime,1);assert.equal(attemptedTransfer,1);assert.equal(attemptedCross,1);assert.deepEqual((await Promise.all(closing)).sort((a,b)=>a-b),[1006,4003,4003]);assert.equal(runtime.realtime.status().connectedDevices,0);
   for(const device of devices)assert.equal(runtime.crypto.hasSession(device.issued.credential.sessionId),false);await auth.close();groups.push('independent-realtime-transfer-cleanup-faults');
  }
  // Failed explicit revoke fences every same-process issuer; a new process independently denies old disk owner binding.
  {
   const auth=await owner(),device=await pair(auth,'explicit'),context=runtime.pairing.authenticate(device.issued.credential.token),before=fs.readFileSync(runtime.store.filePath),offered=pending(device),fault=renameFault([device.deviceId]);
   try{assert.throws(()=>runtime.pairing.revokeDevice(device.deviceId),error=>error===fault.errors.get(device.deviceId));}finally{fault.restore();}
   assert.deepEqual(fs.readFileSync(runtime.store.filePath),before);assert.equal(security.ownerSessionBindingActive(auth.context.bindingId),true);assertDead(device,context,offered);
   const second=cold(runtime.store);assert.throws(()=>second.pairing.beginReconnect(initiation(second.pairing,device).request),/DEVICE_TRUST_INVALID/);
   const source=fileURLToPath(import.meta.url),loader=new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).href;
   const child=spawnSync(process.execPath,['--import',loader,source],{cwd:process.cwd(),env:{...process.env,EDITH_OWNER_INVALIDATION_CHILD:'true',EDITH_OWNER_INVALIDATION_REGISTRY:runtime.store.filePath,EDITH_OWNER_INVALIDATION_DEVICE:device.deviceId},encoding:'utf8',timeout:30_000,windowsHide:true,maxBuffer:64*1024});
   assert.equal(child.error,undefined);assert.equal(child.status,0,'Fresh child owner denial must complete successfully');
   const summary=JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!);assert.equal(summary.emptyOwnerDenied,true);assert.equal(summary.newLoginDidNotReviveOldBinding,true);
   const repair=await prepare(auth,device,true),repaired=repair.consume();runtime.pairing.authenticate(repaired.credential.token);assert.throws(()=>runtime.pairing.authenticate(device.issued.credential.token),denied);
   assert.ok(Date.parse(repaired.credential.expiresAt)<=auth.context.expiresAt);const afterRepair=cold(runtime.store),request=initiation(afterRepair.pairing,device),offer=afterRepair.pairing.beginReconnect(request.request),result=afterRepair.pairing.consumeReconnect(offer.reconnectId,body(device,offer)),plain=plaintext(request.client,offer,result);
   afterRepair.pairing.authenticate(plain.credential.token);assert.throws(()=>afterRepair.pairing.consumeReconnect(offer.reconnectId,body(device,offer)),/ALREADY_CONSUMED/);assert.ok(Date.parse(result.session.expiresAt)<=Date.parse(offer.ownerExpiresAt));assert.equal(offer.ownerExpiresAt,runtime.store.getDevice(device.deviceId)!.ownerBinding.expiresAt);
   assert.equal((await auth.logout()).status,200);assert.throws(()=>afterRepair.pairing.authenticate(plain.credential.token),denied);await auth.close();groups.push('explicit-revoke-shared-fence-restart-protected-repair-cold-replay');
  }
  // A recovering device cannot clear uncertainty if commit/activation fails after its actual effect.
  for(const mode of ['postcommit','activation','owner-rotation'] as const){
   const auth=await owner(),device=await pair(auth,'repair-'+mode),fault=renameFault([device.deviceId]);try{assert.throws(()=>runtime.pairing.revokeDevice(device.deviceId),error=>error===fault.errors.get(device.deviceId));}finally{fault.restore();}
   const pendingRepair=await prepare(auth,device),commit=runtime.store.commitAuthority.bind(runtime.store),activate=runtime.crypto.activateReconnect.bind(runtime.crypto);let activated='';
   if(mode==='postcommit')runtime.store.commitAuthority=(...args:Parameters<Store['commitAuthority']>)=>{commit(...args);throw Error('OWNED_AFTER_COMMIT_FAULT');};
   if(mode==='activation')runtime.crypto.activateReconnect=(staged:Parameters<typeof activate>[0])=>{activate(staged);activated=(staged as any).sessionId;throw Error('OWNED_AFTER_ACTIVATION_FAULT');};
   try{if(mode==='owner-rotation'){const old=auth.context.bindingId;assert.equal((await auth.rotate()).status,201);assert.equal(security.ownerSessionBindingActive(old),false);assert.throws(()=>pendingRepair.consume(),/PAIRING_|DEVICE_TRUST_INVALID/);}else assert.throws(()=>pendingRepair.consume(),/OWNED_AFTER_/);}
   finally{runtime.store.commitAuthority=commit;runtime.crypto.activateReconnect=activate;}
   if(activated)assert.equal(runtime.crypto.hasSession(activated),false);
   const second=cold(runtime.store);assert.throws(()=>second.pairing.beginReconnect(initiation(second.pairing,device).request),/DEVICE_TRUST_INVALID/);
   assert.equal((await auth.logout()).status,200);await auth.close();groups.push('fresh-repair-'+mode+'-refenced');
  }
  // Normal owner rotation and logout keep public compatibility; original binding is never renewed.
  {
   const auth=await owner(),old=auth.context.bindingId,device=await pair(auth,'normal'),context=runtime.pairing.authenticate(device.issued.credential.token);
   runtime.pairing.acceptCommand(context,'task.list',1);assert.throws(()=>runtime.pairing.acceptCommand(context,'task.list',1),/SEQUENCE_REPLAYED/);
   const live=await connect(device),closing=closed(live);assert.equal((await auth.rotate()).status,201);assert.notEqual(auth.context.bindingId,old);assert.equal(security.ownerSessionBindingActive(old),false);assert.equal(await closing,4003);assert.throws(()=>runtime.pairing.authenticate(device.issued.credential.token),denied);
   const healthy=await pair(auth,'normal-repair');assert.ok(Date.parse(healthy.issued.credential.expiresAt)<=auth.context.expiresAt);assert.equal((await auth.logout()).status,200);await auth.close();groups.push('normal-rotation-logout-one-use-original-deadline');
  }
  console.log(JSON.stringify({task:'R6_OWNER_REPAIR_REGRESSION',groups:groups.length,namedGroups:groups,actualSingletonRuntime:true,actualOwnerHTTP:true,actualProtectedPairingApproval:true,actualP256:true,actualWebSockets:true,freshChildProcess:true,faults:'owned registry EPERM; explicit cleanup and post-effect faults',physicalDevice:false,rawCredentialsLogged:false}));
 }finally{
  for(const socket of sockets)socket.terminate();for(const auth of owners)await auth.close();runtime.realtime.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
}
