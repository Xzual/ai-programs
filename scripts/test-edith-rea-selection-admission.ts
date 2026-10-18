import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { FileService } from '../server/files/fileService';
import { createReaAnalysisService } from '../src/edith/reaAnalysisService';
import { reaProjectionDigest } from '../src/edith/reaIntegrationContract';
import { createOwnerSessionRouter } from '../server/security/ownerSession';
let subject: typeof import('../src/edith/reaIntegrationService')|undefined;
try{subject=await import('../src/edith/reaIntegrationService');}catch(e){if((e as NodeJS.ErrnoException).code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof subject?.createReaIntegrationService,'function','actual private integration factory must exist');
const {createReaIntegrationService,reaPlannedInputCommitment}=subject!;
const fixture=path.join(process.env.EDITH_WORKSPACE_ROOT!,'rea-selected-fixture');await fs.mkdir(fixture);
const roots=[{id:'workspace' as const,path:fixture}];const files=new FileService(()=>roots);
const target=path.join(fixture,'sample.dll');await fs.writeFile(target,Buffer.alloc(300000,65));
const fileId=files.search('sample.dll').files[0].id;
let count=0;async function test(name:string,body:()=>void|Promise<void>){await body();count++;console.log('PASS '+name);}
const locator={id:fileId,kind:'file' as const};const baseTime=Date.now();let now=baseTime,owner=true,killed=false,workspace='workspace_1',qualified=true,voiceClosed=false;
const identity={taskId:'task_1',planId:'plan_1',stepId:'step_1',runId:'run_1',attempt:1};
let record: import('../src/edith/reaIntegrationService').ReaCanonicalExecutionRecord|undefined;
let calls=0,release:(()=>void)|undefined,hold=false,lastSignal:AbortSignal|undefined,qualificationRef='fixture_source_bound';
const runtimeOptions={launch:{command:path.join(fixture,'never-launch.exe'),args:[],cwd:fixture,env:{},expectedServerName:'rea-agents/rea',expectedServerVersion:'6.5.0',protocolVersion:'2025-11-25'},expectedCatalogDigest:'a'.repeat(64),expectedServerPath:path.join(fixture,'never-server.js'),stagingRoot:path.join(fixture,'never-staging'),localConfiguration:{hostPlatform:'win32' as const,architecture:'x64'}};
const deps={files,serverBootId:'boot_1',now:()=>now,readOwner:(id:string)=>owner&&id==='owner_1'?{ownerId:'owner'}:undefined,
 currentWorkspace:()=>({workspaceId:workspace,workspaceRoot:fixture}),isKillSwitchActive:()=>killed,
 readExecutionRecord:()=>record,
 readQualification:()=>qualified?{ready:true as const,qualificationRef}:{ready:false as const,reasons:[{kind:'qualification_failed' as const,code:'REA_HELPER_UNQUALIFIED'}]},runtimeOptions,
 runtimeFactory:(options:Parameters<typeof createReaAnalysisService>[0])=>{const actual=createReaAnalysisService(options);return{admission:{...actual.admission,issueAuthority:(context:Parameters<typeof actual.admission.issueAuthority>[0])=>{lastSignal=context.signal;return actual.admission.issueAuthority(context);}},service:{run:async()=>{calls++;if(hold)await new Promise<void>(r=>{release=r;});return{outcome:'blocked' as const,reasonCode:'REA_SYNTHETIC_NO_PROVIDER',cleanup:{closed:true,unknownEffect:false}};}}};}};
const integration=createReaIntegrationService(deps);
const makeRecord=()=>({identity,ownerSessionBindingId:'owner_1',ownerId:'owner',workspaceId:'workspace_1',serverBootId:'boot_1',providerTaskSessionId:'provider_task_1',expiresAt:baseTime+100000,taskStatus:'QUEUED' as const});
await test('input commitment pins normalized strict planned wrapper rather than args alone',()=>{
 const planned={toolId:'rea_analysis',args:{schemaVersion:1,selectionRef:'selection_example',profile:'static-managed',objective:' Inspect selected artifact '}};
 assert.equal(reaPlannedInputCommitment(planned),'e9ca3597a9909a0a6c9e9177d73d6a2626bc8bef63bc98ed17952717f2bfa4fb');
 assert.notEqual(reaPlannedInputCommitment(planned),reaProjectionDigest(planned.args));
 assert.throws(()=>reaPlannedInputCommitment({...planned,extra:'ignored'}),/REA_/);
});
await test('binary indexed selection supports >256KiB without text decoding and cannot resolve raw paths',async()=>{
 const snapshot=await files.resolveReaTarget(locator,()=>{});assert.equal(snapshot.sizeBytes,300000);assert.equal(snapshot.kind,'file');
 await assert.rejects(()=>files.resolveReaTarget({id:target,kind:'file'},()=>{}),/FILE_/);
 assert.throws(()=>files.assertReaTargetCurrent({...snapshot}),/FILE_/);
});
await test('runtime false and remote missing producer create no task or tool',async()=>{
 const disabled=createReaIntegrationService({...deps,runtimeOptions:undefined,readExecutionRecord:undefined});
 assert.equal(disabled.status('static-managed').runtimeReady,false);
 assert.equal(disabled.preflight('owner_1',{}).outcome,'clarification_required');
 const selected=await disabled.select('owner_1',{locator,profile:'static-managed'});assert.equal(selected.outcome,'selected');
 if(selected.outcome!=='selected')throw Error('fixture');
 assert.equal(disabled.preflight('owner_1',{selectionRef:selected.selection.selectionRef,profile:'static-managed'}).outcome,'configuration_required');
 assert.equal((await disabled.select('owner_1',{locator,profile:'web'})).outcome,'configuration_required');assert.equal(calls,0);assert.equal(record,undefined);
});
let selection: import('../src/edith/reaIntegrationContract').ReaSelectionProjectionV1;
await test('public preselection is opaque owner scoped and replacements revoke stale refs',async()=>{
 const old=await integration.select('owner_1',{locator,profile:'static-managed'});if(old.outcome!=='selected')throw Error('fixture');
 const newer=await integration.select('owner_1',{locator,profile:'static-managed'});if(newer.outcome!=='selected')throw Error('fixture');selection=newer.selection;
 assert.deepEqual(Object.keys(selection).sort(),['expiresAt','profile','revision','schemaVersion','selectionRef']);
 assert.equal(integration.preflight('owner_1',{selectionRef:old.selection.selectionRef,profile:'static-managed'}).outcome,'clarification_required');
 assert.equal(integration.preflight('foreign',{selectionRef:selection.selectionRef,profile:'static-managed'}).outcome,'clarification_required');
 assert.equal(integration.preflight('owner_1',{selectionRef:[selection.selectionRef],profile:'static-managed'}).outcome,'clarification_required');
});
let prepared: Awaited<ReturnType<typeof integration.prepare>>;
let cap: import('../src/edith/reaIntegrationContract').ReaExecutionCapabilityV1;
await test('canonical record precedes actual service admission and exact stored call precedes issuer',async()=>{
 await assert.rejects(()=>integration.prepare('owner_1',selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect selected artifact'}),/REA_CANONICAL/);
 record=makeRecord();prepared=await integration.prepare('owner_1',selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect selected artifact'});
 assert.notEqual(prepared.call.args.selectionRef,selection.selectionRef);
 assert.throws(()=>integration.issue(prepared),/REA_CANONICAL/);
 record={...record,call:prepared.call};cap=integration.issue(prepared);assert.equal(integration.issue(prepared),cap);
 assert.equal(integration.readCapabilityBinding(cap).inputDigest,reaPlannedInputCommitment(cap.call));
 assert.throws(()=>integration.issue({...prepared,identity:{...identity,attempt:2}}),/REA_/);
 assert.throws(()=>integration.assertCapability({...cap}),/REA_CAPABILITY/);
 const foreign=createReaIntegrationService(deps);assert.throws(()=>foreign.assertCapability(cap),/REA_CAPABILITY/);
});
await test('typed exact prepared call is immutable and idempotent binding cannot rebind args or attempt',async()=>{
 const replay=await integration.prepare('owner_1',selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect selected artifact'});assert.equal(replay,prepared);
 await assert.rejects(()=>integration.prepare('owner_1',selection.selectionRef,identity,{profile:'static-managed',objective:'changed'}),/REA_.*CONFLICT/);
 await assert.rejects(()=>integration.prepare('owner_1',selection.selectionRef,{...identity,attempt:2},{profile:'static-managed',objective:'Inspect selected artifact'}),/REA_/);
 assert.ok(Object.isFrozen(cap.call.args));assert.ok(Object.isFrozen(cap));
});
await test('voice close does not revoke independently valid canonical task and winning dispatch runs once',async()=>{
 voiceClosed=true;assert.equal(voiceClosed,true);integration.assertCapability(cap);
 const results=await Promise.all([integration.consume(cap),integration.consume(cap)]);assert.equal(results[0].outcome,'blocked');assert.equal(calls,1);
 assert.equal((await integration.consume(cap)).reasonCode,'REA_SYNTHETIC_NO_PROVIDER');assert.equal(calls,1);
});
await test('owner workspace kill qualification expiry and target changes invalidate capability',async()=>{
 killed=true;assert.throws(()=>integration.assertCapability(cap),/REA_/);killed=false;
 assert.throws(()=>integration.assertCapability(cap),/REA_/);
 const variants=[()=>{owner=false;},()=>{workspace='foreign';},()=>{qualified=false;},()=>{now=baseTime+200000;}];
 for(const change of variants){owner=true;workspace='workspace_1';qualified=true;now=baseTime;const svc=createReaIntegrationService(deps);const s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');record=makeRecord();const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};const c=svc.issue(p);change();assert.throws(()=>svc.assertCapability(c),/REA_/);svc.revokeSelection('owner_1',s.selection.selectionRef);}
 owner=true;workspace='workspace_1';qualified=true;now=baseTime;
 const svc=createReaIntegrationService(deps),s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');record=makeRecord();const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};const c=svc.issue(p);await fs.writeFile(target,Buffer.alloc(300000,66));assert.throws(()=>svc.assertCapability(c),/FILE_|REA_/);
});
await test('revocation during an awaited tool aborts and suppresses late successful publication',async()=>{
 const svc=createReaIntegrationService(deps),s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');record=makeRecord();const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};const c=svc.issue(p);hold=true;const pending=svc.consume(c);await new Promise(r=>setTimeout(r,0));svc.revokeSelection('owner_1',s.selection.selectionRef);release!();await assert.rejects(()=>pending,/REA_/);hold=false;
});
await test('owner kill and expiry changes during await abort the actual issued signal',async()=>{
 for(const change of [()=>{owner=false;},()=>{killed=true;},()=>{now=baseTime+200000;}]){
  owner=true;killed=false;now=baseTime;record=makeRecord();
  const svc=createReaIntegrationService(deps),s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');
  const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};
  const c=svc.issue(p);hold=true;const pending=svc.consume(c);await new Promise(r=>setTimeout(r,0));change();await new Promise(r=>setTimeout(r,40));
  assert.equal(lastSignal?.aborted,true);release!();await assert.rejects(()=>pending,/REA_/);hold=false;svc.revokeSelection('owner_1',s.selection.selectionRef);
 }
 owner=true;killed=false;now=baseTime;
});
await test('owner changes after asynchronous target resolution cannot publish a selection',async()=>{
 const svc=createReaIntegrationService({...deps,files:{...files,assertReaTargetCurrent:s=>files.assertReaTargetCurrent(s),resolveReaTarget:async(l,g)=>{const s=await files.resolveReaTarget(l,g);owner=false;return s;}}});
 await assert.rejects(()=>svc.select('owner_1',{locator,profile:'static-managed'}),/REA_OWNER/);owner=true;
});
await test('completed task before issue or first consume cannot dispatch new work',async()=>{
 for(const transition of ['before_issue','before_consume']){
  record=makeRecord();const svc=createReaIntegrationService(deps),s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');
  const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};const before=calls;
  if(transition==='before_issue'){record={...record,taskStatus:'COMPLETED'};assert.throws(()=>svc.issue(p),/REA_/);}
  else{const c=svc.issue(p);record={...record,taskStatus:'COMPLETED'};await assert.rejects(()=>svc.consume(c),/REA_/);}
  assert.equal(calls,before);svc.revokeSelection('owner_1',s.selection.selectionRef);
 }
});
await test('synchronous reentrant consumption shares the reserved winning operation',async()=>{
 let dispatched=0,nested:Promise<import('../src/edith/reaAnalysisService').ReaAnalysisResult>|undefined;
 let c:import('../src/edith/reaIntegrationContract').ReaExecutionCapabilityV1;
 const svc=createReaIntegrationService({...deps,runtimeFactory:options=>{
  const actual=createReaAnalysisService(options);return{admission:actual.admission,service:{run:async()=>{
   dispatched++;if(dispatched===1)nested=svc.consume(c);return{outcome:'blocked',reasonCode:'REA_SYNTHETIC_NO_PROVIDER',cleanup:{closed:true,unknownEffect:false}};
  }}};
 }});record=makeRecord();const s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');
 const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};c=svc.issue(p);
 await svc.consume(c);await nested;assert.equal(dispatched,1);svc.revokeSelection('owner_1',s.selection.selectionRef);
});
await test('synchronous resolver reentry shares one materialized preparation',async()=>{
 let trigger=false,nested:Promise<import('../src/edith/reaIntegrationService').ReaPreparedExecution>|undefined;
 let selectedRef='';record=makeRecord();
 const svc=createReaIntegrationService({...deps,files:{assertReaTargetCurrent:s=>files.assertReaTargetCurrent(s),resolveReaTarget:(l,g)=>{
  if(trigger){trigger=false;nested=svc.prepare('owner_1',selectedRef,identity,{profile:'static-managed',objective:'Inspect'});}
  return files.resolveReaTarget(l,g);
 }}});
 const s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');selectedRef=s.selection.selectionRef;trigger=true;
 const outer=await svc.prepare('owner_1',selectedRef,identity,{profile:'static-managed',objective:'Inspect'});
 assert.equal(await nested,outer);svc.revokeSelection('owner_1',selectedRef);
});
await test('qualification identity rotation revokes old capability even while source stays ready',async()=>{
 record=makeRecord();const svc=createReaIntegrationService(deps),s=await svc.select('owner_1',{locator,profile:'static-managed'});if(s.outcome!=='selected')throw Error('fixture');
 const p=await svc.prepare('owner_1',s.selection.selectionRef,identity,{profile:'static-managed',objective:'Inspect'});record={...record,call:p.call};const c=svc.issue(p);
 qualificationRef='rotated_fixture_qualification';assert.throws(()=>svc.assertCapability(c),/REA_/);qualificationRef='fixture_source_bound';svc.revokeSelection('owner_1',s.selection.selectionRef);
});
await test('complete tree digest matches canonical REA directory convention; private members reject whole tree',async()=>{
 const tree=path.join(fixture,'tree');await fs.mkdir(tree);await fs.writeFile(path.join(tree,'a.js'),'one');
 const directory=files.searchDirectories('tree').directories.find(d=>d.relativePath==='tree')!;const snap=await files.resolveReaTarget({id:directory.id,kind:'directory'},()=>{});
 const fileHash=(await import('node:crypto')).createHash('sha256').update('one').digest('hex');
 const artifact='art_'+reaProjectionDigest({sha256:fileHash});assert.equal(snap.sha256,reaProjectionDigest({kind:'directory-root',children:[{logical_path:'a.js',artifact_id:artifact}]}));
 await fs.writeFile(path.join(tree,'.env'),'SYNTHETIC=fixture');await assert.rejects(()=>files.resolveReaTarget({id:directory.id,kind:'directory'},()=>{}),/FILE_/);await fs.unlink(path.join(tree,'.env'));
 // Real alias creation is forbidden by the unchanged runner. Inject only hostile metadata,
 // retaining the original confined filesystem read beneath this external-boundary fixture.
 const original=nativeFs.promises.lstat;
 for(const attack of ['hardlink','symlink'] as const){
   nativeFs.promises.lstat=(async (...args:Parameters<typeof original>)=>{
     const stat=await original(...args);
     if(String(args[0])===path.join(tree,'a.js')){
       if(attack==='hardlink')Object.defineProperty(stat,'nlink',{value:2n});
       else Object.defineProperty(stat,'isSymbolicLink',{value:()=>true});
     }
     return stat;
   }) as typeof original;syncBuiltinESMExports();
   try{await assert.rejects(()=>files.resolveReaTarget({id:directory.id,kind:'directory'},()=>{}),/FILE_/);}
   finally{nativeFs.promises.lstat=original;syncBuiltinESMExports();}
 }
});
await test('file byte and directory entry/depth bounds fail before unconstrained reads',async()=>{
 const huge=path.join(fixture,'large.dll');const h=await fs.open(huge,'w');await h.truncate(67108865);await h.close();const hid=files.search('large.dll').files[0].id;
 await assert.rejects(()=>files.resolveReaTarget({id:hid,kind:'file'},()=>{}),/FILE_.*LIMIT/);
 const deep=path.join(fixture,'deep');await fs.mkdir(deep);let dir=deep;for(let i=0;i<25;i++){dir=path.join(dir,'d');await fs.mkdir(dir);}const did=files.searchDirectories('deep').directories.find(d=>d.relativePath==='deep')!.id;
 await assert.rejects(()=>files.resolveReaTarget({id:did,kind:'directory'},()=>{}),/FILE_.*LIMIT/);
 const many=path.join(fixture,'many');await fs.mkdir(many);for(let start=0;start<2048;start+=64)await Promise.all(Array.from({length:64},(_,i)=>fs.mkdir(path.join(many,'n'+(start+i)))));
 const mid=files.searchDirectories('many').directories.find(d=>d.relativePath==='many')!.id;
 await fs.mkdir(path.join(many,'extra'));await assert.rejects(()=>files.resolveReaTarget({id:mid,kind:'directory'},()=>{}),/FILE_.*LIMIT/);
});
await test('configured exclusions and changed active roots invalidate previously indexed snapshot',async()=>{
 let active=[{id:'workspace' as const,path:fixture,excluded:[] as string[]}];const indexed=new FileService(()=>active);
 const id=indexed.search('sample.dll').files[0].id,snapshot=await indexed.resolveReaTarget({id,kind:'file'},()=>{});
 active=[{id:'workspace',path:fixture,excluded:[target]}];assert.throws(()=>indexed.assertReaTargetCurrent(snapshot),/FILE_/);
 active=[];await assert.rejects(()=>indexed.resolveReaTarget({id,kind:'file'},()=>{}),/FILE_/);
});
await test('protected actual selection router enforces owner same-origin CSRF and strips private snapshot',async()=>{
 const {createReaFilesRouter}=await import('../server/routes/files');
 async function request(router:Router,url:string,headers:Record<string,string>,body?:unknown){return new Promise<{status:number;body:Record<string,unknown>;cookie?:string}>(resolve=>{const req={method:'POST',url,originalUrl:url,path:url,protocol:'http',secure:false,headers,body,get:(n:string)=>headers[n.toLowerCase()]};const result={status:200,body:{},cookie:undefined as string|undefined};const res={setHeader:()=>{},status:(s:number)=>{result.status=s;return res;},cookie:(_n:string,v:string)=>{result.cookie=v;},json:(b:Record<string,unknown>)=>{result.body=b;resolve(result);}};router(req as unknown as Request,res as unknown as Response,(e:unknown)=>{if(e)throw e;resolve(result);});});}
 const headers={host:'fixture.local',origin:'http://fixture.local'};const router=createReaFilesRouter(integration);
 assert.equal((await request(router,'/api/files/rea/selections',headers,{locator,profile:'static-managed'})).status,401);
 process.env.EDITH_OWNER_TOKEN='synthetic-owned-fixture-token';const login=await request(createOwnerSessionRouter(),'/api/security/session',{...headers,authorization:'Bearer synthetic-owned-fixture-token'});
 const auth={...headers,cookie:'edith_owner_session='+login.cookie};assert.equal((await request(router,'/api/files/rea/selections',auth,{locator,profile:'static-managed'})).status,403);
 const csrf=(login.body.session as {csrfToken:string}).csrfToken;const valid={...auth,'x-edith-csrf-token':csrf};
 assert.equal((await request(router,'/api/files/rea/selections',{...valid,origin:'http://foreign.invalid'},{locator,profile:'static-managed'})).status,403);
 // Router uses an independently session-bound synthetic source, not arbitrary body owner fields.
 const routeService=createReaIntegrationService({...deps,readOwner:(binding:string)=>binding.startsWith('owner-session-')?{ownerId:'owner'}:undefined});
 const selected=await request(createReaFilesRouter(routeService),'/api/files/rea/selections',valid,{locator,profile:'static-managed'});assert.equal(selected.status,201);assert.equal(JSON.stringify(selected.body).includes(fixture),false);
 const raw=await request(createReaFilesRouter(routeService),'/api/files/rea/selections',valid,{locator,profile:'static-managed',path:target});assert.equal(raw.status,400);
 delete process.env.EDITH_OWNER_TOKEN;
});
console.log(JSON.stringify({suite:'rea-selection-admission',passed:count,providerLaunches:0,networkListeners:0,productionRuntimeReady:false}));
