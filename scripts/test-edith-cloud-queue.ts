import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { FilePendingSyncStore } from '../server/cloud/pendingSyncStore';
import { CloudSyncWorker } from '../server/cloud/syncWorker';
import { SupabaseRegistry } from '../server/cloud/supabaseRegistry';
assert.equal(process.env.EDITH_TEST_MODE,'true');
const file=path.join(process.env.EDITH_TEST_DATA_DIR!,'queue-fixture.jsonl');
let writes=0,clock=10000,active=true;const unique=new Map<string,unknown>();
const app=express();app.use(express.json());
app.get('/auth/v1/user',(_req,res)=>res.json({id:'fixture-user'}));
app.post('/rest/v1/devices',(req,res)=>{writes++;if(writes===1){res.status(503).json({message:'fixture outage'});return;}unique.set(req.body.id,req.body);res.json([req.body]);});
app.post('/functions/v1/push-fixture',(req,res)=>{assert.equal(req.get('Idempotency-Key'),'event-fixture');res.json({accepted:true,receiptId:'provider-fixture-ack'});});
const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');
const base=`http://127.0.0.1:${address.port}`;
const registry=new SupabaseRegistry({env:{SUPABASE_URL:base,SUPABASE_ANON_KEY:'anon-fixture',EDITH_SUPABASE_PUSH_FUNCTION:'push-fixture'}});
const store=new FilePendingSyncStore(file);let worker=new CloudSyncWorker(store,registry,()=>active,()=>clock);
async function eventually(check:()=>boolean) { const deadline=Date.now()+3000; while(!check()) { if(Date.now()>deadline) throw Error('Automatic queue loop timed out'); await new Promise(resolve=>setTimeout(resolve,10)); } }
try{
 const item=store.enqueue({userId:'fixture-user',entity:'device',operation:'upsert',payload:{id:'fixture-device',name:'safe metadata'}});
 assert.equal(store.enqueue({userId:'fixture-user',entity:'device',operation:'upsert',payload:{id:'fixture-device',name:'safe metadata'}}).id,item.id);
 worker.start();await eventually(()=>worker.status().state==='CONFIGURATION_REQUIRED');assert.equal(writes,0);
 worker.restore('fixture-user','user-secret-canary','owner-fixture',clock+100000);await worker.drain();assert.equal(writes,1);assert.equal(store.pending()[0].attempts,1);
 await worker.drain();assert.equal(writes,1,'Backoff must prevent hot retry');await worker.shutdown();
 worker=new CloudSyncWorker(new FilePendingSyncStore(file),registry,()=>active,()=>clock);worker.start();await eventually(()=>worker.status().state==='CONFIGURATION_REQUIRED');assert.equal(writes,1,'Restart cannot restore token from disk');
 clock+=1001;worker.restore('fixture-user','user-secret-canary','owner-fixture',clock+100000);await eventually(()=>store.pending().length===0);assert.equal(writes,2);assert.equal(unique.size,1);assert.equal(store.pending().length,0);
 assert.equal(fs.readFileSync(file,'utf8').includes('user-secret-canary'),false);
 assert.throws(()=>store.enqueue({userId:'fixture-user',entity:'device',operation:'upsert',payload:{apiKey:'forbidden'}}),/QUEUE_SECRET/);
 store.enqueue({userId:'fixture-user',entity:'device',operation:'upsert',payload:{id:'another-device'}});active=false;await worker.drain();assert.equal(writes,2);assert.equal(worker.status().state,'CONFIGURATION_REQUIRED');
 const push=await registry.sendPush('fixture-token',{deviceId:'fixture-device',eventId:'event-fixture',kind:'task',resourceId:'fixture-task'});assert.equal(push.accepted,true);assert.equal(push.receiptId,'provider-fixture-ack');
 const missing=new SupabaseRegistry({env:{}});assert.equal(missing.pushStatus().status,'CONFIGURATION_REQUIRED');await assert.rejects(()=>missing.sendPush('fixture-token',{deviceId:'d',eventId:'e',kind:'task',resourceId:'r'}), (error:any)=>error.code==='CONFIGURATION_REQUIRED');
 console.log(JSON.stringify({pass:true,actualLoopbackSupabaseRest:true,automaticStartupRetryDrain:true,writes,uniqueRows:unique.size,restartAuthNotPersisted:true,retryBackoff:true,ackDurable:true,revokeBlocks:true,pushLocalHttpAck:true,physicalPush:false}));
}finally{await worker.shutdown();await new Promise<void>(resolve=>server.close(()=>resolve()));}
