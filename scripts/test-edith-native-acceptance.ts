import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import { beginComputerSession, observeComputer, actOnComputer, stopComputer, getComputerMonitors, inspectComputerApp, getComputerAppSnapshot, locateComputerTarget,locateComputerFocusTarget, type ComputerObservation } from '../src/edith/computerDesktopClient';
import {DesktopActionIdempotencyLedger,ComputerContractError} from '../src/edith/computerContractAdapter';
import {operatorStateForAction} from '../src/edith/computerOperatorEvents';

// Regression fixtures exercise the actual frontend adapter. They deliberately
// do not call Windows and are not physical native acceptance receipts.
// Minimal source integration guards complement the executable client fixtures.
const nativeComputer=readFileSync(new URL('../src-tauri/src/computer.rs',import.meta.url),'utf8');
const nativeLib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const nativeUia=readFileSync(new URL('../src-tauri/src/native_uia.rs',import.meta.url),'utf8');
for(const command of ['computer_locate_ocr','computer_ocr_readback']){
  assert.match(nativeComputer,new RegExp(`pub async fn ${command}\\(`));
  assert.equal(nativeLib.split(`computer::${command},`).length-1,1,`${command} must register exactly once`);
}
assert.match(nativeComputer,/validate_metadata\(&target\.target_id/);
assert.match(nativeComputer,/fresh_ocr_frame\(/);
assert.match(nativeComputer,/finish_dispatch\(/);
assert.match(nativeComputer,/invalidate_unused\(/);
assert.match(nativeUia,/found\.ok_or_else\(\|\| "UIA_TARGET_NOT_FOUND"\.into\(\)\)/);
assert.match(nativeUia,/elements_for_query\(hwnd, process_id, true\)/);
assert.match(nativeUia,/"UIA_PROVIDER_UNAVAILABLE"/);
const nativeSection=(start:string,end:string)=>nativeComputer.slice(nativeComputer.indexOf(start),nativeComputer.indexOf(end,nativeComputer.indexOf(start)));
const nativeOcrLocate=nativeSection('pub async fn computer_locate_ocr(', 'pub async fn computer_ocr_readback(');
assert.match(nativeOcrLocate,/let eligibility=crate::native_uia::locate\(/,'Native establishes fallback eligibility independently');
assert.match(nativeOcrLocate,/Err\(code\)if code=="UIA_TARGET_NOT_FOUND"\|\|code=="UIA_PROVIDER_UNAVAILABLE"=>\{\}/);
assert.match(nativeOcrLocate,/Err\(code\)=>return Err\(code\)/);
assert.match(nativeOcrLocate,/Ok\(_\)=>return Err\(/);
assert.match(nativeOcrLocate,/guard\.deadline=guard\.deadline\.min\(observation\.captured_at\.saturating_add\(5000\)\)/);
assert.match(nativeOcrLocate,/recognize_cached_ocr\(&image,&\|\|guard\.check_local\(\)\)/,'Provider polling uses bounded local cancellation checks');
const nativeOcrReadback=nativeSection('pub async fn computer_ocr_readback(', 'pub async fn computer_ocr(');
assert.match(nativeOcrReadback,/guard\.deadline=guard\.deadline\.min\(state\.ocr_targets\.lock\(\).*?expires_at\(&target_id,now_ms\(\)\)/);
assert.match(nativeOcrReadback,/guard\.check\(\)\?;let ocr=recognize_cached_ocr\(&image,&\|\|guard\.check_local\(\)\)\?;guard\.check\(\)\?/);
assert.match(nativeComputer,/ocr_context\.as_ref\(\)\.is_none_or\(\|context\|now_ms\(\)<context\.expires_at\.min\(context\.captured_at\.saturating_add\(5000\)\)\)/,'Input guard retains original capture expiry');
for(const [start,end] of [['pub fn computer_workflow_reserve(', 'pub fn computer_workflow_release('],['pub fn computer_workflow_release(', 'pub async fn computer_focus_target(']]){
  assert.match(nativeSection(start,end),/drop\(slot\);\s*if let Ok\(mut targets\)=state\.ocr_targets\.lock\(\)\{targets\.invalidate_all\(\);\}/,'Reservation boundary revokes OCR authority');
}
let generation = 0, nativeCalls = 0, postPid = 77, launchedPid: number | undefined = 77;
let stopDuringReport = false, stopDuringNative = false, staleDuringReport = false, stopDuringPost = false;
let textMode=false,textReads=0,readbackAvailable=true,preDocument='',postDocument='EDITH_COMPUTER_USE_OK',failedInput=false,wrongTextWindow=false;
let releaseConfirmed=true;
let focusMode=false,focusNoop=false,ambiguousFocus=false,focusDenied=false,focusWrongWindow=false,focusWrongPid=false,focusWrongPath=false,stopDuringFocusIssue=false;
let killDuringFocusNative=false;
let calcMode=false,calcDisplay='0',calcOperand:number|undefined,calcStage=0,calcVariant='';
const calcIssued=new Map<string,string>();
const issuedFocus=new Map<string,{windowId:string;processId:number;imagePathFingerprint:string;observationId:string;observationGeneration:number;app:unknown}>();
const eventBodies:unknown[]=[];
let wire: ComputerObservation;
const status = { runtime: 'tauri', mode: 'owner_command', available: true,
  screenCapture: 'ready', mouseControl: 'ready', keyboardControl: 'ready',
  ownerCommandMode: true, killSwitch: 'inactive', overlay: 'missing',
  sessionExpiresAt: Date.now() + 300000, safeMessage: 'Fixture only.' };
const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
(globalThis as unknown as {window: unknown}).window = {
  location: {origin: 'http://127.0.0.1:49999'},
  __TAURI__: {core: {invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'computer_begin') return 'native-regression-session';
    if (command === 'computer_status') return status;
    if (command === 'computer_stop') {issuedFocus.clear();return undefined;}
    if (command === 'computer_monitors') return [{id:'monitor-left',bounds:{x:-800,y:0,width:800,height:600},primary:false,active:false,dpiScale:null},{id:'monitor-main',bounds:{x:0,y:0,width:800,height:600},primary:true,active:true,dpiScale:1.25}];
    if (command === 'computer_app_windows') return [{app:args?.app,windowId:'fixture-window',processId:77,title:'Fixture only'}];
    if (command === 'computer_locate') {
      if(calcMode){const query=String(args?.query);if(!['2','Add','Equals'].includes(query))throw new Error('UIA_TARGET_NOT_FOUND');const targetId=`uia:calc-${wire.generation}:${createHash('sha256').update(query).digest('hex')}`;calcIssued.set(targetId,query);return {targetId,x:100,y:100,width:20,height:20};}
      return {targetId:'uia:fixture:'+ 'b'.repeat(64),x:100,y:100,width:20,height:20};
    }
    if(command==='computer_app_snapshot'&&calcMode){
      if(calcVariant==='stale')await observeComputer('native-regression-session');
      const control=(target:string,name:string,automationId:string,controlType:number)=>({targetId:`uia:calc:${createHash('sha256').update(target).digest('hex')}`,name,automationId,controlType,x:100,y:100,width:40,height:20,value:null,toggle:null,rangeValue:null,rangeMin:null,rangeMax:null,selected:null});
      const controls=[control('button4','4','num4Button',50000),control('history4','4','HistoryItem',50020)];
      if(calcVariant!=='button-history-only'||calcStage<4)controls.push(control('result',`Ekran değeri ${calcDisplay}`,'CalculatorResults',50020));
      if(calcVariant==='ambiguous'&&calcStage===4)controls.push(control('duplicate-result',`Ekran değeri ${calcDisplay}`,'CalculatorResults',50020));
      return controls;
    }
    if (command === 'computer_read_text') {textReads++;if(!readbackAvailable)throw new Error('UIA unavailable');return textReads===1?preDocument:postDocument;}
    if(command==='computer_focus_target'){
      if(stopDuringFocusIssue)await stopComputer();
      if(ambiguousFocus)throw new Error('Ambiguous installed app window');
      if(args?.observationId!==wire.observationId||args?.generation!==wire.generation)throw new Error('stale_observation');
      const target={windowId:'hwnd:focus-fixture',processId:77,imagePathFingerprint:focusWrongPath?'e'.repeat(64):'d'.repeat(64),observationId:wire.observationId,observationGeneration:wire.generation};
      issuedFocus.set(`${args?.sessionId}:${wire.generation}`,{...target,app:args?.app});return target;
    }
    if (command === 'computer_observe' || command === 'computer_screenshot') {
      if (command === 'computer_screenshot' && stopDuringPost) await stopComputer();
      wire = { observationId: `obs-${++generation}`, generation, imageDataUrl: 'data:image/png;base64,fixture',
        originX: 0, originY: 0, width: 800, height: 600, cursorX: 50, cursorY: 50,
        capturedAt: Date.now(), expiresAt: Date.now()+15000, source: 'windows_gdi_virtual_desktop',confidence:1,
        windowId: focusMode&&(focusNoop||command==='computer_screenshot') ? (focusWrongWindow?'hwnd-unrelated':'hwnd:focus-fixture') : command === 'computer_observe'||(textMode&&!wrongTextWindow) ? 'hwnd-before' : 'hwnd-post',
        windowProcessId: focusMode&&(focusNoop||command==='computer_screenshot') ? (focusWrongPid?999:77) : command === 'computer_observe'||textMode ? 10 : postPid,
        windowBounds:{x:0,y:0,width:800,height:600},monitorId:'monitor-fixture',monitorBounds:{x:0,y:0,width:800,height:600},
        scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:false,ocrAvailable:false };
      if(calcMode){wire.windowId=calcVariant==='wrong-window'&&calcStage===4?'hwnd:other':'hwnd:calc-fixture';wire.windowProcessId=calcVariant==='wrong-pid'&&calcStage===4?999:77;}
      return wire;
    }
    if (command === 'computer_action') {
      nativeCalls++;
      if (stopDuringNative) await stopComputer();
      const request = args!.request as {actionId: string; planId: string;stepId: string;observationId:string;action:string};
      if(calcMode&&request.action==='clickMouse'){
        const query=calcIssued.get((request as typeof request&{target:{targetId:string}}).target.targetId);
        if(query==='2'){calcDisplay='2';calcStage++;}
        else if(query==='Add'){calcOperand=Number(calcDisplay);calcStage++;}
        else if(query==='Equals'){calcDisplay=String((calcOperand??NaN)+Number(calcDisplay));calcStage++;if(calcVariant==='unrelated-label')calcDisplay='3';}
        else throw new Error('Calculator fixture target was not independently located');
      }
      if(request.action==='focusApp'){
        if(killDuringFocusNative)throw new Error('kill_switch_active: fixture native safety guard rejected focus');
        const focused=request as typeof request&{applicationId:string;focusTarget:unknown;observationGeneration:number};
        const issued=issuedFocus.get(`${args?.sessionId}:${focused.observationGeneration}`);
        const issuedTarget=issued&&{windowId:issued.windowId,processId:issued.processId,imagePathFingerprint:issued.imagePathFingerprint,observationId:issued.observationId,observationGeneration:issued.observationGeneration};
        if(!issued||issued.app!==focused.applicationId||JSON.stringify(focused.focusTarget)!==JSON.stringify(issuedTarget))throw new Error('Native focus target not issued');
        if(focusDenied)return {...request,injected:false,dispatchStatus:'failed',errorCode:'NATIVE_FOCUS_NOT_VERIFIED',cursorX:50,cursorY:50,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:request.observationId,attempts:1};
        return {...request,injected:!focusNoop,dispatchStatus:'dispatched',cursorX:50,cursorY:50,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:request.observationId,attempts:1,focusReadback:{source:'native_operator',applicationId:focused.applicationId,windowId:issued.windowId,windowProcessId:issued.processId,imagePathFingerprint:issued.imagePathFingerprint,matched:true}};
      }
      return {...request,injected:true,dispatchStatus:failedInput?'failed':'dispatched',...(failedInput?{partialInputInjected:true,releaseConfirmed,errorCode:'NATIVE_DISPATCH_INTERRUPTED'}:{}),cursorX:50,cursorY:50,
        verification:textMode?'input_injected_outcome_unverified':'process_started',verificationStatus:'pending_post_observation',preObservationId:request.observationId,
        attempts:1,launchedProcessId:launchedPid};
    }
    throw new Error(`Unexpected fixture command ${command}`);
  }}}
};
globalThis.fetch = async (input, init) => {
  if(String(input)==='/api/security/session') return new Response(JSON.stringify({session:{actor:'owner',csrfToken:'fixture-csrf',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}}));
  const payload=init?.body?JSON.parse(String(init.body)):{};
  eventBodies.push(payload);
  if(payload.event==='desktop.action.requested.v2') {
    if(stopDuringReport) await stopComputer();
    if(staleDuringReport) wire.expiresAt=Date.now()-1;
  }
  return new Response('{}',{status:202});
};
async function prepare(){await stopComputer();await beginComputerSession();await observeComputer('native-regression-session');}
// Single-PID software model only: the real Calculator root/content PID mismatch
// remains outside acceptance. Result verification independently samples the
// actual client snapshot primitive and identifies its Text result context.
async function calculatorResult(expected:string):Promise<boolean>{
  const before=wire;
  const controls=await getComputerAppSnapshot('native-regression-session');
  const results=controls.filter(c=>c.automationId==='CalculatorResults'&&c.controlType===50020);
  return wire===before&&before.windowId==='hwnd:calc-fixture'&&before.windowProcessId===77&&before.expiresAt>Date.now()
    &&results.length===1&&results[0].name===`Ekran değeri ${expected}`;
}
async function calculatorFixture(variant=''):Promise<boolean>{
  calcMode=true;calcVariant=variant;calcDisplay=variant==='preexisting4'?'4':'0';calcOperand=undefined;calcStage=0;calcIssued.clear();
  failedInput=variant==='partial';await prepare();
  if(!await calculatorResult('0'))return false;
  for(const [query,expected] of [['2','2'],['Add','2'],['2','2'],['Equals','4']]){
    const beforeGeneration=wire.generation;
    const target=await locateComputerTarget('native-regression-session',query);
    const dispatch=await actOnComputer('native-regression-session',{action:'clickMouse',button:'left',x:110,y:110,target});
    if(dispatch.canonicalLifecycle?.dispatch.status!=='dispatched'||dispatch.partialInputInjected===true||!dispatch.injected||wire.generation<=beforeGeneration)return false;
    if(!await calculatorResult(expected))return false;
  }
  return calcStage===4&&await calculatorResult('4');
}
try {
  await prepare();postPid=999;launchedPid=77;
  assert.equal((await actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'})).verificationStatus,'partial','Unrelated window must not verify launch');
  await prepare();postPid=77;
  assert.equal((await actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'})).verificationStatus,'verified','Matching observed child PID is required');
  await prepare();launchedPid=undefined;
  assert.equal((await actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'})).verificationStatus,'partial');
  await prepare();stopDuringReport=true;let prior=nativeCalls;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'}),/stopped_or_expired/);
  assert.equal(nativeCalls,prior,'Cancellation while awaiting event has zero native dispatch');stopDuringReport=false;
  await prepare();staleDuringReport=true;prior=nativeCalls;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'}),/stale_observation/);
  assert.equal(nativeCalls,prior);staleDuringReport=false;
  await prepare();stopDuringNative=true;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'}),/stopped_or_expired/);
  stopDuringNative=false;await prepare();stopDuringPost=true;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'launchApp',app:'notepad'}),/stopped_or_expired/);
  stopDuringPost=false;await prepare();
  const monitors=await getComputerMonitors('native-regression-session');
  assert.equal(monitors[0].bounds.x,-800);assert.equal(monitors[0].dpiScale,null);assert.equal(monitors[1].dpiScale,1.25);
  assert.equal((await inspectComputerApp('native-regression-session','spotify'))[0].processId,77);
  const target=await locateComputerTarget('native-regression-session','Fixture');
  const locatedResult=await actOnComputer('native-regression-session',{action:'moveMouse',x:110,y:110,target});
  const canonicalAction=locatedResult.canonicalLifecycle!.action;
  assert.equal(canonicalAction.target?.targetId,target.targetId);
  const ledger=new DesktopActionIdempotencyLedger<number>();ledger.run(canonicalAction,async()=>1);
  assert.throws(()=>ledger.run({...canonicalAction,target:{...target,targetId:'uia:changed:'+ 'c'.repeat(64)}},async()=>2),/another action/,'Semantic target changes conflict with the same idempotency key');
  await stopComputer();await assert.rejects(()=>inspectComputerApp('native-regression-session','spotify'),/session_missing/);
  textMode=true;await prepare();textReads=0;eventBodies.length=0;
  const inserted=await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK',actionId:'text-success',idempotencyKey:'text-success'});
  assert.equal(inserted.verificationStatus,'verified');assert.equal(inserted.textReadback?.matched,true);assert.equal(textReads,2);
  const ordered=eventBodies as Array<{event?:string;payload?:unknown}>;
  assert.ok(ordered.map(e=>e.event).lastIndexOf('desktop.observation.v2')<ordered.findIndex(e=>e.event==='desktop.action.verification.v2'));
  assert.equal(JSON.stringify(ordered).includes('EDITH_COMPUTER_USE_OK'),false,'Raw text does not enter realtime journal');
  await prepare();textReads=0;postDocument='OTHER_CONTENT';
  assert.equal((await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK'})).verificationStatus,'partial','Unrelated text change is insufficient');
  await prepare();textReads=0;preDocument='selected old text';postDocument='EDITH_COMPUTER_USE_OK';
  assert.equal((await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK'})).verificationStatus,'partial','Replacement is not the requested insertion');
  preDocument='';postDocument='EDITH_COMPUTER_USE_OK';await prepare();textReads=0;wrongTextWindow=true;
  assert.equal((await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK'})).verificationStatus,'partial');wrongTextWindow=false;
  await prepare();textReads=0;readbackAvailable=false;
  assert.equal((await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK'})).verificationStatus,'partial');readbackAvailable=true;
  await prepare();textReads=0;failedInput=true;prior=nativeCalls;
  const partial=await actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK',actionId:'text-partial',idempotencyKey:'text-partial'});
  assert.equal(partial.canonicalLifecycle?.dispatch.status,'failed');assert.equal(partial.verificationStatus,'partial');
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'typeText',text:'EDITH_COMPUTER_USE_OK',actionId:'text-partial',idempotencyKey:'text-partial'}),/another action/,'A newer observation cannot rebind a partially injected action');
  assert.equal(nativeCalls,prior+1,'Partial insertion is never automatically dispatched again');failedInput=false;
  textMode=false;await prepare();
  assert.equal(operatorStateForAction('dragMouse'),'moving');assert.equal(operatorStateForAction('doubleClickMouse'),'clicking');
  const drag=await actOnComputer('native-regression-session',{action:'dragMouse',dragStart:{x:100,y:100},dragEnd:{x:200,y:200},dragDurationMs:300});
  assert.equal(drag.canonicalLifecycle?.action.retryBudget.maxAttempts,1);assert.equal(drag.verificationStatus,'partial','Dispatch cannot prove drag effect');
  await prepare();failedInput=true;releaseConfirmed=false;
  const unconfirmed=await actOnComputer('native-regression-session',{action:'doubleClickMouse',x:100,y:100});
  assert.equal(unconfirmed.canonicalLifecycle?.dispatch.releaseConfirmed,false);assert.equal(unconfirmed.canonicalLifecycle?.dispatch.status,'failed');assert.equal(unconfirmed.verificationStatus,'partial');
  failedInput=false;releaseConfirmed=true;await prepare();prior=nativeCalls;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'dragMouse',dragStart:{x:100,y:100},dragEnd:{x:900,y:200},dragDurationMs:300}),(error:unknown)=>error instanceof ComputerContractError&&error.errorCode==='DESKTOP_COORDINATE_MISMATCH');
  assert.equal(nativeCalls,prior,'Invalid atomic bounds are rejected before native dispatch');
  focusMode=true;await prepare();let focus=await locateComputerFocusTarget('native-regression-session','spotify');
  const focused=await actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus});
  assert.equal(focused.verificationStatus,'verified');assert.equal(focused.canonicalLifecycle?.verification.expectedEffect,'foreground_window_focused');assert.equal(focused.launchedProcessId,undefined);
  assert.equal(focused.canonicalLifecycle?.verification.evidence.some(e=>e.kind==='process_started'),false,'Focus does not fabricate a process launch');
  focusNoop=true;await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');
  const noop=await actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus});assert.equal(noop.verificationStatus,'verified');assert.equal(noop.injected,false);focusNoop=false;
  for(const kind of ['window','pid','path','denied'] as const){
    await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');
    focusWrongWindow=kind==='window';focusWrongPid=kind==='pid';focusWrongPath=kind==='path';focusDenied=kind==='denied';
    assert.equal((await actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus})).verificationStatus,'partial',kind);
    focusWrongWindow=focusWrongPid=focusWrongPath=focusDenied=false;
  }
  await prepare();ambiguousFocus=true;await assert.rejects(()=>locateComputerFocusTarget('native-regression-session','spotify'),/Ambiguous/);ambiguousFocus=false;
  await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');issuedFocus.clear();
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus}),/not issued/);
  await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'focusApp',applicationId:'steam',focusTarget:focus}),/not issued/);
  await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');stopDuringReport=true;prior=nativeCalls;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus}),/stopped_or_expired/);assert.equal(nativeCalls,prior);stopDuringReport=false;
  await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');stopDuringNative=true;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus}),/stopped_or_expired|not issued/);stopDuringNative=false;
  await prepare();stopDuringFocusIssue=true;await assert.rejects(()=>locateComputerFocusTarget('native-regression-session','spotify'),/stopped_or_expired/);stopDuringFocusIssue=false;
  await prepare();focus=await locateComputerFocusTarget('native-regression-session','spotify');killDuringFocusNative=true;
  await assert.rejects(()=>actOnComputer('native-regression-session',{action:'focusApp',applicationId:'spotify',focusTarget:focus}),/kill_switch_active/);killDuringFocusNative=false;
  focusMode=false;
  assert.equal(await calculatorFixture(),true,'Fresh 0, located 2/Add/2/Equals, independent unique CalculatorResults Text=4');
  for(const variant of ['button-history-only','unrelated-label','preexisting4','wrong-pid','wrong-window','ambiguous','partial'])assert.equal(await calculatorFixture(variant),false,variant);
  await assert.rejects(()=>calculatorFixture('stale'),/stale_observation/);
  calcMode=false;failedInput=false;
  console.log(JSON.stringify({calculatorSoftwareFixture:true,sequence:['neutral0','2','Add','2','Equals','independent_result_Text4'],checks:['unique_result_context_not_button_or_history','wrong_result_not_verified','preexisting4_not_verified','wrong_pid_window_not_verified','ambiguous_result_not_verified','stale_snapshot_not_verified','partial_dispatch_not_verified'],physicalAcceptance:false,providerAcceptance:false,actualCalculatorCrossPidGap:'unverified; separate coordinator CROSS evidence'}));
  console.log(JSON.stringify({focusChecks:['issued_focus_exact_positive','already_focused_no_input_noop','unrelated_foreground_pid_path_unverified','native_denial_unverified','ambiguous_and_not_issued_target_rejected','wrong_app_native_lease_rejected','stop_across_issuance_report_dispatch','native_kill_guard_error_not_verified','no_process_started_fabrication'],physicalAcceptance:false}));
  console.log(JSON.stringify({success:true,physicalAcceptance:false,checks:['unrelated_launch_not_verified','matching_child_pid','no_pid_not_verified','stop_during_report_zero_dispatch','stale_during_report_zero_dispatch','stop_during_native_no_success','stop_during_post_no_success','negative_monitor_origin_and_unknown_dpi','app_inspection_session_bound','semantic_target_bound_and_idempotency_conflict','independent_text_pre_post_readback','same_window_exact_insertion_only','raw_text_absent_from_events','post_observation_precedes_verification','partial_typing_not_replayed','atomic_dispatch_not_effect_verification','unconfirmed_release_failed_and_no_verification','invalid_atomic_bounds_zero_native_dispatch']}));
} finally { await stopComputer(); globalThis.fetch=previousFetch;(globalThis as unknown as {window:unknown}).window=previousWindow; }
