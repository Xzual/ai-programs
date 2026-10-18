import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';

// Actual React/CSS/default consumer and protected producer. IPC is SIM;
// no simulated native success, proof capability, ledger or Task PASS is issued.
const repo=fs.realpathSync(path.resolve('.'));
const reports=path.join(repo,'artifacts/repair-20261006/chat2/w5-native-ui-consumer/tests',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(reports,{recursive:true});
assert.equal(process.env.EDITH_TEST_MODE,'true');
assert.equal(process.env.EDITH_W5_UI_SOURCE_READY,'1','Parent SOURCE_READY required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-w5-ui-'));
process.env.EDITH_TEST_DATA_DIR=path.join(root,'data');
process.env.EDITH_OWNER_TOKEN=randomBytes(32).toString('hex');
process.env.EDITH_OWNER_TOKEN_ONE_TIME='false';
process.env.EDITH_DESKTOP_BRIDGE_TOKEN=randomBytes(32).toString('hex');
const hashes=Object.fromEntries(['scripts/test-edith-native-browser-ui-consumer.ts','src/components/ui/edithOS.tsx','src/edith/nativeBrowserConsumerClient.ts','src/edith/computerDesktopClient.ts','server/routes/browserWorkflows.ts','server/browser/browserNativePrivateContract.ts'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));
fs.writeFileSync(path.join(reports,'startup.json'),JSON.stringify({root,repo,pid:process.pid,hashes},null,2));
const calls:any[]=[],httpRows:any[]=[],checks:string[]=[],errors:string[]=[];
const outcomes:any[]=[];
let browser:any,page:any,vite:any,server:any,approved=false,until=0,mode='unavailable',generation=0;
let holding=false,releaseHold:(()=>void)|undefined,phase=0,observations=0;
let closeServices=async()=>{};
let admittedTask:string|undefined,otherTask:string|undefined,cancelAdmitted=()=>{};
const wait=async(fn:()=>any,label:string)=>{const limit=Date.now()+20000;while(Date.now()<limit){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Wait timed out: '+label);};
const status=()=>({runtime:'tauri',mode:approved&&Date.now()<until?'owner_command':'read_only',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:approved&&Date.now()<until,killSwitch:'inactive',overlay:'in_app',sessionExpiresAt:until,uia:'missing',ocr:'missing',safeMessage:'SIM native IPC; no physical browser effects.'});
const safe=(state:string,reason='CONFIGURATION_REQUIRED')=>({status:state,reasonCode:reason,logicalBatches:0,requestedEventCount:0,sentEventCount:0,cleanupRequestedCount:0,cleanupSentCount:0,possibleEffect:false});
async function invoke(command:string,args:any={}){
  calls.push({command,args,provenance:'SIM'});
  if(command==='computer_status')return status();
  if(command==='computer_begin'){approved=true;until=Date.now()+60000;return 'SIM-local-session-'+(++generation);}
  if(command==='computer_stop'){approved=false;return;}
  if(command==='computer_observe'||command==='computer_screenshot')return {observationId:'SIM-browser-observation-'+(++observations),generation:observations,imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',originX:0,originY:0,width:1600,height:900,cursorX:20,cursorY:20,capturedAt:Date.now(),expiresAt:Date.now()+15000,source:'windows_gdi_virtual_desktop',confidence:1,windowId:'hwnd:SIM-browser-fixture',windowProcessId:77,windowBounds:{x:0,y:0,width:1600,height:900},monitorId:'SIM-monitor',monitorBounds:{x:0,y:0,width:1600,height:900},scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:false,ocrAvailable:false};
  if(command==='computer_workflow_reserve'){if(mode==='reserve-lost-ack'){cancelAdmitted();throw Error('SIM_RESERVE_ACK_LOST');}return {workflowId:args.workflowId};}
  if(command==='computer_workflow_release')return;
  if(command.startsWith('native_browser_')){
    assert.deepEqual(Object.keys(args).sort(),command==='native_browser_resolve'?['attempt_wire_ref','local_session_ref']:['operation_wire_ref']);
    if(command==='native_browser_resolve')phase=0;
    if(mode==='oversize-ready')return {...safe('ready','OK'),requestedEventCount:20401};
    if(['distinct-phases','max-budget','duplicate-phase','status-ready','malformed-phase'].includes(mode)){
      if(command==='native_browser_resolve')return safe('ready','OK');
      if(command==='native_browser_dispatch'){
        phase++;const row={...safe(mode==='distinct-phases'&&phase===3?'complete':mode==='status-ready'?'partial':'ready','OK'),logicalBatches:mode==='duplicate-phase'?0:phase,requestedEventCount:phase*2,sentEventCount:phase*2};
        return mode==='malformed-phase'?{...row,untrusted:true}:row;
      }
      cancelAdmitted();return {...safe('ready','OK'),logicalBatches:phase,requestedEventCount:phase*2,sentEventCount:phase*2};
    }
    if(mode==='held'&&command==='native_browser_resolve'){holding=true;await new Promise<void>(r=>{releaseHold=r;});holding=false;}
    if(['unavailable','stale','partial','complete-without-proof'].includes(mode))cancelAdmitted();
    if(mode==='lost-ack'&&command==='native_browser_read_status')cancelAdmitted();
    if(mode==='lost-ack'&&command==='native_browser_dispatch')throw Error('SIM_ACK_LOST');
    if(mode==='stale')return safe('denied','NATIVE_SCOPE_STALE');
    if(mode==='partial')return {...safe('partial','NATIVE_DISPATCH_INTERRUPTED'),possibleEffect:true,requestedEventCount:2,sentEventCount:1};
    if(mode==='complete-without-proof')return safe('complete','OK');
    return safe(command==='native_browser_resolve'&&mode==='lost-ack'?'ready':'unavailable');
  }
  throw Error('Unexpected SIM command '+command);
}

async function main(){
  const [{default:express},{createServer},{createOwnerSessionRouter},{createPermissionsRouter},{createComputerUseRouter},{createBrowserWorkflowsRouter},{browserNativeAuthority,NATIVE_BROWSER_PRIVATE_BASE,nativeBrowserBodyErrorHandler},{getBrowserOperatorAdapter,setBrowserOperatorTestOptions},{createTasksRouter},{createKillSwitchRouter},{getNativeTaskBinding},{getMobileRuntime},{getEdithPersistenceStore},{taskService}]=await Promise.all([import('express'),import('node:http'),import('../server/security/ownerSession'),import('../server/routes/permissions'),import('../server/routes/computerUse'),import('../server/routes/browserWorkflows'),import('../server/browser/browserNativeAuthority'),import('../src/edith/browserOperatorAdapter'),import('../server/routes/tasks'),import('../server/routes/killSwitch'),import('../server/computer/nativeTaskBinding'),import('../server/mobile/runtime'),import('../src/edith/persistence'),import('../src/edith/taskService')]);
  closeServices=async()=>{await getBrowserOperatorAdapter().closeAll();getNativeTaskBinding().close();getMobileRuntime().realtime.shutdown();(getEdithPersistenceStore() as any).close?.();};
  cancelAdmitted=()=>{if(admittedTask&&taskService.getTask(admittedTask)?.status==='RUNNING')taskService.updateStatus(admittedTask,'CANCELLED');};
  const app=express();app.use(express.json());app.use(nativeBrowserBodyErrorHandler);
  app.use((req,res,next)=>{if(req.path.startsWith('/api/edith/browser/workflows')||req.path.startsWith('/api/edith/tasks/')){const json=res.json.bind(res);res.json=(body:any)=>{
    const original=structuredClone(body);let projected=body;
    if(req.method==='POST'&&req.path==='/api/edith/browser/workflows'&&res.statusCode===202){admittedTask=body.taskId;if(mode==='malformed-ticket')projected={...body,attemptLookupRef:'invalid'};if(mode==='ticket-other-task')projected={...body,taskId:otherTask};}
    if(req.path.endsWith('/activity')&&body.data?.task&&['missing-evidence','all-required','other-task'].includes(mode)){
      projected=structuredClone(body);const task=projected.data.task;
      if(mode==='missing-evidence'&&task.verification)task.verification.checks=task.verification.checks.map((check:any)=>({...check,evidence:''}));
      if(mode==='all-required'&&task.verification?.checks?.length)task.verification.checks[0].status='FAIL';
      if(mode==='other-task')task.objective='Different original verification goal';
    }
    if(mode==='no-receipt'&&req.method==='POST'&&req.path==='/api/edith/browser/workflows'&&res.statusCode===200){projected=structuredClone(body);delete projected.structuredOutput.browser;}
    if(mode==='other-task-same-goal'&&req.method==='POST'&&req.path==='/api/edith/browser/workflows'&&res.statusCode===200){projected=structuredClone(body);projected.structuredOutput.taskId=otherTask;}
    httpRows.push({method:req.method,path:req.path,status:res.statusCode,body:original,...(projected===body?{}:{projection:'SIM_INVALID_TRANSPORT_ONLY',projected})});return json(projected);
  };}next();});
  app.get('/fixture/search',(req,res)=>res.type('html').send('<!doctype html><html><head><title>Own bounded fixture</title></head><body><h1>Own search fixture</h1><form action="/fixture/search"><input type="search" name="q" value="'+String(req.query.q??'').replace(/[^a-zA-Z0-9 ]/g,'')+'"></form><main><a href="/fixture/search?q=Own">Own bounded browser fixture result</a></main></body></html>'));
  app.use(createOwnerSessionRouter());app.use(createPermissionsRouter());app.use(createComputerUseRouter());app.use(createKillSwitchRouter());
  app.post('/fixture/native',async(req,res)=>{try{res.json({result:await invoke(req.body.command,req.body.args)});}catch(error){res.json({error:String((error as Error).message)});}});
  server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  await setBrowserOperatorTestOptions({fixtureOrigins:[origin],searchUrl:q=>origin+'/fixture/search?q='+encodeURIComponent(q)});
  // Compose genuine sources only after the own test adapter has been configured.
  app.use(createBrowserWorkflowsRouter());app.use(createTasksRouter());
  const login=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(login.status,201);const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json() as any).session.csrfToken;
  const protectedPost=async(route:string,body:any)=>fetch(origin+route,{method:'POST',headers:{origin,cookie,'x-edith-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await protectedPost('/api/edith/permissions/grants',{permissions:['network:read','browser:control','computer:control'],toolIds:['browser_open','browser_search','browser_workflow','playwright_browser_agent','computer_action'],ttlMs:600000,reason:'Own UI browser admission fixture, no native input'})).status,200);
  const frontend=path.join(root,'frontend');fs.mkdirSync(frontend);fs.cpSync(path.join(repo,'src'),path.join(frontend,'src'),{recursive:true});fs.symlinkSync(path.join(repo,'node_modules'),path.join(frontend,'node_modules'),'junction');
  fs.writeFileSync(path.join(frontend,'package.json'),'{"type":"module"}');fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  fs.writeFileSync(path.join(frontend,'entry.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import './src/index.css';import {ComputerUseScreen,BrowserResearchScreen} from './src/components/ui/edithOS';import {runNativeBrowserRequest} from './src/edith/nativeBrowserConsumerClient';
  window.__TAURI__={core:{invoke:async(command,args)=>{const response=await fetch('/fixture/native',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});const row=await response.json();if(row.error)throw Error(row.error);return row.result;}}};
  window.__direct=(sessionId,request,id)=>runNativeBrowserRequest(sessionId,request,{requestId:id,signal:new AbortController().signal});
  function Fixture(){const [screen,setScreen]=React.useState('browser');const [pending,setPending]=React.useState();const pendingRef=React.useRef(pending);pendingRef.current=pending;window.__pending=pending;
  const handled=React.useCallback(id=>{if(pendingRef.current?.id===id){pendingRef.current=undefined;setPending(undefined);}},[]);
  const request=React.useCallback(request=>{if(pendingRef.current)return;const descriptor={id:'ui-original-'+crypto.randomUUID(),request};window.__lastRequest=descriptor;pendingRef.current=descriptor;setPending(descriptor);setScreen('computer');},[]);
  window.__request=request;
  React.useEffect(()=>{const clear=()=>{pendingRef.current=undefined;setPending(undefined);};window.addEventListener('edith-owner-logout',clear);window.addEventListener('edith-computer-stop',clear);return()=>{window.removeEventListener('edith-owner-logout',clear);window.removeEventListener('edith-computer-stop',clear);};},[]);
  window.__setRequest=(request,id)=>{pendingRef.current={id,request};setPending(pendingRef.current);setScreen('computer');};window.__computer=()=>{pendingRef.current=undefined;setPending(undefined);setScreen('computer');};return <div className="min-h-screen bg-slate-950 text-white"><button onClick={()=>setScreen('browser')}>Fixture browser tab</button>{screen==='browser'?<BrowserResearchScreen onBrowserRequest={request}/>:<ComputerUseScreen browserRequest={pending} onBrowserRequestHandled={handled}/>}</div>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
  const {createServer:createVite}=await import('vite');const react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
  vite=await createVite({configFile:false,root:frontend,envDir:frontend,envPrefix:'NO_PRODUCT_ENV_',cacheDir:path.join(root,'cache'),plugins:[react(),tailwind()],server:{middlewareMode:true,hmr:false},clearScreen:false});app.use(vite.middlewares);
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1366,height:1000}});await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin,httpOnly:true,sameSite:'Strict'}]);page=await context.newPage();page.on('pageerror',(e:any)=>errors.push(e.message));await page.goto(origin);
  const countPost=()=>httpRows.filter(row=>row.method==='POST'&&row.path==='/api/edith/browser/workflows').length;
  const count=(command:string)=>calls.filter(row=>row.command===command).length;
  const approve=async()=>{await wait(()=>page.getByRole('button',{name:'Start approved session'}).isEnabled(),'native status ready for explicit approval');await page.getByRole('button',{name:'Start approved session'}).click();await wait(()=>page.getByRole('button',{name:'Refresh view',exact:true}).isEnabled(),'approved local session');};
  const stop=async()=>{await page.getByRole('button',{name:/^Stop now/}).click();await wait(()=>page.getByRole('button',{name:'Start approved session'}).isEnabled(),'local stop');};
  const request={action:'search',query:'Own browser UI search',verificationGoal:'Observe actual search results.'};
  const direct=async(label:string,id='direct-'+label+'-'+randomBytes(6).toString('hex'))=>{
    const posts=countPost(),result=await page.evaluate(({sessionId,request,id}:any)=>(window as any).__direct(sessionId,request,id),{sessionId:'SIM-local-session-'+generation,request,id});outcomes.push({label,result,posts:countPost()-posts});return result;
  };
  mode='dom-positive';await page.getByLabel('Araştırma sorusu').fill(request.query);
  for(const width of [1366,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(reports,'browser-request-'+width+'.png'),fullPage:true});}
  const noAdmission=countPost();await page.getByRole('button',{name:'Tarayıcıda ara',exact:true}).click();
  const region=page.getByRole('region',{name:'Browser workflow result'});await region.getByText(/owner-approved session required/).waitFor();assert.equal(countPost(),noAdmission);checks.push('explicit_browser_original_waits_for_approval_no_post');
  const retained=await page.evaluate(()=>(window as any).__pending.id);await page.evaluate(request=>{(window as any).__request(request);(window as any).__request(request);},request);assert.equal(await page.evaluate(()=>(window as any).__pending.id),retained);assert.equal(countPost(),noAdmission);checks.push('mounted_duplicate_callback_retains_original_descriptor_no_post_before_approval');
  await approve();await region.getByText('Every ordinary required check PASS.',{exact:true}).waitFor();assert.equal(countPost(),noAdmission+1);
  assert.equal(await region.getByText('DOM-only; no native physical proof.',{exact:true}).count(),1);assert.equal(count('native_browser_resolve'),0);
  const original=(await page.evaluate(()=>(window as any).__lastRequest));assert.deepEqual(original.request,request);
  const positive=httpRows.find(row=>row.method==='POST'&&row.status===200&&row.path==='/api/edith/browser/workflows')!;otherTask=positive.body.structuredOutput.taskId;
  const canonical=taskService.getTask(otherTask!)!;assert.equal(canonical.status,'COMPLETED');assert.equal(canonical.verification?.taskId,otherTask);assert.ok(canonical.verification?.checks.filter(check=>check.required).length!>=2);assert.ok(canonical.verification?.checks.every(check=>!check.required||(check.status==='PASS'&&Boolean(check.evidence.trim()))));checks.push('real_DOM_producer_sameTask_all_required_PASS_explicit_DOM_only');
  for(const width of [1366,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(reports,'browser-DOM-result-'+width+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);}
  await page.setViewportSize({width:1366,height:1000});
  const duplicate=await direct('duplicate',original.id);assert.equal(duplicate.reasonCode,'BROWSER_REQUEST_ALREADY_CLAIMED');assert.equal(outcomes.at(-1).posts,0);checks.push('same_original_claim_never_second_admission');
  for(const invalid of ['no-receipt','missing-evidence','all-required','other-task','other-task-same-goal']){mode=invalid;const result=await direct(invalid);assert.notEqual(result.status,'verified');assert.equal(outcomes.at(-1).posts,1);checks.push('SIM_transport_'+invalid+'_cannot_verify');}
  await stop();await page.evaluate(()=>{(window as any).__savedTauri=(window as any).__TAURI__;delete (window as any).__TAURI__;});const noTauri=await direct('no-Tauri');assert.equal(noTauri.reasonCode,'TAURI_REQUIRED');assert.equal(outcomes.at(-1).posts,0);await page.getByRole('button',{name:'Fixture browser tab'}).click();assert.equal(await page.getByRole('button',{name:'Tarayıcıda ara',exact:true}).isDisabled(),true);checks.push('no_Tauri_no_admission_UI_disabled');await page.evaluate(()=>{(window as any).__TAURI__=(window as any).__savedTauri;});
  // Browser tab unmount stopped ComputerUse; fresh explicit session for native admission.
  await page.evaluate(()=>(window as any).__computer());await approve();
  const boot=await fetch(origin+NATIVE_BROWSER_PRIVATE_BASE+'/boot',{method:'POST',headers:{authorization:'Bearer '+process.env.EDITH_DESKTOP_BRIDGE_TOKEN,'content-type':'application/json'},body:JSON.stringify({version:1,nativeBootNonce:randomBytes(24).toString('base64url')})});assert.equal(boot.status,200);assert.equal(browserNativeAuthority.supportsStrategy('search'),true);
  mode='held';const uiPosts=countPost();await page.evaluate(request=>(window as any).__setRequest(request,'ui-native-held'),request);await wait(()=>holding,'actual ComputerUse pending native resolve');await region.getByText(/Pending backend proof/).waitFor();
  for(const width of [1366,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(reports,'browser-native-pending-'+width+'.png'),fullPage:true});}
  await page.setViewportSize({width:1366,height:1000});const heldDispatch=count('native_browser_dispatch');await stop();releaseHold!();await wait(()=>!holding,'late native resolve released');cancelAdmitted();await approve();await new Promise(r=>setTimeout(r,200));assert.equal(countPost(),uiPosts+1);assert.equal(count('native_browser_dispatch'),heldDispatch);assert.equal(await region.count(),0);checks.push('actual_ComputerUse_pending_STOP_and_reapproval_no_late_result_or_replay');
  for(const invalid of ['malformed-ticket','ticket-other-task','reserve-lost-ack','oversize-ready','unavailable','stale','partial','complete-without-proof','lost-ack','distinct-phases','max-budget','duplicate-phase','status-ready','malformed-phase']){
    mode=invalid;const beforeResolve=count('native_browser_resolve'),beforeDispatch=count('native_browser_dispatch');const result=await direct(invalid);assert.notEqual(result.status,'verified');assert.equal(outcomes.at(-1).posts,1);cancelAdmitted();
    if(['malformed-ticket','ticket-other-task','reserve-lost-ack'].includes(invalid))assert.equal(count('native_browser_resolve'),beforeResolve);
    if(invalid==='reserve-lost-ack')assert.equal(result.requiresStop,true);
    const expectedDispatch=invalid==='distinct-phases'?3:invalid==='max-budget'?10:['lost-ack','duplicate-phase','status-ready','malformed-phase'].includes(invalid)?1:0;
    assert.equal(count('native_browser_dispatch')-beforeDispatch,expectedDispatch);assert.notEqual(taskService.getTask(admittedTask!)?.verification?.status,'PASS');
    const reservation=calls.filter(row=>row.command==='computer_workflow_reserve').at(-1);if(!['malformed-ticket','ticket-other-task'].includes(invalid))assert.equal(reservation.args.workflowId,admittedTask);
    checks.push('genuine202_SIM_'+invalid+'_no_native_TaskPASS_no_replay');await stop();await approve();
  }
  for(const boundary of ['STOP','cancel','delayed-native-expiry','owner-rotated']){
    mode='held';const beforeDispatch=count('native_browser_dispatch'),promise=direct(boundary);await wait(()=>holding,'SIM held resolve');
    if(boundary==='cancel')cancelAdmitted();
    if(boundary==='STOP')await stop();
    if(boundary==='delayed-native-expiry'){until=Date.now()-1;await wait(()=>page.getByRole('button',{name:'Start approved session'}).isEnabled(),'native owner mode expiry');}
    if(boundary==='owner-rotated'){
      const rotated=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(rotated.status,201);const newCookie=rotated.headers.get('set-cookie')!.split(';')[0];await context.addCookies([{name:newCookie.split('=')[0],value:newCookie.split('=').slice(1).join('='),url:origin,httpOnly:true,sameSite:'Strict'}]);
    }
    releaseHold!();const result=await promise;assert.notEqual(result.status,'verified');assert.equal(count('native_browser_dispatch'),beforeDispatch);cancelAdmitted();assert.notEqual(taskService.getTask(admittedTask!)?.verification?.status,'PASS');checks.push('held_resolve_'+boundary+'_no_late_dispatch_or_PASS');
    if(boundary==='owner-rotated')break;await stop();await approve();
  }
  assert.deepEqual(errors,[]);const nativeIds=httpRows.filter(row=>row.method==='POST'&&row.status===202).map(row=>row.body.taskId);assert.ok(nativeIds.every(id=>taskService.getTask(id)?.verification?.status!=='PASS'));
  fs.writeFileSync(path.join(reports,'evidence.json'),JSON.stringify({status:'PASS',checks,outcomes,calls,httpRows,hashes,realReactCSS:true,defaultHelper:true,realProtectedProducerAdmission:true,realDOMPositive:true,nativeIPC:'SIM',nativeTaskPassIssued:0,nativePhysicalAcceptance:false,tasks:taskService.listTasks(),limits:['Full production App boot is not exercised; ephemeral routing mirrors actual App','Negative corruptions are explicit transport projections, never persisted proof','Native session expiry is synthetic native status; actual backend owner rotation is tested','Physical native/browser final pair not executed']},null,2));console.log('PASS W5 actual React/default helper/protected real producer; native IPC SIM, nativeTaskPassIssued=0');
}
try{await main();}catch(error){fs.writeFileSync(path.join(reports,'failure.json'),JSON.stringify({error:String(error),checks,calls,httpRows,errors,hashes},null,2));await page?.screenshot({path:path.join(reports,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{releaseHold?.();await browser?.close();await vite?.close();await closeServices();server?.closeAllConnections();if(server?.listening)await new Promise<void>(r=>server.close(()=>r()));assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('edith-w5-ui-'));try{fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}finally{fs.writeFileSync(path.join(reports,'cleanup.json'),JSON.stringify({root,tempRemoved:!fs.existsSync(root),browserClosed:true,serverClosed:!server?.listening,pid:process.pid},null,2));}}
