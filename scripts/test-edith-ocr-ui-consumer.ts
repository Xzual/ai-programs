import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';

// Real React/CSS, default client and adapter. Native OCR/UIA/input and desktop
// pixels are explicit fixtures; this does not claim Windows provider acceptance.
const repo=path.resolve('.');
const reports=path.join(repo,'artifacts/repair-20261006/chat2/w4-ocr-ui-consumer/tests',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(reports,{recursive:true});
assert.equal(process.env.EDITH_TEST_MODE,'true');
assert.equal(process.env.EDITH_OCR_SOURCE_READY,'1','Parent SOURCE_READY is required');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-ocr-ui-'));
process.env.EDITH_TEST_DATA_DIR=path.join(root,'data');
process.env.EDITH_OWNER_TOKEN=randomBytes(32).toString('hex');
const sourceHashes=Object.fromEntries(['src/components/ui/edithOS.tsx','src/edith/computerDesktopClient.ts','src/edith/computerContractAdapter.ts','src/edith/contracts.ts','scripts/test-edith-ocr-targets.ts'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const intent={query:'OCR_TARGET_PRIVATE_EQUALS',before:'OCR_BEFORE_PRIVATE_2_PLUS_2',after:'OCR_AFTER_PRIVATE_FOUR'};
let browser:any,vite:any,server:any,page:any,closeServices=()=>{};
let approved=false,sessionNumber=0,sessionUntil=0,generation=0,mode='eligible',wire:any,pre:any,target:any,lastAction:any,issuedIntent:any;
let releaseHold:(()=>void)|undefined,holding=false;
const nativeCalls:any[]=[],journal:any[]=[],checks:string[]=[],pageErrors:string[]=[];
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const status=()=>({runtime:'tauri',mode:approved&&Date.now()<sessionUntil?'owner_command':'read_only',available:true,screenCapture:'ready',mouseControl:'ready',keyboardControl:'ready',ownerCommandMode:approved&&Date.now()<sessionUntil,killSwitch:'inactive',overlay:'in_app',sessionExpiresAt:sessionUntil,uia:'missing',ocr:'ready',targeting:'uia_first',safeMessage:'Synthetic OCR command fixture; no physical application control.'});
const hold=async()=>{holding=true;await new Promise<void>(resolve=>{releaseHold=resolve;});holding=false;releaseHold=undefined;};
async function invoke(command:string,args:any={}){
  nativeCalls.push({command,args});
  if(command==='computer_status')return status();
  if(command==='computer_begin'){approved=true;sessionUntil=Date.now()+60000;return 'ocr-ui-session-'+(++sessionNumber);}
  if(command==='computer_stop'){approved=false;return;}
  if(command==='computer_observe'||command==='computer_screenshot'){
    wire={observationId:'ocr-ui-observation-'+(++generation),generation,imageDataUrl:image,originX:-800,originY:0,width:1600,height:600,cursorX:-690,cursorY:110,capturedAt:Date.now(),expiresAt:Date.now()+15000,source:'windows_gdi_virtual_desktop',confidence:1,windowId:'hwnd:ocr-calculator-fixture',windowProcessId:77,windowBounds:{x:-800,y:0,width:800,height:600},monitorId:'left',monitorBounds:{x:-800,y:0,width:800,height:600},scaleFactor:1,coordinateSpace:'physical_virtual_desktop',uiaAvailable:false,ocrAvailable:true};
    if(command==='computer_observe')pre=wire;return wire;
  }
  if(command==='computer_locate'){
    if(mode==='uia-success')return {targetId:'uia:fixture:'+hash('uia'),x:-700,y:100,width:20,height:20};
    const error=mode.startsWith('ineligible:')?mode.slice(11):mode==='provider-unavailable'?'UIA_PROVIDER_UNAVAILABLE':'UIA_TARGET_NOT_FOUND';throw new Error(error);
  }
  if(command==='computer_locate_ocr'){
    issuedIntent=args.postcondition;
    if(mode==='duplicate')throw new Error('OCR_TARGET_AMBIGUOUS');
    target={contractVersion:2,amendment:'2.1',targetId:'ocr-ui-'+generation,observationId:wire.observationId,observationGeneration:wire.generation,provenance:'ocr',confidence:1,textFingerprint:hash(args.query),physicalBounds:{x:-700,y:100,width:20,height:20,coordinateSpace:'physical_virtual_desktop'}};
    if(mode==='outside')target.physicalBounds.x=-900;
    if(mode==='stale')target.observationId='older-observation';
    const row={target,windowId:wire.windowId,windowProcessId:77,imagePathFingerprint:hash('calculator.exe'),expiresAt:wire.capturedAt+4000};
    if(mode==='lease-expired')await new Promise(resolve=>setTimeout(resolve,4300));
    if(mode==='hold-locate'||mode==='session-expiry'){if(mode==='session-expiry')sessionUntil=Date.now()+200;await hold();}
    return row;
  }
  if(command==='computer_action'){
    lastAction=args.request;
    return {...lastAction,injected:mode!=='not-injected',dispatchStatus:mode==='partial'?'failed':'dispatched',...(mode==='partial'?{partialInputInjected:true,releaseConfirmed:false,errorCode:'NATIVE_DISPATCH_INTERRUPTED'}:{}),cursorX:-690,cursorY:110,verification:'input_injected_outcome_unverified',verificationStatus:'pending_post_observation',preObservationId:pre.observationId,attempts:1};
  }
  if(command==='computer_ocr_readback'){
    const receipt:any={source:'native_operator',kind:'ocr_semantic_transition',targetId:target.targetId,canonicalActionId:lastAction.actionId,preObservationId:pre.observationId,postObservationId:wire.observationId,preGeneration:pre.generation,postGeneration:wire.generation,windowId:wire.windowId,windowProcessId:77,imagePathFingerprint:hash('calculator.exe'),preTextFingerprint:hash(issuedIntent.beforeText),postTextFingerprint:hash(issuedIntent.afterText),expectedTextFingerprint:hash(issuedIntent.afterText),matched:true,observedAt:Date.now()};
    if(mode==='no-receipt')return null;
    if(mode==='mismatch-action')receipt.canonicalActionId='unrelated';
    if(mode==='mismatch-text')receipt.postTextFingerprint=hash('unrelated');
    if(mode==='mismatch-window')receipt.windowId='hwnd:unrelated';
    if(mode==='hold-readback')await hold();
    return receipt;
  }
  throw new Error('Unexpected OCR fixture command '+command);
}
const count=(command:string)=>nativeCalls.filter(call=>call.command===command).length;
const wait=async(predicate:()=>Promise<boolean>|boolean,label:string)=>{const until=Date.now()+20000;while(Date.now()<until){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Wait timed out: '+label);};
try{
  const [{default:express},{createServer},{createOwnerSessionRouter},{createComputerUseRouter},{createKillSwitchRouter},{getNativeTaskBinding},{getMobileRuntime},{getEdithPersistenceStore}]=await Promise.all([import('express'),import('node:http'),import('../server/security/ownerSession'),import('../server/routes/computerUse'),import('../server/routes/killSwitch'),import('../server/computer/nativeTaskBinding'),import('../server/mobile/runtime'),import('../src/edith/persistence')]);
  closeServices=()=>{getNativeTaskBinding().close();getMobileRuntime().realtime.shutdown();(getEdithPersistenceStore() as any).close?.();};
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{if(req.path.startsWith('/api/')&&req.method==='POST'&&req.path!=='/api/security/session')journal.push({route:req.path,body:req.body});next();});
  app.use(createOwnerSessionRouter());app.use(createComputerUseRouter());app.use(createKillSwitchRouter());
  app.post('/fixture/native',async(req,res)=>{try{res.json({result:await invoke(req.body.command,req.body.args)});}catch(error){res.json({error:(error as Error).message});}});
  server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(origin+'/api/security/session',{method:'POST',headers:{origin,authorization:'Bearer '+process.env.EDITH_OWNER_TOKEN}});assert.equal(login.status,201);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const frontend=path.join(root,'frontend');fs.mkdirSync(frontend);fs.cpSync(path.join(repo,'src'),path.join(frontend,'src'),{recursive:true});fs.symlinkSync(path.join(repo,'node_modules'),path.join(frontend,'node_modules'),'junction');
  fs.writeFileSync(path.join(frontend,'package.json'),'{"type":"module"}');fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  fs.writeFileSync(path.join(frontend,'entry.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import './src/index.css';import {ComputerUseScreen} from './src/components/ui/edithOS';window.__TAURI__={core:{invoke:async(command,args)=>{const response=await fetch('/fixture/native',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});const row=await response.json();if(row.error)throw new Error(row.error);return row.result;}}};createRoot(document.getElementById('root')).render(<div className="min-h-screen bg-slate-950 text-white"><ComputerUseScreen/></div>);`);
  const {createServer:createVite}=await import('vite');const react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
  vite=await createVite({configFile:false,root:frontend,envDir:frontend,envPrefix:'NO_PRODUCT_ENV_',cacheDir:path.join(root,'cache'),plugins:[react(),tailwind()],server:{middlewareMode:true,hmr:false},clearScreen:false});app.use(vite.middlewares);
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1366,height:1000}});await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin,httpOnly:true,sameSite:'Strict'}]);
  page=await context.newPage();page.on('pageerror',(error:any)=>pageErrors.push(error.message));await page.goto(origin);
  await page.getByRole('button',{name:'Start approved session'}).click();await page.getByRole('button',{name:'Refresh view',exact:true}).waitFor();await wait(()=>page.getByRole('button',{name:'Refresh view',exact:true}).isEnabled(),'owner approval');
  await page.getByText('Advanced native input diagnostics',{exact:true}).click();
  const button=page.getByRole('button',{name:'Click intended transition',exact:true}),optIn=page.getByLabel('Enable explicit OCR transition'),outcome=page.getByLabel('OCR transition result');
  assert.equal(await button.isDisabled(),true);assert.equal(await optIn.isDisabled(),true);checks.push('no_explicit_intent_no_transition_button');
  const beforeAbsent=count('computer_locate_ocr');await page.getByRole('button',{name:'Click test',exact:true}).click();await page.getByRole('alert').filter({hasText:/UIA_TARGET_NOT_FOUND/}).waitFor();assert.equal(count('computer_locate_ocr'),beforeAbsent);assert.equal(count('computer_action'),0);checks.push('existing_two_argument_uia_only_no_ocr_fallback');
  const fill=async()=>{await page.getByLabel('OCR target query').fill(intent.query);await page.getByLabel('OCR before text').fill(intent.before);await page.getByLabel('OCR after text').fill(intent.after);};
  const run=async(nextMode:string,expected:string)=>{mode=nextMode;await fill();await optIn.check();assert.equal(await button.isEnabled(),true);await button.click();await outcome.filter({hasText:expected}).waitFor();assert.equal(await optIn.isChecked(),false);assert.equal(await button.isDisabled(),true);checks.push(nextMode);};
  await fill();assert.equal(await button.isDisabled(),true);checks.push('intent_fields_without_one_shot_opt_in_cannot_dispatch');
  for(const eligible of ['eligible','provider-unavailable']){const prior=count('computer_action');await run(eligible,'Local OCR semantic transition verified.');assert.equal(count('computer_action'),prior+1);const action=lastAction;assert.equal(action.action,'clickMouse');assert.equal(action.button,'left');assert.equal(action.attempt,1);assert.equal(action.target.provenance,'ocr');assert.equal(action.x,-690);}
  for(const width of [1366,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(reports,'ocr-verified-'+width+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);}
  await page.setViewportSize({width:1366,height:1000});
  const unavailable='Intended transition unavailable, stale or unverified; no verified outcome.';
  const partial='Intended transition remains unverified; input or pixel change is insufficient.';
  for(const code of ['UIA query is ambiguous; require a unique target name','UIA traversal time budget exceeded','permission_denied','UIA_PROVIDER_UNAVAILABLE: detail','unknown error']){const nativeBefore=count('computer_locate_ocr'),dispatchBefore=count('computer_action');await run('ineligible:'+code,unavailable);assert.equal(count('computer_locate_ocr'),nativeBefore);assert.equal(count('computer_action'),dispatchBefore);}
  for(const invalid of ['duplicate','outside','stale','lease-expired']){const prior=count('computer_action');await run(invalid,unavailable);assert.equal(count('computer_action'),prior);}
  for(const invalid of ['partial','not-injected','no-receipt','mismatch-action','mismatch-text','mismatch-window']){const priorRead=count('computer_ocr_readback');await run(invalid,partial);if(['partial','not-injected'].includes(invalid))assert.equal(count('computer_ocr_readback'),priorRead);}
  const ocrBeforeUiA=count('computer_locate_ocr');await run('uia-success',partial);assert.equal(count('computer_locate_ocr'),ocrBeforeUiA);checks.push('uia_target_success_does_not_fallback_or_fabricate_semantic_click_proof');
  for(const stopped of ['hold-locate','hold-readback']){
    mode=stopped;await fill();await optIn.check();const dispatchBefore=count('computer_action');await button.click();await wait(()=>holding,'held '+stopped);
    assert.equal(await outcome.count(),0);await page.getByRole('button',{name:/^Stop now/}).click();releaseHold!();await wait(()=>!holding,'released '+stopped);await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await outcome.count(),0);if(stopped==='hold-locate')assert.equal(count('computer_action'),dispatchBefore);
    mode='eligible';await page.getByRole('button',{name:'Start approved session'}).click();await wait(()=>page.getByRole('button',{name:'Refresh view',exact:true}).isEnabled(),'fresh approval');checks.push('stop_'+stopped);
  }
  mode='session-expiry';await fill();await optIn.check();const expiryInputs=count('computer_action');await button.click();await wait(()=>holding,'held expiry');
  await wait(()=>page.getByText('Session',{exact:true}).locator('..').getByText('INACTIVE',{exact:true}).isVisible(),'expired owner session revoked');releaseHold!();await wait(()=>!holding,'expired native return');await new Promise(resolve=>setTimeout(resolve,150));assert.equal(await outcome.count(),0);assert.equal(count('computer_action'),expiryInputs);checks.push('delayed_session_expiry_no_dispatch_or_late_success');
  const journalText=JSON.stringify(journal);for(const raw of Object.values(intent))assert.equal(journalText.includes(raw),false,'Raw OCR owner intent never enters reporting journal');
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('OCR_')),false);assert.equal((await page.locator('body').innerText()).includes('100%'),false);assert.deepEqual(pageErrors,[]);
  fs.writeFileSync(path.join(reports,'evidence.json'),JSON.stringify({status:'PASS',actualReactCSS:true,actualDefaultClientAdapter:true,realOwnerReportingRoutes:true,physicalAcceptance:false,providerAcceptance:false,checks,nativeCalls,journal,pageErrors,sourceHashes,limitations:['Full production App boot is not exercised','UIA target resolution succeeds without OCR but generic click remains partial without independent semantic proof']},null,2));
  console.log('PASS actual React/CSS/default client+adapter OCR opt-in UI; native OCR/input synthetic, physicalAcceptance=false');
}catch(error){fs.writeFileSync(path.join(reports,'failure.json'),JSON.stringify({error:String(error),mode,checks,nativeCalls,journal,pageErrors,sourceHashes},null,2));await page?.screenshot({path:path.join(reports,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
  releaseHold?.();await browser?.close();await vite?.close();closeServices();
  if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('edith-ocr-ui-'));
  try{fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}finally{fs.writeFileSync(path.join(reports,'cleanup.json'),JSON.stringify({root,tempRemoved:!fs.existsSync(root),browserClosed:true,viteClosed:true,serverClosed:!server?.listening,pid:process.pid,sourceHashes},null,2));}
}
