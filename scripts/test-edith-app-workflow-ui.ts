import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// This runner borrows ONLY the native command fixture/setup from the existing
// mounted producer test. Browser HTTP responses and task events are never seeded.
// Synthetic native UIA/input is NOT physical Windows acceptance.
const repo = path.resolve('.');
const reports = path.join(repo, 'artifacts/repair-20261006/chat2/w4-app-workflow-ui/tests');
fs.mkdirSync(reports, { recursive: true });
const run = path.join(reports, new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(run);
assert.equal(process.env.EDITH_TEST_MODE, 'true', 'Use isolated test mode');
assert.ok(process.env.EDITH_TEST_DATA_DIR, 'Never open user persistence');
const prepareOnly=process.env.EDITH_W4_PREPARE_ONLY==='1';
if(!prepareOnly)assert.equal(process.env.EDITH_W4_WRITERS_STOPPED, '1', 'Coordinator STOP gate is required before the joint run');
const testData=path.resolve(process.env.EDITH_TEST_DATA_DIR!);
if(!prepareOnly){assert.ok(testData.startsWith(path.resolve(os.tmpdir())+path.sep)&&/^edith-w4-ui-[a-f0-9]{32}$/.test(path.basename(testData)),'Use a fresh owned GUID testdata directory under the system temporary root');assert.equal(fs.existsSync(testData),false,'Never reuse or erase prior persistence');}
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-workflow-ui-'));
const source = fs.readFileSync(path.join(repo, 'scripts/test-edith-app-workflows.ts'), 'utf8').replace(/\r/g, '');
function cut(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Mounted harness anchor changed: ${start}`);
  return source.slice(a, b);
}
const bootstrap = cut("import assert from 'node:assert/strict';", 'try{\n  assert.deepEqual').replace(/\r/g, '');
const mounted = cut('async function mountedProducerHarness(){', '    let id=await prepare();');
const cleanup = source.slice(source.lastIndexOf('  }finally{')).replace('    await stopComputer();','    await uiBrowser?.close();await uiVite?.close();await stopComputer();');
const bridge = String.raw`
    const {createKillSwitchRouter}=await import('../server/routes/killSwitch');
    router.use(createKillSwitchRouter());
    const nativeLog:any[]=[];
    let expired=false,holdApproval=false,approvalHeld=false,releaseApproval:(()=>void)|undefined;
    router.post('/fixture/native',async(req,res)=>{
      try {
        const {command,args}=req.body;
        nativeLog.push({command,workflowId:args?.workflowId,actionId:args?.request?.actionId});
        if(command==='computer_begin'&&holdApproval){approvalHeld=true;await new Promise<void>(resolve=>{releaseApproval=resolve;});approvalHeld=false;}
        if(command==='computer_status'&&expired)return res.json({result:{runtime:'tauri',mode:'disabled',available:false,ownerCommandMode:false,killSwitch:'inactive',safeMessage:'Synthetic expired native owner session'}});
        const result=await fixtureCore.invoke(command,args);res.json({result});
      }catch(error){res.json({error:String(error)});}
    });
    const frontend=path.join(UI_FIXTURE_ROOT,'frontend');fs.mkdirSync(frontend);
    fs.cpSync(path.resolve('src'),path.join(frontend,'src'),{recursive:true});
    fs.symlinkSync(path.resolve('node_modules'),path.join(frontend,'node_modules'),process.platform==='win32'?'junction':'dir');
    fs.writeFileSync(path.join(frontend,'package.json'),' {"type":"module"}');
    fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
    fs.writeFileSync(path.join(frontend,'entry.tsx'),UI_ENTRY);
    const {createServer:createVite}=await import('vite');
    const react=(await import('@vitejs/plugin-react')).default;
    const tailwind=(await import('@tailwindcss/vite')).default;
    uiVite=await createVite({configFile:false,root:frontend,envDir:frontend,envPrefix:'NO_PRODUCT_ENV_',cacheDir:path.join(UI_FIXTURE_ROOT,'cache'),plugins:[react(),tailwind()],server:{middlewareMode:true,hmr:false},optimizeDeps:{entries:[path.join(frontend,'entry.tsx')]},clearScreen:false});
    router.use(uiVite.middlewares);
    const {chromium}=await import('playwright');
    uiBrowser=await chromium.launch({headless:true,...(process.env.EDITH_TEST_CHROMIUM?{executablePath:process.env.EDITH_TEST_CHROMIUM}:{})});
    const context=await uiBrowser.newContext({viewport:{width:1366,height:900}});
    await context.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:origin,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();const errors:string[]=[],browserHTTP:any[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',async response=>{const route=new URL(response.url()).pathname;if(/^\/api\/(?:computer-use\/workflows\/[^/]+|files\/explorer\/(?:find-plans|plans)\/[^/]+(?:\/execute)?)$/.test(route)){try{browserHTTP.push({route,status:response.status(),body:await response.json()});}catch{}}});
    const wait=async(predicate:()=>Promise<boolean>,label:string)=>{const until=Date.now()+20000;while(Date.now()<until){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('UI wait timed out: '+label);};
    const dispatch=async(descriptor:string,request:any)=>page.evaluate(({descriptor,request})=>(window as any).ui.dispatch(descriptor,request),{descriptor,request});
    const results=()=>page.evaluate(()=>(window as any).ui.results);
    const screenshotAffected=async(name:string)=>{for(const width of [1366,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(UI_REPORTS,name+'-'+width+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,name+' '+width+' horizontal overflow');}await page.setViewportSize({width:1366,height:900});};
    const result=async(index:number)=>{await wait(async()=> (await results()).length>index,'canonical result '+index);return (await results())[index].result;};
    const canonical=(value:any)=>{
      assert.equal(value.status,'verified',JSON.stringify(value));assert.equal(value.taskBinding,'registered');
      assert.equal(value.taskState,'COMPLETED');assert.equal(value.physicalAcceptance,false);
      assert.ok(value.taskId&&!value.taskId.startsWith('ui-'),'Canonical ID must come from backend');
      const actual=taskService.getTask(value.taskId)!;assert.ok(actual);
      assert.equal(actual.status,'COMPLETED');assert.equal(actual.verification?.status,'PASS');
      const required=actual.verification!.checks.filter(check=>check.required);assert.ok(required.length>0);required.forEach(check=>assert.equal(check.status,'PASS'));
      canonicalEvidence.push({taskId:actual.id,bindingId:value.bindingId,status:actual.status,verification:actual.verification,events:projectTaskEventsV2(actual).events});
      return actual;
    };
    try{
    await page.goto(origin);await page.getByRole('button',{name:'Start approved session'}).waitFor();
    await dispatch('ui-open',{app:'spotify',workflow:'open'});
    assert.equal((await results()).length,0,'No native action before explicit owner start');
    await page.getByRole('button',{name:'Start approved session'}).click();
    const opened=await result(0);canonical(opened);
    const region=page.getByRole('region',{name:'Canonical workflow result'});await region.getByText(opened.taskId,{exact:false}).waitFor();
    await screenshotAffected('canonical-result');
    const openedCalls=openCalls;
    await dispatch('ui-open',{app:'spotify',workflow:'open'});await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(openCalls,openedCalls,'Same descriptor cannot dispatch twice');assert.equal((await results()).length,1);
    partial=true;await dispatch('ui-partial',{app:'spotify',workflow:'play'});const partialResult=await result(1);partial=false;
    assert.equal(partialResult.status,'partial');assert.notEqual(taskService.getTask(partialResult.taskId!)?.verification?.status,'PASS');
    await region.waitFor();assert.ok((await region.innerText()).includes(partialResult.taskId));
    unsupported=true;await dispatch('ui-unsupported',{app:'spotify',workflow:'pause'});const rejected=await result(2);unsupported=false;
    assert.notEqual(rejected.status,'verified');assert.notEqual(taskService.getTask(rejected.taskId!)?.verification?.status,'PASS');
    holdOpen=true;await dispatch('ui-cancel',{app:'spotify',workflow:'play'});
    await wait(async()=>Boolean(pausedOpen),'held app opener');const inputsBeforeStop=inputCalls;
    await page.getByRole('button',{name:/^Stop now/}).click();pausedOpen!();holdOpen=false;pausedOpen=undefined;
    await wait(async()=>!heldWorkflow,'stopped reservation');await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(inputCalls,inputsBeforeStop,'Stop prevents post-await native input');
    assert.equal((await results()).length,3,'Late cancelled completion cannot publish canonical success callback');
    holdApproval=true;await dispatch('ui-global-approval',{app:'spotify',workflow:'play'});
    await page.getByRole('button',{name:'Start approved session'}).click();await wait(async()=>approvalHeld,'pending native approval');
    await page.evaluate(()=>window.dispatchEvent(new Event('edith-computer-stop')));holdApproval=false;releaseApproval!();
    await wait(async()=>!approvalHeld&&!(await page.getByRole('button',{name:'Start approved session'}).isDisabled()),'global stop approval completion');
    const inputsAfterGlobal=inputCalls;await page.getByRole('button',{name:'Start approved session'}).click();
    await wait(async()=>await page.getByRole('button',{name:'Start approved session'}).isDisabled(),'explicit fresh empty approval');
    await new Promise(resolve=>setTimeout(resolve,150));assert.equal(inputCalls,inputsAfterGlobal,'Global stop during approval clears pending descriptor before later approval');
    assert.equal((await results()).length,3,'No old task replay after pending approval was stopped');
    await page.getByRole('button',{name:/^Stop now/}).click();
    await dispatch('ui-recover',{app:'steam',workflow:'library'});await page.getByRole('button',{name:'Start approved session'}).click();canonical(await result(3));
    expired=true;await wait(async()=>await page.getByText('Session',{exact:true}).locator('..').getByText('INACTIVE',{exact:true}).isVisible()&&await page.getByRole('button',{name:'Start approved session'}).isDisabled(),'native owner expiry revoke observed');
    const callsAtExpiry=inputCalls;await dispatch('ui-expired',{app:'spotify',workflow:'play'});await new Promise(resolve=>setTimeout(resolve,150));assert.equal(inputCalls,callsAtExpiry);expired=false;
    // Refresh status uses the actual UI polling effect; reapproval remains explicit.
    await wait(async()=>!(await page.getByRole('button',{name:'Start approved session'}).isDisabled()),'owner status restored');
    await page.getByRole('button',{name:'Start approved session'}).click();canonical(await result(4));
    await page.getByRole('button',{name:'fixture files',exact:true}).click();
    const sourceButton=page.getByRole('button',{name:/workspace\/source\/owned.txt/});await sourceButton.click();
    const consent=page.getByLabel('Seçili Explorer işlemini onaylıyorum');
    const destination=page.getByLabel('Explorer hedef klasörü');await destination.waitFor();
    const directories=await page.evaluate(async()=>{const response=await fetch('/api/files/explorer/directories',{credentials:'include'});return {status:response.status,data:await response.json()};});assert.equal(directories.status,200);const directoryBody=directories.data;
    const destinationRow=directoryBody.directories.find((entry:any)=>entry.relativePath==='destination');assert.ok(destinationRow);
    assert.match(destinationRow.id,/^[a-f0-9]{64}$/);await destination.selectOption(destinationRow.id);
    assert.equal(await page.getByRole('button',{name:'Kopyala',exact:true}).isDisabled(),true,'No Explorer request without explicit consent');
    await consent.check();await screenshotAffected('explorer-selected');await page.getByRole('button',{name:'Explorer’da bul',exact:true}).click();
    await page.getByRole('button',{name:'Start approved session'}).click();canonical(await result(5));
    const explorerOperation=async(button:string,index:number)=>{
      await page.getByRole('button',{name:'fixture files',exact:true}).click();await sourceButton.click();await destination.selectOption(destinationRow.id);await consent.check();
      await page.getByRole('button',{name:button,exact:true}).click();await page.getByRole('button',{name:'Start approved session'}).click();const value=await result(index);canonical(value);return value;
    };
    const copied=await explorerOperation('Kopyala',6);assert.ok(fs.existsSync(path.join(ownRoot,'destination','owned.txt')));
    await wait(async()=>Boolean(await page.evaluate(()=>(window as any).ui.undoReceipt)),'authoritative copy undo receipt');
    await page.getByRole('button',{name:'fixture files',exact:true}).click();await consent.check();await page.getByRole('button',{name:'Son işlemi geri al',exact:true}).click();await page.getByRole('button',{name:'Start approved session'}).click();canonical(await result(7));
    assert.equal(fs.existsSync(path.join(ownRoot,'destination','owned.txt')),false);
    const moved=await explorerOperation('Taşı',8);assert.equal(fs.existsSync(path.join(ownRoot,'source','owned.txt')),false);assert.ok(fs.existsSync(path.join(ownRoot,'destination','owned.txt')));
    await wait(async()=>Boolean(await page.evaluate(()=>(window as any).ui.undoReceipt)),'authoritative move undo receipt');
    await page.getByRole('button',{name:'fixture files',exact:true}).click();await consent.check();await page.getByRole('button',{name:'Son işlemi geri al',exact:true}).click();await page.getByRole('button',{name:'Start approved session'}).click();canonical(await result(9));
    assert.ok(fs.existsSync(path.join(ownRoot,'source','owned.txt')));assert.equal(fs.existsSync(path.join(ownRoot,'destination','owned.txt')),false);
    for(const width of [1366,390]){await page.setViewportSize({width,height:900});for(const screen of ['files','computer']){await page.getByRole('button',{name:'fixture '+screen,exact:true}).click();await page.screenshot({path:path.join(UI_REPORTS,screen+'-'+width+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,screen+' '+width+' horizontal overflow');}}
    // Advance only this isolated mounted server's clock through the real owner
    // expiry check, then restore it before any native proof. No session is seeded.
    const realNow=Date.now;let expiryResponse:Response;
    try{Date.now=()=>fixtureOwner.expiresAt+1;expiryResponse=await previousFetch(origin+'/api/security/session',{headers:publicHeaders});}
    finally{Date.now=realNow;}
    assert.equal(expiryResponse!.status,401,'Real mounted owner cookie expiry invalidates authority');
    await page.getByRole('button',{name:'Start approved session'}).click();
    await page.getByRole('alert').filter({hasText:/emergency stop state/}).waitFor();
    const actualExpiredInputs=inputCalls;await dispatch('ui-real-owner-expired',{app:'spotify',workflow:'play'});
    await page.getByRole('button',{name:'Start approved session'}).click();assert.equal(inputCalls,actualExpiredInputs,'Real expired owner boundary cannot issue native input');
    assert.equal((await results()).length,10,'Expired backend owner cannot mint canonical completion');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(UI_REPORTS,'evidence.json'),JSON.stringify({status:'PASS',actualReactCSS:true,actualBrowserDefaultClient:true,realMountedBackend:true,realTaskPersistence:true,physicalAcceptance:false,canonicalEvidence,nativeLog,browserHTTP,results:await results(),sourceHashes:UI_SOURCE_HASHES},null,2));
    console.log('PASS mounted actual React/CSS app and Explorer UI/default client with real persisted required checks; native dispatch synthetic, physicalAcceptance=false');
    }catch(error){fs.writeFileSync(path.join(UI_REPORTS,'failure.json'),JSON.stringify({error:String(error),lastPrivateFailure,publicFailure,canonicalEvidence,nativeLog,browserHTTP,results:await results(),pageErrors:errors},null,2));await page.screenshot({path:path.join(UI_REPORTS,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
`;
const entry = String.raw`import React from 'react';import {createRoot} from 'react-dom/client';import './src/index.css';
import {ComputerUseScreen,FilesScreen} from './src/components/ui/edithOS';import {startComputerRuntimeHeartbeat} from './src/edith/computerDesktopClient';import {fetchExplorerUndoReceipt} from './src/edith/filesClient';
window.__TAURI__={core:{invoke:async(command,args)=>{const response=await fetch('/fixture/native',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});const row=await response.json();if(row.error)throw new Error(row.error);return row.result;}}};
const results=[];const explorerRequests=[];window.ui={results,explorerRequests};
function Harness(){const [screen,setScreen]=React.useState('computer');const [task,setTask]=React.useState(null);const [undoReceipt,setUndo]=React.useState();const pending=React.useRef(task);pending.current=task;const receiptEpoch=React.useRef(0);
React.useEffect(()=>startComputerRuntimeHeartbeat(2000),[]);
React.useEffect(()=>{const clear=()=>{receiptEpoch.current++;setUndo(undefined);};window.addEventListener('edith-owner-logout',clear);window.addEventListener('edith-computer-stop',clear);return()=>{receiptEpoch.current++;window.removeEventListener('edith-owner-logout',clear);window.removeEventListener('edith-computer-stop',clear);};},[]);
window.ui.dispatch=(id,request)=>{const descriptor={id,kind:'app_workflow',label:'Fixture '+request.app+' '+request.workflow,request};pending.current=descriptor;setScreen('computer');setTask(descriptor);};window.ui.undoReceipt=undoReceipt;
const explorer=request=>{if(pending.current)return;explorerRequests.push(request);receiptEpoch.current++;setUndo(undefined);window.ui.dispatch('ui-explorer-'+results.length,request);};
const complete=(descriptor,result)=>{results.push({descriptor,result});const receipt=result.effectReceipt;if(pending.current?.id!==descriptor||result.app!=='explorer'||result.status!=='verified'||result.taskState!=='COMPLETED'||result.taskBinding!=='registered'||!result.taskId||!result.bindingId||!receipt?.operationId||!receipt.undoReceiptId||result.workflow==='undo')return;const epoch=receiptEpoch.current;void fetchExplorerUndoReceipt(receipt.operationId,{undoReceiptId:receipt.undoReceiptId,taskId:result.taskId,bindingId:result.bindingId}).then(value=>{if(epoch===receiptEpoch.current&&(!pending.current||pending.current.id===descriptor))setUndo(value);}).catch(()=>{if(epoch===receiptEpoch.current)setUndo(undefined);});};
return <div className="min-h-screen bg-slate-950 text-slate-100"><nav>{['files','computer'].map(s=><button className="p-3" key={s} onClick={()=>setScreen(s)}>fixture {s}</button>)}</nav>{screen==='computer'?<ComputerUseScreen task={task} onTaskHandled={id=>setTask(current=>current?.id===id?null:current)} onWorkflowResult={complete}/>:<FilesScreen undoReceipt={undoReceipt} onExplorerRequest={explorer}/>}</div>};createRoot(document.getElementById('root')).render(<Harness/>);`;
const hashes = Object.fromEntries(['src/edith/computerAppWorkflows.ts','src/edith/computerDesktopClient.ts','src/edith/contracts.ts','src/components/ui/edithOS.tsx','src/edith/filesClient.ts','scripts/test-edith-app-workflows.ts'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));
let generated = bootstrap + `\nconst UI_FIXTURE_ROOT=${JSON.stringify(fixture)};const UI_REPORTS=${JSON.stringify(run)};const UI_SOURCE_HASHES=${JSON.stringify(hashes)};const UI_ENTRY=${JSON.stringify(entry)};let uiBrowser:any,uiVite:any;const canonicalEvidence:any[]=[];\ntry { await mountedProducerHarness(); } finally { await uiBrowser?.close();await uiVite?.close();await stopComputer();globalThis.fetch=previousFetch;(globalThis as any).window=previousWindow;fs.rmSync(fixtureRoot,{recursive:true,force:true}); }\n` + mounted + bridge + cleanup;
function repoImportUrl(file:string){const base=path.resolve(repo,'scripts',file);const actual=[base,base+'.ts',base+'.tsx',path.join(base,'index.ts'),path.join(base,'index.tsx')].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());assert.ok(actual,'Unresolved mounted harness import '+file);return pathToFileURL(actual).href;}
generated = generated.replace(/from '([.][.]\/[^']+)'/g, (_m, file) => `from '${repoImportUrl(file)}'`);
generated = generated.replace(/import\('([.][.]\/[^']+)'\)/g, (_m, file) => `import('${repoImportUrl(file)}')`);
const runtimeFile=path.join(run,'mounted-runtime.ts');fs.writeFileSync(runtimeFile,generated);
if(prepareOnly){const {transformSync}=await import('esbuild');transformSync(generated,{loader:'ts'});transformSync(entry,{loader:'tsx'});fs.writeFileSync(path.join(run,'prepare.json'),JSON.stringify({status:'PASS_SYNTAX_AND_EXTRACTION_ONLY',jointRun:false,sourceHashes:hashes},null,2));fs.rmSync(fixture,{recursive:true,force:true});console.log('PASS mounted harness extraction and actual UI fixture TypeScript/TSX syntax; joint execution gated');process.exit(0);}
const execution=spawnSync(process.execPath,[path.join(repo,'node_modules/tsx/dist/cli.mjs'),runtimeFile],{cwd:repo,env:process.env,encoding:'utf8',timeout:180000});
fs.writeFileSync(path.join(run,'run.log'),execution.stdout+'\n'+execution.stderr);
fs.writeFileSync(path.join(run,'exit.json'),JSON.stringify({exit:execution.status,signal:execution.signal,error:execution.error?.message,sourceHashes:hashes},null,2));
if(fs.existsSync(testData)){fs.cpSync(testData,path.join(run,'persistence'),{recursive:true});fs.rmSync(testData,{recursive:true,force:true});}
fs.writeFileSync(path.join(run,'cleanup.json'),JSON.stringify({testData,isolatedFrontend:fixture,testDataRemoved:!fs.existsSync(testData),childExited:execution.status!==null},null,2));
// Verify the generated module wrote only its owned temporary fixtures before deleting them.
assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(fixture,{recursive:true,force:true});
process.stdout.write(execution.stdout);process.stderr.write(execution.stderr);
assert.equal(execution.status,0,`UI fixture failed; preserve ${run}/run.log`);
