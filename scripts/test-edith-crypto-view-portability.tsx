import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

// Actual CryptoView/React/browser. Every API response is synthetic and intercepted;
// no app server, crypto runtime, local AI, provider, database or user configuration is loaded.
assert.equal(process.env.EDITH_TEST_MODE,'true');
const repo=fs.realpathSync('.'), reports=path.join(repo,'artifacts/repair-20261006/chat2/overnight-crypto-view-portability');
const run=path.join(reports,'runs',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-crypto-view-portability-'));
process.env.PLAYWRIGHT_BROWSERS_PATH??=path.join(repo,'runtime/Packages/Playwright-Browsers');
const sourcePath=path.join(repo,'src/components/views/CryptoView.tsx'), source=fs.readFileSync(sourcePath,'utf8');
const checks:string[]=[],requests:Array<{scenario:string;method:string;path:string}>=[],errors:string[]=[],unexpected:string[]=[];
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const sourceHash=hash(sourcePath);
fs.symlinkSync(path.join(repo,'src'),path.join(root,'src'),'junction');
fs.symlinkSync(path.join(repo,'node_modules'),path.join(root,'node_modules'),'junction');
fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
fs.writeFileSync(path.join(root,'index.html'),'<html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
fs.writeFileSync(path.join(root,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import'./src/index.css';import{CryptoView}from'./src/components/views/CryptoView';createRoot(document.getElementById('root')).render(<CryptoView/>);`);
let vite:any,browser:any,passed=false;
try{
 const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
 const {chromium}=await import('playwright');
 vite=await createServer({configFile:false,root,envDir:root,envPrefix:'ISOLATED_NO_PRODUCT_ENV_',cacheDir:path.join(root,'cache'),plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:0},clearScreen:false});await vite.listen();
 const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 browser=await chromium.launch({headless:true});
 const backendPath='Q:\\Synthetic runtime\\gözlem "<script>window.__unexpected=1</script>"';
 const healthy=(projectPath?:string,running=false)=>({success:true,status:{dashboardUrl:'http://synthetic.invalid',...(projectPath===undefined?{}:{projectPath}),healthy:true,runtime:{state:running?'RUNNING':'STOPPED',observerRunning:running,runtimeMode:'OBSERVER_ONLY',ollamaAvailable:false,tradingEnabled:false,paperTradingEnabled:false,liveTradingEnabled:false}}});
 const cases:Array<{name:string;mode:string;body?:any;status?:number}>= [
  {name:'fetch-failure',mode:'abort'},
  {name:'non-success-status',mode:'json',status:503,body:healthy(backendPath,true)},
  {name:'success-false',mode:'json',body:{success:false,error:'Synthetic status unavailable',status:healthy(backendPath,true).status}},
  {name:'missing-status',mode:'json',body:{success:true}},
  {name:'missing-path-offline',mode:'json',body:{success:true,status:{healthy:false}}},
  {name:'missing-path-healthy',mode:'json',body:healthy()},
  {name:'legitimate-path-and-actions',mode:'json',body:healthy(backendPath)},
  {name:'healthy-then-failure',mode:'json',body:healthy(backendPath,true)},
 ];
 for(const scenario of cases){
  const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
  await page.addInitScript(()=>{(window as any).__name=(v:any)=>v;});
  page.on('pageerror',(e:any)=>errors.push(scenario.name+':'+e.message));
  let mode=scenario.mode,body=scenario.body,status=scenario.status??200,actions=0,reads=0;
  await page.route('**/*',async(route:any)=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin){unexpected.push(url.origin+url.pathname);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   requests.push({scenario:scenario.name,method:request.method(),path:url.pathname});
   if(url.pathname==='/api/edith/crypto/status'){
    reads++;if(mode==='abort')return route.abort('failed');
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   }
   if(url.pathname==='/api/security/session')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session:{csrfToken:'synthetic-csrf',actor:'owner'}})});
   if(['/api/edith/crypto/start','/api/edith/crypto/stop'].includes(url.pathname)){
    assert.equal(request.method(),'POST');assert.equal(request.headers()['x-edith-csrf-token'],'synthetic-csrf');actions++;
    body=healthy(backendPath,url.pathname.endsWith('/start'));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   }
   if(['/api/obsidian-status','/api/learning-notes','/api/overview','/api/observations','/api/markets','/api/risk'].includes(url.pathname))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
   unexpected.push(url.pathname);return route.abort();
  });
  await page.goto(origin);
  const start=page.getByRole('button',{name:'Start Market Observer'}),stop=page.getByRole('button',{name:'Stop Market Observer'});
  await start.waitFor();
  if(['missing-path-healthy','legitimate-path-and-actions','healthy-then-failure'].includes(scenario.name)){
   await page.getByText('service STOPPED',{exact:true}).waitFor().catch(async()=>{await page.getByText('service RUNNING',{exact:true}).waitFor();});
   assert.match(await page.locator('body').innerText(),/Crypto service is online; Ollama\/local AI is offline/);checks.push(scenario.name+': healthy service preserved with AI offline');
  }else{
   await page.getByText('Crypto observer bekleniyor',{exact:true}).waitFor();
   if(['fetch-failure','non-success-status','success-false','missing-status'].includes(scenario.name))await page.locator('p').filter({hasText:/Failed to fetch|Crypto status unavailable|Synthetic status unavailable/}).waitFor();
   assert.equal(await page.getByText('service RUNNING',{exact:true}).count(),0);assert.equal(await stop.isDisabled(),true);checks.push(scenario.name+': unavailable never becomes healthy/running');
  }
  if(scenario.name==='legitimate-path-and-actions'){
   await page.getByText(backendPath,{exact:true}).waitFor();
   assert.equal(await page.getByText(backendPath,{exact:true}).evaluate((e:any)=>e.tagName),'SPAN');
   assert.equal(await page.locator('pre').count(),0);assert.equal(await page.getByRole('link').count(),0);assert.equal(await page.evaluate(()=>(window as any).__unexpected),undefined);
   await start.click();await page.getByText('service RUNNING',{exact:true}).waitFor();assert.equal(await start.isDisabled(),true);assert.equal(await stop.isDisabled(),false);
   await stop.click();await page.getByText('service STOPPED',{exact:true}).waitFor();assert.equal(actions,2);checks.push('backend path is inert text; existing owner-CSRF start/stop controls work with intercepted synthetic routes');
  }else if(scenario.name==='healthy-then-failure'){
   await page.getByText(backendPath,{exact:true}).waitFor();mode='abort';await page.getByRole('button',{name:'Yenile'}).click();
   await page.getByText('Failed to fetch',{exact:true}).waitFor();assert.equal(await page.getByText(backendPath,{exact:true}).count(),0);assert.equal(await stop.isDisabled(),true);await page.getByText('Project',{exact:true}).locator('..').getByText('Unavailable',{exact:true}).waitFor();checks.push('refresh failure clears prior backend path/running state');
  }else{
   assert.equal(await page.getByText(backendPath,{exact:true}).count(),0);await page.getByText('Project',{exact:true}).locator('..').getByText('Unavailable',{exact:true}).waitFor();checks.push(scenario.name+': explicit unavailable and no fabricated backend project path');
  }
  const text=await page.locator('body').innerText();assert.match(text,/Sistem OBSERVER_ONLY modundadır; gerçek veya sanal al\/sat işlemi yapmaz/);assert.match(text,/Paper trading disabled, live trading locked/);assert.match(text,/EDITH Ollama server başlatmaz/);assert.doesNotMatch(text,/\.venv|run_agent\.py|^cd\s/im);
  assert.equal(actions,scenario.name==='legitimate-path-and-actions'?2:0);assert.ok(reads>=1);checks.push(scenario.name+': observer safety and no shell startup guidance');
  await context.close();
 }
 assert.doesNotMatch(source,/\.venv|run_agent\.py|projectPath:\s*['"]C:/);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(hash(sourcePath),sourceHash);passed=true;
}finally{
 await browser?.close();await vite?.close();
 // Only the current freshly created fixture directory is removed; Windows junctions are unlinked, never traversed.
 const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('edith-crypto-view-portability-'));
 for(const name of ['src','node_modules']){const link=path.join(resolved,name);assert.ok(fs.lstatSync(link).isSymbolicLink());fs.unlinkSync(link);}
 fs.rmSync(resolved,{recursive:true,force:true});
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({pass:passed,checks,requests,pageErrors:errors,unexpectedRequests:unexpected,sourceHash,classification:'Actual CryptoView React module and Chromium; HTTP fixtures synthetic/intercepted, zero real crypto/provider/AI/backend or native execution',cleanup:{browserClosed:true,viteClosed:true,ownTempRemoved:!fs.existsSync(root)},visualAcceptance:'NOT_CLAIMED'},null,2));
 console.log(JSON.stringify({pass:passed,checks:checks.length,run}));
}
