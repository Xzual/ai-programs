import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { PushService, type PushEnvironment } from '../supabase/functions/edith-push/pushService';
import { SupabaseRegistry } from '../server/cloud/supabaseRegistry';
import { createCloudRouter } from '../server/routes/cloud';
import { createOwnerSessionRouter } from '../server/security/ownerSession';
assert.equal(process.env.EDITH_TEST_MODE,'true');
const userId='11111111-1111-4111-8111-111111111111',otherUser='22222222-2222-4222-8222-222222222222';
const registrationToken='FCM-fixture-token-must-not-leave-responses';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const env:PushEnvironment={SUPABASE_URL:'https://fixture.supabase.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-role',EDITH_PUSH_TOKEN_KEY:Buffer.alloc(32,17).toString('base64'),FCM_PROJECT_ID:'fixture-project',FCM_CLIENT_EMAIL:'fixture@fixture-project.iam.gserviceaccount.com',FCM_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString()};
let clock=Date.now(),providerCalls=0,oauthCalls=0,mode='accepted',failFinish=false;
let registration:any;const ledger=new Map<string,any>();const providerBodies:any[]=[];
const app=express();app.use(express.json({limit:'20kb'}));app.use(express.urlencoded({extended:false}));
app.get('/auth/v1/user',(req,res)=>{
  assert.equal(req.get('apikey'),'fixture-anon');
  const auth=req.get('authorization');if(auth==='Bearer fixture-user')res.json({id:userId});else if(auth==='Bearer other-user')res.json({id:otherUser});else res.status(401).json({});
});
app.get('/rest/v1/devices',(req,res)=>res.json(req.query.user_id===`eq.${userId}` && req.query.id==='eq.android-fixture' ? [{id:'android-fixture',user_id:userId,platform:'android'}] : []));
app.post('/rest/v1/rpc/:name',(req,res)=>{
  assert.equal(req.get('authorization'),'Bearer fixture-role');assert.equal(req.get('apikey'),'fixture-role');
  const p=req.body;
  const deny=(message:string)=>res.status(403).json({message});
  if(p.p_user_id!==userId || p.p_device_id!=='android-fixture'){deny('DEVICE_NOT_AUTHORIZED');return;}
  if(req.params.name==='edith_push_register') {
    if(p.p_revoke){if(registration)registration.revoked=true;res.json({registered:false,revoked:true});return;}
    assert.equal(JSON.stringify(p).includes(registrationToken),false,'Token is encrypted before RPC/storage');
    registration={ciphertext:p.p_ciphertext,iv:p.p_iv,version:randomUUID(),revoked:false};res.json({registered:true,revoked:false});return;
  }
  if(req.params.name==='edith_push_claim') {
    if(!['own-task','own-transfer'].includes(p.p_resource_id) || (p.p_resource_id==='own-task' ? p.p_kind!=='task' : p.p_kind!=='transfer')){deny('RESOURCE_NOT_AUTHORIZED');return;}
    if(!registration || registration.revoked){res.status(428).json({message:'PUSH_REGISTRATION_REQUIRED'});return;}
    const key=p.p_user_id+':'+p.p_device_id+':'+p.p_event_id;let row=ledger.get(key);
    if(row && row.fingerprint!==p.p_fingerprint){res.status(409).json({message:'PUSH_IDEMPOTENCY_CONFLICT'});return;}
    if(row && !(row.state==='retry_wait' && row.retryAt<=clock)){res.json({state:row.state,receiptId:row.receiptId});return;}
    row={state:'sending',attemptId:randomUUID(),fingerprint:p.p_fingerprint};ledger.set(key,row);
    res.json({state:'claimed',attemptId:row.attemptId,...registration});return;
  }
  if(req.params.name==='edith_push_finish') {
    if(failFinish){res.status(503).json({message:'fixture write outage'});return;}
    const row=ledger.get(p.p_user_id+':'+p.p_device_id+':'+p.p_event_id);
    if(!row || row.attemptId!==p.p_attempt_id || row.state!=='sending'){res.status(409).json({message:'PUSH_ATTEMPT_STALE'});return;}
    row.state=p.p_state;row.receiptId=p.p_receipt_id;row.retryAt=clock+Math.max(60,p.p_retry_seconds)*1000;
    if(p.p_revoke && registration.version===p.p_version)registration.revoked=true;
    res.json({recorded:true});return;
  }
  res.status(404).json({});
});
app.post('/oauth/token',(req,res)=>{
  oauthCalls++;
  assert.equal(req.body.grant_type,'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header,payload,signature]=req.body.assertion.split('.');
  assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),keys.publicKey,Buffer.from(signature,'base64url')),true);
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.exp-claims.iat,3600);
  res.json({access_token:'fixture-oauth-secret',expires_in:3600});
});
app.post('/fcm/send',(req,res)=>{
  providerCalls++;providerBodies.push(req.body);
  assert.equal(req.get('authorization'),'Bearer fixture-oauth-secret');assert.equal(req.body.message.token,registrationToken);
  assert.deepEqual(Object.keys(req.body.message.data).sort(),['eventId','kind','resourceId']);
  if(mode==='ambiguous'){req.socket.destroy();return;}
  if(mode==='unregistered'){res.status(404).json({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}});return;}
  if(mode==='retry'){res.set('Retry-After','120').status(503).json({error:{status:'UNAVAILABLE'}});return;}
  if(mode==='permission'){res.status(403).json({error:{status:'PERMISSION_DENIED'}});return;}
  if(mode==='malformed'){res.json({success:true});return;}
  res.json({name:`projects/fixture-project/messages/receipt-${providerCalls}`});
});
const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
const wire:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.origin==='https://fixture.supabase.invalid')return fetch(base+url.pathname+url.search,init);
  if(url.href==='https://oauth2.googleapis.com/token')return fetch(base+'/oauth/token',init);
  assert.equal(url.href,'https://fcm.googleapis.com/v1/projects/fixture-project/messages:send');
  return fetch(base+'/fcm/send',init);
};
let service=new PushService(env,wire,()=>clock);
const edge=async(body:unknown,token='fixture-user')=>{
  const eventId=(body as any).eventId;
  const request=new Request('https://fixture.supabase.invalid/functions/v1/edith-push',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...(eventId?{'Idempotency-Key':eventId}:{})},body:JSON.stringify(body)});
  const response=await service.handle(request);const json=await response.json();
  assert.equal(JSON.stringify(json).includes(registrationToken),false);assert.equal(JSON.stringify(json).includes('fixture-oauth-secret'),false);assert.equal(JSON.stringify(json).includes('fixture-role'),false);assert.equal(json.delivered,false);
  return {status:response.status,json};
};
const push=(eventId:string,resourceId='own-task',kind='task')=>edge({deviceId:'android-fixture',eventId,kind,resourceId});
try {
  const absent=new PushService({},wire);assert.equal((await absent.handle(new Request('https://fixture.invalid',{method:'POST'}))).status,503);
  assert.equal((await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:true},'invalid')).status,401);
  assert.equal((await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:true},'other-user')).status,403);
  assert.equal((await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:false})).status,400);
  assert.equal((await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:true})).status,200);
  assert.equal(JSON.stringify(registration).includes(registrationToken),false);
  assert.equal((await push('foreign-resource','someone-elses-task')).status,403);assert.equal(providerCalls,0);
  const concurrent=await Promise.all([push('concurrent'),push('concurrent')]);
  assert.equal(providerCalls,1,'Atomic claim permits only one provider send');assert.ok(concurrent.some(result=>result.status===202));
  assert.equal((await push('concurrent')).json.deduplicated,true);assert.equal(providerCalls,1);
  assert.equal((await push('concurrent','own-transfer','transfer')).json.errorCode,'PUSH_IDEMPOTENCY_CONFLICT');
  mode='ambiguous';assert.equal((await push('ambiguous')).json.errorCode,'PUSH_OUTCOME_UNKNOWN');const afterAmbiguous=providerCalls;
  service=new PushService(env,wire,()=>clock);assert.equal((await push('ambiguous')).status,409);assert.equal(providerCalls,afterAmbiguous,'Restart cannot retry ambiguous send');
  mode='malformed';assert.equal((await push('malformed')).json.errorCode,'PUSH_OUTCOME_UNKNOWN');const afterMalformed=providerCalls;await push('malformed');assert.equal(providerCalls,afterMalformed);
  mode='retry';assert.equal((await push('retry')).json.errorCode,'PUSH_RETRY_WAIT');const afterRetry=providerCalls;await push('retry');assert.equal(providerCalls,afterRetry);clock+=120001;mode='accepted';assert.equal((await push('retry')).status,202);assert.equal(providerCalls,afterRetry+1);
  mode='unregistered';assert.equal((await push('unregistered')).json.errorCode,'PUSH_REGISTRATION_REVOKED');assert.equal(registration.revoked,true);const afterRevoke=providerCalls;assert.equal((await push('revoked')).status,428);assert.equal(providerCalls,afterRevoke);
  await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:true});
  mode='accepted';failFinish=true;assert.equal((await push('ack-db-loss')).json.errorCode,'PUSH_OUTCOME_UNKNOWN');failFinish=false;const afterDbLoss=providerCalls;await push('ack-db-loss');assert.equal(providerCalls,afterDbLoss,'Lost ack persistence must never double-send');
  await edge({action:'revoke',deviceId:'android-fixture'});assert.equal(registration.revoked,true);
  await edge({action:'register',deviceId:'android-fixture',registrationToken,consent:true});
  // Mount the real cloud router/default Supabase invocation class against the local Edge Function fixture.
  app.post('/functions/v1/edith-push',async(req,res)=>{
    const result=await service.handle(new Request('https://fixture.supabase.invalid/functions/v1/edith-push',{method:'POST',headers:{'content-type':'application/json',authorization:req.get('authorization')??'',...(req.get('Idempotency-Key')?{'Idempotency-Key':req.get('Idempotency-Key')!}:{})},body:JSON.stringify(req.body)}));
    res.status(result.status).json(await result.json());
  });
  const registry=new SupabaseRegistry({env:{SUPABASE_URL:base,SUPABASE_ANON_KEY:'fixture-anon',EDITH_SUPABASE_PUSH_FUNCTION:'edith-push'}});
  const routerApp=express();routerApp.use(express.json());routerApp.use(createOwnerSessionRouter());routerApp.use(createCloudRouter(registry));const backend=createServer(routerApp);
  process.env.EDITH_OWNER_TOKEN='fixture-push-owner';await new Promise<void>(resolve=>backend.listen(0,'127.0.0.1',resolve));const backendAddress=backend.address();assert(backendAddress&&typeof backendAddress!=='string');const origin=`http://127.0.0.1:${backendAddress.port}`;
  try {
    const login=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer fixture-push-owner'}});assert.equal(login.status,201);const loginBody=await login.json() as any;
    const headers={origin,cookie:login.headers.get('set-cookie')!.split(';')[0],'x-edith-csrf-token':loginBody.session.csrfToken,authorization:'Bearer fixture-user','content-type':'application/json'};
    assert.equal((await fetch(origin+'/api/cloud/push/registration',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'register',deviceId:'android-fixture',registrationToken,consent:true})})).status,401);
    const registered=await fetch(origin+'/api/cloud/push/registration',{method:'POST',headers,body:JSON.stringify({action:'register',deviceId:'android-fixture',registrationToken,consent:true})});assert.equal(registered.status,200);assert.equal(JSON.stringify(await registered.json()).includes(registrationToken),false);
    const sent=await fetch(origin+'/api/cloud/push',{method:'POST',headers,body:JSON.stringify({deviceId:'android-fixture',eventId:'router-send',kind:'task',resourceId:'own-task'})});assert.equal(sent.status,202);const sentBody=await sent.json() as any;assert.equal(sentBody.accepted,true);assert.equal(sentBody.delivered,false);
    await assert.rejects(()=>registry.sendPush('fixture-user',{deviceId:'android-fixture',eventId:'ambiguous',kind:'task',resourceId:'own-task'}),(error:any)=>error.code==='PUSH_OUTCOME_UNKNOWN');
    assert.equal((await fetch(origin+'/api/cloud/push',{method:'POST',headers:{...headers,'x-edith-csrf-token':'bad'},body:'{}'})).status,403);
  }finally{await new Promise<void>(resolve=>backend.close(()=>resolve()));}
  const sql=fs.readFileSync('supabase/migrations/202610060002_edith_push.sql','utf8');
  assert.match(sql,/enable row level security/);assert.match(sql,/from public, anon, authenticated/);assert.match(sql,/for update/);assert.match(sql,/version=p_version/);
  console.log(JSON.stringify({pass:true,actualLoopbackOAuthAndFcmHttp:true,oauthJwtSignatureVerified:true,encryptedTokenRegistration:true,ownerDeviceResourceAuth:true,concurrentOneSend:true,restartAmbiguousNoResend:true,retryAfterHonored:true,permanentTokenRevoked:true,ackPersistenceLossUnknown:true,realCloudRouterBound:true,providerCalls,oauthCalls,sqlExecution:'not_run_no_local_postgres',deployed:false,physicalDelivery:false}));
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
