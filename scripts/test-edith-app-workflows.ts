import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {beginComputerSession,stopComputer,runComputerAppWorkflow,consumePendingComputerExplorer,startComputerRuntimeHeartbeat,observeComputer,actOnComputer,type ComputerExplorerClaim,type ComputerObservation} from '../src/edith/computerDesktopClient';
import {parseComputerCommand,parseComputerAppWorkflowCommand} from '../src/edith/computerCommandService';
import {validateComputerAppWorkflow,computerAppCanonicalError,COMPUTER_APP_CANONICAL_ERROR_CODES} from '../src/edith/computerAppWorkflows';
import {clearOwnerSessionMemory as clearSteamFixtureOwnerSession} from '../src/edith/ownerMutationClient';

const canonicalCasesOnly=process.argv.includes('--canonical-error-cases-only');
const steamConsumerCasesOnly=process.argv.includes('--steam-consumer-cases-only');

// Native command fixtures exercise the real default client and orchestrator.
// No application is opened or controlled; these are not Windows acceptance.
const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
let session=0,generation=0,app='spotify',playing=false,title='Track A',query='',volume=30,view='',volumeLabel='Volume';
let inputCalls=0,openCalls=0,unsupported=false,ambiguous=false,kill=false,partial=false,stopSnapshot=false;
let extraSelection=false;
let gameName='',gameSelected=false,gameMode='',gameClicks=0;
let wire:ComputerObservation;
const events:unknown[]=[];
// Synthetic command-contract baseline only; mounted cases below use real persistence.
const fixtureTasks=new Map<string,{bindingId:string;taskId:string;workflowId:string;state:string}>();
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'edith-app-gui-fixture-'));
type PrivateFixtureJob={operationId:string;operation:ComputerExplorerClaim['operation'];sourcePath:string;destinationPath:string;expiresAt:number;quarantine?:{directoryPath:string;directoryName:string;parentDirectoryIdentity:string}};
let activeJob:PrivateFixtureJob|null=null,currentDirectory=fixtureRoot,selectedName='',clipboard: {source:string;copy:boolean}|null=null,editing='address',pendingValue='',changedSource=false;
let heldWorkflow:string|undefined,heldDeadline=0,pausedOpen: (()=>void)|undefined,openEntered:(()=>void)|undefined,holdOpen=false;
const fileHash=(filename:string)=>createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const renameEvidence:unknown[]=[];
const fileIdentityParts=(filename:string)=>{const stat=fs.statSync(filename);return {dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs,sha256:fileHash(filename)};};
const hex='b'.repeat(64),pathHash='d'.repeat(64);
function control(name:string,controlType:number,automationId=name,extra:Record<string,unknown>={}){
  return {targetId:`uia:${automationId.replace(/[^A-Za-z0-9_-]/g,'_')}:${hex}`,name,automationId,controlType,x:100,y:100,width:40,height:20,value:null,toggle:null,rangeValue:null,rangeMin:null,rangeMax:null,selected:null,...extra};
}
function snapshot(){
  if(unsupported)return [];
  if(app==='explorer')return [control('Address',50004,'address',{value:currentDirectory}),...(editing==='filename'?[control('File name',50004,'filename',{value:pendingValue})]:[]),...fs.readdirSync(currentDirectory).map(name=>control(name,50007,name,{selected:name===selectedName})),...(extraSelection&&selectedName?[control('Unexpected selected item',50007,'unexpected-selection',{selected:true})]:[])];
  const controls=[control('Search',50004,'search',{value:query}),control('Library',50000),control('Downloads',50000)];
  if(app==='spotify')controls.push(control(playing?'Pause':'Play',50000),control('Next',50000),control('Previous',50000),control(title,50020,'track-title'),control(volumeLabel,50015,'volume',{rangeValue:volume,rangeMin:0,rangeMax:100}));
  if(ambiguous)controls.push(control(playing?'Pause':'Play',50000,'duplicate'));
  if(query)controls.push(control(query+' result',50007,'result'));
  if(view)controls.push(control(view,50008,`${view}-view`),control('Fixture item',50007,'item'));
  if(app==='steam'&&view==='library'&&gameName)controls.push(control(gameName,50007,'game-entry',{selected:gameSelected}));
  return controls;
}
(globalThis as unknown as {window:unknown}).window={location:{origin:'http://127.0.0.1:49999'},setInterval:()=>1,clearInterval:()=>{},__TAURI__:{core:{invoke:async(command:string,args?:Record<string,unknown>)=>{
  if(command==='computer_begin')return `workflow-session-${++session}`;
  if(command==='computer_stop'){heldWorkflow=undefined;heldDeadline=0;return;}
  if(command==='computer_workflow_reserve'){if(heldWorkflow)throw new Error('APP_WORKFLOW_RESOURCE_BUSY');heldWorkflow=String(args!.workflowId);heldDeadline=Date.parse(String(args!.deadlineAt));assert.ok(heldDeadline>Date.now());return {workflowId:heldWorkflow};}
  if(command==='computer_workflow_release'){if(heldWorkflow===args!.workflowId){heldWorkflow=undefined;heldDeadline=0;}return true;}
  if(heldWorkflow&&command!=='computer_status')assert.equal(args?.workflowId,heldWorkflow,'Native fixture independently rejects competing reservation token');
  if(command==='computer_status')return {runtime:'tauri',mode:'owner_command',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:true,killSwitch:'inactive',overlay:'missing',sessionExpiresAt:Date.now()+300000,safeMessage:'Native fixture only'};
  if(command==='computer_file_open_pending')return false;
  if(command==='computer_task_register')return {registered:true,reservationId:args!.workflowId,expiresAt:Date.now()+60000};
  if(['computer_task_bind','computer_task_finish','computer_task_cancel'].includes(command)){const task=fixtureTasks.get(String(args!.bindingId))!;assert.ok(task);if(command==='computer_task_finish')task.state='COMPLETED';if(command==='computer_task_cancel')task.state='CANCELLED';return {...task};}
  if(command==='computer_app_open'){openCalls++;if(holdOpen){openEntered?.();await new Promise<void>(resolve=>{pausedOpen=resolve;});}app=String(args!.app);return {app,windowId:'hwnd:abc',processId:77,launchRequested:false,startedProcessId:null,source:'installed_app_operator'};}
  if(command==='computer_explorer_claim')return null; // Baseline has no producer; mounted harness below owns real queued jobs.
  if(command==='computer_observe'||command==='computer_screenshot')return wire={observationId:`workflow-obs-${++generation}`,generation,imageDataUrl:'data:image/png;base64,fixture',originX:0,originY:0,width:800,height:600,cursorX:100,cursorY:100,capturedAt:Date.now(),expiresAt:Date.now()+15000,source:'windows_gdi_virtual_desktop',confidence:1,windowId:'hwnd:abc',windowProcessId:77,windowBounds:{x:0,y:0,width:800,height:600},monitorId:'monitor-fixture',monitorBounds:{x:0,y:0,width:800,height:600},scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:true,ocrAvailable:false};
  if(command==='computer_focus_target')return {windowId:'hwnd:abc',processId:77,imagePathFingerprint:pathHash,observationId:wire.observationId,observationGeneration:wire.generation};
  if(command==='computer_app_snapshot'){if(stopSnapshot){stopSnapshot=false;await stopComputer();}return snapshot();}
  if(command==='computer_app_volume'){inputCalls++;if(kill)throw new Error('kill_switch_active');volume=Number(args!.volume);return {source:'semantic_range_pattern',targetId:args!.targetId,requestedVolume:volume,observedValue:volume,minimum:0,maximum:100,matched:true};}
  if(command==='computer_read_text')return query;
  if(command==='computer_action'){
    const request=args!.request as Record<string,unknown>;
    if(args!.explorerOperationId){assert.equal(args!.explorerOperationId,activeJob?.operationId);if(changedSource)throw new Error('source_changed');assert.ok(fs.existsSync(activeJob!.sourcePath));if(activeJob!.operation!=='find')assert.equal(fs.existsSync(activeJob!.destinationPath),false);}
    if(request.action==='focusApp')return {...request,injected:false,dispatchStatus:'dispatched',cursorX:100,cursorY:100,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:request.observationId,attempts:1,focusReadback:{source:'native_operator',applicationId:request.applicationId,windowId:'hwnd:abc',windowProcessId:77,imagePathFingerprint:pathHash,matched:true}};
    inputCalls++;if(kill)throw new Error('kill_switch_active');
    const target=(request.target as {targetId:string}|undefined)?.targetId;
    if(request.action==='clickMouse'&&target){if(target.includes(':Play:'))playing=true;if(target.includes(':Pause:'))playing=false;if(target.includes(':Next:'))title='Track B';if(target.includes(':Previous:'))title='Track A';if(target.includes(':Library:'))view='library';if(target.includes(':Downloads:'))view='downloads';}
    if(app==='explorer'){
      if(request.action==='clickMouse'&&target){const selected=snapshot().find(c=>c.targetId===target);assert.ok(selected);selectedName=selected.name;}
      if(request.action==='hotkey'){
        const keys=(request.keys as string[]).join(',');
        if(keys==='CTRL,L'){editing='address';pendingValue=currentDirectory;}
        if(keys==='CTRL,A')pendingValue='';
        if(keys==='CTRL,SHIFT,N'){editing='filename';pendingValue='New folder';}
        if(keys==='CTRL,C'||keys==='CTRL,X')clipboard={source:path.join(currentDirectory,selectedName),copy:keys==='CTRL,C'};
        if(keys==='CTRL,V'){assert.ok(clipboard);const destination=path.join(currentDirectory,path.basename(clipboard.source));if(clipboard.copy)fs.copyFileSync(clipboard.source,destination);else{const before=fileIdentityParts(clipboard.source);fs.renameSync(clipboard.source,destination);renameEvidence.push({before,after:fileIdentityParts(destination)});}selectedName=path.basename(destination);}
      }
      if(request.action==='typeText')pendingValue=String(request.text);
      if(request.action==='pressKey'&&request.key==='ENTER'){
        if(editing==='filename'){fs.mkdirSync(path.join(currentDirectory,pendingValue));editing='address';}else{assert.ok(fs.statSync(pendingValue).isDirectory());currentDirectory=pendingValue;selectedName='';}
      }
    }else{
      if(request.action==='hotkey'&&(request.keys as string[]).join(',')==='CTRL,A')query='';
      if(request.action==='typeText')query=String(request.text);
    }
    return {...request,injected:true,dispatchStatus:partial?'failed':'dispatched',...(partial?{partialInputInjected:true,releaseConfirmed:true}:{}),cursorX:100,cursorY:100,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:request.observationId,attempts:1};
  }
  throw new Error(`Unexpected native fixture command ${command}`);
}}}};
globalThis.fetch=async(input,init)=>{
  if(String(input)==='/api/computer-use/workflows'){const body=JSON.parse(String(init!.body));const bindingId='fixture-binding-'+body.workflowId,task={bindingId,taskId:'fixture-task-'+body.workflowId,workflowId:body.workflowId,state:'RUNNING'};fixtureTasks.set(bindingId,task);return new Response(JSON.stringify({success:true,...task,taskBinding:'registered',physicalAcceptance:false}));}
  if(String(input).startsWith('/api/computer-use/workflows/')){const task=fixtureTasks.get(String(input).split('/').at(-1)!)!;return new Response(JSON.stringify({success:true,...task,taskBinding:'registered',physicalAcceptance:false}));}
  if(String(input).startsWith('/api/edith/tasks/')){const task=Array.from(fixtureTasks.values()).find(task=>task.taskId===String(input).split('/')[4])!;return new Response(JSON.stringify({success:true,taskId:task.taskId,status:task.state,verification:{taskId:task.taskId,status:'PASS',checks:[{id:'native-session-ledger',required:true,status:'PASS'},{id:'native-required-postcondition',required:true,status:'PASS'}]}}));}
  if(String(input)==='/api/security/session')return new Response(JSON.stringify({session:{actor:'owner',csrfToken:'fixture-csrf',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}}));
  assert.ok(['/api/computer-use/realtime-events','/api/computer-use/runtime','/api/computer-use/events'].includes(String(input)),'Fixture permits only real declared local reporting routes');
  events.push(init?.body?JSON.parse(String(init.body)):{});return new Response('{}',{status:202});
};
async function prepare(){await stopComputer();const id=await beginComputerSession();playing=false;query='';volume=30;title='Track A';view='';gameName='';gameSelected=false;gameMode='';unsupported=false;ambiguous=false;kill=false;partial=false;return id;}
// Frontend command-contract SIM only. Successful native semantic admission and
// task proof below are invented fixture responses, never production injection,
// actual EMPTY native capture, provider approval or physical Windows acceptance.
async function steamConsumerContractCases(){
 const core=(window as any).__TAURI__.core,baseInvoke=core.invoke;
 const RealDate=globalThis.Date,realNow=RealDate.now;
 const baseline={session,generation,app,playing,title,query,volume,view,volumeLabel,inputCalls,openCalls,unsupported,ambiguous,kill,partial,stopSnapshot,extraSelection,gameName,gameSelected,gameMode,gameClicks,wire,heldWorkflow,heldDeadline,eventsLength:events.length,tasks:new Map(fixtureTasks)};
 // This synthetic clock keeps legitimate fixture session TTLs in the past
 // relative to the unchanged old suite. Its first workflow uses the ordinary
 // expiry sweep; no private workflow ledger setter or injected cleanup exists.
 const virtualNow=()=>realNow()-600000;
 const priorDate=new Proxy(RealDate,{
  construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[virtualNow()],newTarget);},
  get(target,property,receiver){return property==='now'?virtualNow:Reflect.get(target,property,receiver);},
  apply(){return new RealDate(virtualNow()).toString();},
 });
 globalThis.Date=priorDate;
 const cases=[
  {mode:'approved_sim',expected:undefined,clicks:1,finishes:1},
  {mode:'empty',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'empty_focus',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'ambiguous',expected:'APP_GAME_TARGET_UNSUPPORTED',clicks:0,finishes:0},
  {mode:'sidebar',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'properties',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'overlay',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'stale',expected:'APP_WORKFLOW_UNVERIFIED',clicks:0,finishes:0},
  {mode:'malformed_target',expected:'APP_GAME_TARGET_UNSUPPORTED',clicks:0,finishes:0},
  {mode:'wrong_window',expected:'APP_WINDOW_CHANGED',clicks:0,finishes:0},
  {mode:'owner',expected:'OWNER_SESSION_REQUIRED',clicks:0,finishes:0},
  {mode:'kill',expected:'KILL_SWITCH_ACTIVE',clicks:0,finishes:0},
  {mode:'partial',expected:'APP_INPUT_PARTIAL',clicks:1,finishes:0},
  {mode:'finish_refusal',expected:'NATIVE_STEAM_FINAL_PROFILE_INVALID',clicks:1,finishes:1},
  {mode:'first_cause_cleanup_kill',expected:'NATIVE_STEAM_PROFILE_UNAPPROVED',clicks:0,finishes:0},
  {mode:'private_unknown_refusal',expected:'APP_WORKFLOW_UNVERIFIED',clicks:0,finishes:0},
 ] as const;
 const results:unknown[]=[];
 try{for(const test of cases){
  core.invoke=baseInvoke;const id=await prepare();const trace:Array<{command:string;action?:unknown;target?:unknown}>=[];
  let clicks=0,finishes=0,locates=0,observations=0,cancels=0;
  const target={targetId:`steam-uia:1:${hex}`,controlType:50007,x:110,y:130,width:44,height:22};
  core.invoke=async(command:string,args:Record<string,unknown>={})=>{
   const request=args.request as Record<string,unknown>|undefined;
   trace.push({command,...(request?{action:request.action,target:request.target}: {})});
   if(command==='computer_app_snapshot')assert.fail('Marked Steam path must never request a generic control snapshot');
   if(command==='computer_observe'||command==='computer_screenshot'){
    observations++;const result=await baseInvoke(command,args);
    if(test.mode==='wrong_window'&&observations===3)result.windowId='hwnd:changed';
    return result;
   }
   if(command==='computer_locate'){
    locates++;assert.equal(args.query,'__native_steam_game_entry__');assert.deepEqual(Object.keys(args).sort(),['generation','observationId','query','sessionId','workflowId']);
    assert.equal(args.sessionId,id);assert.equal(args.observationId,wire.observationId);assert.equal(args.generation,wire.generation);
    const focusIndex=trace.findIndex(row=>row.command==='computer_action'&&row.action==='focusApp');assert.ok(focusIndex>=0);assert.ok(trace.slice(focusIndex+1,-1).some(row=>row.command==='computer_observe'),'Fresh observation follows focus before native resolution');
    if(['empty','sidebar','properties','overlay','first_cause_cleanup_kill'].includes(test.mode))throw new Error('NATIVE_STEAM_PROFILE_UNAPPROVED');
    if(test.mode==='ambiguous')throw new Error('APP_GAME_TARGET_UNSUPPORTED');
    if(test.mode==='owner')throw new Error('OWNER_SESSION_REQUIRED');
    if(test.mode==='kill')throw new Error('KILL_SWITCH_ACTIVE');
    if(test.mode==='private_unknown_refusal')throw new Error('SIM-private-unrecognized-provider-text');
    if(test.mode==='stale')await observeComputer(id,String(args.workflowId));
    return test.mode==='malformed_target'?{...target,controlType:50000}:target;
   }
   if(command==='computer_action'&&request?.action==='focusApp'&&test.mode==='empty_focus')throw new Error('NATIVE_STEAM_PROFILE_UNAPPROVED');
   if(command==='computer_action'&&request?.action!=='focusApp'){
    assert.ok(request);clicks++;assert.equal(clicks,1,'One marked entry input; no library click, keys or fallback input');assert.equal(request.action,'clickMouse');assert.equal(request.button,'left');assert.equal(request.attempt,1);assert.equal(request.x,132);assert.equal(request.y,141);assert.equal((request.target as any).targetId,target.targetId);
    assert.equal((request.target as any).observationId,wire.observationId);assert.equal((request.target as any).observationGeneration,wire.generation);
    const result=await baseInvoke(command,args);return test.mode==='partial'?{...result,dispatchStatus:'failed',partialInputInjected:true,releaseConfirmed:true}:result;
   }
   if(command==='computer_task_finish'){
    finishes++;if(test.mode==='finish_refusal')throw new Error('NATIVE_STEAM_FINAL_PROFILE_INVALID');
   }
   if(command==='computer_task_cancel'){
    cancels++;const result=await baseInvoke(command,args);if(test.mode==='first_cause_cleanup_kill')throw new Error('KILL_SWITCH_ACTIVE');return result;
   }
   return baseInvoke(command,args);
  };
  const identity={workflowId:'steam-consumer-SIM-'+test.mode,idempotencyKey:'steam-consumer-SIM-'+test.mode};
  const result=await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:' Fixture Game '},identity);
  const diagnostic=()=>JSON.stringify({mode:test.mode,clicks,finishes,locates,observations,cancels,commands:trace.slice(-24).map(row=>row.command)});
  assert.equal(result.physicalAcceptance,false);assert.equal(result.errorCode,test.expected,diagnostic());assert.equal(clicks,test.clicks,diagnostic());assert.equal(finishes,test.finishes,diagnostic());
  assert.equal(locates,['wrong_window','empty_focus'].includes(test.mode)?0:1,test.mode);assert.equal(JSON.stringify(result).includes('SIM-private-unrecognized-provider-text'),false);
  if(test.mode==='approved_sim'){assert.equal(result.status,'verified');assert.equal(result.taskState,'COMPLETED');assert.equal(cancels,0);}
  else{assert.notEqual(result.status,'verified',test.mode);assert.notEqual(result.taskState,'COMPLETED',test.mode);assert.ok(cancels>=1||test.mode==='wrong_window',test.mode);}
  const priorTrace=trace.length;assert.equal(await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:' Fixture Game '},identity),result);assert.equal(trace.length,priorTrace,'Cached result never resolves, clicks or finishes again: '+test.mode);
  assert.equal(trace.some(row=>row.command==='computer_app_snapshot'),false);
  results.push({mode:test.mode,errorCode:result.errorCode,status:result.status,clicks,finishes,locates,productionAdmission:false});
 }
 }finally{
  core.invoke=baseInvoke;
  try{await stopComputer();}finally{
   globalThis.Date=RealDate;clearSteamFixtureOwnerSession();
   ({session,generation,app,playing,title,query,volume,view,volumeLabel,inputCalls,openCalls,unsupported,ambiguous,kill,partial,stopSnapshot,extraSelection,gameName,gameSelected,gameMode,gameClicks,wire,heldWorkflow,heldDeadline}=baseline);
   events.length=baseline.eventsLength;fixtureTasks.clear();for(const [id,task]of baseline.tasks)fixtureTasks.set(id,task);
  }
 }
 assert.equal(globalThis.Date,RealDate);assert.equal(Date.now,realNow);assert.equal(core.invoke,baseInvoke);assert.equal(events.length,baseline.eventsLength);assert.equal(fixtureTasks.size,baseline.tasks.size);
 console.log(JSON.stringify({steamConsumerCases:true,caseCount:cases.length,commandContractSimulationOnly:true,syntheticPriorClockMs:600000,clockAndFixtureRestored:true,actualNativeEmptyCapture:false,physicalAcceptance:false,cases:results}));
}
try{
  await steamConsumerContractCases();
  if(!steamConsumerCasesOnly){
  assert.ok(Object.isFrozen(COMPUTER_APP_CANONICAL_ERROR_CODES));
  for(const code of ['NATIVE_POSTSTATE_STALE','OWNER_SESSION_REQUIRED','KILL_SWITCH_ACTIVE']){assert.equal(computerAppCanonicalError(code),code);assert.equal(computerAppCanonicalError(new Error(code)),code);}
  for(const unknown of ['NATIVE_ARBITRARY_PRIVATE_VALUE','APP_ARBITRARY_PRIVATE_VALUE','secret auth-like fixture text','NATIVE_POSTSTATE_STALE '.repeat(100),{message:'NATIVE_POSTSTATE_STALE'},null,undefined,new String('NATIVE_POSTSTATE_STALE')])assert.equal(computerAppCanonicalError(unknown),'APP_WORKFLOW_UNVERIFIED');
  if(canonicalCasesOnly){
  const privacyInvoke=(window as any).__TAURI__.core.invoke;
  try{
    const faults:Array<{value:unknown;expected:string}>=[{value:'NATIVE_POSTSTATE_STALE',expected:'NATIVE_POSTSTATE_STALE'},{value:new Error('OWNER_SESSION_REQUIRED'),expected:'OWNER_SESSION_REQUIRED'},{value:'KILL_SWITCH_ACTIVE',expected:'KILL_SWITCH_ACTIVE'},{value:'unrecognized private fixture message',expected:'APP_WORKFLOW_UNVERIFIED'},{value:'NATIVE_POSTSTATE_STALE'.repeat(100),expected:'APP_WORKFLOW_UNVERIFIED'},{value:{message:'NATIVE_POSTSTATE_STALE'},expected:'APP_WORKFLOW_UNVERIFIED'}];
    for(const [index,fault]of faults.entries()){
      (window as any).__TAURI__.core.invoke=async(command:string,args:Record<string,unknown>)=>{if(command==='computer_task_finish')throw fault.value;return privacyInvoke(command,args);};
      const privacySession=await prepare(),failure=await runComputerAppWorkflow(privacySession,{app:'spotify',workflow:'open'},{workflowId:'canonical-privacy-'+index,idempotencyKey:'canonical-privacy-'+index});
      assert.equal(failure.errorCode,fault.expected);assert.equal(failure.status,'partial');assert.equal(failure.taskState,'CANCELLED');
    }
  }finally{(window as any).__TAURI__.core.invoke=privacyInvoke;}
  await mountedProducerHarness();
  console.log('PASS focused canonical errors: real mounted normal/stale/cleanup-kill plus software-only transport privacy; physical Windows acceptance NOT claimed.');
  }else{
  assert.deepEqual(parseComputerAppWorkflowCommand('Spotify ses 45'),{app:'spotify',workflow:'volume',volume:45});
  assert.equal(parseComputerAppWorkflowCommand('Steam play'),null);
  assert.equal(parseComputerCommand('Steam purchase game')?.kind,'blocked');
  assert.equal(validateComputerAppWorkflow({app:'spotify',workflow:'volume',volume:101}),false);
  assert.equal(validateComputerAppWorkflow({app:'spotify',workflow:'search',query:'ok',extra:true}),false);
  for(const gameName of ['Fixture Game',' \uFEFFİstanbul 😀\u3000 ','😀'.repeat(160)])assert.equal(validateComputerAppWorkflow({app:'steam',workflow:'game_detail',gameName}),true);
  for(const gameName of ['', ' ', '\u0085name','\tname','\uD800','😀'.repeat(161),'x'.repeat(161)])assert.equal(validateComputerAppWorkflow({app:'steam',workflow:'game_detail',gameName}),false);
  for(const request of [{app:'spotify',workflow:'game_detail',gameName:'Game'},{app:'steam',workflow:'game_detail',gameName:'Game',query:'x'},{app:'steam',workflow:'open',gameName:'Game'}])assert.equal(validateComputerAppWorkflow(request),false);
  let id=await prepare();
  let result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'open'});assert.equal(result.status,'verified');assert.equal(result.physicalAcceptance,false);assert.equal(result.taskBinding,'registered','Synthetic command-contract fixture is explicitly separate from real mounted task persistence');assert.equal(result.steps.length,1);
  result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'});assert.equal(result.status,'verified');assert.equal(playing,true);
  result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'pause'});assert.equal(result.status,'verified');assert.equal(playing,false);
  assert.equal((await runComputerAppWorkflow(id,{app:'spotify',workflow:'next'})).status,'verified');assert.equal(title,'Track B');
  assert.equal((await runComputerAppWorkflow(id,{app:'spotify',workflow:'previous'})).status,'verified');assert.equal(title,'Track A');
  assert.equal((await runComputerAppWorkflow(id,{app:'spotify',workflow:'volume',volume:75})).status,'verified');assert.equal(volume,75);
  volumeLabel='Ses seviyesi';assert.equal((await runComputerAppWorkflow(id,{app:'spotify',workflow:'volume',volume:50})).status,'verified');assert.equal(volume,50);volumeLabel='Volume';
  result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'search',query:'fixture needle'});assert.equal(result.status,'verified');assert.equal(result.effectReceipt?.itemCount,1);
  assert.equal(JSON.stringify(events).includes('fixture needle'),false,'Canonical journal never contains raw search query');
  assert.equal((await runComputerAppWorkflow(id,{app:'spotify',workflow:'library'})).status,'verified');
  id=await prepare();assert.equal((await runComputerAppWorkflow(id,{app:'steam',workflow:'library'})).status,'verified');
  view='';assert.equal((await runComputerAppWorkflow(id,{app:'steam',workflow:'downloads'})).status,'verified');
  id=await prepare();unsupported=true;let prior=inputCalls;result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'});assert.notEqual(result.status,'verified');assert.equal(inputCalls,prior,'Unsupported UIA causes zero blind input');
  id=await prepare();ambiguous=true;prior=inputCalls;assert.notEqual((await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'})).status,'verified');assert.equal(inputCalls,prior,'Ambiguous UIA causes zero input');
  id=await prepare();partial=true;const identity={workflowId:'workflow-partial',idempotencyKey:'workflow-partial'};
  result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'},identity);prior=inputCalls;
  assert.equal(result.status,'partial');assert.equal(await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'},identity),result);assert.equal(inputCalls,prior,'Partial workflow is never automatically replayed');
  await assert.rejects(()=>runComputerAppWorkflow(id,{app:'spotify',workflow:'pause'},identity),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>runComputerAppWorkflow(id,{app:'spotify',workflow:'play'},{...identity,workflowId:'workflow-rebound'}),/IDEMPOTENCY_CONFLICT/);
  id=await prepare();stopSnapshot=true;prior=inputCalls;assert.notEqual((await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'})).status,'verified');assert.equal(inputCalls,prior,'Stop during semantic await prevents later input');
  id=await prepare();kill=true;result=await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'},{workflowId:'workflow-killed',idempotencyKey:'workflow-killed'});prior=inputCalls;assert.notEqual(result.status,'verified');await runComputerAppWorkflow(id,{app:'spotify',workflow:'play'},{workflowId:'workflow-killed',idempotencyKey:'workflow-killed'});assert.equal(inputCalls,prior);
  id=await prepare();holdOpen=true;const entered=new Promise<void>(resolve=>{openEntered=resolve;});
  const running=runComputerAppWorkflow(id,{app:'spotify',workflow:'play'});await entered;
  prior=inputCalls;const opensBefore=openCalls;
  assert.equal(await consumePendingComputerExplorer(id),null,'Default pending consumer does not claim while another workflow owns input');
  assert.equal((await runComputerAppWorkflow(id,{app:'steam',workflow:'library'})).status,'blocked');assert.equal(inputCalls,prior);assert.equal(openCalls,opensBefore,'Competing app cannot redirect foreground');
  await assert.rejects(()=>observeComputer(id),/RESOURCE_BUSY/);
  await assert.rejects(()=>actOnComputer(id,{action:'clickMouse',x:110,y:110}),/RESOURCE_BUSY/);assert.equal(inputCalls,prior);
  await stopComputer();assert.equal(heldWorkflow,undefined);pausedOpen!();holdOpen=false;
  assert.notEqual((await running).status,'verified');assert.equal(inputCalls,prior,'Stopped awaited opener produces no following UI input');
  await mountedProducerHarness();
  console.log('PASS default app orchestrator/client: synthetic command-contract baseline plus real mounted producer/TaskService/default-mobile integration and own sandbox filesystem effects. Native dispatch/UIA are explicit fixtures; physical Windows acceptance NOT claimed.');
  }
  }
}finally{await stopComputer();globalThis.fetch=previousFetch;(globalThis as unknown as {window:unknown}).window=previousWindow;fs.rmSync(fixtureRoot,{recursive:true,force:true});}

// BEGIN DEFAULT_OPEN_DIAGNOSTICS
function createDefaultOpenDiagnostics(){
  type Stage='before_finish'|'finish_request'|'finish_rejection'|'finish_response_mapping'|'completion_binding_readback'|'completion_activity_readback'|'cleanup';
  type Entry={stage:Stage;status?:number;errorCode?:string;exceptionType?:string};
  const knownCodes=new Set(['FILES_NATIVE_UNAVAILABLE','NATIVE_POSTSTATE_STALE','NATIVE_BINDING_REVOKED','NATIVE_LEDGER_INCOMPLETE','NATIVE_REQUIRED_POSTCONDITION_FAILED','NATIVE_CONTEXT_INVALID','NATIVE_BINDING_INPUT_INVALID','NATIVE_SESSION_EXPIRED','NATIVE_BINDING_EXPIRED','NATIVE_SAFETY_MEMBERSHIP_LOST','NATIVE_SAFETY_MEMBERSHIP_INVALID','NATIVE_TASK_EVENT_INVALID','OWNER_SESSION_REQUIRED','KILL_SWITCH_ACTIVE','APP_TASK_BINDING_INVALID','APP_TASK_NOT_COMPLETED','APP_TASK_READBACK_REJECTED','APP_TASK_PROOF_UNAVAILABLE','APP_TASK_REQUIRED_PROOF_UNVERIFIED','APP_WORKFLOW_EXPIRED','APP_SESSION_CHANGED','APP_WORKFLOW_UNVERIFIED','EPERM','EBUSY','EACCES','ENOENT','ABORT_ERR']);
  const knownTypes=new Set(['Error','AssertionError','TypeError','RangeError','SyntaxError','DOMException','AbortError']);
  const canonical=(value:unknown)=>typeof value==='string'&&knownCodes.has(value)?value:value===undefined?undefined:'UNRECOGNIZED';
  const history:Entry[]=[];let firstFailure:Entry|undefined,lastStage:Stage='before_finish',lastStatus:number|undefined,cleanup=false;
  const statusOf=(value:unknown)=>Number.isInteger(value)&&Number(value)>=100&&Number(value)<=599?Number(value):undefined;
  const note=(stage:Stage,status?:number)=>{const entry:Entry={stage:cleanup?'cleanup':stage,status:statusOf(status)};history.push(entry);if(history.length>16)history.shift();if(!cleanup){lastStage=stage;lastStatus=entry.status;}};
  const failure=(stage:Stage,error?:unknown,status?:number,code?:unknown)=>{
    if(cleanup)return;
    const row=error&&typeof error==='object'?error as {name?:unknown;code?:unknown;message?:unknown}:undefined;
    const exceptionType=row?(typeof row.name==='string'&&knownTypes.has(row.name)?row.name:'Unknown'):undefined;
    const errorCode=canonical(code??(knownCodes.has(String(row?.code))?row?.code:row?.message));
    if(!firstFailure)firstFailure={stage,status:statusOf(status??lastStatus),errorCode,exceptionType};
    else if(!firstFailure.exceptionType&&exceptionType)firstFailure={...firstFailure,exceptionType};
  };
  return {canonical,note,failure,
    response(stage:Stage,status:number,code?:unknown){note(stage,status);if(status!==200)failure(stage==='finish_request'?'finish_rejection':stage,undefined,status,code);},
    async capture<T>(stage:Stage,work:()=>Promise<T>):Promise<T>{note(stage);try{return await work();}catch(error){failure(stage==='finish_request'?'finish_rejection':stage,error);throw error;}},
    cleanup(){cleanup=true;note('cleanup');},
    snapshot(resultCode?:unknown){return {lastStage,firstFailure:firstFailure?{...firstFailure}:undefined,resultErrorCode:canonical(resultCode),history:history.map(entry=>({...entry}))};},
  };
}
// END DEFAULT_OPEN_DIAGNOSTICS

/** Real mounted producer and persistence. Native invocation remains the explicitly
 * synthetic fixture above. No invented future consumer command names are handled. */
async function mountedProducerHarness(){
  assert.equal(process.env.EDITH_TEST_MODE,'true','Mounted producer harness requires isolated runner');
  assert.ok(process.env.EDITH_TEST_DATA_DIR,'Never use the live application store');
  const [{default:express},{createServer},{createOwnerSessionRouter,getSoleActiveOwnerSession},
    {createComputerUseRouter},{createTasksRouter},{createMobileTasksRouter},{createFilesRouter},
    {FileService},{getNativeTaskBinding,NativeTaskBindingService,digest},{taskService},{getMobileRuntime},
    {clearOwnerSessionMemory},{projectTaskEventsV2,parseTaskEventV2,TASK_CONTRACT_VERSION,EDITH_CONTRACT_AMENDMENT},
    {generateKeyPairSync,sign},{killSwitchService}]=await Promise.all([
    import('express'),import('node:http'),import('../server/security/ownerSession'),
    import('../server/routes/computerUse'),import('../server/routes/tasks'),import('../server/routes/mobileTasks'),
    import('../server/routes/files'),import('../server/files/fileService'),import('../server/computer/nativeTaskBinding'),
    import('../src/edith/taskService'),import('../server/mobile/runtime'),import('../src/edith/ownerMutationClient'),
    import('../src/edith/contracts'),import('node:crypto'),import('../src/edith/killSwitch')]);
  const oldFetch=globalThis.fetch,oldOrigin=window.location.origin;
  const fixtureCore=(window as any).__TAURI__.core;
  const fixtureInvoke=fixtureCore.invoke;
  const oldOwner=process.env.EDITH_OWNER_TOKEN,oldBridge=process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
  const ownRoot=path.join(fixtureRoot,'mounted-producer');fs.mkdirSync(ownRoot);fs.mkdirSync(path.join(ownRoot,'source'));fs.mkdirSync(path.join(ownRoot,'destination'));
  fs.writeFileSync(path.join(ownRoot,'source','owned.txt'),'Mounted producer own bytes İstanbul');
  const files=new FileService(()=>[{id:'workspace',path:ownRoot}]);
  const router=express();router.use(express.json());router.use(createOwnerSessionRouter());router.use(createFilesRouter(files));
  router.use(createComputerUseRouter());router.use(createTasksRouter());router.use(createMobileTasksRouter());
  const mounted=createServer(router),runtime=getMobileRuntime();
  process.env.EDITH_OWNER_TOKEN='mounted-workflow-fixture-owner';process.env.EDITH_DESKTOP_BRIDGE_TOKEN='mounted-workflow-fixture-private';
    const checks:string[]=[];
  try{
    await new Promise<void>(resolve=>mounted.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+(mounted.address() as {port:number}).port;
    const login=await previousFetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer mounted-workflow-fixture-owner'}});
    const loginBody=await login.json() as any;assert.equal(login.status,201);
    const cookie=login.headers.get('set-cookie')!.split(';')[0];
    // This is fixture-only Node authority. Production Rust cannot call this getter.
    // Keep CROSS_CHAT_OWNER_CONTEXT_REQUEST.json unresolved; never claim native readiness.
    const fixtureOwner=getSoleActiveOwnerSession()!;assert.ok(fixtureOwner);
    assert.equal(loginBody.session.bindingId,undefined,'Public owner response does not supply the missing private native owner context');
    const publicHeaders={origin,cookie,'content-type':'application/json','x-edith-csrf-token':loginBody.session.csrfToken};
    const privateHeaders:Record<string,string>={authorization:'Bearer mounted-workflow-fixture-private','content-type':'application/json'};
    const defaultOpenDiagnostics=createDefaultOpenDiagnostics();let defaultOpenDiagnosticsActive=false;
    const call=async(route:string,body?:unknown,headers:Record<string,string>=publicHeaders)=>{
      const response=await previousFetch(origin+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
      const isDefaultFinish=defaultOpenDiagnosticsActive&&/^\/api\/computer-use\/native-workflows\/[^/]+\/finish$/.test(route);
      if(isDefaultFinish)defaultOpenDiagnostics.note('finish_request',response.status);
      const data=await response.json() as any;
      if(isDefaultFinish)defaultOpenDiagnostics.response('finish_request',response.status,data?.errorCode);
      return {status:response.status,data};
    };
    const privateCall=(route:string,body?:unknown,headers=privateHeaders)=>call(route,body,headers);
    let lastPrivateFailure='',publicFailure='';
    const checked=async(route:string,body?:unknown,headers=privateHeaders)=>{
      const result=await privateCall(route,body,headers);if(result.status!==200)lastPrivateFailure=route+': '+JSON.stringify(result.data);
      if(result.status!==200&&route.startsWith('/api/computer-use/native-workflows/'))throw new Error(computerAppCanonicalError(result.data?.errorCode));
      assert.equal(result.status,200,`Real private producer ${route}: ${JSON.stringify(result.data)}`);return result.data;
    };
    // SIM native lifecycle, actual authenticated mounted safety registry. Native
    // epochs are separate from the synthetic observation generation above.
    let safetyScope:any=null,nativeSafetyEpoch=0;
    const retireSafety=async()=>{
      if(!safetyScope)return;
      const original=safetyScope;
      const retired=await checked('/api/computer-use/native-safety/session/retire',{
        schema:'edith.native-mobile/1',safetySessionRef:original.safetySessionRef,nativeSessionId:original.nativeSessionId,
        nativeBootNonce:original.nativeBootNonce,originalGeneration:original.originalGeneration},
        {...privateHeaders,'x-edith-safety-session':original.safetySessionRef});
      assert.equal(retired.retired,true);assert.equal(retired.safetySessionRef,original.safetySessionRef);assert.equal(retired.expiresAt,original.expiresAt,'Retirement does not renew original safety deadline');safetyScope=null;
    };
    const ensureSafety=async(nativeSessionId:string)=>{
      const owner=(await checked('/api/computer-use/native-workflows/owner-context')).context;
      if(safetyScope?.nativeSessionId===nativeSessionId){assert.equal(safetyScope.ownerBindingId,owner.ownerBindingId);assert.ok(Date.parse(safetyScope.expiresAt)>Date.now());return safetyScope;}
      await retireSafety();
      const original={schema:'edith.native-mobile/1',nativeSessionId,ownerBindingId:owner.ownerBindingId,
        originalGeneration:nativeSafetyEpoch++,nativeBootNonce:'SIM-mounted-native-boot-'+nativeSafetyEpoch,
        sessionExpiresAt:new Date(Math.min(owner.ownerExpiresAt,Date.now()+300000)).toISOString()};
      const enrolled=await privateCall('/api/computer-use/native-safety/session',original);assert.equal(enrolled.status,201,JSON.stringify(enrolled.data));
      assert.ok(Date.parse(enrolled.data.expiresAt)<=Date.parse(original.sessionExpiresAt));
      safetyScope=Object.freeze({...original,safetySessionRef:enrolled.data.safetySessionRef,expiresAt:enrolled.data.expiresAt});return safetyScope;
    };
    const parentHash=(directory:string)=>digest(directory.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase());
    let canonicalFixtureMode:''|'stale'|'stale_cleanup_kill'='',canonicalPostAt=0;
    const cancellationReason=(taskId:string)=>(projectTaskEventsV2(taskService.getTask(taskId)!).events.find(row=>row.type==='task.cancelled') as any)?.payload?.reasonCode;
    let mountedAppIntent:any=null;
    let skipFixtureMode:''|'unchanged'|'wrong_echo'|'wrong_target'|'partial'|'later_focus'='';
    let nativeBinding:any=null,privateSource:any=null,privateContext:any=null,permitNonce:string|undefined,quarantineIdentity:string|undefined;
    let retainedReadback:any=null,postObservationId='',proofSerial=0,nativeBoundTarget=false;
    let wrongFolderProof=false,tamperReadback=false,mutateOnClaim=false,approvedNativeText:string|undefined;
    const mountedGuiResults:unknown[]=[];
    const mountedCanonicalTaskIds=new Set<string>();
    const sampledCanonicalJournal=new Map<string,unknown[]>();
    const recordCanonicalTask=(taskId:string)=>{
      mountedCanonicalTaskIds.add(taskId);
      const journal=JSON.parse(fs.readFileSync(path.join(path.dirname(runtime.store.filePath),'mobile-realtime.json'),'utf8'));
      const rows=journal.histories.flatMap((entry:any)=>entry[1]).filter((event:any)=>event.event==='task.event.v2'&&event.payload.taskId===taskId).map((event:any)=>event.payload);
      assert.deepEqual(rows,projectTaskEventsV2(taskService.getTask(taskId)!).events,'Actual persisted realtime sampled immediately before its bounded500 row journal can evict old events');
      sampledCanonicalJournal.set(taskId,rows);
    };
    const entryIdentity=()=>digest(JSON.stringify(['steam-entry-v1',nativeBinding.requestDigest,'hwnd:abc',77,pathHash,[42,7],gameName.trim(),[[[42],50008],[[42,7],50007]]]));
    // Explicit SIM-only profile and typed property facts; these invented fixture
    // IDs/tokens are never a production Steam profile or actual UIA evidence.
    const simProfile=Object.freeze({schema:'SIM-only-steam-provider-v2',identity:['SIM-only-process','SIM-only-provider'],properties:[[910001,'BSTR','SIM-detail-kind'],[910002,'BOOL','SIM-overlay']],mapping:[['SIM-detail-kind','library_game_detail'],['SIM-overlay',false]],exclusions:['SIM-properties','SIM-settings','SIM-overlay'],ordering:'signed-runtime-vector-lexicographic-then-property-id',variantTags:['BSTR','BOOL','I4']});
    const simProfileFingerprint=digest(JSON.stringify(simProfile));
    let gameOriginalScope:Readonly<{originalGeneration:number;expiresAt:number}>|null=null;
    const detailIdentity=()=>{
      const documentRuntimeId=[42],mainRuntimeId=[42,8],titleRuntimeId=[42,8,1];
      const mainActualAncestry=[[[41],50032],[documentRuntimeId,50030],[mainRuntimeId,50033]],titleActualAncestry=[...mainActualAncestry,[titleRuntimeId,50020]];
      const mainPhysicalRect=[100,100,700,550],titlePhysicalRect=[120,120,650,180];
      const mainSemanticFacts=['uia-main-v1',80002,'main',false,false,false,titleRuntimeId],titleSemanticFacts=['uia-primary-heading-v1','heading',1,digest(gameName.trim())];
      const observedProperties=[[mainRuntimeId,910001,'BSTR',digest(JSON.stringify(['BSTR','SIM-detail-kind']))]],exclusionProperties=[[mainRuntimeId,910002,'BOOL',digest(JSON.stringify(['BOOL',false]))]];
      const detailStateFacts=['provider-detail-state-v1',simProfileFingerprint,'library_game_detail',observedProperties,exclusionProperties];
      assert.ok(gameOriginalScope,'Original mounted safety epoch and effective binding deadline captured before detail evidence');
      // Raw unsigned64 creation FILETIME decimal: no unit conversion/Number roundtrip.
      const tuple=['steam-main-detail-v2',nativeBinding.requestDigest,nativeBinding.sessionId,nativeBinding.reservationId,nativeBinding.ownerBindingId,'hwnd:abc',77,pathHash,'116444736000000001',String(gameOriginalScope.originalGeneration),String(gameOriginalScope.expiresAt),entryIdentity(),simProfileFingerprint,documentRuntimeId,mainRuntimeId,titleRuntimeId,mainActualAncestry,titleActualAncestry,mainPhysicalRect,titlePhysicalRect,mainSemanticFacts,titleSemanticFacts,detailStateFacts];
      assert.equal(tuple.length,23);return digest(JSON.stringify(tuple));
    };
    // These provider relations are explicitly synthetic facts. The real mounted
    // producer validates their ledger consistency; installed Steam is not exercised.
    const gameSnapshot=()=>mountedAppIntent?.app!=='steam'||mountedAppIntent?.workflow!=='game_detail'?{}:gameSelected?{view:'game_detail',selectedCount:gameMode==='duplicate'?2:1,
      selectedGameFingerprint:gameMode==='wrong_entry'?digest('another synthetic entry'):entryIdentity(),
      gameTitleFingerprint:digest(gameMode==='wrong_title'?'Another game':gameName.trim()),
      ...(gameMode==='missing_detail'?{}:{gameDetailContextFingerprint:detailIdentity()}),
      gameDetailWitnessVersion:2,gameDetailProviderProfileFingerprint:simProfileFingerprint,
      ...(gameMode==='stale'?{observedAt:Date.now()-6000}:{})}:
      view==='library'?{gameEntryFingerprint:entryIdentity()}:{};
    const taskSnapshot=()=>mountedAppIntent?{source:'native_uia_state',observationId:`mounted-app-observation-${++proofSerial}`,observedAt:Date.now(),applicationId:mountedAppIntent.app,windowId:'hwnd:abc',processId:77,imagePathFingerprint:pathHash,foreground:true,playback:playing?'playing':'paused',trackFingerprint:digest(title),queryFingerprint:digest(query),view:query?'search':view||undefined,itemCount:snapshot().filter(c=>c.controlType===50007).length,volume,...gameSnapshot()}:({source:'native_uia_state',observationId:`mounted-command-observation-${++proofSerial}`,observedAt:Date.now(),applicationId:'explorer',
      windowId:'hwnd:abc',processId:77,imagePathFingerprint:pathHash,foreground:true,folderFingerprint:parentHash(wrongFolderProof?ownRoot:currentDirectory),
      ...(selectedName?{selectedNameFingerprint:digest(selectedName)}:{}),selectedCount:selectedName?(extraSelection?2:1):0});
    const namespace=()=>activeJob!.operation==='find'?'/api/computer-use/native-explorer-find':'/api/computer-use/native-explorer';
    const operationContext=()=>({...privateContext,...(quarantineIdentity?{quarantineDirectoryIdentity:quarantineIdentity}:{})});
    const nativeContext=()=>Object.fromEntries(['nonce','taskId','ownerBindingId','sessionId','reservationId','requestDigest'].map(key=>[key,nativeBinding[key]]));
    const actualSourceHash=()=>fileHash(activeJob!.sourcePath);
    const checkOperation=async()=>{
      const response=await checked(`${namespace()}/${activeJob!.operationId}/check`,operationContext());permitNonce=response.permit.permitNonce;return response;
    };
    const taskAction=async(command:string,args:Record<string,unknown>)=>{
      assert.equal(args.workflowId,heldWorkflow);assert.ok(Date.now()<heldDeadline,'Actual fixture dispatch stays inside the reserved deadline');
      const taskRoute='/api/computer-use/native-workflows/'+nativeBinding.bindingId;
      const pre=nativeBoundTarget?taskSnapshot():{source:'native_reservation',observationId:`mounted-command-reservation-${++proofSerial}`,observedAt:Date.now(),applicationId:mountedAppIntent?.app??'explorer'};
      const request=command==='computer_action'?args.request as any:undefined;
      const currentControl=request?.action==='clickMouse'?snapshot().find(control=>control.targetId===request.target?.targetId):undefined;
      const skipLabels=mountedAppIntent?.workflow==='next'?['next','sonraki']:mountedAppIntent?.workflow==='previous'?['previous','önceki']:[];
      const requestedSkip=currentControl?.controlType===50000&&skipLabels.includes(currentControl.name.trim().toLowerCase())?
        {source:'native_uia_action',canonicalActionId:request.actionId,kind:'clickMouse',targetId:currentControl.targetId,controlType:currentControl.controlType,nameFingerprint:digest(currentControl.name.trim().toLowerCase())}:undefined;
      if(requestedSkip)assert.equal(snapshot().filter(control=>control.targetId===requestedSkip.targetId).length,1,'Actual fixture dispatch resolves one current exact UIA Button target');
      const requestedGameNavigation=mountedAppIntent?.workflow==='game_detail'&&currentControl?.automationId==='game-entry'?
        {source:'native_uia_action',canonicalActionId:request.actionId,kind:'clickMouse',targetId:currentControl.targetId,controlType:currentControl.controlType,nameFingerprint:digest(currentControl.name.trim()),entryFingerprint:entryIdentity()}:undefined;
      const issued=(await checked(taskRoute+'/check',{...nativeContext(),pre,...(requestedSkip?{requestedSkip}:{}),...(requestedGameNavigation?{requestedGameNavigation}:{})})).result;
      const authorization={actionId:issued.actionId,permitNonce:issued.permitNonce};
      if(activeJob)await checkOperation();
      assert.equal(args.workflowId,heldWorkflow);assert.ok(Date.now()<heldDeadline,'Network authorization awaits cannot outlive input reservation');
      if(activeJob&&command==='computer_action'&&(args.request as any).action==='typeText'){
        assert.equal((args.request as any).text,approvedNativeText,'Typed text is refetched from private retained source immediately before each input');approvedNativeText=undefined;
      }
      const trackBefore=title;const result=await fixtureInvoke(command,args);
      if(requestedGameNavigation){
        assert.equal(request.button,'left');assert.equal(request.attempt,1);gameClicks++;
        if(gameMode==='kill')throw new Error('kill_switch_active');
        gameSelected=true;
        if(gameMode==='partial')Object.assign(result,{dispatchStatus:'failed',partialInputInjected:true});
      }
      if(requestedSkip&&skipFixtureMode==='unchanged')title=trackBefore;
      if(requestedSkip&&skipFixtureMode==='partial')Object.assign(result,{dispatchStatus:'failed',partialInputInjected:true});
      if(!nativeBoundTarget){await checked(taskRoute+'/target',{...nativeContext(),...authorization,windowId:'hwnd:abc',processId:77,imagePathFingerprint:pathHash});nativeBoundTarget=true;}
      const post=taskSnapshot();postObservationId=post.observationId;canonicalPostAt=post.observedAt;
      await checked(taskRoute+'/step',{...nativeContext(),...authorization,dispatch:result.dispatchStatus==='failed'?'failed':'dispatched',partialInput:result.partialInputInjected===true,post,
        ...(requestedSkip?{nativeActionId:skipFixtureMode==='wrong_echo'?'wrong-actual-action':request.actionId,nativeTargetId:skipFixtureMode==='wrong_target'?'wrong-current-target':currentControl!.targetId}:{}),
        ...(requestedGameNavigation?{nativeActionId:gameMode==='wrong_echo'?'wrong-game-action':request.actionId,nativeTargetId:currentControl!.targetId}:{})});
      return result;
    };
    fixtureCore.invoke=async(command:string,args:Record<string,unknown>={})=>{
      if(command==='computer_begin'){const nativeSessionId=String(await fixtureInvoke(command,args));await ensureSafety(nativeSessionId);return nativeSessionId;}
      if(command==='computer_stop'){const result=await fixtureInvoke(command,args);await retireSafety();return result;}
      if(command==='computer_task_register'){
        mountedAppIntent=args.intent;nativeBinding=null;activeJob=null;nativeBoundTarget=false;
        gameSelected=false;gameName=mountedAppIntent.workflow==='game_detail'?mountedAppIntent.gameName:'';
        const owner=(await checked('/api/computer-use/native-workflows/owner-context')).context;
        await ensureSafety(String(args.sessionId));
        const expiresAt=Math.min(Date.now()+30000,owner.ownerExpiresAt,heldDeadline);
        await checked('/api/computer-use/native-workflows/session',{source:'native_operator',ownerBindingId:owner.ownerBindingId,sessionId:args.sessionId,reservationId:args.workflowId,applicationId:mountedAppIntent.app,expiresAt});
        return {registered:true,reservationId:args.workflowId,expiresAt};
      }
      if(command==='computer_task_bind'){
        nativeBinding=(await checked('/api/computer-use/native-workflows/'+args.bindingId+'/source')).source;
        gameOriginalScope=null;
        if(mountedAppIntent?.app==='steam'&&mountedAppIntent.workflow==='game_detail'){
          assert.equal(safetyScope.nativeSessionId,nativeBinding.sessionId);assert.equal(safetyScope.ownerBindingId,nativeBinding.ownerBindingId);
          gameOriginalScope=Object.freeze({originalGeneration:safetyScope.originalGeneration,expiresAt:Math.min(nativeBinding.expiresAt,Date.parse(safetyScope.expiresAt))});
        }
        return {bindingId:nativeBinding.bindingId,taskId:nativeBinding.taskId,state:nativeBinding.state};
      }
      if(command==='computer_locate'&&args.query==='__native_steam_game_entry__'){
        assert.deepEqual(Object.keys(args).sort(),['generation','observationId','query','sessionId','workflowId']);
        assert.equal(args.workflowId,heldWorkflow);assert.equal(args.observationId,wire.observationId);assert.equal(args.generation,wire.generation);
        assert.equal(nativeBinding.request.gameNameFingerprint,digest(gameName.trim()));
        if(gameMode==='empty_resolver')throw new Error('NATIVE_STEAM_PROFILE_UNAPPROVED');
        if(gameMode==='unsupported'||gameMode==='duplicate_target')throw new Error('APP_GAME_TARGET_UNSUPPORTED');
        // Post-gate fault fixture ONLY: successful synthetic focus/resolver
        // admits pre-library semantics directly, without a frontend Library
        // click, guessed AutomationId or actual EMPTY native capture. B2 EMPTY
        // can reject earlier during focus; this bypass is never production.
        view='library';
        const entry=snapshot().find(c=>c.automationId==='game-entry')!;assert.ok(entry);
        if(gameMode==='stale_target')await observeComputer(String(args.sessionId),String(args.workflowId));
        return {targetId:entry.targetId,controlType:entry.controlType,x:entry.x,y:entry.y,width:entry.width,height:entry.height};
      }
      if(command==='computer_app_snapshot'&&mountedAppIntent?.app==='steam'&&mountedAppIntent.workflow==='game_detail')assert.fail('Marked Steam command path must not request generic controls');
      if(command==='computer_task_finish'||command==='computer_task_cancel'){
        if(command==='computer_task_finish'&&skipFixtureMode==='later_focus'&&['next','previous'].includes(mountedAppIntent?.workflow)){
          await taskAction('computer_action',{...args,request:{action:'focusApp',applicationId:mountedAppIntent.app,actionId:'later-focus-'+proofSerial,observationId:wire.observationId}});
        }
        if(command==='computer_task_finish'&&gameMode==='later_focus'&&mountedAppIntent?.workflow==='game_detail'){
          await taskAction('computer_action',{...args,request:{action:'focusApp',applicationId:'steam',actionId:'later-game-focus-'+proofSerial,observationId:wire.observationId}});
        }
        if(command==='computer_task_finish'&&canonicalFixtureMode){
          const invalid=await privateCall('/api/computer-use/native-workflows/'+args.bindingId+'/finish',{...nativeContext(),nonce:'invalid-fixture-context'});assert.equal(invalid.status,409);assert.equal(invalid.data.errorCode,'NATIVE_CONTEXT_INVALID');
          const waitMs=Math.max(0,5002-(Date.now()-canonicalPostAt));assert.ok(waitMs<=5002);await new Promise(resolve=>setTimeout(resolve,waitMs));assert.ok(Date.now()-canonicalPostAt>5000);assert.ok(Date.now()<heldDeadline,'Stale-post case keeps original workflow authority unexpired');
        }
        if(command==='computer_task_cancel'&&canonicalFixtureMode==='stale_cleanup_kill')killSwitchService.activate('Canonical cleanup fixture only','fixture');
        if(command==='computer_task_cancel'&&defaultOpenDiagnosticsActive)defaultOpenDiagnostics.cleanup();
        const finishCall=()=>checked('/api/computer-use/native-workflows/'+args.bindingId+(command==='computer_task_finish'?'/finish':'/cancel'),nativeContext());
        const response=command==='computer_task_finish'&&defaultOpenDiagnosticsActive?await defaultOpenDiagnostics.capture('finish_request',finishCall):await finishCall();
        if(command==='computer_task_finish'){if(defaultOpenDiagnosticsActive)defaultOpenDiagnostics.note('finish_response_mapping',200);return response.result;}
        const view=(await call('/api/computer-use/workflows/'+args.bindingId)).data;
        return {bindingId:view.bindingId,taskId:view.taskId,state:view.state};
      }
      if(mountedAppIntent&&nativeBinding&&['computer_app_open','computer_action','computer_app_volume'].includes(command))return taskAction(command,args);
      if(command==='computer_explorer_claim'){
        let operation:'copy'|'move'|'undo'|'find'='copy';let route='/api/computer-use/native-explorer';
        let poll=await checked(route+'/next');
        if(!poll.job){route='/api/computer-use/native-explorer-find';operation='find';poll=await checked(route+'/next');}
        if(!poll.job)return null;
        mountedAppIntent=null;
        const nonce=poll.job.claimNonce,id=poll.job.operationId;
        privateSource=(await checked(`${route}/${id}/source`,undefined,{...privateHeaders,[operation==='find'?'x-edith-find-claim':'x-edith-explorer-claim']:nonce})).source;
        operation=operation==='find'?'find':privateSource.operation;
        const keys=operation==='find'?['claimNonce','nonce','ownerBindingId','sourceFileId','rootIdentity','parentIdentity','sourceIdentity','contentSha256']:
          ['claimNonce','operationNonce','ownerBindingId','actionId','operation','rootIdentity','sourceIdentity','contentSha256','sourceDirectoryIdentity','destinationDirectoryIdentity'];
        privateContext=Object.fromEntries(keys.map(key=>[key,key==='claimNonce'?nonce:privateSource[key]]));
        // Explorer owner authority comes from authenticated source, not the Node owner getter.
        const explorerSafety=await ensureSafety(String(args.sessionId));assert.equal(explorerSafety.ownerBindingId,privateSource.ownerBindingId);
        await checked('/api/computer-use/native-workflows/session',{source:'native_operator',ownerBindingId:privateSource.ownerBindingId,
          sessionId:args.sessionId,reservationId:args.workflowId,applicationId:'explorer',expiresAt:Math.min(Date.now()+30000,privateSource.expiresAt,heldDeadline)});
        nativeBinding=(await checked('/api/computer-use/native-workflows/associate',{operationId:id,ownerBindingId:privateSource.ownerBindingId,sessionId:args.sessionId,reservationId:args.workflowId})).source;
        permitNonce=undefined;quarantineIdentity=undefined;retainedReadback=null;nativeBoundTarget=false;postObservationId='';
        activeJob={operationId:id,operation,sourcePath:privateSource.sourcePath,destinationPath:operation==='find'?privateSource.sourcePath:privateSource.destinationPath,
          expiresAt:privateSource.expiresAt,quarantine:privateSource.quarantine};
        app='explorer';currentDirectory=ownRoot;selectedName='';clipboard=null;editing='address';pendingValue='';
        assert.equal(actualSourceHash(),privateSource.contentSha256);
        if(mutateOnClaim){fs.writeFileSync(activeJob.sourcePath,'Changed own fixture after authenticated claim');mutateOnClaim=false;}
        return {operationId:id,operation,...(privateSource.reverseOf?{reverseOf:privateSource.reverseOf}:{}),sourceName:path.basename(activeJob.sourcePath),
          sourceParentFingerprint:parentHash(path.dirname(activeJob.sourcePath)),...(operation!=='find'?{destinationParentFingerprint:parentHash(path.dirname(activeJob.destinationPath))}:{}),
          expiresAt:privateSource.expiresAt,quarantine:Boolean(privateSource.quarantine),taskId:nativeBinding.taskId,bindingId:nativeBinding.bindingId,taskState:'RUNNING'};
      }
      if(command==='computer_explorer_text'){
        assert.ok(activeJob);assert.equal(args.operationId,activeJob.operationId);
        switch(args.intent){
          case 'source_parent':return approvedNativeText=path.dirname(activeJob.sourcePath);
          case 'destination_parent':assert.notEqual(activeJob.operation,'find');return approvedNativeText=path.dirname(activeJob.destinationPath);
          case 'source_name':return approvedNativeText=path.basename(activeJob.sourcePath);
          case 'quarantine_parent':assert.ok(activeJob.quarantine);return approvedNativeText=path.dirname(activeJob.quarantine.directoryPath);
          case 'quarantine_name':assert.ok(activeJob.quarantine);return approvedNativeText=activeJob.quarantine.directoryName;
          default:throw new Error('EXPLORER_APPROVED_TEXT_INVALID');
        }
      }
      if(activeJob&&command==='computer_app_open')return taskAction(command,args);
      if(activeJob&&command==='computer_action'){assert.equal(args.explorerOperationId,activeJob.operationId);return taskAction(command,args);}
      if(command==='computer_explorer_exchange'){
        assert.ok(activeJob);assert.equal(args.operationId,activeJob.operationId);
        const route=`${namespace()}/${activeJob.operationId}`;
        if(args.action==='check')return checkOperation();
        if(args.action==='quarantine'){
          const response=await checked(route+'/quarantine',{...operationContext(),permitNonce});quarantineIdentity=response.quarantine.identity;permitNonce=undefined;return response;
        }
        if(args.action==='readback'){
          if(tamperReadback){fs.writeFileSync(activeJob.destinationPath,'Own fixture tamper before independent mounted readback');tamperReadback=false;}
          retainedReadback=await checked(route+'/readback',{...operationContext(),permitNonce});return retainedReadback;
        }
        if(args.action==='finish'){
          const response=activeJob.operation==='find'?await checked(route+'/finish',{...operationContext(),permitNonce,postObservationId}):
            await checked(route+'/finish',{...operationContext(),permitNonce,source:'native_explorer',postcondition:'gui_action_observed',destinationIdentity:retainedReadback!.readback.destination.identity});
          if(activeJob.operation!=='find')await checked('/api/computer-use/native-workflows/'+nativeBinding.bindingId+'/finish',nativeContext());
          activeJob=null;return response;
        }
        if(args.action==='cancel'){const result=await privateCall(route+'/cancel',operationContext());activeJob=null;return result.data;}
        throw new Error('EXPLORER_ACTION_INVALID');
      }
      return fixtureInvoke(command,args);
    };
    // All default-client HTTP requests now reach real mounted routers. This wrapper
    // only supplies browser-equivalent origin/cookie transport, never response bodies.
    Object.defineProperty(window.location,'origin',{value:origin,configurable:true});
    clearOwnerSessionMemory();
    globalThis.fetch=async(input,init:RequestInit={})=>{
      const url=new URL(input instanceof Request?input.url:String(input),origin);
      assert.equal(url.origin,origin,'No fixture request may leave mounted loopback origin');
      const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('cookie',cookie);
      const readbackStage=defaultOpenDiagnosticsActive?(/^\/api\/computer-use\/workflows\/[^/]+$/.test(url.pathname)?'completion_binding_readback':/^\/api\/edith\/tasks\/[^/]+\/activity$/.test(url.pathname)?'completion_activity_readback':undefined):undefined;
      if(readbackStage)defaultOpenDiagnostics.note(readbackStage);
      let responsePromise:Promise<Response>;
      try{responsePromise=previousFetch(url,{...init,headers});}catch(error){if(readbackStage)defaultOpenDiagnostics.failure(readbackStage,error);throw error;}
      let drive:Promise<void>|undefined,driveError:unknown;
      if(/^\/api\/files\/explorer\/(?:find-plans|plans)\/[^/]+\/execute$/.test(url.pathname))drive=(async()=>{
        // Wait only for the real queue to become visible, then drive the exact
        // production default heartbeat/client; no backend response is fabricated.
        for(let attempt=0;attempt<80;attempt++){
          await new Promise(resolve=>setTimeout(resolve,5));
          const result=await consumePendingComputerExplorer(id);
          if(result){mountedGuiResults.push(result);return;}
        }
        throw new Error('MOUNTED_DEFAULT_CONSUMER_QUEUE_MISSING');
      })().catch(error=>{driveError=error;});
      let response:Response;
      try{response=await responsePromise;}catch(error){if(readbackStage)defaultOpenDiagnostics.failure(readbackStage,error);throw error;}
      if(readbackStage){defaultOpenDiagnostics.note(readbackStage,response.status);if(!response.ok){let code:unknown;try{code=(await response.clone().json())?.errorCode;}catch{/* Diagnostic clone cannot replace the original response/error. */}defaultOpenDiagnostics.failure(readbackStage,undefined,response.status,code);}}
      if(drive&&!response.ok)publicFailure=JSON.stringify(await response.clone().json());
      if(drive)await drive;if(driveError)throw driveError;return response;
    };
    let id=await prepare();
    defaultOpenDiagnosticsActive=true;
    const defaultOpen=await runComputerAppWorkflow(id,{app:'spotify',workflow:'open'},{workflowId:'mounted-open-legacy',idempotencyKey:'mounted-open-legacy'});
    defaultOpenDiagnosticsActive=false;
    const defaultOpenFailureMessage=()=>JSON.stringify({status:defaultOpen.status,taskState:defaultOpen.taskState,errorCode:defaultOpenDiagnostics.canonical(defaultOpen.errorCode),diagnostics:defaultOpenDiagnostics.snapshot(defaultOpen.errorCode)});
    assert.equal(defaultOpen.physicalAcceptance,false,defaultOpenFailureMessage());
    // Native authority comes from the actual private loopback owner-context route.
    assert.equal(defaultOpen.taskBinding,'registered',defaultOpenFailureMessage());assert.equal(defaultOpen.status,'verified',defaultOpenFailureMessage());assert.equal(defaultOpen.taskState,'COMPLETED',defaultOpenFailureMessage());
    checks.push('actual default client app open/register/bind/finish/report reaches real mounted owner/CSRF/private-owner-context routers and independent COMPLETED activity readback');
    if(canonicalCasesOnly){
    for(const mode of ['stale','stale_cleanup_kill'] as const){
      canonicalFixtureMode=mode;
      try{
        const failure=await runComputerAppWorkflow(id,{app:'spotify',workflow:'open'},{workflowId:'canonical-mounted-'+mode,idempotencyKey:'canonical-mounted-'+mode}),actual=taskService.getTask(failure.taskId!)!;
        assert.equal(failure.status,'partial');assert.equal(failure.errorCode,'NATIVE_POSTSTATE_STALE');assert.equal(actual.status,'CANCELLED');assert.notEqual(actual.verification?.status,'PASS');
        assert.equal(cancellationReason(actual.id),mode==='stale'?'NATIVE_POSTSTATE_STALE':'KILL_SWITCH_ACTIVE');
        if(mode==='stale')assert.equal(failure.taskState,'CANCELLED');
      }finally{canonicalFixtureMode='';if(killSwitchService.status().active)killSwitchService.deactivate('fixture');}
      id=await prepare();
    }
    checks.push('real mounted stale-post finish retains canonical code and cleanup reason; invalid original context cannot poison; later actual kill cleanup preserves first consumer cause and safety journal reason with no PASS');
    console.log(JSON.stringify({canonicalFocused:true,checks,physicalAcceptance:false,rustTransport:'PROPOSED_CANONICAL_ADAPTER_ONLY'}));return;
    }
    const signing=generateKeyPairSync('ed25519'),agreement=generateKeyPairSync('x25519');
    const offer=runtime.pairing.request({device:{deviceId:'mounted-app-workflow-fixture',displayName:'Mounted Fixture',platform:'android',capabilities:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,realtime:true,fileTransfer:false,notifications:false,camera:false,microphone:false,computerControl:false,browserControl:false}},signingPublicKeyJwk:signing.publicKey.export({format:'jwk'}) as JsonWebKey,agreementPublicKeyJwk:agreement.publicKey.export({format:'jwk'}) as JsonWebKey,requestedCommands:['task.list','task.detail','task.activity']});
    const signProof=(value:string)=>sign(null,Buffer.from(value),signing.privateKey).toString('base64url');
    runtime.pairing.submitProof(offer.pairing.pairingId,signProof(offer.proofPayload));runtime.pairing.approve(offer.pairing.pairingId,offer.code,undefined,{bindingId:fixtureOwner.bindingId,expiresAt:new Date(fixtureOwner.expiresAt).toISOString()});
    const credential=runtime.pairing.consume(offer.pairing.pairingId,signProof(offer.proofPayload+'\nconsume')).credential;
    for(const request of [{app:'spotify',workflow:'play'},{app:'spotify',workflow:'pause'},{app:'spotify',workflow:'next'},{app:'spotify',workflow:'previous'},{app:'spotify',workflow:'search',query:'Mounted local query'},
      {app:'spotify',workflow:'library'},{app:'spotify',workflow:'volume',volume:44},{app:'steam',workflow:'library'},{app:'steam',workflow:'downloads'},
      {app:'steam',workflow:'open'},{app:'steam',workflow:'focus'},{app:'steam',workflow:'search',query:'Mounted Steam needle'}] as const){
      query='';view='';if(request.workflow==='next')title='Track A';if(request.workflow==='previous')title='Track B';app='explorer';
      const result=await runComputerAppWorkflow(id,request);
      assert.equal(result.status,'verified',JSON.stringify({result,lastPrivateFailure}));assert.equal(result.taskBinding,'registered');assert.equal(result.taskState,'COMPLETED');
      recordCanonicalTask(result.taskId!);
      const actual=taskService.getTask(result.taskId!)!;assert.equal(actual.verification!.status,'PASS');
      assert.ok(actual.verification!.checks.filter(check=>check.required).every(check=>check.status==='PASS'));
    }
    checks.push('default mounted Spotify play/pause/search/library/volume and Steam open/focus/search/library/downloads obtain real persisted separate canonical required PASS tasks in one persistent session; native controls remain explicit synthetic fixtures');
    checks.push('cold/background default mounted Next/Previous requires actual synthetic exact UIA Button dispatch, genuine private issued marked action/target echoes and its immediate changed-track pre/post pair');
    for(const mode of ['unchanged','wrong_echo','wrong_target','partial','later_focus'] as const){
      skipFixtureMode=mode;title='Track A';app='explorer';const failed=await runComputerAppWorkflow(id,{app:'spotify',workflow:'next'});skipFixtureMode='';
      assert.notEqual(failed.status,'verified',mode);assert.ok(failed.taskId,mode);assert.notEqual(taskService.getTask(failed.taskId!)!.verification?.status,'PASS',mode);
    }
    checks.push('default mounted skip unchanged post, wrong actual action echo, partial dispatch and later unmarked focus each reject canonical required PASS and never replay');
    query='';view='';app='explorer';gameMode='empty_resolver';
    const emptyClicks=gameClicks,emptyIdentity={workflowId:'mounted-game-empty-resolver',idempotencyKey:'mounted-game-empty-resolver'};
    const emptyGame=await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:'Fixture Game'},emptyIdentity);
    assert.equal(emptyGame.errorCode,'NATIVE_STEAM_PROFILE_UNAPPROVED');assert.notEqual(emptyGame.status,'verified');assert.equal(gameClicks,emptyClicks,'EMPTY native resolver fixture refuses before every game click');
    const emptyTask=taskService.getTask(emptyGame.taskId!)!;assert.equal(emptyTask.status,'CANCELLED');assert.notEqual(emptyTask.verification?.status,'PASS');
    assert.equal(projectTaskEventsV2(emptyTask).events.some(event=>event.type==='task.completed'),false);
    assert.equal(await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:'Fixture Game'},emptyIdentity),emptyGame);assert.equal(gameClicks,emptyClicks,'EMPTY refusal is not replayed');
    checks.push('mounted actual backend with adapter-only EMPTY resolver refusal: no game click, canonical CANCELLED without PASS/completed, no replay; synthetic focus success is not actual native EMPTY capture acceptance');
    query='';view='';app='explorer';gameMode='';
    const gameIdentity={workflowId:'mounted-game-positive',idempotencyKey:'mounted-game-positive'};
    const game=await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:' Fixture Game '},gameIdentity);
    // Backend post-gate fault boundary only: the resolver/focus are synthetic;
    // this unapproved SIM witness never enters the actual EMPTY native gate.
    assert.equal(game.status,'partial',JSON.stringify({game,lastPrivateFailure}));assert.equal(game.physicalAcceptance,false);
    assert.ok(lastPrivateFailure.includes('NATIVE_STEAM_PROFILE_UNAPPROVED'));assert.equal(game.errorCode,'NATIVE_STEAM_PROFILE_UNAPPROVED');
    const deniedGameTask=taskService.getTask(game.taskId!)!;assert.equal(deniedGameTask.status,'CANCELLED');assert.notEqual(deniedGameTask.verification?.status,'PASS');
    const deniedGameEvents=projectTaskEventsV2(deniedGameTask);assert.equal(deniedGameEvents.diagnostics.quarantinedEventCount,0);assert.equal(deniedGameEvents.events.some(event=>event.type==='task.completed'),false);
    const deniedMobile=async(route:string,purpose:string)=>{const result=await call(route,undefined,{authorization:'Device '+credential.token});assert.equal(result.status,200);return runtime.crypto.decrypt<any>(credential.sessionId,result.data.envelope,purpose,'server_to_client','http');};
    const deniedDetail=await deniedMobile('/api/mobile/tasks/'+game.taskId,'task.detail.result'),deniedActivity=await deniedMobile('/api/mobile/tasks/'+game.taskId+'/activity','task.activity.result'),deniedList=await deniedMobile('/api/mobile/tasks?limit=100','task.list.result');
    assert.equal(deniedDetail.task.status,'CANCELLED');assert.notEqual(deniedDetail.task.verification?.status,'PASS');assert.equal(deniedList.tasks.find((task:any)=>task.id===game.taskId).status,'CANCELLED');assert.deepEqual(deniedActivity.events,deniedGameEvents.events);
    let clicksBefore=gameClicks;assert.equal(await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:' Fixture Game '},gameIdentity),game);assert.equal(gameClicks,clicksBefore);
    assert.equal(gameClicks,1,'The unapproved SIM profile cannot cause a second game click');assert.equal(JSON.stringify(taskService.getTask(game.taskId!)),JSON.stringify(deniedGameTask),'Cached failure replay cannot mutate canonical task');
    checks.push('backend post-gate fault fixture single SIM marked click reaches actual EMPTY backend registry denial NATIVE_STEAM_PROFILE_UNAPPROVED; synthetic approved native pre-library bypass is not actual native EMPTY capture; canonical task and encrypted mobile detail/list/activity remain CANCELLED without PASS/completed event; cached replay performs no further click or task mutation; canonical23tuple is not profile approval');
    for(const mode of ['unsupported','duplicate_target','stale_target','wrong_entry','wrong_title','missing_detail','duplicate','stale','partial','kill','wrong_echo','later_focus']){
      query='';view='';app='explorer';gameMode=mode;const identity={workflowId:'mounted-game-'+mode,idempotencyKey:'mounted-game-'+mode};clicksBefore=gameClicks;
      const rejected=await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:'Fixture Game'},identity);
      assert.notEqual(rejected.status,'verified',JSON.stringify({mode,rejected}));assert.ok(rejected.taskId);assert.notEqual(taskService.getTask(rejected.taskId!)!.verification?.status,'PASS',mode);
      const after=gameClicks;await runComputerAppWorkflow(id,{app:'steam',workflow:'game_detail',gameName:'Fixture Game'},identity);assert.equal(gameClicks,after,'Failed navigation never replayed: '+mode);
      assert.equal(gameClicks-clicksBefore,['unsupported','duplicate_target','stale_target'].includes(mode)?0:1,'Bounded single click '+mode);
    }
    gameMode='';gameName='';gameSelected=false;
    checks.push('mounted game_detail keeps target/shape/dispatch/kill/replay negatives; wrong retained entry/title and later-focus cases stop earlier at EMPTY membership, not downstream admitted-profile postconditions; every failure has no canonical PASS and no replay');
    const sessionId='mounted-fixture-native-session',reservationId='mounted-fixture-reservation';
    await ensureSafety(sessionId);
    assert.equal((await call('/api/computer-use/native-workflows/session',{source:'native_operator',ownerBindingId:fixtureOwner.bindingId,
      sessionId,reservationId,applicationId:'spotify',expiresAt:Date.now()+60000},privateHeaders)).status,200);
    const body={sessionId,workflowId:reservationId,request:{app:'spotify',workflow:'open'}};
    const create=await call('/api/computer-use/workflows',body,{...publicHeaders,'x-idempotency-key':'mounted-cold-create'});
    assert.equal(create.status,200);assert.equal(create.data.taskBinding,'registered');
    const {taskId,bindingId}=create.data;assert.equal(taskService.getTask(taskId)!.status,'QUEUED');
    const duplicate=await call('/api/computer-use/workflows',body,{...publicHeaders,'x-idempotency-key':'mounted-cold-create'});
    assert.equal(duplicate.data.taskId,taskId);
    assert.equal((await call('/api/computer-use/workflows',{...body,request:{app:'spotify',workflow:'play'}},{...publicHeaders,'x-idempotency-key':'mounted-cold-create'})).status,409);
    for(const route of ['check','step','finish'])assert.equal((await call(`/api/computer-use/native-workflows/${bindingId}/${route}`,{taskId,status:'PASS'})).status,401,'Owner public context cannot submit native proof');
    assert.equal((await call(`/api/edith/tasks/${taskId}/complete`,{status:'COMPLETED',verification:{status:'PASS'}})).status,409);
    assert.notEqual(taskService.getTask(taskId)!.verification?.status,'PASS');
    const source=(await call(`/api/computer-use/native-workflows/${bindingId}/source`,undefined,privateHeaders)).data.source;
    const context=Object.fromEntries(['nonce','taskId','ownerBindingId','sessionId','reservationId','requestDigest'].map(key=>[key,source[key]]));
    const permit=await call(`/api/computer-use/native-workflows/${bindingId}/check`,{...context,pre:{source:'native_reservation',observationId:'mounted-cold-reserved',observedAt:Date.now(),applicationId:'spotify'}},privateHeaders);
    assert.equal(permit.status,200);assert.notEqual(taskService.getTask(taskId)!.status,'COMPLETED');
    const target={windowId:'mounted-fixture-window',processId:7001,imagePathFingerprint:digest('mounted-fixture-image')};
    assert.equal((await call(`/api/computer-use/native-workflows/${bindingId}/target`,{...context,...permit.data.result,...target},privateHeaders)).status,400,'Strict target body rejects response-only expiresAt');
    const issued={actionId:permit.data.result.actionId,permitNonce:permit.data.result.permitNonce};
    assert.equal((await call(`/api/computer-use/native-workflows/${bindingId}/target`,{...context,...issued,...target},privateHeaders)).status,200);
    assert.equal((await call(`/api/computer-use/native-workflows/${bindingId}/step`,{...context,...issued,dispatch:'dispatched',partialInput:false,
      post:{source:'native_uia_state',observationId:'mounted-cold-observed',observedAt:Date.now(),applicationId:'spotify',...target,foreground:true}},privateHeaders)).status,200);
    assert.equal((await call(`/api/computer-use/native-workflows/${bindingId}/finish`,context,privateHeaders)).status,200);
    const task=taskService.getTask(taskId)!;assert.equal(task.status,'COMPLETED');assert.equal(task.verification!.status,'PASS');
    assert.ok(task.verification!.checks.every(check=>check.required&&check.status==='PASS'));
    const projection=projectTaskEventsV2(task);assert.equal(projection.diagnostics.quarantinedEventCount,0);
    projection.events.forEach((event,index)=>{assert.equal(parseTaskEventV2(event).success,true);assert.equal(event.taskId,taskId);assert.equal(event.sequence,index+1);});
    checks.push('real persisted canonical queued->running->completed task and required PASS only after explicitly synthetic private issued cold reservation/target/poststate proof; public forged proof rejected');
    const activity=await call(`/api/mobile/tasks/${taskId}/activity`,undefined,{authorization:'Device '+credential.token});assert.equal(activity.status,200);
    assert.deepEqual(runtime.crypto.decrypt<any>(credential.sessionId,activity.data.envelope,'task.activity.result','server_to_client','http').events,projection.events);
    const journal=JSON.parse(fs.readFileSync(path.join(path.dirname(runtime.store.filePath),'mobile-realtime.json'),'utf8'));
    const persisted=journal.histories.flatMap((entry:any)=>entry[1]).filter((event:any)=>event.event==='task.event.v2'&&event.payload.taskId===taskId);
    assert.deepEqual(persisted.map((entry:any)=>entry.payload),projection.events);
    checks.push('real default mobile pairing, encrypted mounted activity and persisted realtime events use identical canonical task IDs and sequences');
    let sequence=0;
    const createCold=async(request:Record<string,unknown>)=>{
      const reservation='mounted-sequential-'+ ++sequence;
      await ensureSafety(sessionId);
      assert.equal((await call('/api/computer-use/native-workflows/session',{source:'native_operator',ownerBindingId:fixtureOwner.bindingId,
        sessionId,reservationId:reservation,applicationId:request.app,expiresAt:Date.now()+60000},privateHeaders)).status,200,'Persistent native session may obtain a distinct reservation after the prior terminal task');
      const created=await call('/api/computer-use/workflows',{sessionId,workflowId:reservation,request},{...publicHeaders,'x-idempotency-key':reservation});assert.equal(created.status,200);
      const src=(await call(`/api/computer-use/native-workflows/${created.data.bindingId}/source`,undefined,privateHeaders)).data.source;
      const ctx=Object.fromEntries(['nonce','taskId','ownerBindingId','sessionId','reservationId','requestDigest'].map(key=>[key,src[key]]));
      return {...created.data,context:ctx};
    };
    const cold=await createCold({app:'spotify',workflow:'play'});
    assert.equal((await call('/api/computer-use/native-workflows/session',{source:'native_operator',ownerBindingId:fixtureOwner.bindingId,
      sessionId,reservationId:'concurrent-reservation',applicationId:'spotify',expiresAt:Date.now()+60000},privateHeaders)).status,409);
    const coldPermit=await call(`/api/computer-use/native-workflows/${cold.bindingId}/check`,{...cold.context,pre:{source:'native_reservation',observationId:'mounted-play-reservation',observedAt:Date.now(),applicationId:'spotify'}},privateHeaders);
    const coldIssued={actionId:coldPermit.data.result.actionId,permitNonce:coldPermit.data.result.permitNonce};
    assert.equal((await call(`/api/computer-use/native-workflows/${cold.bindingId}/target`,{...cold.context,...coldIssued,...target},privateHeaders)).status,200);
    const state=(observationId:string,playback:'playing'|'paused')=>({source:'native_uia_state',observationId,observedAt:Date.now(),applicationId:'spotify',...target,foreground:true,playback});
    assert.equal((await call(`/api/computer-use/native-workflows/${cold.bindingId}/step`,{...cold.context,...coldIssued,dispatch:'dispatched',partialInput:false,post:state('mounted-open-only','paused')},privateHeaders)).status,200);
    assert.equal((await call(`/api/computer-use/native-workflows/${cold.bindingId}/finish`,cold.context,privateHeaders)).status,409,'Cold opening cannot substitute for requested playback');
    const playPermit=await call(`/api/computer-use/native-workflows/${cold.bindingId}/check`,{...cold.context,pre:state('mounted-pre-play','paused')},privateHeaders);
    const playIssued={actionId:playPermit.data.result.actionId,permitNonce:playPermit.data.result.permitNonce};
    assert.equal((await call(`/api/computer-use/native-workflows/${cold.bindingId}/step`,{...cold.context,...playIssued,dispatch:'dispatched',partialInput:false,post:state('mounted-post-play','playing')},privateHeaders)).status,200);
    assert.equal((await call(`/api/computer-use/native-workflows/${cold.bindingId}/finish`,cold.context,privateHeaders)).status,200);
    checks.push('cold requested play requires actual fixture post-play predicate; opening alone cannot PASS; same persistent session sequential reservation succeeds and concurrent reservation conflicts');
    // No requested-skip descriptor is supplied: focus/open/natural track changes
    // must never impersonate the actual issued Next/Previous control dispatch.
    const naturalSkip=await createCold({app:'spotify',workflow:'next'});
    const naturalRoute='/api/computer-use/native-workflows/'+naturalSkip.bindingId;
    const naturalFirst=(await call(naturalRoute+'/check',{...naturalSkip.context,pre:{source:'native_reservation',observationId:'natural-skip-cold',observedAt:Date.now(),applicationId:'spotify'}},privateHeaders)).data.result;
    const naturalIssued={actionId:naturalFirst.actionId,permitNonce:naturalFirst.permitNonce};
    assert.equal((await call(naturalRoute+'/target',{...naturalSkip.context,...naturalIssued,...target},privateHeaders)).status,200);
    const naturalState=(observationId:string,track:string)=>({...state(observationId,'playing'),trackFingerprint:digest(track)});
    assert.equal((await call(naturalRoute+'/step',{...naturalSkip.context,...naturalIssued,dispatch:'dispatched',partialInput:false,post:naturalState('natural-open-post','Track A')},privateHeaders)).status,200);
    const naturalChanged=(await call(naturalRoute+'/check',{...naturalSkip.context,pre:naturalState('natural-change-pre','Track A')},privateHeaders)).data.result;
    assert.equal((await call(naturalRoute+'/step',{...naturalSkip.context,actionId:naturalChanged.actionId,permitNonce:naturalChanged.permitNonce,dispatch:'dispatched',partialInput:false,post:naturalState('natural-change-post','Track B')},privateHeaders)).status,200);
    assert.equal((await call(naturalRoute+'/finish',naturalSkip.context,privateHeaders)).status,409,'Natural change after focus without actual requested skip dispatch cannot PASS');
    assert.notEqual(taskService.getTask(naturalSkip.taskId)!.verification?.status,'PASS');
    assert.equal((await call('/api/edith/tasks/'+naturalSkip.taskId+'/cancel',{})).status,200);
    checks.push('cold open/focus followed by an unmarked natural track change cannot satisfy requested Next; accepted exact marked skip proof is independently required');
    const cancelled=await createCold({app:'spotify',workflow:'open'});
    assert.equal((await call(`/api/edith/tasks/${cancelled.taskId}/cancel`,{})).status,200);
    assert.ok((await call(`/api/computer-use/native-workflows/${cancelled.bindingId}/check`,{...cancelled.context,pre:{source:'native_reservation',observationId:'mounted-late-cancel',observedAt:Date.now(),applicationId:'spotify'}},privateHeaders)).status>=400);
    assert.notEqual(taskService.getTask(cancelled.taskId)!.verification?.status,'PASS');
    const paused=await createCold({app:'spotify',workflow:'open'});
    assert.equal((await call(`/api/edith/tasks/${paused.taskId}/pause`,{})).status,200);
    assert.equal(taskService.getTask(paused.taskId)!.status,'BLOCKED');
    const partialTask=await createCold({app:'spotify',workflow:'open'});
    const partialPermit=await call(`/api/computer-use/native-workflows/${partialTask.bindingId}/check`,{...partialTask.context,pre:{source:'native_reservation',observationId:'mounted-partial-pre',observedAt:Date.now(),applicationId:'spotify'}},privateHeaders);
    const partialIssued={actionId:partialPermit.data.result.actionId,permitNonce:partialPermit.data.result.permitNonce};
    assert.equal((await call(`/api/computer-use/native-workflows/${partialTask.bindingId}/target`,{...partialTask.context,...partialIssued,...target},privateHeaders)).status,200);
    assert.equal((await call(`/api/computer-use/native-workflows/${partialTask.bindingId}/step`,{...partialTask.context,...partialIssued,dispatch:'failed',partialInput:true,post:state('mounted-partial-post','paused')},privateHeaders)).status,409);
    assert.equal(taskService.getTask(partialTask.taskId)!.status,'BLOCKED');
    assert.equal((await call(`/api/computer-use/native-workflows/${partialTask.bindingId}/finish`,partialTask.context,privateHeaders)).status,409);
    const killed=await createCold({app:'spotify',workflow:'open'});
    const killedPrior=await call(`/api/computer-use/native-workflows/${killed.bindingId}/finish`,killed.context,privateHeaders);assert.equal(killedPrior.data.errorCode,'NATIVE_LEDGER_INCOMPLETE');
    killSwitchService.activate('Mounted test fixture only','fixture');
    assert.equal(taskService.getTask(killed.taskId)!.status,'CANCELLED');assert.equal(cancellationReason(killed.taskId),'KILL_SWITCH_ACTIVE');assert.notEqual(taskService.getTask(killed.taskId)!.verification?.status,'PASS');
    assert.ok((await call(`/api/computer-use/native-workflows/${killed.bindingId}/finish`,killed.context,privateHeaders)).status>=400);
    killSwitchService.deactivate('fixture');
    checks.push('actual mounted task cancel/pause, partial native fixture receipt and kill switch revoke canonical completion and late proof');
    const safeFile=files.search('owned.txt').files[0];assert.ok(safeFile);
    const findPlan=await call('/api/files/explorer/find-plans',{sourceFileId:safeFile.id},{...publicHeaders,'x-idempotency-key':'mounted-find-plan'});
    assert.equal(findPlan.status,200);assert.equal(taskService.getTask(findPlan.data.taskId)!.status,'QUEUED');
    assert.equal(JSON.stringify(findPlan.data).includes(ownRoot),false,'Public mounted find descriptor is opaque');
    assert.equal((await call('/api/files/explorer/find-plans',{sourcePath:path.join(ownRoot,'source','owned.txt')},{...publicHeaders,'x-idempotency-key':'mounted-find-path-forgery'})).status,400);
    const findResult=await runComputerAppWorkflow(id,{app:'explorer',workflow:'find',sourceFileId:safeFile.id},{workflowId:'mounted-find-plan',idempotencyKey:'mounted-find-plan'});
    assert.equal(findResult.status,'verified',JSON.stringify(findResult));assert.equal(findResult.taskBinding,'registered');
    assert.equal(findResult.taskId,findPlan.data.taskId);assert.equal(findResult.bindingId,findPlan.data.bindingId);assert.equal(findResult.taskState,'COMPLETED');
    recordCanonicalTask(findResult.taskId!);
    assert.equal(taskService.getTask(findResult.taskId!)!.verification!.status,'PASS');
    assert.equal(fileHash(path.join(ownRoot,'source','owned.txt')),digest('Mounted producer own bytes İstanbul'),'Find preserves exact source bytes');
    const dirs=files.searchDirectories().directories,destinationId=dirs.find(directory=>directory.relativePath==='destination')!.id;
    const executeTransfer=async(operation:'copy'|'move'|'undo',sourceFileId?:string,undoReceiptId?:string)=>{
      const request=operation==='undo'?{app:'explorer' as const,workflow:'undo' as const,undoReceiptId:undoReceiptId!}:
        {app:'explorer' as const,workflow:operation,sourceFileId:sourceFileId!,destinationDirectoryId:destinationId};
      const result=await runComputerAppWorkflow(id,request);assert.equal(result.status,'verified',JSON.stringify({result,lastPrivateFailure,publicFailure,mountedGuiError:(mountedGuiResults.at(-1) as any)?.errorCode}));
      assert.equal(result.taskBinding,'registered');assert.equal(result.taskState,'COMPLETED');
      recordCanonicalTask(result.taskId!);
      const task=taskService.getTask(result.taskId!)!;assert.equal(task.verification!.status,'PASS');
      assert.ok(task.verification!.checks.every(check=>check.required&&check.status==='PASS'));return result;
    };
    const sourcePath=path.join(ownRoot,'source','owned.txt'),destinationPath=path.join(ownRoot,'destination','owned.txt'),sourceDigest=fileHash(sourcePath);
    const copied=await executeTransfer('copy',safeFile.id);assert.equal(fileHash(destinationPath),sourceDigest);assert.equal(fileHash(sourcePath),sourceDigest);
    const copyUndo=await executeTransfer('undo',undefined,copied.effectReceipt!.undoReceiptId);assert.equal(fs.existsSync(destinationPath),false);
    assert.equal(fileHash(sourcePath),sourceDigest);assert.ok(privateSource.quarantine);
    assert.equal(fileHash(privateSource.destinationPath),sourceDigest,'Undo copy retains generated bytes in server-approved own quarantine');
    assert.notEqual(copyUndo.taskId,copied.taskId);
    const refreshedSource=files.search('owned.txt').files.find(file=>file.relativePath==='source/owned.txt')!.id;
    const reusedBefore=fileIdentityParts(sourcePath);
    const reusedMove=await runComputerAppWorkflow(id,{app:'explorer',workflow:'move',sourceFileId:refreshedSource,destinationDirectoryId:destinationId});
    const reusedAfter=fileIdentityParts(destinationPath);
    console.log(JSON.stringify({fixture:'owned_fs_real_rename',before:reusedBefore,after:reusedAfter,operationStatus:reusedMove.status,
      taskId:reusedMove.taskId,taskState:taskService.getTask(reusedMove.taskId!)!.status,physicalAcceptance:false}));
    assert.equal(reusedAfter.dev,reusedBefore.dev);assert.equal(reusedAfter.ino,reusedBefore.ino);assert.equal(reusedAfter.sha256,reusedBefore.sha256);
    assert.equal(reusedMove.status,'verified');assert.equal(reusedMove.taskBinding,'registered');assert.ok(reusedMove.taskId&&reusedMove.bindingId);
    const reusedTask=taskService.getTask(reusedMove.taskId)!;assert.equal(reusedTask.id,reusedMove.taskId);assert.equal(reusedTask.status,'COMPLETED');
    assert.equal(reusedTask.verification?.taskId,reusedMove.taskId);assert.equal(reusedTask.verification?.status,'PASS');
    const reusedRequired=reusedTask.verification!.checks.filter(check=>check.required);assert.ok(reusedRequired.length>0);assert.ok(reusedRequired.every(check=>check.status==='PASS'));
    const reusedBinding=await call(`/api/computer-use/workflows/${reusedMove.bindingId}`);assert.equal(reusedBinding.status,200);
    assert.equal(reusedBinding.data.taskId,reusedMove.taskId);assert.equal(reusedBinding.data.bindingId,reusedMove.bindingId);assert.equal(reusedBinding.data.state,'COMPLETED');
    // The defining identity tests prove precise BigInt/held-FD identity; these
    // rounded diagnostics alone cannot attest the supported same-object move.
    checks.push(reusedAfter.birthtimeMs!==reusedBefore.birthtimeMs
      ?'actual reused-name rename changed birthtime; accepted native identity attestation still completed same canonical task with required PASS'
      :'actual reused-name rename did not change birthtime this run; supported same-object move completed same canonical task with required PASS');
    const moveSource=path.join(ownRoot,'source','fresh-move.txt'),moveDestination=path.join(ownRoot,'destination','fresh-move.txt');
    fs.writeFileSync(moveSource,'Own fresh move bytes');const moveDigest=fileHash(moveSource);
    const moveId=files.search('fresh-move.txt').files.find(file=>file.relativePath==='source/fresh-move.txt')!.id;
    const moved=await executeTransfer('move',moveId);assert.equal(fs.existsSync(moveSource),false);assert.equal(fileHash(moveDestination),moveDigest);
    await executeTransfer('undo',undefined,moved.effectReceipt!.undoReceiptId);assert.equal(fileHash(moveSource),moveDigest);assert.equal(fs.existsSync(moveDestination),false);
    assert.equal(mountedGuiResults.length,6,'Five positive workflows and actual reused-name regression all use the default client');
    const heartbeatPlan=await call('/api/files/explorer/find-plans',{sourceFileId:moveId},{...publicHeaders,'x-idempotency-key':'mounted-heartbeat-find'});
    assert.equal(heartbeatPlan.status,200);
    const heartbeatExecute=call('/api/files/explorer/find-plans/'+heartbeatPlan.data.operationId+'/execute',{});
    await new Promise(resolve=>setTimeout(resolve,5));
    const endHeartbeat=startComputerRuntimeHeartbeat();
    try{const completed=await heartbeatExecute;assert.equal(completed.status,200,JSON.stringify(completed.data));assert.equal(completed.data.state,'verified');
      assert.equal(taskService.getTask(heartbeatPlan.data.taskId)!.status,'COMPLETED');assert.equal(taskService.getTask(heartbeatPlan.data.taskId)!.verification!.status,'PASS');
      recordCanonicalTask(heartbeatPlan.data.taskId);
    }finally{endHeartbeat();}
    for(let attempt=0;heldWorkflow&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(heldWorkflow,undefined,'Actual heartbeat releases its reservation before the next public workflow');
    checks.push('actual default runtime heartbeat claims queued real mounted find, dispatches default GUI orchestrator under reservation and completes exact persisted task');
    checks.push('actual default public find/copy/move/undo-copy/undo-move -> mounted producer -> source-derived private native fixture task association and independent filesystem checks -> same canonical COMPLETED required PASS task and completion/activity reads');
    // Preserve negative exact-selection/required-folder/readback coverage without
    // minting success from a synthetic ACK or merely from copied filesystem bytes.
    extraSelection=true;
    const ambiguousFind=await runComputerAppWorkflow(id,{app:'explorer',workflow:'find',sourceFileId:moveId});
    extraSelection=false;assert.notEqual(ambiguousFind.status,'verified');assert.notEqual(taskService.getTask(ambiguousFind.taskId!)!.verification?.status,'PASS');
    const negatives=[{name:'wrong-folder',activate:()=>{wrongFolderProof=true;},reset:()=>{wrongFolderProof=false;}},
      {name:'tampered-readback',activate:()=>{tamperReadback=true;},reset:()=>{tamperReadback=false;}}];
    for(const negative of negatives){
      const name=negative.name+'.txt',filename=path.join(ownRoot,'source',name);fs.writeFileSync(filename,'Own negative fixture bytes');
      const fileId=files.search(name).files.find(file=>file.relativePath==='source/'+name)!.id;
      negative.activate();const failed=await runComputerAppWorkflow(id,{app:'explorer',workflow:'copy',sourceFileId:fileId,destinationDirectoryId:destinationId});negative.reset();
      assert.notEqual(failed.status,'verified',negative.name);assert.notEqual(taskService.getTask(failed.taskId!)!.verification?.status,'PASS',negative.name);
      if(negative.name==='wrong-folder'){
        const following=await runComputerAppWorkflow(id,{app:'explorer',workflow:'find',sourceFileId:moveId});
        assert.equal(following.status,'verified',JSON.stringify(following));assert.equal(following.taskState,'COMPLETED');
        assert.notEqual(following.taskId,failed.taskId);
        recordCanonicalTask(following.taskId!);
        checks.push('failed final folder proof cancels the actual binding; next fresh default workflow succeeds in the exact same session without retaining a competing reservation');
      }
    }
    const changedFilename=path.join(ownRoot,'source','changed-after-claim.txt');fs.writeFileSync(changedFilename,'Own unchanged precondition');
    const changedId=files.search('changed-after-claim.txt').files.find(file=>file.relativePath==='source/changed-after-claim.txt')!.id;
    id=await prepare();mutateOnClaim=true;const inputsBeforeChange=inputCalls;
    const changed=await runComputerAppWorkflow(id,{app:'explorer',workflow:'find',sourceFileId:changedId});
    assert.notEqual(changed.status,'verified');assert.equal(inputCalls,inputsBeforeChange,'Changed actual source prevents later blind input');
    assert.notEqual(taskService.getTask(changed.taskId!)!.verification?.status,'PASS');
    checks.push('actual default mounted negative cases: nonunique selection, wrong required native folder, actual filesystem readback tamper and after-claim source change never obtain canonical PASS');
    const currentJournal=JSON.parse(fs.readFileSync(path.join(path.dirname(runtime.store.filePath),'mobile-realtime.json'),'utf8'));
    for(const canonicalId of mountedCanonicalTaskIds){
      const actualTask=taskService.getTask(canonicalId)!;assert.equal(actualTask.status,'COMPLETED');assert.equal(actualTask.verification!.status,'PASS');
      const actualProjection=projectTaskEventsV2(actualTask);assert.equal(actualProjection.diagnostics.quarantinedEventCount,0);
      actualProjection.events.forEach((event,index)=>{assert.equal(parseTaskEventV2(event).success,true);assert.equal(event.taskId,canonicalId);assert.equal(event.sequence,index+1);});
      const actualMobile=await call('/api/mobile/tasks/'+canonicalId+'/activity',undefined,{authorization:'Device '+credential.token});assert.equal(actualMobile.status,200);
      const decrypted=runtime.crypto.decrypt<any>(credential.sessionId,actualMobile.data.envelope,'task.activity.result','server_to_client','http');
      assert.deepEqual(decrypted.events,actualProjection.events);
      const retained=currentJournal.histories.flatMap((entry:any)=>entry[1]).filter((event:any)=>event.event==='task.event.v2'&&event.payload.taskId===canonicalId);
      assert.deepEqual(sampledCanonicalJournal.get(canonicalId),actualProjection.events);
      if(retained.length)assert.deepEqual(retained.map((entry:any)=>entry.payload),actualProjection.events.slice(-retained.length),'Current bounded journal retains an exact suffix after eviction');
    }
    checks.push('every mounted default completed app/find/transfer/undo/heartbeat/recovery task has identical canonical IDs and event sequences in persisted TaskService, encrypted real mobile activity and actual default persisted realtime sampled at completion before bounded500 row eviction; retained suffixes also match');
    const orphan=await createCold({app:'spotify',workflow:'open'});
    const orphanPrior=await call(`/api/computer-use/native-workflows/${orphan.bindingId}/finish`,orphan.context,privateHeaders);assert.equal(orphanPrior.data.errorCode,'NATIVE_LEDGER_INCOMPLETE');
    const restarted=new NativeTaskBindingService();restarted.recover();
    assert.equal(taskService.getTask(orphan.taskId)!.status,'BLOCKED','Restarted registry cannot recover live native authority from persisted task metadata');
    assert.equal((await call(`/api/edith/tasks/${orphan.taskId}/resume`,{})).status,409);restarted.close();
    checks.push('reconstructed native registry blocks persisted unfinished tasks and rejects public resume; no live native authority synthesized after restart');
    const ownerLogout=await previousFetch(origin+'/api/security/session',{method:'DELETE',headers:publicHeaders});assert.equal(ownerLogout.status,200);assert.equal((await ownerLogout.json() as any).success,true);assert.equal(taskService.getTask(orphan.taskId)!.status,'CANCELLED');assert.equal(cancellationReason(orphan.taskId),'OWNER_REVOKED');assert.notEqual(taskService.getTask(orphan.taskId)!.verification?.status,'PASS');
    const ownerDenied=await call(`/api/computer-use/native-workflows/${orphan.bindingId}/finish`,orphan.context,privateHeaders);assert.equal(ownerDenied.status,401);assert.equal(ownerDenied.data.errorCode,'OWNER_SESSION_REQUIRED');
    checks.push('actual owner logout retains source OWNER_REVOKED safety reason over prior valid finish failure and rejects later native proof');
    console.log(JSON.stringify({mountedDefaultClient:true,realMountedProducer:true,realTaskPersistence:true,realDefaultMobile:true,checks,
      canonicalTasks:[...mountedCanonicalTaskIds].map(id=>{const task=taskService.getTask(id)!;return {taskId:id,state:task.status,
        verification:task.verification!.status,requiredChecks:task.verification!.checks.filter(check=>check.required).map(check=>({id:check.id,status:check.status})),
        eventCount:projectTaskEventsV2(task).events.length,mobileEncryptedActivityMatched:true,persistedRealtimeMatched:true};}),
      consumerTaskBinding:'REGISTERED_ACTUAL_MOUNTED_ROUTER_PERSISTENCE',ownerContext:'ACTUAL_PRIVATE_LOOPBACK_OWNER_CONTEXT_FOR_APPS_SOURCE_OWNER_FOR_EXPLORER_NODE_ONLY_FOR_PAIRING_AND_DIRECT_PRODUCER_NEGATIVES',physicalAcceptance:false}));
  }finally{
    await stopComputer();clearOwnerSessionMemory();fixtureCore.invoke=fixtureInvoke;globalThis.fetch=oldFetch;Object.defineProperty(window.location,'origin',{value:oldOrigin,configurable:true});
    getNativeTaskBinding().close();runtime.realtime.shutdown();if(mounted.listening)await new Promise<void>(resolve=>mounted.close(()=>resolve()));
    if(oldOwner===undefined)delete process.env.EDITH_OWNER_TOKEN;else process.env.EDITH_OWNER_TOKEN=oldOwner;
    if(oldBridge===undefined)delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN;else process.env.EDITH_DESKTOP_BRIDGE_TOKEN=oldBridge;
  }
}

