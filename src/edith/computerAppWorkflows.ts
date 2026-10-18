import {ownerMutationFetch} from './ownerMutationClient';
import {actOnComputer,observeComputer,locateComputerFocusTarget,locateComputerGameTarget,assertComputerSessionActive,getComputerAppSnapshot,computerControlTarget,openComputerInstalledApp,setComputerAppVolume,exchangeComputerExplorer,prepareComputerExplorerTransport,reserveComputerWorkflow,releaseComputerWorkflow,getComputerExplorerText,computerTaskReference,readComputerTaskCompletion,type ComputerExplorerClaim,type ComputerControlState,type ComputerObservation,type ComputerDesktopAction} from './computerDesktopClient';
import type {CanonicalActionLifecycle} from './computerContractAdapter';
import {readComputerTaskState,registerComputerTaskSession,bindComputerTask,finishComputerTask,cancelComputerTask,type ComputerTaskReference} from './computerDesktopClient';

// Finite public diagnostic contract; unknown strings and messages stay redacted.
export const COMPUTER_APP_CANONICAL_ERROR_CODES=Object.freeze([
  'APP_FOCUS_UNVERIFIED',
  'APP_GAME_TARGET_UNSUPPORTED',
  'APP_INPUT_PARTIAL',
  'APP_PLAYBACK_STATE_UNSUPPORTED',
  'APP_PLAYBACK_UNVERIFIED',
  'APP_SEARCH_RESULTS_UNVERIFIED',
  'APP_SEARCH_VALUE_UNVERIFIED',
  'APP_TARGET_AMBIGUOUS',
  'APP_TARGET_UNSUPPORTED',
  'APP_TASK_BINDING_INVALID',
  'APP_TASK_CREATE_REJECTED',
  'APP_TASK_NOT_COMPLETED',
  'APP_TASK_PROOF_UNAVAILABLE',
  'APP_TASK_READBACK_REJECTED',
  'APP_TASK_REQUIRED_PROOF_UNVERIFIED',
  'APP_TASK_SESSION_INVALID',
  'APP_VOLUME_UNVERIFIED',
  'APP_WINDOW_CHANGED',
  'APP_WORKFLOW_EXPIRED',
  'APP_WORKFLOW_IDEMPOTENCY_CONFLICT',
  'APP_WORKFLOW_IDENTITY_INVALID',
  'APP_WORKFLOW_INVALID',
  'APP_WORKFLOW_LEDGER_FULL',
  'APP_WORKFLOW_RESERVATION_INVALID',
  'APP_WORKFLOW_RESOURCE_BUSY',
  'APP_WORKFLOW_UNVERIFIED',
  'EXPLORER_APPROVED_TEXT_CHANGED',
  'EXPLORER_APPROVED_TEXT_INVALID',
  'EXPLORER_CLAIM_INVALID',
  'EXPLORER_DESTINATION_CONFLICT',
  'EXPLORER_DESTINATION_INVALID',
  'EXPLORER_EFFECT_UNVERIFIED',
  'EXPLORER_FINAL_PROOF_CHANGED',
  'EXPLORER_OVERWRITE_BLOCKED',
  'EXPLORER_PLAN_INVALID',
  'EXPLORER_PLAN_REJECTED',
  'EXPLORER_POLL_BUDGET_EXHAUSTED',
  'EXPLORER_PRIOR_EFFECT_UNVERIFIED',
  'EXPLORER_QUARANTINE_CONFLICT',
  'EXPLORER_QUARANTINE_REQUIRED',
  'EXPLORER_SELECTION_AMBIGUOUS',
  'EXPLORER_SOURCE_INVALID',
  'FILES_NATIVE_UNAVAILABLE',
  'KILL_SWITCH_ACTIVE',
  'NATIVE_ACTION_RECEIPT_INVALID',
  'NATIVE_ACTION_REPLAY_OR_LIMIT',
  'NATIVE_BINDING_CLOSED',
  'NATIVE_BINDING_EXPIRED',
  'NATIVE_BINDING_INPUT_INVALID',
  'NATIVE_BINDING_LIMIT',
  'NATIVE_BINDING_NOT_FOUND',
  'NATIVE_BINDING_REVOKED',
  'NATIVE_CONTEXT_EXPIRED',
  'NATIVE_CONTEXT_INVALID',
  'NATIVE_DISPATCH_FAILED',
  'NATIVE_DISPATCH_INCOMPLETE',
  'NATIVE_EXPLORER_PLAN_REQUIRED',
  'NATIVE_FIND_LEDGER_REQUIRED',
  'NATIVE_GAME_NAVIGATION_ACTION_INVALID',
  'NATIVE_GAME_NAVIGATION_DISPATCH_MISMATCH',
  'NATIVE_IDEMPOTENCY_CONFLICT',
  'NATIVE_IDEMPOTENCY_REQUIRED',
  'NATIVE_LEDGER_INCOMPLETE',
  'NATIVE_OBSERVATION_REPLAY',
  'NATIVE_OPERATION_ASSOCIATION_INVALID',
  'NATIVE_OPERATION_ASSOCIATION_REPLAY',
  'NATIVE_OPERATION_BINDING_REQUIRED',
  'NATIVE_OPERATION_CONFLICT',
  'NATIVE_OPERATION_UNVERIFIED',
  'NATIVE_OWNER_EXPIRED',
  'NATIVE_OWNER_INVALID',
  'NATIVE_POSTSTATE_INVALID',
  'NATIVE_POSTSTATE_STALE',
  'NATIVE_REQUIRED_POSTCONDITION_FAILED',
  'NATIVE_RESERVATION_ALREADY_BOUND',
  'NATIVE_RESERVATION_PRESTATE_INVALID',
  'NATIVE_SAFETY_AUTHORITY_UNAVAILABLE',
  'NATIVE_SAFETY_MEMBERSHIP_CHANGED',
  'NATIVE_SAFETY_MEMBERSHIP_INVALID',
  'NATIVE_SAFETY_MEMBERSHIP_LOST',
  'NATIVE_SAFETY_OWNER_INVALID',
  'NATIVE_SAFETY_SESSION_AMBIGUOUS',
  'NATIVE_SAFETY_SESSION_UNAVAILABLE',
  'NATIVE_SAFETY_TRANSPORT_UNKNOWN',
  'NATIVE_SESSION_APPLICATION_MISMATCH',
  'NATIVE_SESSION_CONCURRENT_RESERVATION',
  'NATIVE_SESSION_CONFIGURATION_REQUIRED',
  'NATIVE_SESSION_CONFLICT',
  'NATIVE_SESSION_EXPIRED',
  'NATIVE_SESSION_INVALID',
  'NATIVE_SESSION_LIMIT',
  'NATIVE_SKIP_ACTION_INVALID',
  'NATIVE_SKIP_DISPATCH_MISMATCH',
  'NATIVE_STEAM_FINAL_PROFILE_INVALID',
  'NATIVE_STEAM_PROFILE_APPROVAL_LOST',
  'NATIVE_STEAM_PROFILE_CHANGED',
  'NATIVE_STEAM_PROFILE_PIN_REQUIRED',
  'NATIVE_STEAM_PROFILE_UNAPPROVED',
  'NATIVE_STOP_CAPACITY',
  'NATIVE_STOP_EXPIRED',
  'NATIVE_STOP_IDEMPOTENCY_CONFLICT',
  'NATIVE_STOP_INPUT_INVALID',
  'NATIVE_STOP_NOT_FOUND',
  'NATIVE_STOP_OWNER_INVALID',
  'NATIVE_STOP_OWNER_UNAVAILABLE',
  'NATIVE_STOP_PHASE_INVALID',
  'NATIVE_STOP_PHASE_REGRESSION',
  'NATIVE_STOP_RECEIPT_CONFLICT',
  'NATIVE_STOP_REQUEST_UNAVAILABLE',
  'NATIVE_STOP_SCOPE_INVALID',
  'NATIVE_STOP_SCOPE_UNAVAILABLE',
  'NATIVE_STOP_SESSION_ALREADY_ACTIVE',
  'NATIVE_STOP_SESSION_ALREADY_REGISTERED',
  'NATIVE_STOP_TIME_INVALID',
  'NATIVE_TARGET_BINDING_INVALID',
  'NATIVE_WORKFLOW_INVALID',
  'OWNER_REVOKED',
  'OWNER_SESSION_REQUIRED',
] as const);
const canonicalComputerAppErrors:ReadonlySet<string>=new Set(COMPUTER_APP_CANONICAL_ERROR_CODES);
export function computerAppCanonicalError(error:unknown,fallback:'APP_WORKFLOW_UNVERIFIED'|'EXPLORER_EFFECT_UNVERIFIED'='APP_WORKFLOW_UNVERIFIED'):string{
  try{const value=error instanceof Error?error.message:typeof error==='string'?error:undefined;return typeof value==='string'&&value.length<=96&&canonicalComputerAppErrors.has(value)?value:fallback;}catch{return fallback;}
}

export type ComputerAppWorkflowRequest =
  | {app:'spotify';workflow:'open'|'focus'|'play'|'pause'|'next'|'previous'|'library'}
  | {app:'spotify';workflow:'search';query:string}
  | {app:'spotify';workflow:'volume';volume:number}
  | {app:'steam';workflow:'open'|'focus'|'library'|'downloads'}
  | {app:'steam';workflow:'search';query:string}
  | {app:'steam';workflow:'game_detail';gameName:string}
  | {app:'explorer';workflow:'find';sourceFileId:string}
  | {app:'explorer';workflow:'copy'|'move';sourceFileId:string;destinationDirectoryId:string}
  | {app:'explorer';workflow:'undo';undoReceiptId:string};
export interface ComputerAppWorkflowIdentity {workflowId?:string;idempotencyKey?:string}
export interface ComputerAppWorkflowResult {
  workflowId:string;app:ComputerAppWorkflowRequest['app'];workflow:ComputerAppWorkflowRequest['workflow'];
  status:'verified'|'partial'|'blocked';source:'default_native_orchestrator';physicalAcceptance:false;
  taskBinding:'unbound'|'registered';taskId?:string;bindingId?:string;taskState?:string;
  steps:CanonicalActionLifecycle[];errorCode?:string;
  effectReceipt?:{source:'native_uia_state'|'installed_app_operator'|'independent_filesystem_readback';postObservationId?:string;windowId?:string;processId?:number;imagePathFingerprint?:string;queryFingerprint?:string;stateFingerprint?:string;itemCount?:number;requestedVolume?:number;observedVolume?:number;operationId?:string;undoReceiptId?:string};
  semanticDispatches?:Array<{source:'semantic_range_pattern';targetId:string;requestedVolume:number;observedValue:number;minimum:number;maximum:number;matched:boolean}>;
}

// Approved text originates only in the native retained claim. It remains transient;
// canonical typeText steps carry only length and digest through the adapter.
export async function executeClaimedComputerExplorer(sessionId:string,claim:ComputerExplorerClaim,reservationId:string):Promise<ComputerAppWorkflowResult>{
  const prefix=`explorer-${claim.operationId}`;
  const result:ComputerAppWorkflowResult={workflowId:prefix,app:'explorer',workflow:claim.operation,status:'partial',source:'default_native_orchestrator',physicalAcceptance:false,taskBinding:'registered',...computerTaskReference(claim),steps:[]};
  let step=0;
  const guard=()=>{assertComputerSessionActive(sessionId);if(Date.now()>=claim.expiresAt)throw new Error('APP_WORKFLOW_EXPIRED');};
  const normalizedPath=(value:string)=>value.replace(/\//g,'\\').replace(/\\+$/,'').toLocaleLowerCase('en-US');
  try{
    guard();
    const approved=async(intent:Parameters<typeof getComputerExplorerText>[3])=>{const text=await getComputerExplorerText(sessionId,reservationId,claim.operationId,intent);guard();return text;};
    const source={directory:await approved('source_parent'),name:await approved('source_name')};
    if(source.name!==claim.sourceName||await fingerprint(normalizedPath(source.directory))!==claim.sourceParentFingerprint)throw new Error('EXPLORER_SOURCE_INVALID');
    const destination=claim.operation==='find'?undefined:{directory:await approved('destination_parent'),name:source.name};
    if(destination&&await fingerprint(normalizedPath(destination.directory))!==claim.destinationParentFingerprint)throw new Error('EXPLORER_DESTINATION_INVALID');
    if(claim.operation==='undo'&&claim.reverseOf==='copy'&&!claim.quarantine)throw new Error('EXPLORER_QUARANTINE_REQUIRED');
    await openComputerInstalledApp(sessionId,'explorer',`${prefix}-open`,`${prefix}-open`,new Date(claim.expiresAt).toISOString(),reservationId);guard();
    await observeComputer(sessionId,reservationId);guard();
    const focus=await locateComputerFocusTarget(sessionId,'explorer',reservationId);guard();
    const act=async(action:ComputerDesktopAction)=>{guard();const id=`${prefix}-${++step}`;const receipt=await actOnComputer(sessionId,{...action,actionId:id,idempotencyKey:id},reservationId);
      if(receipt.canonicalLifecycle)result.steps.push(receipt.canonicalLifecycle);guard();
      if(receipt.dispatchStatus!=='dispatched'||receipt.partialInputInjected)throw new Error('APP_INPUT_PARTIAL');return receipt;};
    const focused=await act({action:'focusApp',applicationId:'explorer',focusTarget:focus});
    if(focused.verificationStatus!=='verified')throw new Error('APP_FOCUS_UNVERIFIED');
    const fresh=async()=>{const observation=await observeComputer(sessionId,reservationId);guard();sameAppObservation(observation,focus);const state=await getComputerAppSnapshot(sessionId,reservationId);guard();
      if(state.some(c=>[50000,50020].includes(c.controlType)&&/^(?:replace|overwrite|replace the file|dosyayı değiştir|üzerine yaz)$/i.test(c.name.trim())))throw new Error('EXPLORER_OVERWRITE_BLOCKED');return {observation,state};};
    const folder=async(directory:string)=>{const post=await fresh();unique(post.state,c=>c.controlType===50004&&['address','adres','address bar','adres çubuğu'].includes(normalize(c.name))&&c.value!==null&&normalizedPath(c.value)===normalizedPath(directory));return post;};
    const navigate=async(directory:string,intent:'source_parent'|'destination_parent'|'quarantine_parent')=>{
      // First prove an actual address control exists before the allowlisted shortcut.
      const pre=await fresh();unique(pre.state,c=>c.controlType===50004&&['address','adres','address bar','adres çubuğu'].includes(normalize(c.name))&&c.value!==null);
      await act({action:'hotkey',keys:['CTRL','L']});await act({action:'hotkey',keys:['CTRL','A']});
      const text=await approved(intent);if(text!==directory)throw new Error('EXPLORER_APPROVED_TEXT_CHANGED');
      await act({action:'typeText',text});await act({action:'pressKey',key:'ENTER'});await folder(directory);
    };
    if(claim.quarantine){
      const parent=await approved('quarantine_parent'),name=await approved('quarantine_name');await navigate(parent,'quarantine_parent');
      const pre=await folder(parent);if(pre.state.some(c=>[50007,50029].includes(c.controlType)&&c.name===name))throw new Error('EXPLORER_QUARANTINE_CONFLICT');
      await act({action:'hotkey',keys:['CTRL','SHIFT','N']});
      const editing=await fresh();unique(editing.state,c=>c.controlType===50004&&['filename','file name','name','ad','dosya adı'].includes(normalize(c.name))&&c.value!==null);
      const issuedName=await approved('quarantine_name');if(issuedName!==name)throw new Error('EXPLORER_APPROVED_TEXT_CHANGED');
      await act({action:'typeText',text:issuedName});await act({action:'pressKey',key:'ENTER'});
      const created=await folder(parent);unique(created.state,c=>[50007,50029].includes(c.controlType)&&c.name===name);
      await exchangeComputerExplorer(sessionId,claim.operationId,'quarantine',reservationId);guard();
    }
    await navigate(source.directory,'source_parent');const pre=await folder(source.directory);
    const file=unique(pre.state,c=>[50007,50029].includes(c.controlType)&&c.name===source.name&&c.selected!==null);
    await act({action:'clickMouse',x:file.x+Math.floor(file.width/2),y:file.y+Math.floor(file.height/2),target:computerControlTarget(sessionId,file)});
    const selected=await folder(source.directory);unique(selected.state,c=>[50007,50029].includes(c.controlType)&&c.name===source.name&&c.selected===true);
    if(selected.state.filter(c=>[50007,50029].includes(c.controlType)&&c.selected===true).length!==1)throw new Error('EXPLORER_SELECTION_AMBIGUOUS');
    if(claim.operation==='find'){
      await exchangeComputerExplorer(sessionId,claim.operationId,'finish',reservationId);guard();
      Object.assign(result,await readComputerTaskCompletion(sessionId,computerTaskReference(claim)));guard();
      result.status='verified';result.effectReceipt={source:'native_uia_state',operationId:claim.operationId,postObservationId:selected.observation.observationId,windowId:focus.windowId,processId:focus.processId,imagePathFingerprint:focus.imagePathFingerprint};return result;
    }
    if(!destination)throw new Error('EXPLORER_DESTINATION_INVALID');
    await act({action:'hotkey',keys:['CTRL',claim.operation==='copy'?'C':'X']});
    await navigate(destination.directory,'destination_parent');const absent=await folder(destination.directory);
    if(absent.state.some(c=>[50007,50029].includes(c.controlType)&&c.name===destination.name))throw new Error('EXPLORER_DESTINATION_CONFLICT');
    await act({action:'hotkey',keys:['CTRL','V']});
    const post=await folder(destination.directory);unique(post.state,c=>[50007,50029].includes(c.controlType)&&c.name===destination.name&&c.selected===true);
    if(post.state.filter(c=>[50007,50029].includes(c.controlType)&&c.selected===true).length!==1)throw new Error('EXPLORER_SELECTION_AMBIGUOUS');
    const payload=await exchangeComputerExplorer(sessionId,claim.operationId,'readback',reservationId);guard();
    const readback=payload.readback as {source:null|{contentSha256:string};destination:null|{identity:string;contentSha256:string}}|undefined;
    if(!readback?.destination||!/^[a-f0-9]{64}$/i.test(readback.destination.identity)||(claim.operation==='copy'?!readback.source||readback.source.contentSha256!==readback.destination.contentSha256:readback.source!==null))throw new Error('EXPLORER_EFFECT_UNVERIFIED');
    await exchangeComputerExplorer(sessionId,claim.operationId,'finish',reservationId);guard();
    Object.assign(result,await readComputerTaskCompletion(sessionId,computerTaskReference(claim)));guard();
    result.status='verified';result.effectReceipt={source:'independent_filesystem_readback',operationId:claim.operationId,postObservationId:post.observation.observationId,windowId:focus.windowId,processId:focus.processId,imagePathFingerprint:focus.imagePathFingerprint};return result;
  }catch(error){
    result.errorCode=computerAppCanonicalError(error,'EXPLORER_EFFECT_UNVERIFIED');
    result.status=result.steps.length?'partial':'blocked';
    try{await exchangeComputerExplorer(sessionId,claim.operationId,'cancel',reservationId);}catch{/* Native/backend TTL independently cancels stale authority. */}
    try{await cancelComputerTask(sessionId,reservationId,computerTaskReference(claim));}catch{
      try{await ownerMutationFetch(`/api/computer-use/workflows/${encodeURIComponent(claim.bindingId)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{/* Owner invalidation/kill/expiry independently revokes the task. */}
    }
    try{Object.assign(result,await readComputerTaskState(sessionId,computerTaskReference(claim)));}catch{/* Stopped sessions cannot read or regain authority. */}
    return result;
  }
}
const ledger=new Map<string,{binding:string;expiresAt:number;result:Promise<ComputerAppWorkflowResult>}>();
const safeId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(v);
const safeWorkflowId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(v);
export function validateComputerAppWorkflow(value:unknown):value is ComputerAppWorkflowRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>,base=['app','workflow'];
  let extra:string[]=[];
  if(row.app==='spotify'&&['open','focus','play','pause','next','previous','library'].includes(String(row.workflow))){}
  else if(row.app==='steam'&&['open','focus','library','downloads'].includes(String(row.workflow))){}
  else if(row.app==='steam'&&row.workflow==='game_detail'){
    extra=['gameName'];
    if(typeof row.gameName!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(row.gameName))return false;
    const scalars=Array.from(row.gameName);
    if(!scalars.length||scalars.length>160||scalars.some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff))return false;
    const trimmed=row.gameName.trim(),encoder=new TextEncoder();
    if(!trimmed||Array.from(trimmed).length>160||encoder.encode(row.gameName).length>640||encoder.encode(trimmed).length>640)return false;
  }
  else if(['spotify','steam'].includes(String(row.app))&&row.workflow==='search'){extra=['query'];if(typeof row.query!=='string'||!row.query.trim()||Array.from(row.query).length>160||/[\u0000-\u001f\u007f]/.test(row.query))return false;}
  else if(row.app==='spotify'&&row.workflow==='volume'){extra=['volume'];if(!Number.isSafeInteger(row.volume)||Number(row.volume)<0||Number(row.volume)>100)return false;}
  else if(row.app==='explorer'&&row.workflow==='find'){extra=['sourceFileId'];if(!safeId(row.sourceFileId))return false;}
  else if(row.app==='explorer'&&['copy','move'].includes(String(row.workflow))){extra=['sourceFileId','destinationDirectoryId'];if(!safeId(row.sourceFileId)||!safeId(row.destinationDirectoryId))return false;}
  else if(row.app==='explorer'&&row.workflow==='undo'){extra=['undoReceiptId'];if(!safeId(row.undoReceiptId))return false;}
  else return false;
  return Object.keys(row).every(key=>[...base,...extra].includes(key));
}
async function fingerprint(value:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const normalize=(v:string)=>v.normalize('NFKC').trim().toLocaleLowerCase('tr-TR');
function unique(controls:ComputerControlState[],predicate:(c:ComputerControlState)=>boolean):ComputerControlState{
  const found=controls.filter(predicate);if(found.length!==1)throw new Error(found.length?'APP_TARGET_AMBIGUOUS':'APP_TARGET_UNSUPPORTED');return found[0];
}
const labels={play:['play','oynat'],pause:['pause','duraklat'],next:['next','sonraki'],previous:['previous','önceki'],search:['search','ara'],library:['your library','library','kitaplığın','kitaplık','kütüphane'],downloads:['downloads','indirmeler'],volume:['volume','ses düzeyi','ses seviyesi']};
function named(c:ComputerControlState,names:readonly string[]){return names.includes(normalize(c.name));}
function playback(controls:ComputerControlState[]):'playing'|'paused'|undefined{
  const playing=controls.filter(c=>c.controlType===50000&&named(c,labels.pause));
  const paused=controls.filter(c=>c.controlType===50000&&named(c,labels.play));
  return playing.length===1&&paused.length===0?'playing':paused.length===1&&playing.length===0?'paused':undefined;
}
function track(controls:ComputerControlState[]):string{
  return unique(controls,c=>c.controlType===50020&&['now-playing-title','track-title','song-title'].includes(c.automationId)&&Boolean(c.name.trim())).name;
}
function view(controls:ComputerControlState[],kind:'library'|'downloads'):ComputerControlState{
  const ids=kind==='library'?['library-view','library-list','games-list']:['downloads-view','downloads-list'];
  return unique(controls,c=>[50008,50026,50033].includes(c.controlType)&&ids.includes(c.automationId));
}
function sameAppObservation(observation:ComputerObservation,focus:{windowId:string;processId:number}){
  if(observation.windowId!==focus.windowId||observation.windowProcessId!==focus.processId)throw new Error('APP_WINDOW_CHANGED');
}

export async function runDefaultComputerAppWorkflow(sessionId:string,request:ComputerAppWorkflowRequest,identity:ComputerAppWorkflowIdentity={}):Promise<ComputerAppWorkflowResult>{
  if(!validateComputerAppWorkflow(request))throw new Error('APP_WORKFLOW_INVALID');
  const sessionExpiry=assertComputerSessionActive(sessionId);
  const workflowId=identity.workflowId??`workflow-${crypto.randomUUID()}`,key=identity.idempotencyKey??workflowId;
  if(!safeWorkflowId(workflowId)||!safeWorkflowId(key)||Object.keys(identity).some(k=>!['workflowId','idempotencyKey'].includes(k)))throw new Error('APP_WORKFLOW_IDENTITY_INVALID');
  const binding=await fingerprint(JSON.stringify({request,workflowId:identity.workflowId})),ledgerKey=`${sessionId}:${key}`;
  assertComputerSessionActive(sessionId);
  for(const [id,row]of ledger)if(row.expiresAt<=Date.now())ledger.delete(id);
  const old=ledger.get(ledgerKey);if(old){if(old.binding!==binding)throw new Error('APP_WORKFLOW_IDEMPOTENCY_CONFLICT');return old.result;}
  if(ledger.size>=64)throw new Error('APP_WORKFLOW_LEDGER_FULL');
  const result=execute(sessionId,request,workflowId,key,Math.min(sessionExpiry,Date.now()+30_000));
  ledger.set(ledgerKey,{binding,expiresAt:sessionExpiry,result});return result;
}
async function execute(sessionId:string,request:ComputerAppWorkflowRequest,workflowId:string,key:string,expiresAt:number):Promise<ComputerAppWorkflowResult>{
  const result:ComputerAppWorkflowResult={workflowId,app:request.app,workflow:request.workflow,status:'partial',source:'default_native_orchestrator',physicalAcceptance:false,taskBinding:'unbound',steps:[]};
  const guard=()=>{assertComputerSessionActive(sessionId);if(Date.now()>=expiresAt)throw new Error('APP_WORKFLOW_EXPIRED');};
  let step=0;
  let reserved=false;
  let mutationAttempted=false;
  let explorerPlan:{route:string;operationId:string}|undefined;
  let task:ComputerTaskReference|undefined;
  try{
    guard();
    if(request.app==='explorer'){
      await prepareComputerExplorerTransport(sessionId,expiresAt);guard();
      const route=request.workflow==='find'?'/api/files/explorer/find-plans':'/api/files/explorer/plans';
      const body=request.workflow==='find'?{sourceFileId:request.sourceFileId}:request.workflow==='undo'?{operation:'undo',undoReceiptId:request.undoReceiptId}:{operation:request.workflow,sourceFileId:request.sourceFileId,destinationDirectoryId:request.destinationDirectoryId};
      const proposal=await ownerMutationFetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key},body:JSON.stringify(body)});guard();
      if(!proposal.ok)throw new Error('EXPLORER_PLAN_REJECTED');
      const plan=await proposal.json() as {plan?:{operationId?:string};operationId?:string};guard();
      const operationId=plan.plan?.operationId??plan.operationId;if(!safeId(operationId))throw new Error('EXPLORER_PLAN_INVALID');
      const reference=computerTaskReference(plan);Object.assign(result,reference,{taskBinding:'registered'});
      explorerPlan={route,operationId};
      mutationAttempted=true;
      const response=await ownerMutationFetch(`${route}/${encodeURIComponent(operationId)}/execute`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});guard();
      if(!response.ok)throw new Error('EXPLORER_EFFECT_UNVERIFIED');
      const payload=await response.json() as {plan?:Record<string,unknown>}&Record<string,unknown>,verified=payload.plan??payload;
      if(verified.state!=='verified'||request.workflow!=='find'&&(verified.completed!==true||verified.verification!=='independent_filesystem_readback')||verified.operationId!==operationId)throw new Error('EXPLORER_EFFECT_UNVERIFIED');
      const returned=computerTaskReference(payload);if(returned.taskId!==reference.taskId||returned.bindingId!==reference.bindingId)throw new Error('APP_TASK_BINDING_INVALID');
      Object.assign(result,await readComputerTaskCompletion(sessionId,reference));guard();
      result.effectReceipt={source:request.workflow==='find'?'native_uia_state':'independent_filesystem_readback',operationId,undoReceiptId:typeof verified.undoReceiptId==='string'&&safeId(verified.undoReceiptId)?verified.undoReceiptId:undefined};result.status='verified';return result;
    }
    await reserveComputerWorkflow(sessionId,workflowId,new Date(expiresAt).toISOString());reserved=true;guard();
    await registerComputerTaskSession(sessionId,workflowId,request);guard();
    const created=await ownerMutationFetch('/api/computer-use/workflows',{method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':key},body:JSON.stringify({workflowId,sessionId,request})});guard();
    if(!created.ok)throw new Error('APP_TASK_CREATE_REJECTED');
    const binding=await created.json();guard();task=computerTaskReference(binding);
    if(binding.success!==true||binding.workflowId!==workflowId||binding.taskBinding!=='registered'||binding.physicalAcceptance!==false)throw new Error('APP_TASK_BINDING_INVALID');
    Object.assign(result,task,{taskBinding:'registered'});
    task=await bindComputerTask(sessionId,workflowId,task);guard();Object.assign(result,task);
    const complete=async()=>{guard();Object.assign(result,await finishComputerTask(sessionId,workflowId,task!));guard();result.status='verified';return result;};
    mutationAttempted=true;
    await openComputerInstalledApp(sessionId,request.app,`${workflowId}-open`,`${key}-open`,new Date(expiresAt).toISOString(),workflowId);guard();
    await observeComputer(sessionId,workflowId);guard();
    const focus=await locateComputerFocusTarget(sessionId,request.app,workflowId);guard();
    const focused=await actOnComputer(sessionId,{action:'focusApp',applicationId:request.app,focusTarget:focus,actionId:`${workflowId}-focus`,idempotencyKey:`${key}-focus`},workflowId);guard();
    if(focused.canonicalLifecycle)result.steps.push(focused.canonicalLifecycle);
    if(focused.verificationStatus!=='verified')throw new Error('APP_FOCUS_UNVERIFIED');
    if(request.workflow==='open'||request.workflow==='focus'){
      result.effectReceipt={source:'installed_app_operator',postObservationId:focused.postObservationId,windowId:focus.windowId,processId:focus.processId,imagePathFingerprint:focus.imagePathFingerprint};return await complete();
    }
    if(request.workflow==='game_detail'){
      // Native admits the approved pre-library context before resolving the
      // bound intent. This path never requests the generic control snapshot.
      const observation=await observeComputer(sessionId,workflowId);guard();sameAppObservation(observation,focus);
      const target=await locateComputerGameTarget(sessionId,workflowId);guard();
      const bounds=target.physicalBounds;
      const action=await actOnComputer(sessionId,{action:'clickMouse',button:'left',attempt:1,x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.height/2),target,actionId:`${workflowId}-step-${++step}`,idempotencyKey:`${key}-step-${step}`},workflowId);guard();
      if(action.canonicalLifecycle)result.steps.push(action.canonicalLifecycle);
      if(action.dispatchStatus!=='dispatched'||action.partialInputInjected===true)throw new Error('APP_INPUT_PARTIAL');
      // Native validates fresh selected-entry/detail evidence and final scope;
      // complete still requires the actual canonical task readback.
      return await complete();
    }
    let before=await observeComputer(sessionId,workflowId);guard();sameAppObservation(before,focus);
    let controls=await getComputerAppSnapshot(sessionId,workflowId);guard();
    const click=async(control:ComputerControlState)=>{
      guard();const target=computerControlTarget(sessionId,control);
      const action=await actOnComputer(sessionId,{action:'clickMouse',x:control.x+Math.floor(control.width/2),y:control.y+Math.floor(control.height/2),target,actionId:`${workflowId}-step-${++step}`,idempotencyKey:`${key}-step-${step}`},workflowId);guard();
      if(action.canonicalLifecycle)result.steps.push(action.canonicalLifecycle);
      if(action.dispatchStatus!=='dispatched'||action.partialInputInjected===true)throw new Error('APP_INPUT_PARTIAL');
    };
    const fresh=async()=>{const observation=await observeComputer(sessionId,workflowId);guard();sameAppObservation(observation,focus);const state=await getComputerAppSnapshot(sessionId,workflowId);guard();return {observation,state};};
    let stateFingerprint:string|undefined,queryFingerprint:string|undefined,itemCount:number|undefined,requestedVolume:number|undefined,observedVolume:number|undefined;
    if(request.workflow==='volume'){
      const slider=unique(controls,c=>c.controlType===50015&&named(c,labels.volume)&&c.rangeValue!==null&&c.rangeMin!==null&&c.rangeMax!==null);
      const receipt=await setComputerAppVolume(sessionId,slider.targetId,request.volume,`${workflowId}-volume`,`${key}-volume`,new Date(expiresAt).toISOString(),workflowId);guard();
      result.semanticDispatches=[receipt];if(receipt.source!=='semantic_range_pattern'||!receipt.matched||receipt.requestedVolume!==request.volume)throw new Error('APP_VOLUME_UNVERIFIED');
      const post=await fresh();before=post.observation;const actual=unique(post.state,c=>c.controlType===50015&&named(c,labels.volume)&&c.rangeValue!==null&&c.rangeMin!==null&&c.rangeMax!==null);
      observedVolume=100*(actual.rangeValue!-actual.rangeMin!)/(actual.rangeMax!-actual.rangeMin!);requestedVolume=request.volume;
      if(!Number.isFinite(observedVolume)||Math.abs(observedVolume-request.volume)>0.001)throw new Error('APP_VOLUME_UNVERIFIED');stateFingerprint=await fingerprint(JSON.stringify({volume:observedVolume}));
    }else if(request.workflow==='search'){
      const input=unique(controls,c=>c.controlType===50004&&named(c,labels.search)&&c.value!==null);
      await click(input);
      let action=await actOnComputer(sessionId,{action:'hotkey',keys:['CTRL','A'],actionId:`${workflowId}-step-${++step}`,idempotencyKey:`${key}-step-${step}`},workflowId);guard();if(action.canonicalLifecycle)result.steps.push(action.canonicalLifecycle);if(action.dispatchStatus!=='dispatched')throw new Error('APP_INPUT_PARTIAL');
      action=await actOnComputer(sessionId,{action:'typeText',text:request.query,actionId:`${workflowId}-step-${++step}`,idempotencyKey:`${key}-step-${step}`},workflowId);guard();if(action.canonicalLifecycle)result.steps.push(action.canonicalLifecycle);if(action.dispatchStatus!=='dispatched'||action.partialInputInjected)throw new Error('APP_INPUT_PARTIAL');
      const post=await fresh();before=post.observation;
      const value=unique(post.state,c=>c.controlType===50004&&named(c,labels.search)&&c.value!==null);if(value.value!==request.query)throw new Error('APP_SEARCH_VALUE_UNVERIFIED');
      const results=post.state.filter(c=>[50007,50029,50005].includes(c.controlType)&&normalize(c.name).includes(normalize(request.query)));if(!results.length)throw new Error('APP_SEARCH_RESULTS_UNVERIFIED');
      queryFingerprint=await fingerprint(request.query);itemCount=results.length;stateFingerprint=await fingerprint(JSON.stringify(results.map(c=>[c.automationId,c.controlType,c.name])));
    }else if(request.workflow==='library'||request.workflow==='downloads'){
      const kind=request.workflow;
      if(!controls.some(c=>[50008,50026,50033].includes(c.controlType)&&(kind==='library'?['library-view','library-list','games-list']:['downloads-view','downloads-list']).includes(c.automationId))){
        await click(unique(controls,c=>[50000,50019,50005].includes(c.controlType)&&named(c,labels[kind])));
      }
      const post=await fresh();before=post.observation;const actual=view(post.state,kind);
      const entries=post.state.filter(c=>[50007,50029].includes(c.controlType));itemCount=entries.length;stateFingerprint=await fingerprint(JSON.stringify({view:actual.automationId,items:entries.map(c=>[c.automationId,c.name,c.value,c.rangeValue])}));
    }else{
      const goal=request.workflow;
      const prePlayback=playback(controls);if(!prePlayback)throw new Error('APP_PLAYBACK_STATE_UNSUPPORTED');
      const preTrack=goal==='next'||goal==='previous'?track(controls):undefined;
      if(!((goal==='play'&&prePlayback==='playing')||(goal==='pause'&&prePlayback==='paused'))){await click(unique(controls,c=>c.controlType===50000&&named(c,labels[goal])));}
      const post=await fresh();before=post.observation;const actual=playback(post.state);
      if(!actual||(goal==='play'&&actual!=='playing')||(goal==='pause'&&actual!=='paused')||((goal==='next'||goal==='previous')&&track(post.state)===preTrack))throw new Error('APP_PLAYBACK_UNVERIFIED');
      stateFingerprint=await fingerprint(JSON.stringify({playback:actual,track:goal==='next'||goal==='previous'?track(post.state):undefined}));
    }
    guard();
    result.effectReceipt={source:'native_uia_state',postObservationId:before.observationId,windowId:focus.windowId,processId:focus.processId,imagePathFingerprint:focus.imagePathFingerprint,stateFingerprint,queryFingerprint,itemCount,requestedVolume,observedVolume};return await complete();
  }catch(error){
    result.errorCode=computerAppCanonicalError(error);
    result.status=mutationAttempted||result.steps.length||result.semanticDispatches?.length?'partial':'blocked';
    if(explorerPlan){
      try{await ownerMutationFetch(`${explorerPlan.route}/${encodeURIComponent(explorerPlan.operationId)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{/* Backend owner/expiry/kill guards independently invalidate unfinished work. */}
      try{Object.assign(result,await readComputerTaskState(sessionId,computerTaskReference(result)));}catch{/* No task state is inferred when the owner read is unavailable. */}
    }
    if(task){
      try{await cancelComputerTask(sessionId,workflowId,task);}catch{
        try{await ownerMutationFetch(`/api/computer-use/workflows/${encodeURIComponent(task.bindingId)}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{/* Backend independently revokes stale/partial authority. */}
      }
      try{Object.assign(result,await readComputerTaskState(sessionId,task));}catch{/* A revoked owner cannot regain authority through state readback. */}
    }
    return result;
  }finally{
    if(reserved)try{await releaseComputerWorkflow(sessionId,workflowId);}catch{/* Native stop/expiry clears the reservation independently. */}
  }
}
