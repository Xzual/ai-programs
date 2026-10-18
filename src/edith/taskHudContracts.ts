export type SafeId = string; // ^[A-Za-z0-9._:-]{1,160}$, not an authority token
export interface PersistedTaskAdmissionV1 {
 taskId:SafeId; skillId:SafeId; revision:number; eventSequence:number; admittedAt:string;
}
/** Server-composition hook only, second dispatch argument; never transcript/client input. */
export interface TrustedVoiceDispatchHooksV1 {
 /** Trusted server composition only. Capture before create; bind before best-effort notification. */
 taskAdmission?:TrustedTaskHudAdmissionAuthorityV1;
 onTaskAdmitted?:(value:Readonly<PersistedTaskAdmissionV1>)=>void;
}
export interface TrustedTaskHudAdmissionContextV1 {
 ownerSessionBindingId:string;workspaceId:string;voiceSessionId:string;utteranceId:string;commandSequence:number;
}
/** Manager-owned closure rechecks captured generation, current owner, genuine workspace/target and kill policy.
 * Never sourced from transcript, request JSON or a client callback. No guessed sequence/workspace. */
export interface TrustedTaskHudAdmissionAuthorityV1 {
 assertCurrent:()=>Readonly<TrustedTaskHudAdmissionContextV1>;
}
export interface TaskHudBindingContextV1 {
 workspaceId:string;voiceSessionId:string;utteranceId:string;commandSequence:number;skillId:string;
}
export interface VoiceTaskAdmittedV1 extends PersistedTaskAdmissionV1 {
 schemaVersion:1; type:'skill:task_admitted'; generation:number; voiceSessionId:SafeId;
 utteranceId:SafeId; commandSequence:number;
}
export interface HudPresentationV1 {
 schemaVersion:1; type:'hud:presentation'; generation:number; voiceSessionId:SafeId;
 utteranceId:SafeId; commandSequence:number; action:'show_current'|'hide';
}
export interface TaskObservedMetricsV1 {
 schemaVersion:1; attempt:number; observedAt:string; clock:'adapter_receipt'|'tool_reported';
 source:'tool_result'; coverage:'complete'|'partial';
 scope:{kind:'tool_run';stepId?:SafeId;targetRefId?:SafeId}; evidenceRefs:SafeId[];
 values:Array<{name:string;unit:'count'|'byte'|'millisecond';value:number}>;
}

export const hudSafeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(v);
export const hudPositiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export const hudUtc = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const bytes = (v: unknown) => { try { return new TextEncoder().encode(JSON.stringify(v)).length; } catch { return Infinity; } };
export interface MetricRule { name: string; unit: 'count'|'byte'|'millisecond' }
/** Structural validation is public; approved producer mappings and evidence authority remain server-only. */
export function isTaskObservedMetricsV1(v: unknown, approved?: readonly MetricRule[]): v is TaskObservedMetricsV1 {
 if (!record(v) || !closed(v,['schemaVersion','attempt','observedAt','clock','source','coverage','scope','evidenceRefs','values']) || bytes(v)>8192
 || v.schemaVersion!==1 || !hudPositiveInteger(v.attempt) || !hudUtc(v.observedAt) || !['adapter_receipt','tool_reported'].includes(typeof v.clock==='string'?v.clock:'')
 || v.source!=='tool_result' || !['complete','partial'].includes(typeof v.coverage==='string'?v.coverage:'') || !record(v.scope)
 || !closed(v.scope,['kind','stepId','targetRefId']) || v.scope.kind!=='tool_run'
 || (v.scope.stepId!==undefined&&!hudSafeId(v.scope.stepId)) || (v.scope.targetRefId!==undefined&&!hudSafeId(v.scope.targetRefId))
 || !Array.isArray(v.evidenceRefs) || v.evidenceRefs.length<1 || v.evidenceRefs.length>8 || !v.evidenceRefs.every(hudSafeId)
 || new Set(v.evidenceRefs).size!==v.evidenceRefs.length || !Array.isArray(v.values) || v.values.length<1 || v.values.length>16) return false;
 const names=new Set<string>();
 return v.values.every(m=>{
  if(!record(m)||!closed(m,['name','unit','value'])||typeof m.name!=='string'||! /^[a-z][a-z0-9_.]{0,79}$/.test(m.name)||names.has(m.name)
   ||!['count','byte','millisecond'].includes(typeof m.unit==='string'?m.unit:'')||typeof m.value!=='number'||!Number.isFinite(m.value)||m.value<0||m.value>Number.MAX_SAFE_INTEGER
   ||(m.unit!=='millisecond'&&!Number.isSafeInteger(m.value))||approved&&!approved.some(r=>r.name===m.name&&r.unit===m.unit))return false;
  names.add(m.name);return true;
 });
}
export function isVoiceTaskAdmittedV1(v: unknown): v is VoiceTaskAdmittedV1 {
 return record(v)&&closed(v,['schemaVersion','type','generation','voiceSessionId','utteranceId','commandSequence','taskId','skillId','revision','eventSequence','admittedAt'])
 &&bytes(v)<=2048&&v.schemaVersion===1&&v.type==='skill:task_admitted'&&hudPositiveInteger(v.generation)&&hudSafeId(v.voiceSessionId)&&hudSafeId(v.utteranceId)
 &&hudPositiveInteger(v.commandSequence)&&hudSafeId(v.taskId)&&hudSafeId(v.skillId)&&hudPositiveInteger(v.revision)&&hudPositiveInteger(v.eventSequence)&&hudUtc(v.admittedAt);
}
export function isHudPresentationV1(v: unknown): v is HudPresentationV1 {
 return record(v)&&closed(v,['schemaVersion','type','generation','voiceSessionId','utteranceId','commandSequence','action'])&&bytes(v)<=2048
 &&v.schemaVersion===1&&v.type==='hud:presentation'&&hudPositiveInteger(v.generation)&&hudSafeId(v.voiceSessionId)&&hudSafeId(v.utteranceId)
 &&hudPositiveInteger(v.commandSequence)&&['show_current','hide'].includes(typeof v.action==='string'?v.action:'');
}
/** Clone every duplicate representation; never mutate stored canonical history. */
export function withoutTaskObservedMetrics<T>(value: T): T {
 if(Array.isArray(value))return value.map(withoutTaskObservedMetrics) as T;
 if(record(value))return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='observedMetrics').map(([k,v])=>[k,withoutTaskObservedMetrics(v)])) as T;
 return value;
}
export interface TaskHudScopeV1 {schemaVersion:1;view:'hud-v1';workspaceId:string}
export function isTaskHudScopeV1(v:unknown):v is TaskHudScopeV1 {
 return record(v)&&closed(v,['schemaVersion','view','workspaceId'])&&v.schemaVersion===1&&v.view==='hud-v1'&&hudSafeId(v.workspaceId);
}

/** Capture immutable server context before task creation; does not create execution authority. */
export function captureTaskHudAdmissionContext(authority:TrustedTaskHudAdmissionAuthorityV1):Readonly<TrustedTaskHudAdmissionContextV1> {
 const value=authority.assertCurrent();
 if(!record(value)||!closed(value,['ownerSessionBindingId','workspaceId','voiceSessionId','utteranceId','commandSequence'])
 ||!hudSafeId(value.ownerSessionBindingId)||!hudSafeId(value.workspaceId)||!hudSafeId(value.voiceSessionId)||!hudSafeId(value.utteranceId)||!hudPositiveInteger(value.commandSequence))throw new Error('TASK_HUD_BINDING_REQUIRED');
 return Object.freeze({ownerSessionBindingId:value.ownerSessionBindingId,workspaceId:value.workspaceId,voiceSessionId:value.voiceSessionId,utteranceId:value.utteranceId,commandSequence:value.commandSequence});
}
