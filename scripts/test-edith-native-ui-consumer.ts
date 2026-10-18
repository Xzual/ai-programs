import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { parseNativeFileOpenResult } from '../src/edith/filesClient';

const reports=path.resolve('artifacts/repair-20261006/chat2/w4');
const fileId='a'.repeat(64), content='Isolated native consumer document. İstanbul.';
const digest=createHash('sha256').update(content).digest('hex');
const valid=()=>({success:true,completed:true,fileId,receipt:{operationId:'12345678-1234-4234-8234-123456789abc',fileId,ownerBindingId:'owner-session-'+'b'.repeat(32),source:'native_operator',openedProcessId:42,verifiedProcessId:42,contentSha256:digest,postcondition:'same_file_opened'}});
let negativeChecks=0;
const reject=(v:unknown)=>{assert.throws(()=>parseNativeFileOpenResult(v,fileId,digest),/FILES_NATIVE_OPEN_UNVERIFIED/);negativeChecks++;};
assert.equal(parseNativeFileOpenResult(valid(),fileId,digest).receipt.verifiedProcessId,42);
for(const field of Object.keys(valid().receipt)){const v:any=valid();delete v.receipt[field];reject(v);}
for(const patch of [{operationId:'caller-nonce'},{operationId:'12345678-1234-1234-8234-123456789abc'},{fileId:'c'.repeat(64)},{ownerBindingId:'C:/private'},{source:'fixture'},{postcondition:'input_injected'},{openedProcessId:0},{openedProcessId:-1},{openedProcessId:1.1},{openedProcessId:Number.MAX_SAFE_INTEGER+1},{verifiedProcessId:43},{verifiedProcessId:0},{contentSha256:'bad'},{contentSha256:'c'.repeat(64)},{path:'C:/private'},{privatePath:'secret'},{unknown:true}])reject({...valid(),receipt:{...valid().receipt,...patch}});
for(const patch of [{completed:false},{completed:undefined},{success:false},{fileId:'c'.repeat(64)},{receipt:null}])reject({...valid(),...patch});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-native-ui-consumer-'));
let vite:any,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let openMode='valid', pendingRelease:(()=>void)|undefined, openCalls=0;
const events:string[]=[], pageErrors:string[]=[];
try {
 const frontend=path.join(root,'frontend');fs.mkdirSync(frontend);fs.cpSync(path.resolve('src'),path.join(frontend,'src'),{recursive:true});
 fs.symlinkSync(path.resolve('node_modules'),path.join(frontend,'node_modules'),process.platform==='win32'?'junction':'dir');
 fs.writeFileSync(path.join(frontend,'package.json'),'{"type":"module"}');
 fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
 fs.writeFileSync(path.join(frontend,'entry.tsx'),"import React from 'react';import {createRoot} from 'react-dom/client';import './src/index.css';import {FilesScreen,ComputerUseScreen} from './src/components/ui/edithOS';function Harness(){const [screen,setScreen]=React.useState('files');return <div className='h-screen overflow-auto bg-slate-950 text-white'><nav>{['files','computer'].map(s=><button key={s} onClick={()=>setScreen(s)}>{s}</button>)}</nav>{screen==='files'?<FilesScreen/>:<ComputerUseScreen/>}</div>};createRoot(document.getElementById('root')!).render(<Harness/>);");
 const {createServer}=await import('vite');const react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
 vite=await createServer({configFile:false,root:frontend,envDir:frontend,envPrefix:'NO_PRODUCT_ENV_',cacheDir:path.join(root,'vite-cache'),plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:5194,strictPort:true},clearScreen:false});await vite.listen();
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1366,height:1000}});
 await context.addInitScript({content:'window.__name = value => value;'});
 await context.addInitScript(()=>{
  const state:any={approved:false,mode:'normal',generation:0,commands:[],requests:[]};(window as any).fixture=state;
  const status=()=>({runtime:'tauri',mode:state.approved?'owner_command':'read_only',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:state.approved,killSwitch:'inactive',overlay:'in_app',nativeOverlayReady:false,targeting:'uia_first',uia:state.mode==='missing'?'missing':'ready',ocr:'ready',multiMonitor:'virtual_desktop',verification:'post_observation_required',sessionExpiresAt:Date.now()+60000,safeMessage:'Isolated command fixture; no OS control.'});
  (window as any).__TAURI__={core:{invoke:async(command:string,args:any)=>{
   state.commands.push({command,args});
   if(command==='computer_status')return status();
   if(command==='computer_begin'){state.approved=true;return 'consumer-fixture-session';}
   if(command==='computer_stop'){state.approved=false;return;}
   if(command==='computer_observe'||command==='computer_screenshot'){
    const generation=++state.generation;return {observationId:'observation-fixture-'+generation,generation,imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',originX:0,originY:0,width:1366,height:1000,cursorX:300,cursorY:300,capturedAt:Date.now(),expiresAt:Date.now()+(state.mode==='stale'?300:15000),source:'windows_gdi_virtual_desktop',confidence:1,windowId:'hwnd-fixture',windowProcessId:42,windowBounds:{x:0,y:0,width:1366,height:1000},monitorId:'monitor-fixture',monitorBounds:{x:0,y:0,width:1366,height:1000},scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:true,ocrAvailable:true};
   }
   if(command==='computer_locate'){
    if(state.mode==='missing'||state.mode==='ambiguous')throw new Error('uia_target_'+state.mode);
    if(state.mode==='stale')await new Promise(resolve=>setTimeout(resolve,400));
    return {targetId:'uia:runtime-fixture',x:200,y:200,width:100,height:100};
   }
   if(command==='computer_action'){
    state.requests.push(args.request);return {actionId:args.request.actionId,planId:args.request.planId,stepId:args.request.stepId,action:args.request.action,injected:true,dispatchStatus:'dispatched',cursorX:300,cursorY:300,verification:'input_injected_outcome_unverified',verificationStatus:'partial',preObservationId:args.request.observationId,attempts:1};
   }
   if(command==='computer_read_text'){if(state.mode==='holdText')await new Promise(resolve=>{state.releaseRead=resolve;});return 'PRIVATE_UIA_TRANSIENT';}
   if(command==='computer_ocr')return {...args,originX:0,originY:0,result:{text:'PRIVATE_OCR_TRANSIENT',words:[]}};
   if(command==='computer_monitors')return [{id:'monitor-fixture',bounds:{x:0,y:0,width:1366,height:1000},primary:true,active:true,dpiScale:1}];
   if(command==='computer_app_windows')return [{app:args.app,windowId:'hwnd-fixture',processId:42,title:'PRIVATE_WINDOW_TITLE'}];
   throw new Error('unsupported_fixture_command');
  }}};
 });
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());let row:any={success:true};let status=200;
  if(url.pathname==='/api/security/session')row={session:{actor:'owner',csrfToken:'isolated-csrf',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}};
  else if(url.pathname==='/api/files/status')row={success:true,state:'available',search:true,read:true,actions:{open:'native_adapter_available',send:'adapter_unavailable',summarize:'available'}};
  else if(url.pathname==='/api/files/search')row={success:true,files:[{id:fileId,root:'workspace',relativePath:'fixture.txt',name:'fixture.txt',size:Buffer.byteLength(content),modifiedAt:new Date().toISOString(),readable:true}],truncated:false};
  else if(url.pathname.endsWith('/content'))row={success:true,id:fileId,root:'workspace',relativePath:'fixture.txt',bytes:Buffer.byteLength(content),encoding:'utf-8',text:content,truncated:false};
  else if(url.pathname.endsWith('/open')){
   openCalls++;assert.equal(req.postData(),'{}');assert.equal(req.headers()['x-edith-csrf-token'],'isolated-csrf');
   if(openMode==='pending')await new Promise<void>(resolve=>{pendingRelease=resolve;});
   if(['501','502','504','403','409'].includes(openMode)){status=Number(openMode);row={success:false,errorCode:status===501?'FILES_NATIVE_OPEN_ADAPTER_UNAVAILABLE':'FILES_NATIVE_OPEN_UNVERIFIED'};}
   else row=openMode==='forged'?{...valid(),receipt:{...valid().receipt,verifiedProcessId:43}}:valid();
  } else if(url.pathname==='/api/edith/kill-switch')row={success:true,state:{active:false}};
  else {events.push(req.postData()??'');}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(row)});
 });
 await page.goto('http://127.0.0.1:5194');await page.getByRole('button',{name:/workspace\/fixture.txt/}).click();
 const open=page.getByRole('button',{name:'Aç',exact:true});assert.equal(await open.isEnabled(),true);
 openMode='pending';await open.click();await page.getByText('Yerel açma doğrulaması bekleniyor.',{exact:true}).waitFor();assert.equal(await open.isDisabled(),true);assert.equal(await page.getByText(/receipt ile doğrulandı/).count(),0);
 for(let i=0;!pendingRelease && i<200;i++)await new Promise(resolve=>setTimeout(resolve,10));assert(pendingRelease,'HTTP request must reach pending fixture');
 openMode='valid';pendingRelease!();await page.getByText(/receipt ile doğrulandı/).waitFor();await page.screenshot({path:path.join(reports,'files-open-fixture.png'),fullPage:true});
 for(const mode of ['forged','501','502','504','403','409']){openMode=mode;await open.click();await page.getByRole('status').filter({hasText:/Dosya işlemi tamamlanamadı/}).waitFor();assert.equal(await page.getByText(/receipt ile doğrulandı/).count(),0);assert.equal(await open.isEnabled(),true);}
 openMode='pending';pendingRelease=undefined;await open.click();await page.getByText('Yerel açma doğrulaması bekleniyor.',{exact:true}).waitFor();for(let i=0;!pendingRelease&&i<200;i++)await new Promise(resolve=>setTimeout(resolve,10));assert(pendingRelease);
 await page.getByRole('button',{name:'computer',exact:true}).click();pendingRelease!();assert.equal(await page.getByText(/receipt ile doğrulandı/).count(),0);
 const nativeRow=page.locator('div').filter({has:page.getByText('Native overlay',{exact:true})}).filter({hasText:'unavailable'});assert(await nativeRow.count()>0,'in-app overlay does not establish native readiness');
 fs.writeFileSync(path.join(reports,'computer-before-begin.json'),JSON.stringify(await page.evaluate(()=>({tauri:!!(window as any).__TAURI__,fixture:(window as any).fixture,body:document.body.innerText})),null,2));
 await page.getByRole('button',{name:'Start approved session'}).click();await page.getByRole('button',{name:'Refresh view'}).isEnabled();await page.locator('summary').click();
 await page.getByRole('button',{name:'Read text',exact:true}).click();await page.getByLabel('Transient native readback').filter({hasText:'PRIVATE_UIA_TRANSIENT'}).waitFor();
 await page.getByRole('button',{name:'Read ocr',exact:true}).click();await page.getByLabel('Transient native readback').filter({hasText:'PRIVATE_OCR_TRANSIENT'}).waitFor();
 for(const kind of ['monitors','spotify','steam','explorer']){await page.getByRole('button',{name:'Read '+kind,exact:true}).click();await page.getByLabel('Native inspection').waitFor();assert.equal(await page.getByLabel('Transient native readback').count(),0);}
 for(const [button,action] of [['Double click test','doubleClickMouse'],['Drag test','dragMouse']]){
  await page.getByRole('button',{name:button,exact:true}).click();await page.getByRole('alert').filter({hasText:/Input outcome remains unverified/}).waitFor();
  const requests=await page.evaluate(()=>(window as any).fixture.requests);const r=requests.at(-1);assert.equal(r.action,action);assert.equal(r.target.provenance,'uia');assert.equal(r.target.observationId,r.observationId);assert.equal(r.target.observationGeneration,r.observationGeneration);assert.equal(r.attempt,1);if(action==='dragMouse'){assert.equal(r.destinationTarget.observationId,r.observationId);assert.equal(r.dragDurationMs,300);}
 }
 for(const mode of ['missing','ambiguous','stale']){
  await page.evaluate(m=>(window as any).fixture.mode=m,mode);const before=await page.evaluate(()=>(window as any).fixture.requests.length);
  await page.getByRole('button',{name:'Click test',exact:true}).click();await page.getByRole('alert').filter({hasText:/uia_target_|stale_observation/}).waitFor();assert.equal(await page.evaluate(()=>(window as any).fixture.requests.length),before,'missing/ambiguous/stale target never dispatches');
 }
 await page.evaluate(()=>(window as any).fixture.mode='normal');await page.getByRole('button',{name:'Read text',exact:true}).click();await page.getByLabel('Transient native readback').waitFor();
 assert.equal(events.join('').includes('PRIVATE_'),false);assert.equal(events.join('').includes('imageDataUrl'),false);assert.equal(events.join('').includes('iVBOR'),false);
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('PRIVATE_')),false);
 await page.getByRole('button',{name:'Type test',exact:true}).click();await page.getByRole('alert').filter({hasText:/Input outcome remains unverified/}).waitFor();
 const commands=await page.evaluate(()=>(window as any).fixture.commands);
 for(let i=0;i<commands.length;i++)if(commands[i].command==='computer_locate'){assert(commands.slice(0,i).some((c:any)=>c.command==='computer_observe'&&c.args.sessionId===commands[i].args.sessionId));}
 await page.screenshot({path:path.join(reports,'computer-native-fixture.png'),fullPage:true});
 await page.evaluate(()=>(window as any).fixture.mode='holdText');await page.getByRole('button',{name:'Read text',exact:true}).click();await page.waitForFunction(()=>!!(window as any).fixture.releaseRead);
 await page.getByRole('button',{name:/Stop now/}).click();await page.evaluate(()=>(window as any).fixture.releaseRead());await page.waitForTimeout(100);assert.equal(await page.getByLabel('Transient native readback').count(),0);assert.equal(await page.getByRole('img',{name:'Latest local desktop capture'}).count(),0);
 assert.deepEqual(pageErrors,[]);
 fs.writeFileSync(path.join(reports,'consumer-test-result.json'),JSON.stringify({status:'PASS',receiptNegativeChecks:negativeChecks,openCalls,actualReactCSS:true,actualDesktopClient:true,commands:commands.map((c:any)=>c.command),rawJournalLeak:false,staleBlindDispatch:false,selectionUnmountFenced:true,stopPendingReadFenced:true,typedDispatchRemainsPartial:true,nativeRuntimeAcceptance:false,pageErrors},null,2));
 console.log('PASS strict native receipt '+negativeChecks+' negatives; actual React/CSS + actual client fixture; nativeRuntimeAcceptance=false');
} catch(error){fs.writeFileSync(path.join(reports,'consumer-test-failure.txt'),String(error));throw error;}
finally {
 await browser?.close();await vite?.close();
 if(!root.startsWith(path.join(os.tmpdir(),'edith-native-ui-consumer-')))throw new Error('cleanup target invalid');
 fs.rmSync(root,{recursive:true,force:true});fs.writeFileSync(path.join(reports,'consumer-cleanup.json'),JSON.stringify({browserClosed:true,viteClosed:true,tempRemoved:!fs.existsSync(root),root,pid:process.pid}));
}
