import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import {createTasksRouter} from '../server/routes/tasks';
import {createComputerUseRouter} from '../server/routes/computerUse';
import {createOwnerSessionRouter,requireProtectedMutation} from '../server/security/ownerSession';
import {killSwitchService} from '../src/edith/killSwitch';
import {getEdithPersistenceStore} from '../src/edith/persistence';
import {createPermissionsRouter} from '../server/routes/permissions';
import {browserNativeAuthority,NATIVE_BROWSER_PRIVATE_BASE} from '../server/browser/browserNativeAuthority';
import {getBrowserOperatorAdapter,setBrowserOperatorTestOptions} from '../src/edith/browserOperatorAdapter';
import {taskService} from '../src/edith/taskService';
import {executorService} from '../src/edith/executor';
import {verificationService} from '../src/edith/verifier';
import {browserWorkflowService} from '../src/edith/browserWorkflowService';
import type {BrowserParentExecutionCap} from '../server/browser/browserPrivateContract';
import type {NativeParentStrategySetCap} from '../server/browser/browserNativePrivateContract';

async function main(){
  assert.equal(process.env.EDITH_TEST_MODE,'true');const ref=()=>crypto.randomBytes(24).toString('base64url');
  process.env.EDITH_OWNER_TOKEN=ref();process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';process.env.EDITH_DESKTOP_BRIDGE_TOKEN=ref();
  let cookie='',csrf='',hits=0;const rows:string[]=[];
  const fixture=http.createServer((req,res)=>{hits++;res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><title>Owned fixture</title></head><body><form method="get" action="/search"><label for="q">Query</label><input id="q" type="search" name="q" value="old"></form><main><a href="/result">Owned fixture result</a></main></body></html>');});
  const listen=async(server:http.Server)=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+(server.address() as any).port;};
  const origin=await listen(fixture);await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:q=>origin+'/search?q='+encodeURIComponent(q)});
  const app=express();app.use(express.json());app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createComputerUseRouter());app.use(createTasksRouter());
  const server=http.createServer(app),base=await listen(server);
  const api=async(endpoint:string,body?:unknown)=>{const response=await fetch(base+endpoint,{method:'POST',headers:{origin:base,cookie,'x-edith-csrf-token':csrf,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
  const create=async()=>{const created=await api('/api/edith/tasks',{title:'Owned fixture intent',objective:'Owned fixture intent',originalUserRequest:'Owned fixture intent',toolsRequired:['browser_search'],permissionsRequired:['network:read','browser:control'],riskLevel:4});assert.equal(created.status,200);const id=created.body.task.id;assert.equal((await api('/api/edith/tasks/'+id+'/plan')).status,200);return id as string;};
  try{
    const login=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(login.status,201);cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json() as any).session.csrfToken;
    assert.equal((await api('/api/edith/permissions/grants',{permissions:['network:read','browser:control','computer:control'],toolIds:['browser_search','computer_action'],ttlMs:600000,reason:'Actual parent consumer integration; native causal source unavailable'})).status,200);
    assert.equal(browserNativeAuthority.supportsStrategy('search'),false);rows.push('no_native_boot_preserves_original_DOM_search_selection');
    const id=await create(),count=taskService.listTasks().length;const result=await api('/api/edith/tasks/'+id+'/execute',{nativeStrategies:{},nativePhysicalProof:true,taskId:'forged'});assert.equal(result.status,200);assert.equal(result.body.taskId,id);assert.equal(taskService.listTasks().length,count);
    const completed=taskService.getTask(id)!;assert.equal(completed.status,'COMPLETED');assert.equal(completed.verification?.status,'PASS');assert(completed.verification.checks.filter(item=>item.required).every(item=>item.status==='PASS'));assert(completed.verification.checks.some(item=>item.id.startsWith('browser-step:')&&item.id.endsWith(':no-native-proof')));assert(!completed.verification.checks.some(item=>item.id.endsWith(':native-ledger')));rows.push('original_DOM_parent_all_ordinary_checks_preserved_without_native_boot');
    const before=JSON.stringify(completed),requests=hits;assert.equal((await api('/api/edith/tasks/'+id+'/execute')).status,400);assert.equal(JSON.stringify(taskService.getTask(id)),before);assert.equal(hits,requests);rows.push('completed_original_no_restart_no_second_task');
    const fresh=await create(),unchanged=JSON.stringify(taskService.getTask(fresh)),fake={taskId:fresh,planId:taskService.getTask(fresh)!.plan!.id} as BrowserParentExecutionCap;
    assert.equal(verificationService.verifyTask(fresh,{nativeBrowserExecution:fake}).success,false);assert.equal(JSON.stringify(taskService.getTask(fresh)),unchanged);assert.equal(verificationService.evaluate(taskService.getTask(fresh)!).status,'RETRYABLE');rows.push('cloned_native_execution_aggregate_denied_no_writer');
    // Genuine producer execution cap, but no issued native strategy: a backend context
    // clone cannot manufacture a native leaf or aggregate from this original DOM plan.
    let execution:BrowserParentExecutionCap|undefined;
    app.post('/own/capture',async(req,res)=>{execution=browserWorkflowService.openParentExecution(browserWorkflowService.captureOwner(req),fresh);res.json({success:true});});
    assert.equal((await api('/own/capture')).status,200);const nativeAttempt=await executorService.executeTask(fresh,{browserExecution:execution,nativeStrategies:Object.freeze(Object.create(null)) as NativeParentStrategySetCap});assert.equal(nativeAttempt.success,false);assert.notEqual(taskService.getTask(fresh)!.verification?.status,'PASS');assert.equal(taskService.listTasks().length,count+1);rows.push('unissued_native_strategy_genuine_original_execution_no_pair_no_pass');
    const boot=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify({version:1,nativeBootNonce:ref()})});assert.equal(boot.status,200);assert.equal(browserNativeAuthority.supportsStrategy('search'),true);
    const nativeId=await create(),nativeCount=taskService.listTasks().length;
    const pending=await api('/api/edith/tasks/'+nativeId+'/execute',{nativePhysicalProof:true,taskId:'foreign'});assert.equal(pending.status,202);assert.equal(pending.body.taskId,nativeId);assert.equal(taskService.listTasks().length,nativeCount);assert.equal(taskService.getTask(nativeId)!.status,'RUNNING');
    for(let i=0;i<2;i++){const continuation=await api('/api/edith/tasks/'+nativeId+'/execute');assert.equal(continuation.status,202);assert.deepEqual(continuation.body,pending.body);assert.equal(taskService.listTasks().length,nativeCount);}
    const source=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/source',{method:'POST',headers:{authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify({version:1,phase:'enrollment',attemptRef:pending.body.attemptLookupRef})});assert.equal(source.status,200);assert.equal((await source.json() as any).result.originalTaskRef,nativeId);
    assert.notEqual(taskService.getTask(nativeId)!.verification?.status,'PASS');rows.push('genuine_query_only_native_parent_admission_and_source_same_original_Task_readonly_continuation_no_replay');
    assert.equal((await api('/api/edith/tasks/'+nativeId+'/cancel',{reason:'Owned no-input test finished'})).status,200);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(taskService.getTask(nativeId)!.status,'CANCELLED');assert.notEqual(taskService.getTask(nativeId)!.verification?.status,'PASS');assert.notEqual((await api('/api/edith/tasks/'+nativeId+'/execute')).status,202);assert.equal(taskService.listTasks().length,nativeCount);rows.push('original_native_parent_cancel_cannot_revive_or_publish_pass');
    assert.deepEqual(getEdithPersistenceStore().listTasks().find(task=>task.id===id),taskService.getTask(id),'Healthy original DOM verification uses the actual persistent canonical writer');
    // Actual parent/source/issuer/consume/verifier, with SIM-only native consent,
    // focus and map facts. Never submit a measured dispatch or mint a native pair.
    const publicationCases:unknown[]=[];
    let publicationExecution:BrowserParentExecutionCap|undefined;
    const publicationWorks:Promise<unknown>[]=[];
    app.post('/own/publication/:id',...requireProtectedMutation,async(req,res)=>{
      try{
        publicationExecution=browserWorkflowService.openParentExecution(browserWorkflowService.captureOwner(req),String(req.params.id));
        const nativeStrategies=browserWorkflowService.freezeNativeParentStrategies(publicationExecution);
        let notify!:(ticket:unknown)=>void;const pending=new Promise<unknown>(resolve=>{notify=resolve;});
        const work=executorService.executeTask(String(req.params.id),{browserExecution:publicationExecution,nativeStrategies,onNativePending:notify});publicationWorks.push(work);
        res.status(202).json(await Promise.race([pending,work]));
      }catch(error){res.status(400).json({error:String(error)});}
    });
    const privatePost=async(action:string,body:unknown)=>{const response=await fetch(base+NATIVE_BROWSER_PRIVATE_BASE+'/'+action,{method:'POST',headers:{authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
    const grants=async()=>{const response=await fetch(base+'/api/edith/permissions/grants',{headers:{origin:base,cookie}});assert.equal(response.status,200);return (await response.json() as any).grants as {id:string;permissions:string[]}[];};
    // Actual stop permanently closes this adapter; exercise kill last, with no
    // test-only resurrection of its source engine or authority membership.
    for(const mutation of ['healthy-command-one-use','native-boot','computer-permission','current-source-successor','expiry','kill'] as const){
      assert.equal((await api('/api/edith/permissions/grants',{permissions:['network:read','browser:control','computer:control'],toolIds:['browser_search','browser_open','browser_workflow','playwright_browser_agent','computer_action'],ttlMs:600000,reason:'SIM OS facts; actual parent post-command-consume denial'})).status,200);
      assert.equal((await privatePost('boot',{version:1,nativeBootNonce:ref()})).status,200);
      const taskId=await create(),started=await api('/own/publication/'+taskId,{});assert.equal(started.status,202,JSON.stringify({mutation,started,adapter:getBrowserOperatorAdapter().availability()}));assert.equal(started.body.taskId,taskId);
      const enrollment=await privatePost('source',{version:1,phase:'enrollment',attemptRef:started.body.attemptLookupRef});assert.equal(enrollment.status,200,JSON.stringify(enrollment));const e=enrollment.body.result;
      const recheck=await privatePost('source',{version:1,phase:'enrollment_recheck',enrollmentSourceRef:e.enrollmentSourceRef,enrollmentChallengeRef:e.enrollmentChallengeRef});assert.equal(recheck.status,200);
      const c={version:1,backendBootRef:e.backendBootRef,nativeBootRef:e.nativeBootRef,enrollmentSourceRef:e.enrollmentSourceRef,enrollmentChallengeRef:e.enrollmentChallengeRef,enrollmentRecheckRef:recheck.body.result.enrollmentRecheckRef,consentRef:ref(),nativeSessionRef:ref(),originalOwnerRef:e.originalOwnerRef,originalTaskRef:taskId,attemptRef:e.attemptRef,operationRef:e.operationRef,requestScopeDigest:e.requestScopeDigest,sourceEpochDigest:e.sourceEpochDigest,computerSessionGeneration:1,localSessionExpiresAtMs:e.operationDeadlineMs,reservationRef:ref(),reservationGeneration:1,reservationExpiresAtMs:e.operationDeadlineMs,nativeStopEpoch:0,confirmationRef:ref(),confirmationMethod:'win32-scoped-messagebox-yes',approvedAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+25000,e.operationDeadlineMs)};
      const associated=await privatePost('associate',{version:1,attemptRef:e.attemptRef,nativeSessionRef:c.nativeSessionRef,enrollmentSourceRef:c.enrollmentSourceRef,enrollmentChallengeRef:c.enrollmentChallengeRef,enrollmentRecheckRef:c.enrollmentRecheckRef,consentView:c});assert.equal(associated.status,200,JSON.stringify(associated));const binding=associated.body.result;
      const focus=await privatePost('focus/source',{version:1,operationRef:e.operationRef,bindingRef:binding.bindingRef});assert.equal(focus.status,200);
      const f=focus.body.result,now=Date.now(),focusRecord={version:1,kind:'set-original-foreground',focusActionRef:ref(),sourceEpochDigest:e.sourceEpochDigest,nativeBootRef:e.nativeBootRef,nativeSessionRef:c.nativeSessionRef,computerSessionGeneration:1,reservationRef:c.reservationRef,reservationGeneration:1,nativeStopEpoch:0,originalRootWindowRef:f.originalRootWindowRef,measuredBeforeAtMs:now,measuredAfterAtMs:now,expiresAtMs:f.expiresAtMs,beforeGuardsCurrent:true,afterGuardsCurrent:true,beforeForeground:'managed-edith',afterForeground:'original-chrome',rootAssociationCurrent:true,possibleEffect:true,apiBool:1};
      assert.equal((await privatePost('focus/record',{version:1,operationRef:e.operationRef,bindingRef:binding.bindingRef,focusSourceRef:f.focusSourceRef,focusRecord})).status,200);
      const source=await privatePost('source',{bindingRef:binding.bindingRef});assert.equal(source.status,200);const s=source.body.result;
      const mapRef=ref(),mapView={version:1,backendBootRef:s.backendBootRef,nativeBootRef:s.nativeBootRef,challengeRef:s.mapChallengeRef,mapRef,originalTaskRef:taskId,operationRef:s.operationRef,actionBatchRef:s.batchRef,snapshotRef:s.snapshotRef,processLaunchRef:s.launch.processLaunchRef,kernelCreation:'18446744073709551615',executableFingerprint:s.launch.executableSha256,kernelIdentityRef:ref(),rootIdentityRef:ref(),contentIdentityRef:ref(),logicalDocumentRef:ref(),logicalAncestryDigest:'a'.repeat(64),logicalRuntimeIdDigest:'b'.repeat(64),engineInventoryDigest:'c'.repeat(64),nativeInventoryDigest:'d'.repeat(64),sourceEpochDigest:s.sourceEpochDigest,nativeSessionRef:c.nativeSessionRef,nativeSessionGeneration:1,localConsentRef:c.consentRef,reservationRef:c.reservationRef,reservationGeneration:1,nativeStopEpoch:0,profile:'exclusive-mainpage-dpi96-v1',transform:{originPhysicalX:0,originPhysicalY:0,widthPhysical:100,heightPhysical:100,dpi:96,dpr:1,visualScale:1},nativeHitTargetRef:ref(),nativeHitProofDigest:'e'.repeat(64),measuredAtMs:Date.now(),expiresAtMs:Math.min(Date.now()+800,s.expiresAtMs)};
      const mapped=await privatePost('map',{challengeRef:s.mapChallengeRef,mapRef,mapView});assert.equal(mapped.status,200,JSON.stringify(mapped));
      const checked=await privatePost('check',{bindingRef:binding.bindingRef,snapshotRef:s.snapshotRef,mapRef});assert.equal(checked.status,200);
      const consumed=await privatePost('consume',{permitRef:checked.body.result.permitRef});assert.equal(consumed.status,200);assert.ok(consumed.body.result.command.commandRef);
      const execution=publicationExecution!;assert.equal(execution.taskId,taskId);
      assert.equal(browserWorkflowService.readNativeParentAggregate(execution),undefined,'Consumed command without measured final pair is not an aggregate');
      assert.equal((await privatePost('consume',{permitRef:checked.body.result.permitRef})).status,409,'Actual issued command is one-use');
      if(mutation==='native-boot')assert.equal((await privatePost('boot',{version:1,nativeBootNonce:ref()})).status,200);
      if(mutation==='computer-permission')for(const grant of await grants())if(grant.permissions.includes('computer:control')){
        const revoked=await fetch(base+'/api/edith/permissions/grants/'+grant.id,{method:'DELETE',headers:{origin:base,cookie,'x-edith-csrf-token':csrf}});assert.equal(revoked.status,200);
      }
      if(mutation==='kill')assert.equal((await api('/api/computer-use/stop',{})).status,200);
      if(mutation==='current-source-successor'){
        const attempt=browserWorkflowService.resolveIssuedAttemptLookup(started.body.attemptLookupRef),state=browserWorkflowService.inspectNativeOperationState(attempt);
        assert.ok(state.source);const held=getBrowserOperatorAdapter().nativeSources.inspectHeldSource(state.source!);
        // Actual owned-page document replacement, without network or native input.
        // SIM DOM invalidation only; never a measured native causal successor.
        await held.launch.page.goto('about:blank');assert.equal(held.launch.page.url(),'about:blank');
      }
      if(mutation==='expiry')await new Promise(resolve=>setTimeout(resolve,Math.max(0,mapView.expiresAtMs-Date.now()+30)));
      const beforeDenial=JSON.stringify(taskService.getTask(taskId)),denied=verificationService.verifyTask(taskId,{nativeBrowserExecution:execution});
      assert.equal(denied.success,false);assert.equal(JSON.stringify(taskService.getTask(taskId)),beforeDenial,'Actual verifier denial does not publish canonical changes');
      assert.deepEqual(getEdithPersistenceStore().listTasks().find(task=>task.id===taskId),taskService.getTask(taskId),'Actual persistent task agrees after rejected publication');
      assert.notEqual(taskService.getTask(taskId)!.status,'COMPLETED');assert.notEqual(taskService.getTask(taskId)!.verification?.status,'PASS');
      assert.equal(browserWorkflowService.readNativeParentAggregate(execution),undefined);assert.equal(verificationService.verifyTask(taskId,{nativeBrowserExecution:execution}).success,false,'No verification replay');
      if(mutation==='expiry'){
        const expired=await privatePost('source',{bindingRef:binding.bindingRef});
        if(expired.status===200){assert.ok(expired.body.result.expiresAtMs<=mapView.expiresAtMs);assert.ok(expired.body.result.expiresAtMs<=Date.now(),'Expired descriptive source never renews original map/command authority');}
        const command=consumed.body.result.command;
        assert.equal((await privatePost('input',{version:1,commandRef:command.commandRef,approvedInputRef:command.approvedInputRef})).status,409,'Expired command cannot resolve input');
        assert.equal((await privatePost('consume',{permitRef:checked.body.result.permitRef})).status,409,'Expired consumed permit never revives');
      }else if(mutation!=='healthy-command-one-use')assert.notEqual((await privatePost('source',{bindingRef:binding.bindingRef})).status,200,'Post-consume invalidation cannot renew original source');
      publicationCases.push({mutation,taskId,commandConsumed:true,aggregateConsumed:false,canonicalStatus:taskService.getTask(taskId)!.status,verifierSuccess:denied.success,nativeFacts:'SIM_ONLY_CONSENT_FOCUS_MAP',genuineNativePair:'NOT_RUN'});
      if(mutation==='kill')killSwitchService.deactivate('isolated-publication-fixture');
      if(taskService.getTask(taskId)!.status==='RUNNING')assert.equal((await api('/api/edith/tasks/'+taskId+'/cancel',{reason:'No native input; publication denial complete'})).status,200);
    }
    await Promise.all(publicationWorks);
    rows.push('actual_parent_command_consumed_one_use_then_boot_permission_kill_successor_expiry_no_pair_no_canonical_PASS');
    fs.writeFileSync(path.join(process.env.W5_HTTP_REPORT_DIR!,'native-parent-integration.json'),JSON.stringify({success:true,rows,actualProtectedHttp:true,actualProducer:true,publicationCases,nativeAggregatePublication:'NOT_RUN_CURRENT_COMPILED_NATIVE_CONTROLLER_REQUIRED',nativeParentAdmission:'GENUINE_QUERY_ONLY_SAME_ORIGINAL_TASK',nativeParentPhysicalOutcome:'NOT_RUN_NO_NATIVE_INPUT',physicalNativeActions:0,nativePhysicalProofIssued:0,domOriginalPass:1},null,2));console.log(JSON.stringify({success:true,checks:rows.length,physicalNativeActions:0,nativeParentPhysicalOutcome:'NOT_RUN'}));
  }finally{await getBrowserOperatorAdapter().closeAll();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fixture.closeAllConnections();await new Promise<void>(resolve=>fixture.close(()=>resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
