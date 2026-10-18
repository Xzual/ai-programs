import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {NativeMobileConsumerClient,currentNativeStopState,validateFilteredPng} from '../src/edith/nativeMobileConsumerClient';
import type {CrossDeviceDesktopBridge} from '../src/edith/crossDeviceDesktopBridge';
const report='artifacts/repair-20261006/chat2/overnight-consumers/parent';
const checks:string[]=[];
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const head=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([head,data])));return Buffer.concat([size,head,data,sum]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,80,120,200,255]))),chunk('IEND',Buffer.alloc(0))]);
await validateFilteredPng(png,1,1);checks.push('actual PNG compressed pixels validated');
for(const [name,b,w,h] of [['metadata dimensions',png,2,1],['oversized',Buffer.alloc(49153),1,1],['CRC corrupted',Buffer.from(png.map((b,i)=>i===45?b^1:b)),1,1]] as const){await assert.rejects(validateFilteredPng(b,w,h));checks.push(name+' rejected');}
let now=Date.now(),lease:any={liveViewId:'lease-1',ownerSessionBindingId:'owner-1',workspaceId:'workspace-1',sessionId:'session-1',sourceDeviceId:'mobile-1',targetDeviceId:'server-1',ownerApproved:true,expiresAt:new Date(now+10000).toISOString()};
let seq=1,hold:(()=>void)|undefined;
const frame=()=>({metadata:{liveViewId:lease.liveViewId,ownerSessionBindingId:lease.ownerSessionBindingId,workspaceId:lease.workspaceId,sessionId:lease.sessionId,sourceDeviceId:lease.targetDeviceId,targetDeviceId:lease.sourceDeviceId,frameId:'frame-'+seq,sequence:seq,observedAt:new Date(now).toISOString(),width:1,height:1},transport:{mimeType:'image/png',bytesBase64:png.toString('base64'),sizeBytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}});
const bridge={get activeLiveView(){return lease},refresh:async()=>({killSwitchActive:false,backendAvailable:true,ownerAuthorized:true,native:{controlPlaneConnected:true},counts:{transferIntents:99}}),pullLiveViewFrame:async()=>{const f=frame();if(hold)await new Promise<void>(r=>{hold=r});return f}} as unknown as CrossDeviceDesktopBridge;
const client=new NativeMobileConsumerClient(bridge,()=>now);
const task=await client.readCurrentTask('task-1',4);assert.equal(task.association,'configuration_required');assert.equal(task.transfer,'unassociated');assert.equal(task.stop,'unknown');checks.push('global authenticated status and counts never become task verification');
const shown=await client.showRegisteredFrame();assert.equal(shown.sequence,1);assert.equal(shown.expiresAt,now+2000);checks.push('real PNG presented with original two-second TTL');
await assert.rejects(client.showRegisteredFrame());assert.equal(client.currentFrame,undefined);checks.push('duplicate fetch cannot renew TTL');
seq=2;await assert.rejects(client.showRegisteredFrame());checks.push("distinct frame above 2FPS rejected");now+=500;await client.showRegisteredFrame();now+=2001;assert.equal(client.currentFrame,undefined);checks.push('expired pixels and URL cleared');
seq=3;hold=()=>{};const pending=client.showRegisteredFrame();await new Promise(r=>setTimeout(r,0));client.clear();hold!();hold=undefined;await assert.rejects(pending);assert.equal(client.currentFrame,undefined);checks.push('late response after STOP/logout cannot restore frame');
lease=undefined;await assert.rejects(client.showRegisteredFrame());checks.push('no registered lease cannot present pixels');
const receipt={nativeSessionId:'native-1',originalGeneration:0,latchedGeneration:1,observedAt:new Date(now).toISOString(),state:'native_quiescent' as const};
assert.equal(currentNativeStopState(receipt,'native-1',now),'native_quiescent');assert.equal(currentNativeStopState(receipt,'foreign',now),'unknown');assert.equal(currentNativeStopState({...receipt,latchedGeneration:2},'native-1',now),'unknown');assert.equal(currentNativeStopState({...receipt,observedAt:new Date(now+1).toISOString()},'native-1',now),'unknown');checks.push('STOP original zero generation accepted only with matching latch/session/nonfuture receipt');
client.clear();
fs.writeFileSync(report+'/consumer-tests.json',JSON.stringify({status:'PASS',checks,provenance:'Actual consumer and PNG decompression; bridge delivery is SIM, no physical native or canonical task PASS claim',sourceSha256:createHash('sha256').update(fs.readFileSync('src/edith/nativeMobileConsumerClient.ts')).digest('hex')},null,2));
console.log(JSON.stringify({status:'PASS',checks:checks.length}));
// Real browser rendering of the actual components; all native/HTTP delivery below is SIM.
const {chromium}=await import('playwright');
const os=await import('node:os'),path=await import('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edith-wave-c-dom-'));
fs.symlinkSync(path.resolve('src'),path.join(root,'src'),'junction');
fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),'junction');
fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
fs.writeFileSync(path.join(root,'index.html'),'<html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
fs.writeFileSync(path.join(root,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import'./src/index.css';import{CrossDeviceTaskStatus}from'./src/components/tasks/CrossDeviceTaskStatus';import{ComputerUseScreen}from'./src/components/ui/edithOS';createRoot(document.getElementById('root')).render(<><CrossDeviceTaskStatus taskId="actual-ui-task" revision={7} current={true}/><ComputerUseScreen/></>);`);
const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,tailwind=(await import('@tailwindcss/vite')).default;
let vite:any,browser:any;
try{
 vite=await createServer({configFile:false,root,envDir:root,envPrefix:'ISOLATED_NO_PRODUCT_ENV_',cacheDir:path.join(root,'cache'),plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:0},clearScreen:false});await vite.listen();
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1366,height:1100}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{(window as any).__name=(v:any)=>v;(window as any).__TAURI__={core:{invoke:async(c:string)=>{if(c==='computer_status')return {available:true,runtime:'tauri',mode:'read_only',ownerCommandMode:false,sessionExpiresAt:0,safeMessage:'SIM'};throw Error('SIM_UNAVAILABLE');}}};});
 await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,errorCode:'SIM_UNAVAILABLE'})}));
 const address=vite.httpServer.address();await page.goto(`http://127.0.0.1:${address.port}`);
 await page.getByRole('status',{name:'Current task cross-device status'}).waitFor();
 const text=await page.getByRole('status',{name:'Current task cross-device status'}).innerText();assert.match(text,/actual-ui-task/);assert.match(text,/rev 7|revision 7/);assert.match(text,/configuration_required/);assert.doesNotMatch(text,/verified.*PASS|100%/i);
 await page.getByRole('region',{name:'Native mobile session status'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Show registered filtered frame'}).isDisabled(),true);assert.equal(await page.getByAltText('Verified filtered Live View frame').count(),0);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:report+'/desktop-current-task-native-status.png',fullPage:true});
 fs.writeFileSync(report+'/desktop-dom.json',JSON.stringify({status:'PASS',checks:['actual React taskId/revision and honest association unavailable','no registered lease disables frame control','no fake image','no page runtime errors'],provenance:'Real Chromium and actual React/CSS; native/HTTP delivery SIM; no physical or task PASS',retainedOwnTemp:root},null,2));
 console.log('Actual desktop DOM PASS4');
}finally{await browser?.close();await vite?.close();}
