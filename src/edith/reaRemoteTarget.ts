import {snapshotReaJson,ReaContractError,type ReaRemoteSelectionBinding,type ReaRemoteTarget} from './reaContract';
import path from 'node:path';
function fail(code='REA_REMOTE_SELECTION_INVALID'):never{throw new ReaContractError(code);}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\x00-\x20\x7f\\]/.test(v);
function object(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,any>;}
function exact(v:unknown,keys:readonly string[]):Record<string,any>{const o=object(v);if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail();return o;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function endpoint(v:unknown):string{
 if(!text(v))fail('REA_REMOTE_ENDPOINT_INVALID');const match=/^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/?$/.exec(v);
 if(!match||Number(match[2])>65535)fail('REA_REMOTE_ENDPOINT_INVALID');const parsed=new URL(v);
 if(parsed.port!==match[2]||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')fail('REA_REMOTE_ENDPOINT_INVALID');
 return `http://${match[1]}:${match[2]}`;
}
function publicSelectionUrl(v:unknown):string{
 if(!text(v)||v.includes('%')||v.includes('@'))fail('REA_REMOTE_URL_INVALID');let parsed:URL;try{parsed=new URL(v);}catch{fail('REA_REMOTE_URL_INVALID');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash)fail('REA_REMOTE_URL_INVALID');
 const host=parsed.hostname;if(!/^[a-z0-9.-]+$/.test(host)||!host.includes('.')||/^[0-9.]+$/.test(host)||host.includes('xn--')||/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host)||host.endsWith('.')||host.split('.').some(p=>!p||p.length>63||p.startsWith('-')||p.endsWith('-')))fail('REA_REMOTE_URL_INVALID');
 if(parsed.href!==v&&parsed.href!==v+'/')fail('REA_REMOTE_URL_INVALID');return parsed.href;
}
function origin(v:unknown):string{if(!text(v)||v.includes('%')||v.includes('@'))fail('REA_REMOTE_SCOPE_INVALID');let parsed:URL;try{parsed=new URL(v);}catch{fail('REA_REMOTE_SCOPE_INVALID');}if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==v||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)fail('REA_REMOTE_SCOPE_INVALID');return parsed.origin;}

/** Private metadata only: parsing never resolves DNS, opens a socket or reads selected files. */
export function createReaRemoteTarget(value:ReaRemoteSelectionBinding):ReaRemoteTarget{
 const binding=exact(snapshotReaJson(value),['profile','ownerId','workspaceId','taskId','runId','serverBootId','sessionId','qualificationRef','expiresAt','target','permission']);
 for(const key of ['ownerId','workspaceId','taskId','runId','serverBootId','sessionId','qualificationRef'])if(!id(binding[key]))fail();
 const admittedAt=Date.now();if(!Number.isSafeInteger(binding.expiresAt)||binding.expiresAt<=admittedAt||binding.expiresAt>admittedAt+120000)fail();
 const target=object(binding.target),permission=object(binding.permission);
 if(!Array.isArray(permission.actions)||permission.actions.length)fail('REA_REMOTE_ACTIONS_FORBIDDEN');
 if(binding.profile==='web'&&target.kind==='retained-har'){
  exact(target,['kind','workspaceRoot','absolutePath','sha256']);exact(permission,['kind','network','actions']);
  if(permission.kind!=='historical-capture'||permission.network!=='none'||typeof target.workspaceRoot!=='string'||typeof target.absolutePath!=='string'||!path.isAbsolute(target.workspaceRoot)||!path.isAbsolute(target.absolutePath)||path.extname(target.absolutePath).toLowerCase()!=='.har'||!/^([a-f0-9]{64})$/.test(target.sha256))fail('REA_REMOTE_SCOPE_INVALID');
  const relativePath=path.relative(target.workspaceRoot,target.absolutePath);if(!relativePath||relativePath==='..'||relativePath.startsWith('..'+path.sep)||path.isAbsolute(relativePath))fail('REA_REMOTE_SCOPE_INVALID');
 }else if(binding.profile==='web'&&target.kind==='web-url'){
  exact(target,['kind','url']);exact(permission,['kind','network','actions']);if(permission.kind!=='url-selection'||permission.network!=='public-url')fail('REA_REMOTE_SCOPE_INVALID');target.url=publicSelectionUrl(target.url);
 }else if(binding.profile==='electron-passive-runtime'&&target.kind==='electron-page'){
  exact(target,['kind','cdpEndpoint','targetId','expectedFilePath','observationMs']);exact(permission,['kind','network','endpointTargetMetadata','fileMetadata','actions']);
  if(permission.kind!=='passive-cdp'||permission.network!=='selected-cdp-only'||permission.endpointTargetMetadata!==true||permission.fileMetadata!==true||!Number.isSafeInteger(target.observationMs)||target.observationMs<0||target.observationMs>1000||typeof target.expectedFilePath!=='string'||!path.isAbsolute(target.expectedFilePath)||target.expectedFilePath.length>2048||/[\x00-\x1f\x7f]/.test(target.expectedFilePath))fail('REA_REMOTE_SCOPE_INVALID');
  target.cdpEndpoint=endpoint(target.cdpEndpoint);if(!id(target.targetId))fail('REA_REMOTE_SCOPE_INVALID');
 }else if(binding.profile==='runtime-observation'&&target.kind==='web-execution'){
  exact(target,['kind','cdpEndpoint','targetId','allowedOrigin','observationMs']);exact(permission,['kind','network','endpointTargetMetadata','resetsExecutionCounters','disablesOptimizedExecution','actions']);
  if(permission.kind!=='instrumented-cdp'||permission.network!=='selected-cdp-only'||permission.endpointTargetMetadata!==true||permission.resetsExecutionCounters!==true||permission.disablesOptimizedExecution!==true||!Number.isSafeInteger(target.observationMs)||target.observationMs<1||target.observationMs>1000)fail('REA_REMOTE_SCOPE_INVALID');
  target.cdpEndpoint=endpoint(target.cdpEndpoint);target.allowedOrigin=origin(target.allowedOrigin);if(!id(target.targetId))fail('REA_REMOTE_SCOPE_INVALID');
 }else fail('REA_REMOTE_SCOPE_INVALID');
 return freeze({binding:binding as ReaRemoteSelectionBinding,admittedAt});
}

export function assertReaRemoteTarget(target:ReaRemoteTarget,context:{ownerId:string;workspaceId:string;taskId:string;runId:string;serverBootId:string;sessionId?:string}):void{
 const binding=target.binding;if(binding.expiresAt<=Date.now())fail('REA_REMOTE_SELECTION_REVOKED');
 for(const key of ['ownerId','workspaceId','taskId','runId','serverBootId','sessionId'] as const)if(binding[key]!==context[key])fail('REA_REMOTE_SELECTION_FORBIDDEN');
}
