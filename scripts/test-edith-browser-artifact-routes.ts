import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import express from 'express';
import {parseBrowserOperatorReceipt} from '../src/edith/browserOperatorContract';

async function main(){
  assert.equal(process.env.EDITH_TEST_MODE,'true');assert(process.env.EDITH_TEST_DATA_DIR);
  const out=process.env.W5_HTTP_REPORT_DIR!;assert(out);
  const evidence:Array<Record<string,unknown>>=[];
  const credential=randomUUID();process.env.EDITH_OWNER_TOKEN=credential;process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
  const {createOwnerSessionRouter,getSoleActiveOwnerSession}=await import('../server/security/ownerSession');
  const {createPermissionsRouter}=await import('../server/routes/permissions');
  const {createBrowserWorkflowsRouter}=await import('../server/routes/browserWorkflows');
  const {browserWorkflowService}=await import('../src/edith/browserWorkflowService');
  const {getBrowserOperatorAdapter,setBrowserOperatorTestOptions}=await import('../src/edith/browserOperatorAdapter');
  const {getEdithPersistenceStore}=await import('../src/edith/persistence');
  const {readRecentAuditEvents}=await import('../src/edith/audit');
  const {taskService}=await import('../src/edith/taskService');
  const marker='Isolated actual artifact content '+randomUUID();
  let hits=0,cookie='',csrf='',owner='',base='',readCalls=0,closeCalls=0;
  let readMode:'missing'|'failure'|'mime'='missing',closeMode:'failure'|'foreign'|'logout'='failure';
  let logout:()=>Promise<void>=async()=>{};
  const app=express();app.use(express.json({limit:'32kb'}));app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createBrowserWorkflowsRouter());
  // Separate route-error/deny-before-call fixture. Actual positive handlers above use the unmodified default service.
  app.use('/mapping',createBrowserWorkflowsRouter({capabilities:()=>browserWorkflowService.capabilities(),run:(request,actor)=>browserWorkflowService.run(request,actor),readArtifact:()=>{readCalls++;if(readMode==='mime')return {bytes:Buffer.from('unsafe'),mime:'text/html'};throw Error(readMode==='failure'?'PRIVATE_INTERNAL_DETAIL':'PAGE_NOT_FOUND');},closeSession:async()=>{closeCalls++;if(closeMode==='logout'){await logout();return;}throw Error(closeMode==='foreign'?'OWNER_SESSION_REQUIRED':'EFFECT_OUTCOME_UNKNOWN');}}));
  const fixture=http.createServer((_req,res)=>{hits++;res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html><head><title>Artifact fixture</title></head><body><div id="content">'+marker+'</div></body></html>');});
  const apiServer=http.createServer(app);
  const listen=async(server:http.Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');return `http://127.0.0.1:${address.port}`;};
  const origin=await listen(fixture);base=await listen(apiServer);
  const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  async function request(route:string,method='GET',body?:unknown,extra:Record<string,string>={}){const response=await fetch(base+route,{method,headers:{origin:base,cookie,'x-edith-csrf-token':csrf,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const bytes=Buffer.from(await response.arrayBuffer());return {status:response.status,headers:response.headers,bytes,json:()=>JSON.parse(bytes.toString())};}
  async function login(){const response=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:`Bearer ${credential}`}});assert.equal(response.status,201);cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json() as any).session.csrfToken;owner=getSoleActiveOwnerSession()!.bindingId;}
  logout=async()=>{assert.equal((await request('/api/security/session','DELETE')).status,200);};
  async function grant(){assert.equal((await request('/api/edith/permissions/grants','POST',{permissions:['network:read','browser:control'],toolIds:['browser_workflow','browser_search','browser_open','playwright_browser_agent'],ttlMs:600000,reason:'Isolated actual artifact route acceptance'})).status,200);}
  async function run(action:string,args:Record<string,unknown>={}){const result=await request('/api/edith/browser/workflows','POST',{action,verificationGoal:'Verify finite artifact fixture action',...args});assert.equal(result.status,200,result.bytes.toString());const parsed=parseBrowserOperatorReceipt(result.json().structuredOutput.browser);assert(parsed.success);assert.equal(parsed.value.status,'verified');assert.equal(parsed.value.nativePhysicalProof,false);return parsed.value;}
  const artifactRoute=(id:string)=>'/api/edith/browser/artifacts/'+id;
  const closeRoute=(id:string)=>'/api/edith/browser/sessions/'+id+'/close';
  // Raw HTTP is necessary because fetch prohibits GET request bodies.
  async function raw(route:string,method:string,body:string,extra:Record<string,string>={}){return await new Promise<number>((resolve,reject)=>{const req=http.request(base+route,{method,headers:{origin:base,cookie,'x-edith-csrf-token':csrf,'content-type':'text/plain','content-length':Buffer.byteLength(body),...extra}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end(body);});}
  try{
    await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:q=>origin+'/?q='+encodeURIComponent(q)});
    await login();await grant();
    const start=await run('navigate',{url:origin});const identity={sessionId:start.sessionId!,pageId:start.pageId!};
    const adapter=getBrowserOperatorAdapter(),metadata=adapter.sessions.inspectOwned(identity.sessionId,owner);
    const text=await run('extract',{...identity,selectors:{text:'#content'}}),image=await run('screenshot',identity);
    for(const receipt of [text,image]){
      const id=receipt.artifacts[0].id,expected=browserWorkflowService.readArtifact(id,owner),ttl=adapter.sessions.inspectOwned(identity.sessionId,owner);
      const count=taskService.listTasks().length,beforeHits=hits,result=await request(artifactRoute(id));
      assert.equal(result.status,200);assert.deepEqual(result.bytes,expected.bytes);assert.equal(sha(result.bytes),receipt.artifacts[0].sha256);assert.equal(result.headers.get('content-type'),expected.mime);assert.equal(Number(result.headers.get('content-length')),expected.bytes.length);assert.equal(result.headers.get('cache-control'),'no-store, private');assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(result.headers.get('content-disposition'),`attachment; filename="edith-artifact.${receipt===text?'txt':'png'}"`);
      for(const header of ['etag','last-modified','location','accept-ranges'])assert.equal(result.headers.get(header),null);
      if(receipt===text)assert(result.bytes.toString().includes(marker));else assert.equal(result.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      for(let n=0;n<3;n++)assert.equal((await request(artifactRoute(id))).status,200);
      const after=adapter.sessions.inspectOwned(identity.sessionId,owner);assert.equal(after.expiresAt,ttl.expiresAt);assert.equal(after.hardExpiresAt,ttl.hardExpiresAt);assert.equal(hits,beforeHits);assert.equal(taskService.listTasks().length,count);
      evidence.push({scenario:'actual_default_router_bytes',kind:receipt===text?'text':'png',sha256:sha(result.bytes),length:result.bytes.length,mime:expected.mime,ttlUntouched:true,noNewTaskOrPageAccess:true,nativePhysicalProof:false});
    }
    const id=image.artifacts[0].id,mapping='/mapping'+artifactRoute(id);
    for(const [scenario,route,method,headers,status] of [
      ['missing_owner',mapping,'GET',{cookie:''},401],['foreign_origin',mapping,'GET',{origin:'https://foreign.invalid'},403],['cross_site',mapping,'GET',{'sec-fetch-site':'cross-site'},403],['head',mapping,'HEAD',{},405],['malformed','/mapping'+artifactRoute('bad'),'GET',{},400],['query',mapping+'?actor=forged','GET',{},400],
      ...['range','if-range','if-match','if-none-match','if-modified-since','if-unmodified-since'].map(header=>[header,mapping,'GET',{[header]:'anything'},400]),
    ] as Array<[string,string,string,Record<string,string>,number]>){const calls=readCalls;assert.equal((await request(route,method,undefined,headers)).status,status);assert.equal(readCalls,calls);evidence.push({scenario,status,deniedBeforeArtifactAccess:true});}
    assert.equal(await raw(mapping,'GET','unparsed-body'),400);assert.equal(readCalls,0);
    assert.equal((await request(artifactRoute(randomUUID()))).status,404);assert.equal((await request(mapping)).status,404);
    readMode='failure';const fail=await request(mapping);assert.equal(fail.status,500);assert(!fail.bytes.toString().includes('PRIVATE_INTERNAL_DETAIL'));readMode='mime';assert.equal((await request(mapping)).status,500);
    evidence.push({scenario:'fixed_error_and_mime_mapping',scope:'route-error spy only',unknownActualHandle404:true});
    let retainedId='';for(let n=0;n<9;n++)retainedId=(await run('extract',{...identity,selectors:{text:'#content'}})).artifacts[0].id;
    assert.equal((await request(artifactRoute(text.artifacts[0].id))).status,404);assert.equal((await request(artifactRoute(id))).status,404);evidence.push({scenario:'actual_count_eviction',status:404});
    for(const [body,headers,status] of [[{}, {cookie:''},401],[{}, {origin:'https://foreign.invalid'},403],[{}, {'x-edith-csrf-token':''},403],[{}, {'x-edith-csrf-token':'wrong'},403],[{actor:owner},{},400],[{taskId:randomUUID()},{},400],[[],{},400]] as Array<[unknown,Record<string,string>,number]>){const calls=closeCalls;assert.equal((await request('/mapping'+closeRoute(identity.sessionId),'POST',body,headers)).status,status);assert.equal(closeCalls,calls);}
    assert.equal((await request('/mapping'+closeRoute('bad'),'POST',{})).status,400);assert.equal((await request('/mapping'+closeRoute(identity.sessionId)+'?owner=forged','POST',{})).status,400);assert.equal(await raw('/mapping'+closeRoute(identity.sessionId),'POST','unparsed-body'),400);assert.equal(closeCalls,0);
    // Actual service guard on an existing live owned session; no second live owner can be minted by this HTTP session issuer.
    await assert.rejects(browserWorkflowService.closeSession(identity.sessionId,randomUUID()),/OWNER_SESSION_REQUIRED/);assert.equal(adapter.sessions.inspectOwned(identity.sessionId,owner).pid,metadata.pid);
    closeMode='foreign';assert.equal((await request('/mapping'+closeRoute(identity.sessionId),'POST',{})).status,403);closeMode='failure';assert.equal((await request('/mapping'+closeRoute(identity.sessionId),'POST',{})).status,500);
    evidence.push({scenario:'live_foreign_close_and_failure',actualServiceLiveOwnerGuard:true,http403And500Scope:'separate route-error spy; single live owner issuer limitation'});
    const unknown=randomUUID(),before=adapter.diagnostics().closedProcesses.length;assert.deepEqual((await request(closeRoute(unknown),'POST')).json(),{success:true});assert.equal(adapter.diagnostics().closedProcesses.length,before);
    assert.equal((await request(artifactRoute(retainedId))).status,200);
    const closed=await request(closeRoute(identity.sessionId),'POST',{});assert.equal(closed.status,200);assert.deepEqual(closed.json(),{success:true});const closure=adapter.diagnostics().closedProcesses.find(p=>p.pid===metadata.pid);assert(closure?.processExited);assert.throws(()=>process.kill(metadata.pid,0));assert.equal((await request(closeRoute(identity.sessionId),'POST',{})).status,200);assert.equal((await request(artifactRoute(retainedId))).status,404);
    evidence.push({scenario:'actual_close_waited_process_exit',pid:metadata.pid,processExited:true,alreadyClosed200:true,unknownAcknowledgedWithoutClosureFact:true,previouslyLiveArtifactRevoked404:true,csrfBodyOriginOwnerDeniedBeforeService:true});
    const exp=await run('navigate',{url:origin}),expText=await run('extract',{sessionId:exp.sessionId!,pageId:exp.pageId!,selectors:{text:'#content'}});
    // Fixture-only clock input: production get() expiration predicate and real close execute unchanged.
    adapter.sessions.get(exp.sessionId!,owner).expiresAt=new Date(Date.now()-1).toISOString();assert.equal((await request(artifactRoute(expText.artifacts[0].id))).status,404);assert.equal((await request(closeRoute(exp.sessionId!),'POST',{})).status,200);
    evidence.push({scenario:'actual_expiration_guard',status:404,fixtureOnlyPastExpiryInput:true});
    const rev=await run('navigate',{url:origin}),revText=await run('extract',{sessionId:rev.sessionId!,pageId:rev.pageId!,selectors:{text:'#content'}}),oldOwner=owner;
    await logout();assert.equal((await request(artifactRoute(revText.artifacts[0].id))).status,401);await browserWorkflowService.closeSession(rev.sessionId!,oldOwner);await login();assert.notEqual(owner,oldOwner);assert.equal((await request(artifactRoute(revText.artifacts[0].id))).status,404);
    evidence.push({scenario:'actual_revoked_and_unowned_old_handle',oldCookie401:true,newBinding404:true});
    closeMode='logout';assert.equal((await request('/mapping'+closeRoute(randomUUID()),'POST',{})).status,401);evidence.push({scenario:'owner_lost_after_await',scope:'route await-race spy calling real logout',status:401});
    const audits=JSON.stringify(readRecentAuditEvents(10000));assert(!audits.includes(marker));assert(!audits.includes(credential));assert(!audits.includes(csrf));assert(!audits.includes(cookie));evidence.push({scenario:'audit_has_no_artifact_bytes_or_credentials',passed:true});
    console.log(JSON.stringify({success:true,checks:evidence.length,actualDefaultRouter:true,actualOwnedHeadedBrowser:true,nativePhysicalProof:false}));
  }finally{
    await getBrowserOperatorAdapter().closeAll();const diagnostics=getBrowserOperatorAdapter().diagnostics();assert(diagnostics.closedProcesses.every(p=>p.processExited));
    for(const server of [apiServer,fixture]){server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
    const store=getEdithPersistenceStore();assert(store.getPaths().dataDir.startsWith(process.env.EDITH_TEST_DATA_DIR!));
    fs.writeFileSync(path.join(out,`artifact-runtime-${process.pid}.json`),JSON.stringify({evidence,diagnostics,actualDefaultRouter:true,serversClosed:true,ownDatabasePath:store.getPaths().dataDir},null,2));
    (store as unknown as {close?:()=>void}).close?.();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
