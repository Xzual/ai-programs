import assert from 'node:assert/strict';
import { parseTaskEventV2 } from '../src/edith/contracts';
const event = {contractVersion:2,taskId:'task-fixture',eventId:'event-fixture',sequence:1,revision:1,type:'task.tool_completed',occurredAt:'2026-10-17T00:00:00.000Z',context:{correlationId:'correlation-fixture',idempotencyKey:'key-fixture'},payload:{toolId:'fixture_tool',runId:'audit-fixture',outcome:'success'}};
assert.equal(parseTaskEventV2({...event,payload:{...event.payload,observedMetrics:{schemaVersion:1,values:[]}}}).success,false,'malformed metric extension must fail the actual V2 validator');
console.log('task HUD contract checks passed');

import {isTaskObservedMetricsV1,isVoiceTaskAdmittedV1,isHudPresentationV1,withoutTaskObservedMetrics} from '../src/edith/taskHudContracts';
import {parseTaskHudListV1,parseTaskListV2,fetchTaskHudListV1} from '../src/edith/taskActivityClient';
import {EDITH_CONTRACT} from '../src/edith/contracts';
const metric={schemaVersion:1,attempt:1,observedAt:'2026-10-17T00:00:00.000Z',clock:'adapter_receipt',source:'tool_result',coverage:'partial',scope:{kind:'tool_run'},evidenceRefs:['evidence-fixture'],values:[{name:'items_examined',unit:'count',value:0}]};
assert.equal(isTaskObservedMetricsV1(metric),true);
assert.equal(parseTaskEventV2({...event,payload:{...event.payload,observedMetrics:metric}}).success,true);
assert.equal(parseTaskEventV2(event).success,true);
for(const bad of [undefined,null,{}, {...metric,extra:1},{...metric,attempt:0},{...metric,attempt:Number.MAX_SAFE_INTEGER+1},{...metric,observedAt:'2026-02-30T00:00:00.000Z'},{...metric,scope:{kind:'tool_run',path:'C:/private'}},{...metric,evidenceRefs:[]},{...metric,evidenceRefs:['same','same']},{...metric,values:[]},{...metric,values:[metric.values[0],metric.values[0]]},...[-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1].map(value=>({...metric,values:[{name:'items_examined',unit:'count',value}]}))]){
 assert.equal(isTaskObservedMetricsV1(bad),false);
 assert.equal(parseTaskEventV2({...event,payload:{...event.payload,observedMetrics:bad}}).success,false);
}
assert.equal(isTaskObservedMetricsV1({...metric,values:[{name:'elapsed',unit:'millisecond',value:0.5}]}),true);
assert.equal(isTaskObservedMetricsV1(metric,[]),false);
assert.equal(isTaskObservedMetricsV1(metric,[{name:'items_examined',unit:'count'}]),true);
assert.equal(isTaskObservedMetricsV1({...metric,values:Array.from({length:17},(_,i)=>({name:'m'+i,unit:'count',value:0}))}),false);
const admission={schemaVersion:1,type:'skill:task_admitted',generation:1,voiceSessionId:'voice-fixture',utteranceId:'utterance-fixture',commandSequence:1,taskId:'task-fixture',skillId:'skill-fixture',revision:1,eventSequence:1,admittedAt:metric.observedAt};
assert.equal(isVoiceTaskAdmittedV1(admission),true);
assert.equal(isVoiceTaskAdmittedV1({...admission,taskId:'../escape'}),false);
assert.equal(isVoiceTaskAdmittedV1({...admission,success:true}),false);
assert.equal(isHudPresentationV1({schemaVersion:1,type:'hud:presentation',generation:1,voiceSessionId:'voice',utteranceId:'utterance',commandSequence:1,action:'hide'}),true);
assert.equal(isHudPresentationV1({...admission,type:'hud:presentation',action:'execute'}),false);
const copies={events:[{payload:{observedMetrics:metric}}],data:{task:{timeline:[{metadata:{observedMetrics:metric}}],agentActivity:[{observedMetrics:metric}]}}};
assert.equal(JSON.stringify(withoutTaskObservedMetrics(copies)).includes('observedMetrics'),false);
assert.equal(copies.events[0].payload.observedMetrics,metric);
const legacy={success:true,contract:EDITH_CONTRACT,data:{tasks:[]}};
assert.deepEqual(parseTaskListV2(legacy),[]);
assert.throws(()=>parseTaskHudListV1(legacy,'workspace-fixture'),/kapsamı/);
assert.deepEqual(parseTaskHudListV1({...legacy,hud:{schemaVersion:1,view:'hud-v1',workspaceId:'workspace-fixture'}},'workspace-fixture'),[]);
assert.throws(()=>parseTaskHudListV1({...legacy,hud:{schemaVersion:1,view:'hud-v1',workspaceId:'other'}},'workspace-fixture'));
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async(input,init)=>{assert.equal(input,'/api/edith/tasks?view=hud-v1');assert.equal(init?.credentials,'include');assert.equal(init?.cache,'no-store');return new Response(JSON.stringify(legacy),{status:200});};
 await assert.rejects(fetchTaskHudListV1('workspace-fixture'));
}finally{globalThis.fetch=originalFetch;}
console.log('task HUD structural, legacy, scoped client checks passed');

for(const malformed of [{...metric,clock:['adapter_receipt']},{...metric,coverage:['partial']},{...metric,values:[{name:'items_examined',unit:['count'],value:0}]}])assert.equal(isTaskObservedMetricsV1(malformed),false);
assert.equal(isHudPresentationV1({schemaVersion:1,type:'hud:presentation',generation:1,voiceSessionId:'voice',utteranceId:'utterance',commandSequence:1,action:['hide']}),false);
