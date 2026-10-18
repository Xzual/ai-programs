import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import { BROWSER_TOOL_IDS, parseBrowserOperatorReceipt } from '../src/edith/browserOperatorContract';
import { projectTaskEventsV2 } from '../src/edith/contracts';

async function main() {
  assert.equal(process.env.EDITH_TEST_MODE,'true');
  const out=process.env.W5_HTTP_REPORT_DIR!;
  assert(out && process.env.EDITH_TEST_DATA_DIR);
  const processFacts=createRequire(import.meta.url)(path.join(out,'guard.cjs')) as ()=>{children:Array<unknown>};
  const evidence:Array<Record<string,unknown>>=[];
  const servers:http.Server[]=[];
  const createServer=http.createServer;
  // Capture actual server handles for teardown; handlers and middleware remain production originals.
  http.createServer=((...args:Parameters<typeof createServer>)=>{const server=createServer(...args);servers.push(server);return server;}) as typeof createServer;
  let fixtureHits=0, hook:((phase:'located'|'after_input',page:Page)=>Promise<void>)|undefined;
  let cookie='',csrf='',grantId='';
  const credential=randomUUID();process.env.EDITH_OWNER_TOKEN=credential;process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
  const listen=async(server:http.Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');return `http://127.0.0.1:${address.port}`;};
  const fixture=http.createServer((_req,res)=>{fixtureHits++;res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><html><head><meta charset="utf-8"><title>Actual tools HTTP fixture</title><style>body{font:18px system-ui;margin:32px}label{display:block;margin:16px 0}input{font:inherit;padding:8px}</style></head><body><section data-search-results><a href="/destination">Actual owned fixture result</a></section><form><label for="name">Name</label><input id="name" type="text" autocomplete="off"><label for="city">City</label><input id="city" type="text" autocomplete="off"></form><script>window.fixture={inputEvents:0};document.addEventListener("input",()=>window.fixture.inputEvents++)</script></body></html>');});
  const fixtureOrigin=await listen(fixture);
  const reserve=http.createServer();const apiOrigin=await listen(reserve);await new Promise<void>(r=>reserve.close(()=>r()));
  process.env.PORT=new URL(apiOrigin).port;process.env.EDITH_HOST='127.0.0.1';
  const {setBrowserOperatorTestOptions,getBrowserOperatorAdapter}=await import('../src/edith/browserOperatorAdapter');
  await setBrowserOperatorTestOptions({fixtureOrigins:[fixtureOrigin],searchUrl:q=>`${fixtureOrigin}/search?q=${encodeURIComponent(q)}`,beforeEffect:async(phase,page)=>{await hook?.(phase,page);}});
  const {taskService}=await import('../src/edith/taskService');
  const {readRecentAuditEvents}=await import('../src/edith/audit');
  const {getEdithPersistenceStore}=await import('../src/edith/persistence');
  const {getSoleActiveOwnerSession}=await import('../server/security/ownerSession');
  const store=getEdithPersistenceStore();assert(store.getPaths().dataDir.startsWith(process.env.EDITH_TEST_DATA_DIR!));
  const taskCount=()=>taskService.listTasks().length;
  const snapshot=()=>({hits:fixtureHits,tasks:taskCount(),launchedProcesses:processFacts().children.length,closure:getBrowserOperatorAdapter().diagnostics().closedProcesses.length});
  async function api(route:string,method='POST',body?:unknown,headers?:Record<string,string>){const response=await fetch(apiOrigin+route,{method,headers:{origin:apiOrigin,'content-type':'application/json',cookie,'x-edith-csrf-token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return {status:response.status,body:await response.json() as any};}
  async function login(){const result=await fetch(apiOrigin+'/api/security/session',{method:'POST',headers:{origin:apiOrigin,authorization:`Bearer ${credential}`}});assert.equal(result.status,201);cookie=result.headers.get('set-cookie')!.split(';')[0];csrf=(await result.json() as any).session.csrfToken;}
  async function grant(ids:readonly string[]=BROWSER_TOOL_IDS,permissions=['network:read','browser:control']){const result=await api('/api/edith/permissions/grants','POST',{permissions,toolIds:ids,ttlMs:600000,reason:'Isolated actual tools HTTP test'});assert.equal(result.status,200);assert.equal(result.body.grant.actor,'owner');grantId=result.body.grant.id;}
  async function revoke(){assert.equal((await api('/api/edith/permissions/grants/'+grantId,'DELETE')).status,200);grantId='';}
  const args=(toolId:string,identity:Record<string,string>={})=>({verificationGoal:'Verify finite fixture action',...identity,...(toolId==='browser_search'?{query:'owned fixture query'}:toolId==='browser_open'?{url:fixtureOrigin}: {action:'navigate',url:fixtureOrigin})});
  const execute=(toolId:string,value:Record<string,unknown>,extra:Record<string,unknown>={})=>api('/api/tools/execute','POST',{toolId,args:value,...extra});
  function verified(toolId:string,result:Awaited<ReturnType<typeof api>>,before:number){assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.success,true);assert.equal(result.body.toolId,toolId);const parsed=parseBrowserOperatorReceipt(result.body.structuredOutput?.browser);assert(parsed.success);const receipt=parsed.value;assert.equal(receipt.status,'verified');assert.equal(receipt.nativePhysicalProof,false);assert.equal(receipt.backend,'owned_headed_playwright');assert(receipt.postconditions.length&&receipt.postconditions.every(c=>c.matched));assert.equal(taskCount(),before+1);const id=result.body.structuredOutput.taskId,task=taskService.getTask(id)!;assert(task);assert.equal(task.status,'COMPLETED');assert.equal(task.verification?.status,'PASS');assert(task.verification?.checks.filter(c=>c.required).every(c=>c.status==='PASS'));const projection=projectTaskEventsV2(task);assert.equal(projection.diagnostics.quarantinedEventCount,0);assert.equal(projection.events.filter(e=>e.type==='task.created').length,1);assert.equal(projection.events.filter(e=>e.type==='task.completed').length,1);const audits=readRecentAuditEvents(10000).filter(e=>e.taskId===id&&e.action==='tool.execute');assert.equal(audits.length,1);assert.equal(audits[0].toolId,toolId);assert.equal(audits[0].actor,getSoleActiveOwnerSession()!.bindingId,'Inspection only: no binding supplied by test HTTP body');assert.equal(result.body.auditEventId,audits[0].id);evidence.push({scenario:'actual_http_verified',toolId,taskId:id,operationId:receipt.operationId,auditId:audits[0].id,requiredChecks:task.verification?.checks,taskCreated:1,leafAudit:1,nativePhysicalProof:false});return receipt;}
  try {
    await import('../server');
    const server=servers.find(s=>{const a=s.address();return a&&typeof a==='object'&&String(a.port)===process.env.PORT;});
    if(!server) await new Promise<void>((resolve,reject)=>{let count=0;const timer=setInterval(()=>{if(servers.some(s=>{const a=s.address();return a&&typeof a==='object'&&String(a.port)===process.env.PORT;})){clearInterval(timer);resolve();}else if(++count>200){clearInterval(timer);reject(Error('Actual fullserver did not listen'));}},50);});
    await login();
    for(const toolId of BROWSER_TOOL_IDS){
      for(const [scenario,headers,status] of [
        ['no_session',{cookie:''},401],['wrong_session',{cookie:'edith_owner_session=wrong'},401],
        ['no_csrf',{'x-edith-csrf-token':''},403],['wrong_csrf',{'x-edith-csrf-token':'wrong'},403],
        ['foreign_origin',{origin:'https://foreign.invalid'},403],['cross_site',{'sec-fetch-site':'cross-site'},403],
      ] as const){const before=snapshot();const result=await api('/api/tools/execute','POST',{toolId,args:args(toolId)},headers);assert.equal(result.status,status);assert.deepEqual(snapshot(),before);evidence.push({scenario,toolId,status,zeroBrowserEffects:true});}
      const before=snapshot();const forged=await execute(toolId,args(toolId),{actor:'owner-session-forged',taskId:'forged',permissions:['network:read','browser:control'],context:{actor:'owner'},approval:true});assert.equal(forged.status,403);assert.deepEqual(snapshot(),before);evidence.push({scenario:'forged_body_no_grant',toolId,zeroBrowserEffects:true});
      const prohibited=await execute(toolId,args(toolId),{authorizedPermissions:['network:read','browser:control']});assert.equal(prohibited.status,400);assert.equal(prohibited.body.errorCode,'CLIENT_PERMISSIONS_FORBIDDEN');assert.deepEqual(snapshot(),before);
      for(const permissions of [['browser:control'],['network:read']]){
        await grant([toolId],permissions);
        // network:read remains a read-only default in every supported policy mode; deny removes high-risk grants.
        const deny=permissions[0]==='browser:control';
        if(deny)assert.equal((await api('/api/edith/permissions/policy','PATCH',{mode:'deny'})).status,200);
        const {permissionService}=await import('../src/edith/permissionService');
        const {edithToolRegistry}=await import('../src/edith/serverRegistry');
        const missing=permissionService.decideToolExecution({tool:edithToolRegistry.get(toolId)!,actor:'owner'}).missingPermissions;
        assert(missing.includes('browser:control'));
        const checkpoint=snapshot();assert.equal((await execute(toolId,args(toolId))).status,403);assert.deepEqual(snapshot(),checkpoint);
        if(deny)assert.equal((await api('/api/edith/permissions/policy','PATCH',{mode:'ask'})).status,200);
        await revoke();evidence.push({scenario:deny?'deny_policy_ignores_grant':'missing_browser_control',toolId,policy:deny?'deny':'ask',missingPermissions:missing,networkReadDefault:true,zeroBrowserEffects:true});
      }
    }
    await grant();
    const bootstrapCount=taskCount();
    const bootstrap=verified('browser_open',await execute('browser_open',args('browser_open')),bootstrapCount);
    const identity={sessionId:bootstrap.sessionId!,pageId:bootstrap.pageId!};assert(identity.sessionId&&identity.pageId);
    for(const toolId of BROWSER_TOOL_IDS){const value=toolId==='browser_workflow'||toolId==='playwright_browser_agent'?{...identity,action:'title',verificationGoal:'Verify actual fixture title'}:args(toolId,identity);const count=taskCount();verified(toolId,await execute(toolId,value,{actor:'forged',taskId:'forged',permissions:['*']}),count);const checkpoint=snapshot();assert.equal((await execute(toolId,{...value,actor:'owner',taskId:'forged',authorizedPermissions:['*']})).status,403);assert.deepEqual(snapshot(),checkpoint);evidence.push({scenario:'strict_args_forged_authority_denied',toolId,zeroBrowserEffects:true});}
    await revoke();
    // Revocation invalidates owned session guards; wait for bounded owned closure before no-effect snapshots.
    await getBrowserOperatorAdapter().closeSession(identity.sessionId,getSoleActiveOwnerSession()!.bindingId);
    for(const toolId of BROWSER_TOOL_IDS){const before=snapshot();assert.equal((await execute(toolId,args(toolId,identity))).status,403);assert.deepEqual(snapshot(),before);evidence.push({scenario:'grant_revoked',toolId,zeroBrowserEffects:true});}
    await grant();
    // Existing harmless canonical Task creation verifies nonbrowser owner principal without OS/provider probing.
    const nonbrowser=await execute('task_create',{title:'Owner principal fixture',objective:'Store isolated fixture',originalUserRequest:'Store isolated fixture'});assert.equal(nonbrowser.status,200);const nonbrowserAudit=readRecentAuditEvents(10000).find(e=>e.id===nonbrowser.body.auditEventId);assert.equal(nonbrowserAudit?.actor,'owner');evidence.push({scenario:'nonbrowser_owner_unchanged',toolId:'task_create',auditId:nonbrowserAudit!.id,actor:'owner'});
    // Real revoke after one DOM effect; the original Task must not receive late PASS and no replay occurs.
    const freshCount=taskCount();const fresh=verified('browser_open',await execute('browser_open',args('browser_open')),freshCount);
    const freshIdentity={sessionId:fresh.sessionId!,pageId:fresh.pageId!};
    let inputsAfter=0;hook=async(phase,page)=>{if(phase!=='after_input')return;hook=undefined;inputsAfter=await page.evaluate(()=>Number((window as any).fixture.inputEvents));await revoke();};
    const partial=await execute('browser_workflow',{...freshIdentity,action:'fill_form',selectors:{name:'#name',city:'#city'},fieldValues:{name:'isolated private value',city:'must not dispatch'},verificationGoal:'Verify bounded form fields'});evidence.push({scenario:'actual_partial_response',taskId:partial.body.structuredOutput?.taskId,receipt:partial.body.structuredOutput?.browser});assert.equal(partial.status,403);assert.equal(partial.body.success,false);assert.equal(inputsAfter,1,JSON.stringify(partial.body));const partialTask=taskService.getTask(partial.body.structuredOutput.taskId)!;assert.notEqual(partialTask.status,'COMPLETED');assert.notEqual(partialTask.verification?.status,'PASS');evidence.push({scenario:'revoke_after_effect_no_late_pass',taskId:partialTask.id,status:partialTask.status,inputEvents:inputsAfter});
    await getBrowserOperatorAdapter().closeAll();
    await api('/api/security/session','DELETE');
    for(const toolId of BROWSER_TOOL_IDS){const before=snapshot();assert.equal((await execute(toolId,args(toolId))).status,401);assert.deepEqual(snapshot(),before);evidence.push({scenario:'logout_old_cookie',toolId,zeroBrowserEffects:true});}
    const invalid=await api('/api/tools/execute','POST',{toolId:'',args:[]});assert.equal(invalid.status,401);
    await login();assert.equal((await api('/api/tools/execute','POST',{toolId:'',args:[]})).status,400);assert.equal((await execute('not_a_tool',{})).status,400);
    await api('/api/security/session','DELETE');
    console.log(JSON.stringify({success:true,actualFullServer:true,realDefaultRegistry:true,checks:evidence.length,verifiedRequests:evidence.filter(e=>e.scenario==='actual_http_verified').length,nativePhysicalProof:false}));
  } finally {
    hook=undefined;await getBrowserOperatorAdapter().closeAll();
    const diagnostics=getBrowserOperatorAdapter().diagnostics();assert(diagnostics.closedProcesses.every(p=>p.processExited));
    const {cloudSyncWorker}=await import('../server/cloud/syncWorker');await cloudSyncWorker.shutdown();
    const {voiceSessionManager}=await import('../server/voice/voiceSessionManager');voiceSessionManager.shutdown();
    const {getMobileRuntime}=await import('../server/mobile/runtime');getMobileRuntime().realtime.shutdown();
    const {obsidianVaultService}=await import('../src/edith/obsidianVaultService');obsidianVaultService.stopWatcher();
    for(const server of servers){server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
    http.createServer=createServer;
    fs.writeFileSync(path.join(out,`http-runtime-${process.pid}.json`),JSON.stringify({evidence,diagnostics,actualFullServer:true,ownDatabasePath:store.getPaths().dataDir,serversClosed:servers.every(s=>!s.listening)},null,2));
    (store as unknown as {close?:()=>void}).close?.();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
