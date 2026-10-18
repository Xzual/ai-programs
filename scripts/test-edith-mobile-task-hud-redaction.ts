import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createTask} from '../src/edith/core';
import {normalizeLegacyTask,projectTaskEventsV2,deriveTaskProgress} from '../src/edith/contracts';
import {withoutTaskObservedMetrics} from '../src/edith/taskHudContracts';
import {redactSensitiveString,sanitizeSensitiveValue} from '../src/edith/securityRedaction';
// Execute the production handler expression without importing the router's runtime singleton graph.
// Authentication and encryption are synthetic seams; real device/network/session behavior is not exercised.
const source=fs.readFileSync(new URL('../server/routes/mobileTasks.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('mobileTasks.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let handler:ts.Node|undefined;
function visit(node:ts.Node):void {
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='get'
 &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/mobile/tasks/:taskId/activity')handler=node.arguments.at(-1);
 ts.forEachChild(node,visit);
}visit(ast);assert.ok(handler);
const functions=['safeText','verificationView','taskView','boundedSnapshot'];
const variables=['PROJECTION_BYTES','LIST_PROJECTION_BYTES','RESPONSE_BYTES','ENVELOPE_PLAINTEXT_BYTES','jsonBytes'];
const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name&&functions.includes(node.name.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&variables.includes(d.name.text))).map(node=>node.getText(ast)).join('\n');
assert.equal(functions.every(name=>declarations.includes('function '+name)),true);
const task=createTask({title:'Visible fixture title',objective:'Visible objective',originalUserRequest:'fixture'});
const at='2026-10-17T00:00:00.000Z';
const metrics={schemaVersion:1,attempt:1,observedAt:at,clock:'adapter_receipt',source:'tool_result',coverage:'partial',scope:{kind:'tool_run'},evidenceRefs:['evidence-fixture'],values:[{name:'items_examined',unit:'count',value:0}]};
const canonical={id:'event-mobile-fixture',eventId:'event-mobile-fixture',contractVersion:2,taskId:task.id,type:'task.tool_completed',sequence:1,revision:1,occurredAt:at,payload:{toolId:'fixture_tool',runId:'audit-fixture',outcome:'success',observedMetrics:metrics},context:{correlationId:'fixture',idempotencyKey:'fixture'}};
const fixture={...task,contractVersion:2,revision:1,eventSequence:1,timeline:[canonical],agentActivity:[]};
let encryptedPayload:any;
const compiled=ts.transpileModule(declarations+'\nconst handle='+handler!.getText(ast)+';handle;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const invoke=vm.runInNewContext(compiled,{Buffer,Date,Set,Map,normalizeLegacyTask,projectTaskEventsV2,deriveTaskProgress,redactSensitiveString,sanitizeSensitiveValue,withoutTaskObservedMetrics,
 mobileContext:()=>({device:{allowedCommands:['task.activity']}}),taskService:{getTask:(id:string)=>id===fixture.id?fixture:undefined},runtime:{},
 encryptedResponse:(_req:unknown,_runtime:unknown,purpose:string,payload:unknown)=>{assert.equal(purpose,'task.activity.result');encryptedPayload=payload;return {syntheticCiphertext:true};},
 commandError:(error:unknown)=>{throw error;}});
const response={json:(value:unknown)=>value,status:()=>response};
invoke({params:{taskId:fixture.id}},response);
assert.ok(encryptedPayload);assert.equal(JSON.stringify(encryptedPayload).includes('observedMetrics'),false,'no HUD metrics may enter device-authorized encrypted activity');
assert.equal(encryptedPayload.task.title,'Visible fixture title');assert.equal(encryptedPayload.task.objective,'Visible objective');
assert.equal(encryptedPayload.events[0].payload.toolId,'fixture_tool');assert.equal(encryptedPayload.events[0].payload.runId,'audit-fixture');
assert.equal(encryptedPayload.timeline[0].payload.outcome,'success');assert.equal(fixture.timeline[0].payload.observedMetrics,metrics);
console.log('production mobile activity handler synthetic plaintext boundary redaction passed; device/auth/encryption/network NOT_EXERCISED');
