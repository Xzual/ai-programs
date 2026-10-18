import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import {createBrowserWorkflowsRouter} from '../server/routes/browserWorkflows';
import {createOwnerSessionRouter,getSoleActiveOwnerSession} from '../server/security/ownerSession';
import {browserWorkflowService,type BrowserWorkflowService} from '../src/edith/browserWorkflowService';
assert.equal(process.env.EDITH_TEST_MODE,'true');
process.env.EDITH_OWNER_TOKEN='own-browser-guard-owner';
let capabilityCalls=0,runCalls=0;const actors:string[]=[];let mode:'permission'|'invalid'|'success'='permission';
const spy:Pick<BrowserWorkflowService,'capabilities'|'run'|'readArtifact'|'closeSession'>={readArtifact:()=>{throw Error('PAGE_NOT_FOUND');},closeSession:async()=>{},capabilities:()=>{capabilityCalls++;return browserWorkflowService.capabilities();},run:async(_request,actor)=>{runCalls++;actors.push(actor!);return mode==='success'?{success:true,toolId:'browser_workflow',result:'Spy only, zero effects'}:{success:false,toolId:'browser_workflow',errorCode:mode==='permission'?'PERMISSION_DENIED':'VALIDATION_ERROR'};}};
const app=express();app.use(express.json());app.use(createOwnerSessionRouter());app.use(createBrowserWorkflowsRouter(spy));app.use('/default',createBrowserWorkflowsRouter());
const server=createServer(app);let realDryRuns=0;
try {
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port,route='/api/edith/browser/workflows';
 const request=async(suffix:string,body?:unknown,headers:Record<string,string>={})=>{const response=await fetch(base+suffix,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any,cache:response.headers.get('cache-control')};};
 const forged={action:'navigate',url:'https://never-dispatched.invalid',actor:'edith-api',authorizedPermissions:['browser:control'],permissions:['*'],approvalGranted:true};
 assert.equal((await request(route+'/capabilities')).status,401);assert.equal((await request(route,forged)).status,401);assert.equal(capabilityCalls,0);assert.equal(runCalls,0);
 const login=await fetch(base+'/api/security/session',{method:'POST',headers:{origin:base,authorization:'Bearer own-browser-guard-owner'}});assert.equal(login.status,201);const loginBody=await login.json() as any,owner=getSoleActiveOwnerSession()!;assert(owner.bindingId);
 const headers={origin:base,cookie:login.headers.get('set-cookie')!.split(';')[0],'x-edith-csrf-token':loginBody.session.csrfToken};
 const caps=await request(route+'/capabilities',undefined,headers);assert.equal(caps.status,200);assert.equal(caps.cache,'no-store');assert.deepEqual(caps.body.capabilities,browserWorkflowService.capabilities());assert.equal(capabilityCalls,1);
 for(const denied of [{cookie:headers.cookie,origin:base},{...headers,'x-edith-csrf-token':'forged'},{...headers,origin:'https://foreign.invalid'},{...headers,'sec-fetch-site':'cross-site'}]){assert.equal((await request(route,forged,denied)).status,403);assert.equal(runCalls,0,'Denied before service call');}
 assert.equal((await request(route,forged,headers)).status,403);assert.equal(runCalls,1);assert.equal(actors[0],owner.bindingId);assert.notEqual(actors[0],forged.actor);mode='invalid';assert.equal((await request(route,forged,headers)).status,400);mode='success';assert.equal((await request(route,{action:'navigate',dryRun:true},headers)).status,200);assert(actors.every(a=>a===owner.bindingId));
 // Actual default service positive: only dryRun branch, SCHEMA_ONLY, no tool/browser/provider dispatch.
 const dry=await request('/default'+route,{action:'navigate',url:'https://never-dispatched.invalid',verificationGoal:'Validate the navigation schema without dispatch.',dryRun:true},headers);realDryRuns++;
 assert.equal(dry.status,200);assert.equal(dry.body.structuredOutput.verification,'SCHEMA_ONLY');
 const receipt=dry.body.structuredOutput.browser;
 assert.equal(receipt.status,'schema_only');assert.equal(receipt.nativePhysicalProof,false);assert.equal(receipt.inputProvenance,'none');
 assert.equal(receipt.before,undefined);assert.equal(receipt.after,undefined);assert.equal(receipt.sessionId,undefined);assert.equal(receipt.pageId,undefined);
 assert.deepEqual(receipt.postconditions,[]);assert.deepEqual(receipt.artifacts,[]);assert.deepEqual(receipt.targetIds,[]);assert.equal(receipt.resolveAttempts,0);assert.equal(receipt.inputDispatches,0);
 assert.equal(dry.body.structuredOutput.capability.runtimeStatus,caps.body.capabilities.find((capability:any)=>capability.action==='navigate').runtimeStatus);
 const callsBeforeRevoke=runCalls;const logout=await fetch(base+'/api/security/session',{method:'DELETE',headers:{...headers,'content-type':'application/json'}});assert.equal(logout.status,200);assert.equal((await request(route+'/capabilities',undefined,headers)).status,401);assert.equal((await request(route,forged,headers)).status,401);assert.equal((await request('/default'+route,{action:'navigate',dryRun:true},headers)).status,401);assert.equal(runCalls,callsBeforeRevoke);assert.equal(capabilityCalls,1);
 console.log(JSON.stringify({success:true,actualOwnerMiddleware:true,deniedBeforeService:true,capabilityCalls,spyRunCalls:runCalls,actorFromActualBinding:true,realDefaultDryRuns:realDryRuns,verification:'SCHEMA_ONLY',browserProviderNativeEffects:0,permissionGrantMinted:false,physicalBrowserAcceptance:false}));
} finally {server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
