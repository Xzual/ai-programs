import {getMobileOwnerSessionFixture} from './helpers/mobile-owner-session-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import express from 'express';
import {MobileCryptoService} from '../server/mobile/crypto';
import {MobilePairingService} from '../server/mobile/pairingService';
import {MobileRegistryStore} from '../server/mobile/registryStore';
import {MobileRealtimeService} from '../server/mobile/realtime';
import {MobileTransferService} from '../server/mobile/transferService';
import {CrossDeviceService} from '../server/mobile/crossDeviceService';
import type {MobileRuntime} from '../server/mobile/runtime';
import {createMobileTasksRouter} from '../server/routes/mobileTasks';
import {taskService} from '../src/edith/taskService';
import {getEdithPersistenceStore} from '../src/edith/persistence';
import type {EdithVerificationResult} from '../src/edith/core';
import {normalizeLegacyTask,deriveTaskProgress,projectTaskEventsV2,parseTaskEventV2,TASK_CONTRACT_VERSION,EDITH_CONTRACT_AMENDMENT} from '../src/edith/contracts';

const mobileOwnerFixture=await getMobileOwnerSessionFixture();
await mobileOwnerFixture.close(); // Owner session remains active; only the fixture listener closes.
assert.equal(process.env.EDITH_TEST_MODE,'true');
const data=path.join(process.env.EDITH_TEST_DATA_DIR!,'projection-fixture');
const store=new MobileRegistryStore(data);store.initialize();const crypto=new MobileCryptoService();const pairing=new MobilePairingService(store,crypto);
const realtime=new MobileRealtimeService(pairing,crypto,store.serverId());
const runtime:MobileRuntime={store,crypto,pairing,realtime,transfers:new MobileTransferService(store,data),crossDevice:new CrossDeviceService(store.serverId())};
const signing=generateKeyPairSync('ed25519'),agreement=generateKeyPairSync('x25519');
const offer=pairing.request({device:{deviceId:'projection-fixture-device',displayName:'Fixture',platform:'android',capabilities:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,realtime:true,fileTransfer:false,notifications:false,camera:false,microphone:false,computerControl:false,browserControl:false}},signingPublicKeyJwk:signing.publicKey.export({format:'jwk'}) as JsonWebKey,agreementPublicKeyJwk:agreement.publicKey.export({format:'jwk'}) as JsonWebKey,requestedCommands:['task.list','task.detail','task.activity']});
const proof=(text:string)=>sign(null,Buffer.from(text),signing.privateKey).toString('base64url');
pairing.submitProof(offer.pairing.pairingId,proof(offer.proofPayload));pairing.approve(offer.pairing.pairingId,offer.code,undefined,mobileOwnerFixture.pairingOwnerFor(60000));
const credential=pairing.consume(offer.pairing.pairingId,proof(offer.proofPayload+'\nconsume')).credential;
const app=express();app.use(express.json());app.use(createMobileTasksRouter({runtime}));const server=createServer(app);
function assertSnapshot(wire:any,taskId:string) {
  const actual=normalizeLegacyTask(taskService.getTask(taskId)!);
  assert.equal(wire.contractVersion,actual.contractVersion);assert.equal(wire.contractVersion,2);
  assert.equal(wire.eventSequence,actual.eventSequence);assert.ok(Number.isSafeInteger(wire.eventSequence) && wire.eventSequence>=0);
  assert.equal(wire.revision,actual.revision);assert.ok(wire.revision>=1);assert.ok(wire.id && wire.title);
  assert.ok(['low','normal','high','urgent'].includes(wire.priority));assert.deepEqual(wire.progress,JSON.parse(JSON.stringify(deriveTaskProgress(actual))));
  assert.equal(wire.progress.taskId,wire.id);assert.equal(wire.progress.revision,wire.revision);assert.equal(wire.progress.status,wire.status);
  assert.ok(wire.progress.percent>=0 && wire.progress.percent<=100);assert.ok(wire.progress.completedSteps>=0 && wire.progress.totalSteps>=0);
  assert.ok(wire.progress.sources.every((source:string)=>['task_status','plan_steps','verification','recovery'].includes(source)));
  assert.equal(wire.progress.terminal,['COMPLETED','FAILED','CANCELLED','ROLLED_BACK'].includes(wire.status));
  return actual;
}
try {
  const initial=taskService.createTask({title:'Projection fixture',objective:'Own isolated snapshot',originalUserRequest:'Fixture only',riskLevel:0});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
  const headers={authorization:`Device ${credential.token}`};
  const fetchEncrypted=async(route:string,purpose:string)=>{
    const response=await fetch(origin+route,{headers});assert.equal(response.status,200);const wrapper=await response.json() as any;
    assert.equal(wrapper.success,true);assert.equal('tasks' in wrapper,false);assert.equal('task' in wrapper,false);
    return crypto.decrypt<any>(credential.sessionId,wrapper.envelope,purpose,'server_to_client','http');
  };
  const first=await fetchEncrypted(`/api/mobile/tasks/${initial.id}`,'task.detail.result');const normalizedFirst=assertSnapshot(first.task,initial.id);
  taskService.updateStatus(initial.id,'PLANNING');taskService.addObservation(initial.id,'real fixture observation');taskService.updateStatus(initial.id,'RUNNING');
  const detail=await fetchEncrypted(`/api/mobile/tasks/${initial.id}`,'task.detail.result');const normalized=assertSnapshot(detail.task,initial.id);
  assert.ok(detail.task.eventSequence>first.task.eventSequence,'Sequence follows actual canonical task events, not a constant');assert.ok(normalized.revision>normalizedFirst.revision);
  const listed=await fetchEncrypted('/api/mobile/tasks?limit=100','task.list.result');const task=listed.tasks.find((item:any)=>item.id===initial.id);assert.ok(task);assertSnapshot(task,initial.id);assert.deepEqual(task,detail.task);
  const activity=await fetchEncrypted(`/api/mobile/tasks/${initial.id}/activity`,'task.activity.result');assertSnapshot(activity.task,initial.id);
  const projected=projectTaskEventsV2(normalized);assert.deepEqual(activity.events,JSON.parse(JSON.stringify(projected.events)));assert.deepEqual(activity.eventDiagnostics,JSON.parse(JSON.stringify(projected.diagnostics)));
  for(const event of activity.events){assert.equal(parseTaskEventV2(event).success,true);assert.ok(event.sequence<=detail.task.eventSequence);}
  const verification=(taskId:string):EdithVerificationResult=>({id:'projection-proof',taskId,verifier:'heuristic-v1',status:'PASS',checkedAt:new Date().toISOString(),summary:'Required output read back',checks:[{id:'readback',label:'Output exists',status:'PASS',required:true,evidence:'Read back the fixture output and matched its expected content.'},{id:'diagnostic',label:'Optional check',status:'FAIL',required:false,evidence:'Optional diagnostic failed.'}],retryable:false});
  const putVerification=(value:unknown)=>getEdithPersistenceStore().updateTask({...taskService.getTask(initial.id)!,status:'COMPLETED',verification:value as EdithVerificationResult});
  // This assertion is a fixture proof predicate, not Android runtime evidence.
  const earnsProof=(wire:any,current:any,fresh=true)=>fresh&&wire.id===current.id&&wire.revision===current.revision&&wire.eventSequence===current.eventSequence&&wire.status==='COMPLETED'&&wire.verification?.taskId===wire.id&&wire.verification.status==='PASS'&&wire.verification.retryable===false&&wire.verification.checks.some((check:any)=>check.required)&&wire.verification.checks.filter((check:any)=>check.required).every((check:any)=>check.status==='PASS'&&typeof check.evidence==='string'&&!!check.evidence.trim());
  const positive=verification(initial.id);taskService.recordVerification(initial.id,positive);
  const proven=await fetchEncrypted(`/api/mobile/tasks/${initial.id}`,'task.detail.result');assert.deepEqual(proven.task.verification,positive);assertSnapshot(proven.task,initial.id);assert.equal(earnsProof(proven.task,taskService.getTask(initial.id)),true);
  assert.equal(earnsProof(proven.task,taskService.getTask(initial.id),false),false,'Old session snapshot cannot earn proof');assert.equal(earnsProof(proven.task,{...taskService.getTask(initial.id),revision:proven.task.revision+1}),false,'Old revision cannot earn proof');
  for(const route of [['/api/mobile/tasks?limit=100','task.list.result'],[`/api/mobile/tasks/${initial.id}/activity`,'task.activity.result']]){const body=await fetchEncrypted(route[0],route[1]);const wire=body.task??body.tasks.find((item:any)=>item.id===initial.id);assert.deepEqual(wire.verification,positive);}
  const omitted:string[]=[];
  const invalids:Record<string,any>={wrongTask:{...positive,taskId:'other-task'},blankRequired:{...positive,checks:[{...positive.checks[0],evidence:'   '}]},redactedRequired:{...positive,checks:[{...positive.checks[0],evidence:'token=fixture-secret'}]},redactedPath:{...positive,checks:[{...positive.checks[0],evidence:'C:\\Users\\Fixture\\proof.txt'}]},oversizeEvidence:{...positive,checks:[{...positive.checks[0],evidence:'界'.repeat(334)}]},duplicateId:{...positive,checks:[positive.checks[0],positive.checks[0]]},tooManyChecks:{...positive,checks:Array.from({length:33},(_,i)=>({...positive.checks[0],id:`check-${i}`}))},notBoolean:{...positive,retryable:'false'},requiredNotBoolean:{...positive,checks:[{...positive.checks[0],required:'true'}]},wrongVerifier:{...positive,verifier:'unknown'},unknownStatus:{...positive,status:'UNKNOWN'},futureTime:{...positive,checkedAt:new Date(Date.now()+60000).toISOString()},invalidTime:{...positive,checkedAt:'not-time'},oversizeProjection:{...positive,checks:Array.from({length:32},(_,i)=>({...positive.checks[0],id:`check-${i}`,evidence:'"'.repeat(1000)}))}};
  invalids.blankId={...positive,id:' '};invalids.blankCheckId={...positive,checks:[{...positive.checks[0],id:''}]};invalids.oversizeLabel={...positive,checks:[{...positive.checks[0],label:'界'.repeat(67)}]};invalids.oversizeSummary={...positive,summary:'界'.repeat(334)};invalids.unknownCheckStatus={...positive,checks:[{...positive.checks[0],status:'UNKNOWN'}]};
  for(const [name,value] of Object.entries(invalids)){putVerification(value);for(const route of [[`/api/mobile/tasks/${initial.id}`,'task.detail.result'],['/api/mobile/tasks?limit=100','task.list.result'],[`/api/mobile/tasks/${initial.id}/activity`,'task.activity.result']]){const body=await fetchEncrypted(route[0],route[1]);const wire=body.task??body.tasks.find((item:any)=>item.id===initial.id);assertSnapshot(wire,initial.id);assert.equal(wire.verification,undefined,name);assert.equal(earnsProof(wire,taskService.getTask(initial.id)),false,name);}omitted.push(name);}
  for(const status of ['FAIL','PARTIAL','RETRYABLE'] as const){const value={...positive,status,retryable:status==='RETRYABLE'};putVerification(value);const body=await fetchEncrypted(`/api/mobile/tasks/${initial.id}`,'task.detail.result');assert.deepEqual(body.task.verification,value);assert.equal(earnsProof(body.task,taskService.getTask(initial.id)),false,status);}
  for(const [name,value] of Object.entries({zeroRequired:{...positive,checks:[]},retryablePass:{...positive,retryable:true},failedRequired:{...positive,checks:[{...positive.checks[0],status:'FAIL'}]},successOnly:undefined})){putVerification(value);const body=await fetchEncrypted(`/api/mobile/tasks/${initial.id}`,'task.detail.result');assert.equal(earnsProof(body.task,taskService.getTask(initial.id)),false,name);}
  // Escaped JSON bytes exceed the shared optional allocation while each full projection fits.
  for(let i=0;i<8;i++){const row=taskService.createTask({title:`Budget fixture ${i}`,objective:'Own bounded fixture',originalUserRequest:'Fixture',riskLevel:0});taskService.recordVerification(row.id,{...verification(row.id),checks:Array.from({length:32},(_,index)=>({id:`budget-${index}`,label:'Budget check',status:'PASS',required:true,evidence:'"'.repeat(650)}))});}
  const budget=await fetchEncrypted('/api/mobile/tasks?limit=100','task.list.result');let allocated=0,projectedCount=0;
  for(const row of budget.tasks){if(row.verification){const bytes=Buffer.byteLength(JSON.stringify(row.verification));assert.ok(bytes<=48*1024);allocated+=bytes+Buffer.byteLength(',"verification":');projectedCount++;assert.equal(row.verification.checks.length,32);}}
  assert.ok(projectedCount>0&&projectedCount<8,'Whole optional projections omitted at allocation/transport cap');assert.ok(allocated<=256*1024);assert.ok(Buffer.byteLength(JSON.stringify(budget))<=512*1024);assert.ok(Buffer.byteLength(JSON.stringify(budget))<=75000,'Frozen envelope ciphertext limit respected');assert.ok(budget.tasks.filter((row:any)=>row.title.startsWith('Budget fixture')).length===8,'No core tasks removed');
  const beforeOverflow=taskService.getTask(initial.id)!;
  // Owned corrupt-storage fixture: core activity cannot fit even after optional proof removal.
  getEdithPersistenceStore().updateTask({...beforeOverflow,timeline:beforeOverflow.timeline.map((row,index)=>index===0?{...row,fixturePadding:'x'.repeat(512*1024)}:row)});
  const overflow=await fetch(origin+`/api/mobile/tasks/${initial.id}/activity`,{headers});assert.equal(overflow.status,400);const overflowBody=await overflow.json() as any;assert.equal(overflowBody.errorCode,'MOBILE_RESPONSE_LIMIT');assert.ok(Buffer.byteLength(JSON.stringify(overflowBody))<1024);getEdithPersistenceStore().updateTask(beforeOverflow);
  assert.equal((await fetch(origin+'/api/mobile/tasks')).status,401);assert.equal((await fetch(origin+'/api/mobile/tasks',{headers:{authorization:'Device invalid'}})).status,401);
  const current=store.getDevice(credential.deviceId)!;store.saveDevice({...current,allowedCommands:['task.list']});assert.equal((await fetch(origin+`/api/mobile/tasks/${initial.id}`,{headers})).status,403);store.saveDevice(current);
  const snapshots={fixture:'actual mounted encrypted mobileTasks router; decrypted using actual session crypto',physicalAndroidParserRun:false,task:detail.task,activityEventSequences:activity.events.map((event:any)=>event.sequence),firstEventSequence:first.task.eventSequence};
  const reportDir=process.env.W6_HTTP_REPORT_DIR?path.join(process.env.W6_HTTP_REPORT_DIR,'projection'):path.join(process.cwd(),'artifacts/repair-20261006/chat4/w6-reconnect-projection/projection');fs.mkdirSync(reportDir,{recursive:true});
  fs.writeFileSync(path.join(reportDir,'mounted-mobile-task-snapshot.json'),JSON.stringify({...snapshots,provenTask:proven.task,omitted,optionalAllocationBytes:allocated,projectedBudgetCount:projectedCount},null,2));
  console.log(JSON.stringify({pass:true,actualMountedEncryptedListDetailActivity:true,canonicalVersion:detail.task.contractVersion,firstEventSequence:first.task.eventSequence,currentEventSequence:detail.task.eventSequence,realRevision:detail.task.revision,strictSnapshotFieldChecks:true,canonicalRequiredProof:true,negativeProjectionCases:omitted,optionalAllocationBytes:allocated,authAndPermissionsUnchanged:true,physicalDevice:false,androidParserExecuted:false}));
}finally{realtime.shutdown();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
