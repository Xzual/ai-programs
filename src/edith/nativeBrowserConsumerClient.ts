import type { BrowserWorkflowRequest } from './core';
import { parseBrowserWorkflowRequest, parseBrowserOperatorReceipt } from './browserOperatorContract';
import { isTauriShell, invokeDesktopCommand } from './desktopShell';
import { primeOwnerSession } from './ownerMutationClient';
import { assertComputerSessionActive, reserveComputerWorkflow, releaseComputerWorkflow } from './computerDesktopClient';
import { fetchTaskActivityV2, isVerifiedTaskSuccess } from './taskActivityClient';

export interface OriginalBrowserRequest { id:string; request:BrowserWorkflowRequest }
export interface NativeBrowserPending { success:true; pending:true; version:1; taskId:string; attemptLookupRef:string; operationLookupRef:string; status:'awaiting-native-confirmation' }
export interface NativeBrowserStatus { status:'unavailable'|'ready'|'denied'|'partial'|'unknown'|'complete'; reasonCode:string; logicalBatches:number; requestedEventCount:number; sentEventCount:number; cleanupRequestedCount:number; cleanupSentCount:number; possibleEffect:boolean }
export interface NativeBrowserConsumerResult { status:'verified'|'unverified'|'blocked'|'unknown'; provenance:'dom_only'|'native'|'none'; taskId?:string; canonicalStatus?:string; reasonCode:string; requiresStop:boolean }
export interface NativeBrowserConsumerOptions { requestId:string; signal:AbortSignal; onPending?:(ticket:NativeBrowserPending)=>void; onStatus?:(status:NativeBrowserStatus)=>void }
const claims=new Set<string>();
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(value);
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{22,160}$/.test(value);
function exact(value:Record<string,unknown>,keys:string[]){return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
export function parseNativeBrowserPending(value:unknown):NativeBrowserPending {
  if(!record(value)||!exact(value,['success','pending','version','taskId','attemptLookupRef','operationLookupRef','status'])||value.success!==true||value.pending!==true||value.version!==1||value.status!=='awaiting-native-confirmation'||!identifier(value.taskId)||!opaque(value.attemptLookupRef)||!opaque(value.operationLookupRef))throw Error('NATIVE_BROWSER_INVALID_TICKET');
  return {...value} as unknown as NativeBrowserPending;
}
export function parseNativeBrowserStatus(value:unknown):NativeBrowserStatus {
  const counts=['logicalBatches','requestedEventCount','sentEventCount','cleanupRequestedCount','cleanupSentCount'];
  if(!record(value)||!exact(value,['status','reasonCode',...counts,'possibleEffect'])||!['unavailable','ready','denied','partial','unknown','complete'].includes(String(value.status))||typeof value.reasonCode!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(value.reasonCode)||typeof value.possibleEffect!=='boolean'||!counts.every(key=>Number.isSafeInteger(value[key])&&Number(value[key])>=0)||Number(value.logicalBatches)>10||Number(value.requestedEventCount)>20400||Number(value.cleanupRequestedCount)>40||Number(value.sentEventCount)>Number(value.requestedEventCount)||Number(value.cleanupSentCount)>Number(value.cleanupRequestedCount))throw Error('NATIVE_BROWSER_INVALID_STATUS');
  return {...value} as unknown as NativeBrowserStatus;
}

/** One original admission. No mutation/auth/input retry; diagnostics are never proof. */
export async function runNativeBrowserRequest(sessionId:string,request:BrowserWorkflowRequest,options:NativeBrowserConsumerOptions):Promise<NativeBrowserConsumerResult> {
  let returned:NativeBrowserConsumerResult|undefined;
  const outcome=(status:NativeBrowserConsumerResult['status'],reasonCode:string,provenance:NativeBrowserConsumerResult['provenance']='none',canonicalStatus?:string):NativeBrowserConsumerResult=>(returned={status,reasonCode,provenance,taskId:ticket?.taskId??terminalTaskId,canonicalStatus,requiresStop:reserved&&!settled});
  let ticket:NativeBrowserPending|undefined,terminalTaskId:string|undefined,reserved=false,settled=false,admitted=false;
  if(!isTauriShell())return outcome('blocked','TAURI_REQUIRED');
  const parsed=parseBrowserWorkflowRequest(request);
  if(!parsed.success||parsed.value.action!=='search'||!identifier(options.requestId))return outcome('blocked','BROWSER_REQUEST_INVALID');
  if(claims.has(options.requestId))return outcome('blocked','BROWSER_REQUEST_ALREADY_CLAIMED');
  if(claims.size>=256)return outcome('blocked','BROWSER_REQUEST_CAPACITY');
  claims.add(options.requestId);
  const initialExpiry=assertComputerSessionActive(sessionId),deadline=performance.now()+30_000;
  const controller=new AbortController();
  const cancel=()=>controller.abort();options.signal.addEventListener('abort',cancel,{once:true});
  const guard=()=>{if(options.signal.aborted||controller.signal.aborted||performance.now()>=deadline||assertComputerSessionActive(sessionId)!==initialExpiry)throw Error('BROWSER_SCOPE_ENDED');};
  const bounded=async<T>(promise:Promise<T>):Promise<T>=>{
    guard();let timer:ReturnType<typeof setInterval>|undefined;
    const interrupted=new Promise<never>((_,reject)=>{timer=setInterval(()=>{try{guard();}catch{controller.abort();reject(Error('BROWSER_SCOPE_ENDED'));}},20);});
    try{const value=await Promise.race([promise,interrupted]);guard();return value;}finally{clearInterval(timer);}
  };
  const read=async(url:string,init:RequestInit={})=>{
    guard();const response=await bounded(fetch(url,{...init,credentials:'include',cache:'no-store',signal:controller.signal}));
    const body:unknown=await bounded(response.json());guard();return {response,body};
  };
  try {
    guard();const owner=await bounded(primeOwnerSession());guard();
    if(!owner)return outcome('blocked','OWNER_SESSION_REQUIRED');
    const currentOwner=async()=>{
      const current=await read('/api/security/session');
      if(!current.response.ok||!record(current.body)||!record(current.body.session)||current.body.session.csrfToken!==owner.csrfToken||current.body.session.createdAt!==owner.createdAt)throw Error('BROWSER_OWNER_CHANGED');
    };
    await currentOwner();guard();
    // primeOwnerSession is separate: the original protected POST is sent once.
    admitted=true;
    const original=await read('/api/edith/browser/workflows',{method:'POST',headers:{'Content-Type':'application/json','X-EDITH-CSRF-Token':owner.csrfToken},body:JSON.stringify(parsed.value)});
    admitted=true;
    let terminal:unknown=original.body;
    if(original.response.status===202){
      ticket=parseNativeBrowserPending(original.body);options.onPending?.(ticket);guard();
      const activity=await bounded(fetchTaskActivityV2(ticket.taskId,controller.signal));guard();
      if(activity.task.id!==ticket.taskId||activity.task.objective!==parsed.value.verificationGoal||activity.task.originalUserRequest!==parsed.value.verificationGoal||['COMPLETED','FAILED','CANCELLED','ROLLED_BACK','PAUSED'].includes(activity.task.status))throw Error('BROWSER_TASK_MISMATCH');
      await currentOwner();guard();
      reserved=true;await bounded(reserveComputerWorkflow(sessionId,ticket.taskId,new Date(Math.min(initialExpiry,Date.now()+Math.max(1,deadline-performance.now()))).toISOString()));guard();
      const resolve=parseNativeBrowserStatus(await bounded(invokeDesktopCommand('native_browser_resolve',{attempt_wire_ref:ticket.attemptLookupRef,local_session_ref:sessionId})));
      await currentOwner();options.onStatus?.(resolve);guard();
      if(resolve.status==='ready'&&resolve.logicalBatches===0){
        // Only a direct successful response can authorize its distinct retained next phase.
        let previous=resolve;
        for(let phase=0;phase<10;phase++){
          guard();
          try {
            const dispatch=parseNativeBrowserStatus(await bounded(invokeDesktopCommand('native_browser_dispatch',{operation_wire_ref:ticket.operationLookupRef})));
            await currentOwner();guard();options.onStatus?.(dispatch);guard();
            const sequenced=dispatch.logicalBatches===previous.logicalBatches+1&&dispatch.logicalBatches<=10
              &&dispatch.requestedEventCount>=previous.requestedEventCount&&dispatch.sentEventCount>=previous.sentEventCount
              &&dispatch.cleanupRequestedCount>=previous.cleanupRequestedCount&&dispatch.cleanupSentCount>=previous.cleanupSentCount;
            if(!sequenced||dispatch.status!=='ready')break;
            previous=dispatch;
          } catch {guard();break;/* Lost/malformed acknowledgement irreversibly ends dispatch. */}
        }
      }
      terminal=undefined;
      for(let round=0;round<100&&performance.now()<deadline;round++){
        await currentOwner();guard();
        try{const status=parseNativeBrowserStatus(await bounded(invokeDesktopCommand('native_browser_read_status',{operation_wire_ref:ticket.operationLookupRef})));options.onStatus?.(status);guard();}catch{guard();}
        const next=await read('/api/edith/browser/workflows/attempts/'+encodeURIComponent(ticket.attemptLookupRef));
        if(next.response.status===202){const same=parseNativeBrowserPending(next.body);if(JSON.stringify(same)!==JSON.stringify(ticket))throw Error('BROWSER_TICKET_CHANGED');}
        else if(next.response.status===200){terminal=next.body;break;}
        else throw Error('BROWSER_RESULT_UNAVAILABLE');
        await bounded(new Promise<void>(resolve=>setTimeout(resolve,200)));
      }
      if(!terminal)return outcome('unknown','BROWSER_RESULT_PENDING');
    } else if(!original.response.ok){return outcome('blocked','BROWSER_ADMISSION_DENIED');}
    if(!record(terminal)||typeof terminal.success!=='boolean'||!record(terminal.structuredOutput)||!identifier(terminal.structuredOutput.taskId))throw Error('BROWSER_RESULT_INVALID');
    terminalTaskId=terminal.structuredOutput.taskId;
    if(ticket&&terminalTaskId!==ticket.taskId)throw Error('BROWSER_TASK_MISMATCH');
    await currentOwner();guard();
    let activity=await bounded(fetchTaskActivityV2(terminalTaskId,controller.signal));guard();
    for(let round=0;round<20&&['QUEUED','RUNNING','VERIFYING'].includes(activity.task.status);round++){
      await bounded(new Promise<void>(resolve=>setTimeout(resolve,100)));await currentOwner();activity=await bounded(fetchTaskActivityV2(terminalTaskId,controller.signal));guard();
    }
    if(activity.task.id!==terminalTaskId||activity.task.originalUserRequest!==parsed.value.verificationGoal||activity.task.objective!==(ticket?parsed.value.verificationGoal:`Verify the actual ${parsed.value.action} DOM action predicate; native physical proof is absent.`))throw Error('BROWSER_TASK_MISMATCH');
    settled=['COMPLETED','FAILED','CANCELLED','ROLLED_BACK'].includes(activity.task.status);
    const receipt=parseBrowserOperatorReceipt(terminal.structuredOutput.browser);
    const provenance=ticket?'native':'dom_only';
    const required=ticket?['actual-owned-browser-postcondition','no-native-proof','native-counted-ledger','native-dom-pair']:['actual-owned-browser-postcondition','no-native-proof'];
    const proof=activity.task.verification;
    const canonical=isVerifiedTaskSuccess(activity.task)&&required.every(id=>proof?.checks.some(check=>check.id===id&&check.required&&check.status==='PASS'&&Boolean(check.evidence.trim())));
    const validReceipt=receipt.success&&receipt.value.action===parsed.value.action&&receipt.value.status==='verified'&&typeof terminal.auditEventId==='string'&&identifier(terminal.auditEventId)&&activity.events.some(event=>event.taskId===terminalTaskId&&event.type==='task.tool_completed'&&event.payload.runId===terminal.auditEventId&&event.payload.toolId==='browser_search'&&event.payload.outcome==='success')
      &&(ticket?receipt.value.inputProvenance==='native_input'&&receipt.value.nativePhysicalProof===true:receipt.value.inputProvenance==='dom_api'&&receipt.value.nativePhysicalProof===false);
    await currentOwner();guard();
    return outcome(terminal.success&&validReceipt&&canonical?'verified':'unverified',terminal.success&&validReceipt&&canonical?'REQUIRED_CHECKS_PASS':'BROWSER_PROOF_UNVERIFIED',provenance,activity.task.status);
  } catch {return outcome(admitted?'unknown':'blocked',options.signal.aborted?'BROWSER_STOPPED':'BROWSER_SCOPE_OR_RESULT_UNVERIFIED');}
  finally {
    controller.abort();options.signal.removeEventListener('abort',cancel);
    // Never release a live pending source before its terminal result/proof read.
    if(reserved&&settled&&ticket){
      let releaseTimer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([releaseComputerWorkflow(sessionId,ticket.taskId),new Promise<never>((_,reject)=>{releaseTimer=setTimeout(()=>reject(Error('BROWSER_RELEASE_UNCONFIRMED')),1000);})]);}
      catch{if(returned){returned.requiresStop=true;returned.status='unknown';returned.reasonCode='BROWSER_RELEASE_UNCONFIRMED';}}
      finally{clearTimeout(releaseTimer);}
    }
  }
}
