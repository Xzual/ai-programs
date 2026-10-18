import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TASK_CONTRACT_VERSION,EDITH_CONTRACT_AMENDMENT,type DesktopObservationV2} from '../src/edith/contracts';
import {toActionVerificationV2} from '../src/edith/computerContractAdapter';
import {beginComputerSession,observeComputer,actOnComputer,stopComputer,locateComputerTarget,type ComputerObservation} from '../src/edith/computerDesktopClient';

// Independent client-boundary fixtures use the actual local invoke and adapter
// pipeline. No Windows OCR provider, physical input or runtime acceptance claim.
const session='ocr-fixture-session', hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const intent={postcondition:{kind:'unique_text_transition' as const,beforeText:'2 + 2',afterText:'4'}};
let generation=0,wire:ComputerObservation,pre:ComputerObservation;
let uiaError:unknown='UIA_TARGET_NOT_FOUND',locates=0,dispatches=0,readbacks=0;
let stopAt='',staleAt='',failed=false,receiptPatch:Record<string,unknown>={},targetPatch:Record<string,unknown>={},rowPatch:Record<string,unknown>={};
let issuedTarget:Record<string,unknown>,lastAction:Record<string,unknown>;
const bodies:unknown[]=[],calls:Array<{command:string;args?:Record<string,unknown>}>=[];
const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
const status={runtime:'tauri',mode:'owner_command',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:true,killSwitch:'inactive',overlay:'missing',sessionExpiresAt:Date.now()+300000,safeMessage:'Fixture only.'};
(globalThis as unknown as {window:unknown}).window={location:{origin:'http://127.0.0.1:49999'},__TAURI__:{core:{invoke:async(command:string,args?:Record<string,unknown>)=>{
  calls.push({command,args});
  if(command==='computer_begin')return session;
  if(command==='computer_status')return status;
  if(command==='computer_stop')return;
  if(command==='computer_observe'||command==='computer_screenshot'){
    wire={observationId:`ocr-obs-${++generation}`,generation,imageDataUrl:'data:image/png;base64,fixture',originX:-800,originY:0,width:1600,height:600,cursorX:-690,cursorY:110,capturedAt:Date.now(),expiresAt:Date.now()+15000,source:'windows_gdi_virtual_desktop',confidence:1,windowId:'hwnd:calculator-fixture',windowProcessId:77,windowBounds:{x:-800,y:0,width:800,height:600},monitorId:'left',monitorBounds:{x:-800,y:0,width:800,height:600},scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:false,ocrAvailable:true};
    if(command==='computer_observe')pre=wire;
    if(stopAt==='post'&&command==='computer_screenshot')await stopComputer();
    return wire;
  }
  if(command==='computer_locate'){
    if(uiaError!==null)throw uiaError;
    return {targetId:`uia:fixture:${hash('uia')}`,x:-700,y:100,width:20,height:20};
  }
  if(command==='computer_locate_ocr'){
    locates++;
    issuedTarget={contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,targetId:`ocr-fixture-${generation}`,observationId:wire.observationId,observationGeneration:wire.generation,provenance:'ocr',confidence:1,textFingerprint:hash('='),physicalBounds:{x:-700,y:100,width:20,height:20,coordinateSpace:'physical_virtual_desktop'},...targetPatch};
    if(stopAt==='locate')await stopComputer();
    if(staleAt==='locate')await observeComputer(session);
    return {target:issuedTarget,windowId:wire.windowId,windowProcessId:77,imagePathFingerprint:hash('calculator.exe'),expiresAt:Date.now()+4000,...rowPatch};
  }
  if(command==='computer_action'){
    dispatches++;lastAction=args!.request as Record<string,unknown>;
    if(stopAt==='dispatch')await stopComputer();
    return {...lastAction,injected:true,dispatchStatus:failed?'failed':'dispatched',...(failed?{partialInputInjected:true,releaseConfirmed:false,errorCode:'NATIVE_DISPATCH_INTERRUPTED'}:{}),cursorX:-690,cursorY:110,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:pre.observationId,attempts:1};
  }
  if(command==='computer_ocr_readback'){
    readbacks++;
    const receipt={source:'native_operator',kind:'ocr_semantic_transition',targetId:issuedTarget.targetId,canonicalActionId:lastAction.actionId,preObservationId:pre.observationId,postObservationId:wire.observationId,preGeneration:pre.generation,postGeneration:wire.generation,windowId:wire.windowId,windowProcessId:77,imagePathFingerprint:hash('calculator.exe'),preTextFingerprint:hash(intent.postcondition.beforeText),postTextFingerprint:hash('4'),expectedTextFingerprint:hash('4'),matched:true,observedAt:Date.now(),...receiptPatch};
    if(stopAt==='readback')await stopComputer();
    if(staleAt==='readback')await observeComputer(session);
    return receipt;
  }
  throw new Error(`Unexpected fixture command ${command}`);
}}}};
globalThis.fetch=async(input,init)=>{
  if(String(input)==='/api/security/session')return new Response(JSON.stringify({session:{actor:'owner',csrfToken:'fixture',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}}));
  const body=init?.body?JSON.parse(String(init.body)):{};bodies.push(body);
  if(body.event==='desktop.action.requested.v2'&&stopAt==='report')await stopComputer();
  return new Response('{}',{status:202});
};
async function prepare(){stopAt=staleAt='';failed=false;receiptPatch={};targetPatch={};rowPatch={};uiaError='UIA_TARGET_NOT_FOUND';await stopComputer();await beginComputerSession();await observeComputer(session);}
async function locate(){return locateComputerTarget(session,'=',intent);}
async function click(target:Awaited<ReturnType<typeof locate>>,extra:Record<string,unknown>={}){return actOnComputer(session,{action:'clickMouse',button:'left',x:-690,y:110,target,...extra});}
const checks:string[]=[];
try{
  for(const error of ['UIA_TARGET_NOT_FOUND','UIA_PROVIDER_UNAVAILABLE']){
    await prepare();uiaError=error;const before=locates;const target=await locate();assert.equal(target.provenance,'ocr');assert.equal(locates,before+1);assert.equal(target.physicalBounds!.x,-700);
  }checks.push('two_exact_typed_fallback_codes_negative_virtual_origin');
  for(const error of ['UIA query is ambiguous; require a unique target name','UIA traversal time budget exceeded','UIA_PROVIDER_UNAVAILABLE: detail','unknown error','permission_denied','stopped_or_expired',{message:'UIA_TARGET_NOT_FOUND_EXTRA'}]){
    await prepare();uiaError=error;const before=locates;await assert.rejects(()=>locate());assert.equal(locates,before,'Ineligible UIA errors must make zero OCR calls');
  }checks.push('ambiguity_timeout_permission_unknown_stop_and_code_prefix_fail_closed');
  await prepare();let before=locates;await assert.rejects(()=>locateComputerTarget(session,'='));assert.equal(locates,before);checks.push('explicit_transition_intent_required');
  await prepare();uiaError=null;before=locates;assert.equal((await locate()).provenance,'uia');assert.equal(locates,before);checks.push('uia_success_no_fallback');
  const invalidTargets=[{provenance:'uia'},{targetId:'caller-target'},{confidence:0.99},{textFingerprint:hash('other')},{observationId:'wrong'},{observationGeneration:-1},{physicalBounds:{x:-700,y:100,width:4097,height:20,coordinateSpace:'physical_virtual_desktop'}},{physicalBounds:{x:-700.5,y:100,width:20,height:20,coordinateSpace:'physical_virtual_desktop'}},{physicalBounds:{x:-900,y:100,width:20,height:20,coordinateSpace:'physical_virtual_desktop'}},{physicalBounds:{x:-700,y:100,width:20,height:20,coordinateSpace:'css_pixels'}}];
  for(const patch of invalidTargets){await prepare();targetPatch=patch;await assert.rejects(()=>locate(),undefined,JSON.stringify(patch));}
  for(const patch of [{windowId:'wrong'},{windowProcessId:999},{imagePathFingerprint:'malformed'},{expiresAt:0},{expiresAt:Date.now()+60000},{callerProof:true}]){await prepare();rowPatch=patch;await assert.rejects(()=>locate(),undefined,JSON.stringify(patch));}
  checks.push('native_target_source_identity_bounds_frame_generation_fingerprint_expiry_metadata');
  bodies.length=0;await prepare();let target=await locate();let result=await click(target);
  assert.equal(result.verificationStatus,'verified');assert.equal(result.ocrReadback?.matched,true);assert.equal(result.canonicalLifecycle?.verification.expectedEffect,'visual_change');
  assert.equal(result.canonicalLifecycle?.action.retryBudget.maxAttempts,1);assert.equal(result.canonicalLifecycle?.action.retryBudget.attempt,1);
  assert.equal(result.canonicalLifecycle?.verification.evidence.some(e=>e.kind==='text_readback'),false,'OCR cannot fabricate UIA text evidence');
  assert.equal(JSON.stringify(bodies).includes('calculator.exe'),false);
  assert.equal(JSON.stringify(bodies).includes(intent.postcondition.beforeText),false,'Raw calculator labels never enter event journal');
  assert.equal(calls.filter(c=>c.command==='computer_locate_ocr').at(-1)?.args?.query,'=');
  assert.equal(calls.filter(c=>c.command==='computer_ocr_readback').at(-1)?.args?.canonicalActionId,result.canonicalLifecycle?.action.actionId);
  checks.push('native_semantic_receipt_validates_visual_change_only');
  const lifecycle=result.canonicalLifecycle!;
  const observations=(bodies as Array<{event:string;payload:DesktopObservationV2}>).filter(e=>e.event==='desktop.observation.v2').map(e=>e.payload);
  const canonicalPre=observations.find(o=>o.observationId===pre.observationId)!;
  const canonicalPost=observations.find(o=>o.observationId===wire.observationId)!;
  assert.equal(toActionVerificationV2(lifecycle.action,lifecycle.dispatch,result,canonicalPost,Date.now(),canonicalPre).status,'verified','Original locally validated receipt is accepted with exact context');
  for(const forged of [{...result.ocrReadback!},undefined]){
    let verified=false;
    try{verified=toActionVerificationV2(lifecycle.action,lifecycle.dispatch,{...result,ocrReadback:forged},canonicalPost,Date.now(),canonicalPre).status==='verified';}catch{}
    assert.equal(verified,false,'Caller-cloned or absent OCR proof cannot establish visual change');
  }
  await observeComputer(session);assert.notEqual(toActionVerificationV2(lifecycle.action,lifecycle.dispatch,result,canonicalPost,Date.now(),canonicalPre).status,'verified','New observation revokes retained authentic receipt for the old post frame');
  await stopComputer();assert.notEqual(toActionVerificationV2(lifecycle.action,lifecycle.dispatch,result,canonicalPost,Date.now(),canonicalPre).status,'verified','STOP revokes retained authentic receipt');
  checks.push('caller_cloned_or_absent_receipt_not_authority_calculator_2_plus_2_fixture');
  const invalidReceipts=[{source:'caller'},{kind:'text_readback'},{targetId:'ocr-unrelated'},{canonicalActionId:'unrelated'},{preObservationId:'unrelated'},{postObservationId:'unrelated'},{preGeneration:-1},{postGeneration:-1},{windowId:'hwnd:unrelated'},{windowProcessId:999},{imagePathFingerprint:hash('unrelated')},{preTextFingerprint:hash('unrelated')},{postTextFingerprint:hash('unrelated')},{expectedTextFingerprint:hash('unrelated')},{matched:false},{observedAt:0},{observedAt:Date.now()+60000},{unrelatedLabel:'changed text elsewhere'},{callerProof:true}];
  for(const patch of invalidReceipts){await prepare();target=await locate();receiptPatch=patch;result=await click(target);assert.notEqual(result.verificationStatus,'verified',JSON.stringify(patch));assert.notEqual(result.ocrReadback?.matched,true,JSON.stringify(patch));}
  checks.push('receipt_source_kind_target_action_pre_post_generation_window_pid_path_text_time_mismatch');
  for(const boundary of ['locate','report','dispatch','post','readback']){
    await prepare();if(boundary==='locate'){stopAt=boundary;await assert.rejects(()=>locate(),/stopped_or_expired|session_missing/);continue;}
    target=await locate();stopAt=boundary;const prior=dispatches;await assert.rejects(()=>click(target),/stopped_or_expired|session_missing/);if(boundary==='report')assert.equal(dispatches,prior);
  }checks.push('stop_after_each_async_boundary_zero_report_dispatch');
  for(const boundary of ['locate','readback']){await prepare();if(boundary==='locate'){staleAt=boundary;await assert.rejects(()=>locate(),/stale_observation/);}else{target=await locate();staleAt=boundary;result=await click(target);assert.notEqual(result.verificationStatus,'verified');}}
  checks.push('new_observation_during_await_invalidates_authority');
  await prepare();target=await locate();await observeComputer(session);let prior=dispatches;await assert.rejects(()=>click(target));assert.equal(dispatches,prior);checks.push('fresh_observation_before_dispatch_invalidates_unused_target');
  await prepare();target=await locate();prior=dispatches;await assert.rejects(()=>click({...target,physicalBounds:{...target.physicalBounds!,x:-699}}));assert.equal(dispatches,prior);checks.push('caller_target_metadata_change_zero_dispatch');
  for(const action of [{action:'doubleClickMouse'},{button:'right'},{attempt:2}]){await prepare();target=await locate();prior=dispatches;await assert.rejects(()=>click(target,action));assert.equal(dispatches,prior);}
  checks.push('single_left_click_attempt_one_only');
  await prepare();target=await locate();prior=dispatches;const realNow=Date.now;
  try{Date.now=()=>realNow()+6000;await assert.rejects(()=>click(target),/OCR_TARGET_EXPIRED|expired|stale/);assert.equal(dispatches,prior);}finally{Date.now=realNow;}
  checks.push('issued_lease_expiry_zero_dispatch');
  await prepare();target=await locate();const oldTarget=target;await prepare();prior=dispatches;await assert.rejects(()=>click(oldTarget));assert.equal(dispatches,prior);checks.push('same_session_id_new_incarnation_cannot_reuse_target');
  await prepare();target=await locate();failed=true;prior=dispatches;const priorReadback=readbacks;result=await click(target,{actionId:'ocr-partial',idempotencyKey:'ocr-partial'});assert.equal(result.verificationStatus,'partial');assert.equal(readbacks,priorReadback);await assert.rejects(()=>click(target,{actionId:'ocr-partial',idempotencyKey:'ocr-partial'}));assert.equal(dispatches,prior+1);checks.push('partial_dispatch_never_readback_or_replayed');
  console.log(JSON.stringify({success:true,physicalAcceptance:false,providerAcceptance:false,checks}));
}finally{await stopComputer();globalThis.fetch=oldFetch;(globalThis as unknown as {window:unknown}).window=oldWindow;}
