import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {createBrowserWorkflowsRouter} from '../server/routes/browserWorkflows';
import {createComputerUseRouter} from '../server/routes/computerUse';
import {browserNativeAuthority,NATIVE_BROWSER_PRIVATE_BASE,nativeBrowserBodyErrorHandler} from '../server/browser/browserNativeAuthority';
import {createOwnerSessionRouter} from '../server/security/ownerSession';
import {createPermissionsRouter} from '../server/routes/permissions';
import {getBrowserOperatorAdapter,setBrowserOperatorTestOptions} from '../src/edith/browserOperatorAdapter';
import {taskService} from '../src/edith/taskService';

async function main(){
  assert.equal(process.env.EDITH_TEST_MODE,'true');
  const ref=()=>crypto.randomBytes(24).toString('base64url');
  process.env.EDITH_OWNER_TOKEN=ref();process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';process.env.EDITH_DESKTOP_BRIDGE_TOKEN=ref();
  const rows:string[]=[];let cookie='',csrf='',sessionId='';
  const fixture=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body><form method="get" action="/fixture"><label for="q">Query</label><input id="q" type="search" name="q" value="old"></form></body></html>');});
  const listen=async(server:http.Server)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port;};
  const origin=await listen(fixture);await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:()=>origin+'/fixture'});
  const app=express();app.use(express.json());app.use(nativeBrowserBodyErrorHandler);app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createComputerUseRouter());app.use(createBrowserWorkflowsRouter());
  const apiServer=http.createServer(app),base=await listen(apiServer);
  const api=async(endpoint:string,body?:unknown,extra:Record<string,string>={},method='POST')=>{const response=await fetch(base+endpoint,{method,headers:{origin:base,cookie,'x-edith-csrf-token':csrf,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,cache:response.headers.get('cache-control'),body:method==='HEAD'?null:await response.json() as any};};
  const boot=async()=>{const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify({version:1,nativeBootNonce:ref()})});assert.equal(response.status,200);};
  try{
    const login=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(login.status,201);cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json() as any).session.csrfToken;
    assert.equal((await api('/api/edith/permissions/grants',{permissions:['network:read','browser:control'],toolIds:['browser_open','browser_workflow','playwright_browser_agent'],ttlMs:600000,reason:'Actual protected native admission; browser permission only'})).status,200);
    const navigation=await api('/api/edith/browser/workflows',{action:'navigate',url:origin,verificationGoal:'Observe own field'});assert.equal(navigation.status,200);assert.equal(navigation.body.structuredOutput.browser.nativePhysicalProof,false);
    sessionId=navigation.body.structuredOutput.browser.sessionId;const pageId=navigation.body.structuredOutput.browser.pageId;
    await boot();assert.equal(browserNativeAuthority.supportsStrategy('search'),true);
    const domRequest={action:'fill_form',sessionId,pageId,selectors:{q:'#q'},fieldValues:{q:'DOM field'},verificationGoal:'Observe exact own field'};
    const request={action:'search',query:'Native pending original',verificationGoal:'Observe original query search'};
    const workflow='/api/edith/browser/workflows';
    const beforeNativeGrant=taskService.listTasks().length;
    const domBeforeGrant=await api(workflow,domRequest);assert.equal(domBeforeGrant.status,200);assert.equal(domBeforeGrant.body.structuredOutput.browser.nativePhysicalProof,false);assert.equal(taskService.listTasks().length,beforeNativeGrant+1);rows.push('ordinary_DOM_context_before_native_admission_without_computer_grant');
    assert.equal((await api('/api/edith/permissions/grants',{permissions:['network:read','browser:control','computer:control'],toolIds:['browser_open','browser_search','browser_workflow','playwright_browser_agent','computer_action'],ttlMs:600000,reason:'Actual protected native admission; no native physical effects'})).status,200);
    const domWithGrant=await api(workflow,domRequest);assert.equal(domWithGrant.status,200);assert.equal(domWithGrant.body.structuredOutput.browser.nativePhysicalProof,false);rows.push('ordinary_DOM_context_with_native_boot_and_computer_grant_stays_DOM');
    for(const [headers,status] of [[{cookie:''},401],[{'x-edith-csrf-token':''},403],[{origin:'https://foreign.invalid'},403]] as [Record<string,string>,number][]){const count=taskService.listTasks().length;assert.equal((await api(workflow,request,headers)).status,status);assert.equal(taskService.listTasks().length,count);}
    rows.push('actual_owner_csrf_origin_rejected_before_task');
    const count=taskService.listTasks().length;assert.equal((await api(workflow,{...request,nativePhysicalProof:true})).status,400);assert.equal(taskService.listTasks().length,count);rows.push('strict_B0_unknown_native_flag_no_task');
    const admitted=await api(workflow,request);assert.equal(admitted.status,202);assert.equal(admitted.cache,'no-store');assert.equal(taskService.listTasks().length,count+1);const ticket=admitted.body;assert.equal(taskService.getTask(ticket.taskId)!.status,'RUNNING');rows.push('actual_protected_post_one_original_task_202');
    const resultPath=workflow+'/attempts/'+ticket.attemptLookupRef;
    for(let i=0;i<3;i++){const result=await api(resultPath,undefined,{},'GET');assert.equal(result.status,202);assert.deepEqual(result.body,ticket);assert.equal(result.cache,'no-store');}
    assert.equal(taskService.listTasks().length,count+1);rows.push('readonly_same_original_ticket_no_new_task_or_capability');
    assert.equal((await api(resultPath,undefined,{cookie:''},'GET')).status,401);assert.equal((await api(resultPath,undefined,{origin:'https://foreign.invalid'},'GET')).status,403);
    assert.equal((await api(resultPath,undefined,{},'HEAD')).status,405);assert.equal((await api(resultPath+'?',undefined,{},'GET')).status,400);
    const bodyStatus=await new Promise<number>((resolve,reject)=>{const req=http.request(base+resultPath,{method:'GET',headers:{origin:base,cookie,'content-type':'application/json','content-length':'2'}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode!));});req.once('error',reject);req.end('{}');});assert.equal(bodyStatus,400);
    assert.equal((await api(workflow+'/attempts/'+ref(),undefined,{},'GET')).status,404);rows.push('reader_auth_method_query_unknown_scope_denied');
    const page=getBrowserOperatorAdapter().sessions.get(sessionId,(await import('../server/security/ownerSession')).getSoleActiveOwnerSession()!.bindingId).pages.get(pageId)!;
    assert.equal(await page.locator('#q').inputValue(),'DOM field');assert.notEqual(taskService.getTask(ticket.taskId)!.verification?.status,'PASS');rows.push('query_only_admission_does_not_touch_existing_DOM_page_or_issue_native_pass');
    taskService.updateStatus(ticket.taskId,'CANCELLED');await new Promise(resolve=>setTimeout(resolve,70));const cancelled=await api(resultPath,undefined,{},'GET');assert([200,404].includes(cancelled.status));if(cancelled.status===200)assert.equal(cancelled.body.success,false);assert.equal(taskService.getTask(ticket.taskId)!.status,'CANCELLED');rows.push('cancel_no_pass_or_revival');
    const second=await api(workflow,request);assert.equal(second.status,202);await boot();await new Promise(resolve=>setTimeout(resolve,70));const stale=await api(workflow+'/attempts/'+second.body.attemptLookupRef,undefined,{},'GET');assert([200,404].includes(stale.status));if(stale.status===200)assert.equal(stale.body.success,false);assert.notEqual(taskService.getTask(second.body.taskId)!.verification?.status,'PASS');rows.push('boot_replacement_stops_original_waiter');
    const newOwner=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(newOwner.status,201);cookie=newOwner.headers.get('set-cookie')!.split(';')[0];csrf=(await newOwner.json() as any).session.csrfToken;
    const afterOwnerRotation=taskService.listTasks().length;assert.equal((await api(resultPath,undefined,{},'GET')).status,404);assert.equal(taskService.listTasks().length,afterOwnerRotation);rows.push('actual_rotated_owner_cannot_read_original_result');
    fs.writeFileSync(path.join(process.env.W5_HTTP_REPORT_DIR!,'native-entry.json'),JSON.stringify({success:true,rows,actualProtectedHttp:true,actualProducer:true,physicalNativeActions:0,nativePhysicalProofIssued:0,taskPassIssued:0},null,2));console.log(JSON.stringify({success:true,checks:rows.length,physicalNativeActions:0}));
  }finally{await getBrowserOperatorAdapter().closeAll();apiServer.closeAllConnections();await new Promise<void>(resolve=>apiServer.close(()=>resolve()));fixture.closeAllConnections();await new Promise<void>(resolve=>fixture.close(()=>resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
