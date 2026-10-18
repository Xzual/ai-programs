import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import express from 'express';
import type {EdithPlan} from '../src/edith/core';
import type {BrowserParentExecutionCap} from '../server/browser/browserPrivateContract';
import {projectTaskEventsV2} from '../src/edith/contracts';

async function main(){
  assert.equal(process.env.EDITH_TEST_MODE,'true');assert(process.env.EDITH_TEST_DATA_DIR);const out=process.env.W5_HTTP_REPORT_DIR!;assert(out);
  const rows:Array<Record<string,unknown>>=[];let cookie='',csrf='',owner='',grantId='',base='',hits=0,omit=false,finished=false,restartTask='';
  let hold:undefined|{seen:Promise<void>;notify:()=>void;release:()=>void};
  const credential=randomUUID();process.env.EDITH_OWNER_TOKEN=credential;process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
  const {createOwnerSessionRouter,getSoleActiveOwnerSession}=await import('../server/security/ownerSession');
  const {createPermissionsRouter}=await import('../server/routes/permissions');
  const {createTasksRouter}=await import('../server/routes/tasks');
  const {browserWorkflowService:producer}=await import('../src/edith/browserWorkflowService');
  const {setBrowserOperatorTestOptions,getBrowserOperatorAdapter}=await import('../src/edith/browserOperatorAdapter');
  const {taskService,registerGenericTaskPublisher}=await import('../src/edith/taskService');
  const {executorService}=await import('../src/edith/executor');
  const {verificationService}=await import('../src/edith/verifier');
  const {readRecentAuditEvents}=await import('../src/edith/audit');
  const {getEdithPersistenceStore}=await import('../src/edith/persistence');
  const {getMobileRuntime}=await import('../server/mobile/runtime');
  const app=express();app.use(express.json({limit:'16kb'}));app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createTasksRouter());
  const fixture=http.createServer((req,res)=>{hits++;const url=new URL(req.url!,'http://127.0.0.1');if(!['/', '/search','/result'].includes(url.pathname)){res.writeHead(404).end();return;}const respond=()=>{if(res.destroyed)return;res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(omit?'<title>Empty fixture</title><main>No links</main>':'<!doctype html><html><head><title>Owned parent fixture</title></head><body><main><a href="/result">Owned deterministic fixture result</a></main></body></html>');};if(hold&&url.pathname==='/search'){hold.release=respond;hold.notify();}else respond();});
  const apiServer=http.createServer(app);const listen=async(server:http.Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert(a&&typeof a==='object');return `http://127.0.0.1:${a.port}`;};
  const origin=await listen(fixture);base=await listen(apiServer);
  const route=(id:string,suffix:string)=>`/api/edith/tasks/${id}/${suffix}`;
  async function api(endpoint:string,method='POST',body?:unknown,extra:Record<string,string>={}){const response=await fetch(base+endpoint,{method,headers:{origin:base,cookie,'x-edith-csrf-token':csrf,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return {status:response.status,body:await response.json() as any};}
  async function login(){const result=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:`Bearer ${credential}`}});assert.equal(result.status,201);cookie=result.headers.get('set-cookie')!.split(';')[0];csrf=(await result.json() as any).session.csrfToken;owner=getSoleActiveOwnerSession()!.bindingId;}
  async function grant(){const result=await api('/api/edith/permissions/grants','POST',{permissions:['network:read','browser:control'],toolIds:['browser_search'],ttlMs:600000,reason:'Actual original parent consumer fixture'});assert.equal(result.status,200);grantId=result.body.grant.id;}
  async function create(tools=['browser_search'],mutate?:(plan:EdithPlan)=>void){const result=await api('/api/edith/tasks','POST',{title:'Original parent integration fixture',objective:'Owned deterministic fixture intent',originalUserRequest:'Owned deterministic fixture intent',toolsRequired:tools,permissionsRequired:['network:read','browser:control'],riskLevel:4});assert.equal(result.status,200);const id=result.body.task.id;assert.equal((await api(route(id,'plan'))).status,200);if(mutate){const plan=structuredClone(taskService.getTask(id)!.plan!);mutate(plan);taskService.attachPlan(id,plan);}return id as string;}
  const audits=(id:string)=>readRecentAuditEvents(10000).filter(e=>e.taskId===id&&e.action==='tool.execute');
  const clean=async()=>{const registry=getBrowserOperatorAdapter().sessions as unknown as {sessions:Map<string,{id:string;owner:string}>;closing:Map<string,Promise<void>>;closed:Map<string,{owner:string}>};const owned=new Map([...registry.sessions.values()].map(session=>[session.id,session.owner]));for(const id of registry.closing.keys())owned.set(id,registry.closed.get(id)!.owner);for(const [id,binding] of owned)await producer.closeSession(id,binding);await new Promise(r=>setTimeout(r,40));};
  const taskBytes=(id:string)=>JSON.stringify(taskService.getTask(id));
  const restorePublisher=()=>registerGenericTaskPublisher(event=>getMobileRuntime().realtime.publishPersistedTaskEvent(event));
  function success(id:string,response:Awaited<ReturnType<typeof api>>,expectedBrowser=1){assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.success,true);assert.equal(response.body.taskId,id);const task=taskService.getTask(id)!;assert.equal(task.status,'COMPLETED');assert.equal(task.verification?.status,'PASS');assert(task.verification.checks.filter(c=>c.required).every(c=>c.status==='PASS'));assert.equal(audits(id).filter(a=>a.toolId==='browser_search').length,expectedBrowser);assert(audits(id).filter(a=>a.toolId==='browser_search').every(a=>a.actor===owner));assert.equal(task.verification.checks.filter(c=>c.id.startsWith('browser-step:')).length,expectedBrowser*2);for(const check of ['task-status','plan-exists','plan-steps-terminal','plan-steps-not-failed','tool-observation-browser_search','tool-audit-browser_search','execution-evidence'])assert(task.verification.checks.some(c=>c.id===check&&c.required&&c.status==='PASS'));const projected=projectTaskEventsV2(task);assert.equal(projected.diagnostics.quarantinedEventCount,0);assert.equal(projected.events.filter(e=>e.type==='task.created').length,1);assert.equal(projected.events.filter(e=>e.type==='task.completed').length,1);rows.push({scenario:'actual_original_parent_completed',taskId:id,browserLeaves:expectedBrowser,ordinaryRequired:task.verification.checks.filter(c=>c.required).map(c=>({id:c.id,status:c.status})),eventTypes:projected.events.map(e=>e.type),nativePhysicalProof:false});return task;}
  try{
    if(process.env.W5_PARENT_RESTART_ONLY==='true'){
      await login();await grant();const id=process.env.W5_PARENT_RESTART_TASK!;assert(taskService.getTask(id)?.verification?.status==='PASS');const before=taskBytes(id),count=taskService.listTasks().length;
      assert.equal((await api(route(id,'verify'),'POST',{nativePhysicalProof:true,browserExecution:{},approval:true})).body.success,false);assert.equal((await api(route(id,'execute'))).status,400);assert.equal(taskBytes(id),before);assert.equal(taskService.listTasks().length,count);assert.equal(hits,0);
      rows.push({scenario:'actual_new_process_same_sqlite_restart',taskId:id,pid:process.pid,noReceiptAuthorityRestored:true,noTaskMutation:true,noBrowserEffect:true});console.log(JSON.stringify({success:true,actualRestart:true,checks:1}));return;
    }
    await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:q=>`${origin}/search?q=${encodeURIComponent(q)}`});await login();
    const noGrant=await create(),unchanged=taskBytes(noGrant),beforeHits=hits;
    assert.equal((await api(route(noGrant,'execute'))).status,400);assert.equal(taskBytes(noGrant),unchanged);assert.equal(hits,beforeHits);rows.push({scenario:'missing_grant_before_running',passed:true});
    await grant();
    const id=await create();
    for(const [name,headers,status] of [['no_owner',{cookie:''},401],['no_csrf',{'x-edith-csrf-token':''},403],['foreign_origin',{origin:'https://foreign.invalid'},403]] as Array<[string,Record<string,string>,number]>){const before=taskBytes(id);assert.equal((await api(route(id,'execute'),'POST',{actor:'forged',browserExecution:{taskId:id}},headers)).status,status);assert.equal(taskBytes(id),before);assert.equal(audits(id).length,0);rows.push({scenario:name,status,zeroTaskMutation:true});}
    for(const context of [{},{browserExecution:{taskId:id,planId:taskService.getTask(id)!.plan!.id} as BrowserParentExecutionCap}]){const before=taskBytes(id);const result=await executorService.executeTask(id,context);assert.equal(result.success,false);assert.equal(taskBytes(id),before);assert.equal(audits(id).length,0);rows.push({scenario:'absent_or_forged_sealed_context',passed:true});}
    const count=taskService.listTasks().length;const original=success(id,await api(route(id,'execute'),'POST',{actor:'forged',taskId:'forged',authorizedPermissions:['*'],browserExecution:{}}));restartTask=id;assert.equal(taskService.listTasks().length,count);
    const beforeVerify=taskBytes(id);assert.equal((await api(route(id,'verify'))).body.success,true);assert.equal(taskBytes(id),beforeVerify);assert.equal(verificationService.evaluate({...original,toolsRequired:[],plan:{...original.plan!,requiredTools:[]}}).status,'RETRYABLE');rows.push({scenario:'committed_readonly_and_clone_denied',passed:true});
    await clean();const afterClose=taskBytes(id);assert.equal((await api(route(id,'verify'))).body.success,false);assert.equal(taskBytes(id),afterClose);assert.equal((await api(route(id,'execute'))).status,400);assert.equal(audits(id).length,1);rows.push({scenario:'closed_source_old_pass_no_replay',passed:true});
    const multi=await create(['browser_search'],plan=>{const first=plan.steps[1],second={...structuredClone(first),id:'second-original-search',status:'PENDING' as const,dependsOn:[first.id]};plan.steps.splice(2,0,second);plan.steps[3].dependsOn=[second.id];});const multiCount=taskService.listTasks().length;success(multi,await api(route(multi,'execute')),2);assert.equal(taskService.listTasks().length,multiCount);await clean();
    for(const budget of ['iterations','tools'] as const){
      const limited=await create(['browser_search'],plan=>{plan.maxIterations=budget==='iterations'?3:6;if(budget==='tools'){const ordinary={...structuredClone(plan.steps[1]),id:'ordinary-counted-prestep',suggestedTools:['ai_skill_catalog'],requiredPermissions:['system:read'],dependsOn:[plan.steps[0].id]};plan.steps[1].dependsOn=[ordinary.id];plan.steps.splice(1,0,ordinary);plan.requiredTools.push('ai_skill_catalog');plan.maxToolCalls=2;}}),repeatStep=taskService.getTask(limited)!.plan!.steps[budget==='iterations'?0:1].id;let resets=0;
      registerGenericTaskPublisher(event=>{getMobileRuntime().realtime.publishPersistedTaskEvent(event);if(event.taskId===limited&&event.type==='task.step_updated'&&event.payload.stepId===repeatStep&&event.payload.status==='COMPLETED'){resets++;taskService.updatePlanStepStatus(limited,repeatStep,'READY');}});
      const result=await api(route(limited,'execute'));restorePublisher();assert.equal(result.body.success,false);assert.equal(audits(limited).filter(a=>a.toolId==='browser_search').length,0);assert(result.body.iterations<=taskService.getTask(limited)!.plan!.maxIterations);assert(result.body.toolCalls<=taskService.getTask(limited)!.plan!.maxToolCalls);assert.equal(result.body[budget==='iterations'?'iterations':'toolCalls'],budget==='iterations'?3:2);assert(resets>=2);assert.equal(taskService.getTask(limited)!.recoveryEvents.length,0);rows.push({scenario:'actual_repeated_ordinary_'+budget+'_budget',iterations:result.body.iterations,toolCalls:result.body.toolCalls,ordinaryResets:resets,noBrowserEffect:true,noRecovery:true});
    }
    const mixed=await create(['browser_search','ai_skill_catalog']);const mixedTask=success(mixed,await api(route(mixed,'execute')));assert(mixedTask.verification!.checks.some(c=>c.id==='tool-audit-ai_skill_catalog'&&c.status==='PASS'));assert.equal(audits(mixed).find(a=>a.toolId==='ai_skill_catalog')?.actor,'edith-executor');await clean();rows.push({scenario:'mixed_ordinary_actor_unchanged',passed:true});
    const mixedFail=await create(['browser_search','task_create']),failCount=taskService.listTasks().length;const failed=await api(route(mixedFail,'execute'));assert.equal(failed.body.success,false);assert.notEqual(taskService.getTask(mixedFail)!.verification?.status,'PASS');assert.equal(taskService.listTasks().length,failCount);assert.equal(audits(mixedFail).filter(a=>a.toolId==='browser_search').length,1);assert.equal(audits(mixedFail).find(a=>a.toolId==='task_create')?.actor,'edith-executor');assert.equal((await api(route(mixedFail,'recover'))).status,409);assert.equal((await api(route(mixedFail,'execute'))).status,400);await clean();rows.push({scenario:'mixed_ordinary_after_browser_failure_no_full_pass_recovery_or_replay',passed:true});
    for(const tool of ['browser_open','browser_workflow','playwright_browser_agent']){const bad=await create([tool]),before=taskBytes(bad),h=hits;assert.equal((await api(route(bad,'execute'))).status,400);assert.equal(taskBytes(bad),before);assert.equal(hits,h);rows.push({scenario:'unsupported_planned_path',tool,zeroEffect:true});}
    const duplicate=await create(['browser_search'],plan=>plan.steps[1].suggestedTools.push('browser_search'));const duplicateBefore=taskBytes(duplicate);assert.equal((await api(route(duplicate,'execute'))).status,400);assert.equal(taskBytes(duplicate),duplicateBefore);rows.push({scenario:'duplicate_before_effect',passed:true});
    for(const change of ['missing_plan','iteration_budget','tool_budget','skipped_required','missing_step'] as const){const bad=await create(),task=taskService.getTask(bad)!,plan=structuredClone(task.plan!);if(change==='missing_plan')getEdithPersistenceStore().updateTask({...task,plan:undefined});else{if(change==='iteration_budget')plan.maxIterations=1;if(change==='tool_budget')plan.maxToolCalls=0;if(change==='skipped_required')plan.steps[1].status='SKIPPED';if(change==='missing_step')plan.steps.splice(1,1);taskService.attachPlan(bad,plan);}const before=taskBytes(bad),h=hits;assert.equal((await api(route(bad,'execute'))).status,400);assert.equal(taskBytes(bad),before);assert.equal(hits,h);rows.push({scenario:'pre_running_'+change,zeroEffect:true});}
    for(const status of ['CANCELLED','COMPLETED','BLOCKED','FAILED'] as const){const terminal=await create();taskService.updateStatus(terminal,status);const before=taskBytes(terminal);assert.equal((await api(route(terminal,'execute'))).status,400);assert.equal(taskBytes(terminal),before);rows.push({scenario:'terminal_no_revival',status});}
    omit=true;const empty=await create();assert.equal((await api(route(empty,'execute'))).body.success,false);assert.notEqual(taskService.getTask(empty)!.verification?.status,'PASS');assert.equal((await api(route(empty,'execute'))).status,400);omit=false;await clean();rows.push({scenario:'actual_missing_results_unknown_no_replay',passed:true});
    for(const change of ['cancel','pause','replan','logout','revoke']){
      const race=await create();let notify!:()=>void;const seen=new Promise<void>(r=>notify=r);hold={seen,notify,release:()=>{}};
      const pending=api(route(race,'execute'));await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture hold not reached')),12000))]);
      if(change==='cancel'||change==='pause')assert.equal((await api(route(race,change),'POST',{reason:'Actual fixture race'})).status,200);
      else if(change==='replan')assert.equal((await api(route(race,'plan'))).status,409);
      else if(change==='logout')assert.equal((await api('/api/security/session','DELETE')).status,200);
      else assert.equal((await api('/api/edith/permissions/grants/'+grantId,'DELETE')).status,200);
      const observed=taskService.getTask(race)!.status;hold.release();hold=undefined;const result=await pending;assert.equal(result.body.success,false);assert.equal(taskService.getTask(race)!.status,observed);assert.notEqual(taskService.getTask(race)!.verification?.status,'PASS');assert.equal(taskService.getTask(race)!.recoveryEvents.length,0);await clean();
      if(change==='logout'){await login();await grant();}if(change==='revoke')await grant();
      const leafCount=audits(race).length;assert.equal((await api(route(race,'execute'))).status,400);assert.equal(audits(race).length,leafCount);rows.push({scenario:'actual_inflight_'+change,preservedStatus:observed,noRecovery:true,noReplay:true});
    }
    // Reentrant actual publisher boundaries: fixture manipulations, no fake producer receipt or completion.
    const replaced=await create(),originalDom=producer.executeParentDom;
    try{
      // Negative-only after-return hook invokes the actual producer, then replaces its actual retained Page root.
      producer.executeParentDom=async cap=>{const issued=await originalDom.call(producer,cap);if(issued.taskId===replaced&&issued.receipt){const receipt=issued.receipt;await getBrowserOperatorAdapter().sessions.get(receipt.sessionId!,owner).pages.get(receipt.pageId!)!.setContent('<html><body>Unplanned actual root replacement</body></html>');await new Promise(r=>setTimeout(r,40));}return issued;};
      const result=await api(route(replaced,'execute'));assert.equal(result.body.success,false);assert.notEqual(taskService.getTask(replaced)!.verification?.status,'PASS');assert.equal((await api(route(replaced,'execute'))).status,400);rows.push({scenario:'actual_root_replacement',reportedSuccess:false,noReplay:true,scope:'Negative-only hook retains actual producer proof then awaits actual Page.setContent/source events'});
    }finally{producer.executeParentDom=originalDom;await clean();}
    for(const scenario of ['skipped_browser','plan_definition_changed','missing_ordinary_observation','required_artifact_failure','cancel_during_writer','writer_throw']){
      const target=await create(),browserStep=taskService.getTask(target)!.plan!.steps[1].id;let fired=false;
      registerGenericTaskPublisher(event=>{
        getMobileRuntime().realtime.publishPersistedTaskEvent(event);
        if(event.taskId!==target||fired)return;
        if(scenario==='cancel_during_writer'||scenario==='writer_throw'){
          if(event.type==='task.verification_completed'){fired=true;if(scenario==='writer_throw')throw Error('Owned fixture publisher failure');taskService.updateStatus(target,'CANCELLED','Owned fixture publisher cancellation');}
        }else if(event.type==='task.step_updated'&&event.payload.stepId===browserStep&&event.payload.status==='COMPLETED'){
          fired=true;
          if(scenario==='skipped_browser')taskService.updatePlanStepStatus(target,browserStep,'SKIPPED');
          else if(scenario==='plan_definition_changed'){const plan=structuredClone(taskService.getTask(target)!.plan!);plan.validationCriteria.push('Unexpected replacement plan definition');taskService.attachPlan(target,plan);}
          else if(scenario==='required_artifact_failure')taskService.addArtifact(target,path.join(process.env.EDITH_TEST_DATA_DIR!,'missing-required-artifact'));
          else if(scenario==='missing_ordinary_observation'){
            const store=getEdithPersistenceStore(),task=taskService.getTask(target)!;store.updateTask({...task,observations:task.observations.filter(o=>!o.includes('Executor tool browser_search succeeded'))});
          }
        }
      });
      const result=await api(route(target,'execute'));restorePublisher();assert(fired);if(scenario==='writer_throw'){assert.equal(result.body.success,false);assert.equal((await api(route(target,'execute'))).status,400);}else{assert.equal(result.body.success,false,scenario);if(scenario==='cancel_during_writer')assert.equal(taskService.getTask(target)!.status,'CANCELLED');else assert.notEqual(taskService.getTask(target)!.verification?.status,'PASS');}
      assert.equal((await api(route(target,'execute'))).status,400);await clean();rows.push({scenario:'actual_'+scenario,reportedSuccess:false,noReplay:true,scope:scenario==='missing_ordinary_observation'?'Own isolated persisted fixture evidence deletion':'Actual publisher fixture mutation'});
    }
    finished=true;console.log(JSON.stringify({success:true,checks:rows.length,actualProtectedRouter:true,actualOriginalPlanner:true,actualOwnedHeadedProducerExecutorVerifier:true,nativePhysicalProof:false}));
  }finally{
    hold?.release();hold=undefined;restorePublisher();await getBrowserOperatorAdapter().closeAll();const diagnostics=getBrowserOperatorAdapter().diagnostics();assert(diagnostics.closedProcesses.every(p=>p.processExited));getMobileRuntime().realtime.shutdown();
    for(const server of [apiServer,fixture]){server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
    const store=getEdithPersistenceStore();assert(store.getPaths().dataDir.startsWith(process.env.EDITH_TEST_DATA_DIR!));const runtimeFile=path.join(out,`parent-runtime-${process.pid}.json`);fs.writeFileSync(runtimeFile,JSON.stringify({rows,diagnostics,serversClosed:true,ownDatabasePath:store.getPaths().dataDir},null,2));(store as unknown as {close?:()=>void}).close?.();
    if(finished){const source=path.resolve(process.argv[1]),tsx=path.resolve(path.dirname(source),'../node_modules/tsx/dist/cli.mjs');const restarted=spawnSync(process.execPath,[tsx,source],{cwd:process.cwd(),env:{...process.env,W5_PARENT_RESTART_ONLY:'true',W5_PARENT_RESTART_TASK:restartTask},encoding:'utf8',timeout:30000});fs.writeFileSync(path.join(out,`restart-${process.pid}.log`),(restarted.stdout??'')+(restarted.stderr??''));assert.equal(restarted.status,0,restarted.stderr);rows.push({scenario:'actual_restart_child_exit_zero',taskId:restartTask,pid:restarted.pid,sameSqlite:true,exitCode:0});fs.writeFileSync(runtimeFile,JSON.stringify({rows,diagnostics,serversClosed:true,ownDatabasePath:store.getPaths().dataDir},null,2));}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
