import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseTaskActivityV2, TaskContractError, fetchTaskHudListV1, fetchTaskHudActivityV1, type TaskActivityV2View} from '../src/edith/taskActivityClient';
import ts from 'typescript';
import vm from 'node:vm';

async function workspaceBootstrapTests() {
  assert(fs.existsSync(new URL('../src/components/tasks/taskHudWorkspaceScope.ts',import.meta.url)),'Scoped HUD workspace bootstrap must exist');
  const {parseTaskHudWorkspaceId,fetchTaskHudWorkspaceId}=await import('../src/components/tasks/taskHudWorkspaceScope');
  const body={success:true,configured:true,config:{workspaceId:'synthetic-workspace-A',workspaceRoot:'SYNTHETIC_PRIVATE_PATH',cloud:{token:'SYNTHETIC_NOT_REAL'}},obsidianVaultPath:'SYNTHETIC_VAULT'};
  assert.equal(parseTaskHudWorkspaceId(body),'synthetic-workspace-A');
  assert.equal(parseTaskHudWorkspaceId({...body,configured:false}),undefined);
  for(const invalid of [null,[],{}, {...body,success:false},{...body,configured:'true'},{...body,config:{}},{...body,config:{workspaceId:'../private'}},{...body,config:{workspaceId:' x '}}])assert.throws(()=>parseTaskHudWorkspaceId(invalid));
  let privateReads=0;const config:any={workspaceId:'synthetic-workspace-A'};Object.defineProperty(config,'workspaceRoot',{get(){privateReads++;throw Error('DO_NOT_READ_PRIVATE_EXTRA');}});
  assert.equal(parseTaskHudWorkspaceId({...body,config}),'synthetic-workspace-A');assert.equal(privateReads,0);
  const originalFetch=globalThis.fetch;
  try {
    const calls:string[]=[];globalThis.fetch=(async(input,options)=>{calls.push(String(input));assert.equal(options?.cache,'no-store');assert.equal(options?.credentials,'include');return new Response(JSON.stringify(body));}) as typeof fetch;
    assert.equal(await fetchTaskHudWorkspaceId(),'synthetic-workspace-A');assert.deepEqual(calls,['/api/workspace/status']);
    let bodyReads=0;globalThis.fetch=(async()=>({ok:false,status:403,json:async()=>{bodyReads++;return body;}} as Response)) as typeof fetch;
    await assert.rejects(fetchTaskHudWorkspaceId(),(error:any)=>error.code==='TASK_HTTP_403');assert.equal(bodyReads,0);
    globalThis.fetch=(async()=>new Response('not JSON')) as typeof fetch;await assert.rejects(fetchTaskHudWorkspaceId(),(error:any)=>error.code==='TASK_HUD_WORKSPACE_INVALID');
    const gate=deferred<unknown>(),abort=new AbortController();globalThis.fetch=(async()=>({ok:true,status:200,json:()=>gate.promise} as Response)) as typeof fetch;
    const late=fetchTaskHudWorkspaceId(abort.signal);await flush();abort.abort();gate.resolve(body);await assert.rejects(late,{name:'AbortError'});
  } finally {globalThis.fetch=originalFetch;}
}

async function scopedObserverTests() {
  const {createTaskActivityObserver}=await import('../src/components/tasks/TaskActivityProvider');
  const make=()=>{
    let workspace:string|undefined='workspace-A',clock=2_000_000_000_000;
    const calls:string[]=[],publications:any[]=[],rows=new Map([['A',activity('A',3)],['B',activity('B',3)]]);
    let bootstrap=async(_signal:AbortSignal)=>workspace;
    let list=async(_signal:AbortSignal,_scope:string)=>[...rows.values()].map(row=>row.task);
    let read=async(id:string,_signal:AbortSignal,_scope:string)=>rows.get(id)!;
    let scopeChanges=0;
    const observer=createTaskActivityObserver({readEnabled:true,now:()=>clock,readWorkspace:(signal:AbortSignal)=>{calls.push('workspace');return bootstrap(signal);},
      readList:(signal:AbortSignal,scope:string)=>{calls.push('list:'+scope);return list(signal,scope);},
      readActivity:(id:string,signal:AbortSignal,scope:string)=>{calls.push('activity:'+id+':'+scope);return read(id,signal,scope);},
      onScopeChange:()=>{scopeChanges++;},setInterval:()=>1,clearInterval:()=>{}});
    observer.subscribe(()=>publications.push(observer.getSnapshot()));
    return{observer,calls,publications,rows,get workspace(){return workspace;},set workspace(v){workspace=v;},set bootstrap(v){bootstrap=v;},set list(v){list=v;},set read(v){read=v;},get scopeChanges(){return scopeChanges;},advance:(n:number)=>{clock+=n;}};
  };
  {const f=make();f.observer.start();await flush();assert.equal(f.calls[0],'workspace','Metadata must guard every task read');assert(f.calls.includes('list:workspace-A'));assert(f.calls.includes('activity:A:workspace-A'));assert.equal(f.observer.getSnapshot().workspaceId,'workspace-A');f.observer.stop();}
  {const f=make();f.workspace=undefined;f.observer.start();await flush();assert.deepEqual(f.calls,['workspace']);assert.equal(f.observer.getSnapshot().state,'error');assert.equal(f.observer.getSnapshot().activity,undefined);f.observer.stop();}
  {const f=make();f.observer.start();await flush();await f.observer.select({kind:'explicit',taskId:'A'});f.workspace='workspace-B';f.rows.delete('A');let cleanBeforeList=false;
    f.list=async()=>{const s=f.observer.getSnapshot();cleanBeforeList=!s.activity&&!s.tasks.length&&s.lastSuccessfulReadAt===undefined&&s.selection.kind==='automatic';return[f.rows.get('B')!.task];};
    await f.observer.refresh(true);assert(cleanBeforeList,'Scope change clears prior facts and selector before B list');assert.equal(f.observer.getSnapshot().activity?.task.id,'B');assert.equal(f.observer.getSnapshot().workspaceId,'workspace-B');assert(f.scopeChanges>0);f.observer.stop();}
  for(const code of ['TASK_HTTP_401','TASK_HTTP_403','TASK_HUD_FORBIDDEN']){const f=make();f.observer.start();await flush();await f.observer.select({kind:'explicit',taskId:'A'});f.list=async()=>{throw new TaskContractError('PRIVATE_DENIAL',code);};await f.observer.refresh(true);const s=f.observer.getSnapshot();assert.equal(s.activity,undefined,code);assert.deepEqual(s.tasks,[]);assert.equal(s.lastSuccessfulReadAt,undefined);assert.equal(s.selection.kind,'automatic');assert.equal(s.workspaceId,undefined);assert(!JSON.stringify(s).includes('PRIVATE_DENIAL'));f.observer.stop();}
  {const f=make();f.observer.start();await flush();const successful=f.observer.getSnapshot().lastSuccessfulReadAt;f.list=async()=>{throw new TypeError('PRIVATE_NETWORK');};await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'offline');assert.equal(f.observer.getSnapshot().activity?.task.id,'A','Ordinary offline retains explicitly stale snapshot');assert.equal(f.observer.getSnapshot().lastSuccessfulReadAt,successful);
    f.rows.set('A',activity('A',2));f.list=async()=>[...f.rows.values()].map(row=>row.task);await f.observer.reconnect();assert.equal(f.observer.getSnapshot().state,'error','Reconnect cannot erase same-scope revision fences');assert.equal(f.observer.getSnapshot().activity,undefined);f.observer.stop();}
  for(const outcome of ['success','denial'] as const){const f=make(),gate=deferred<TaskActivityV2View>();f.observer.start();await flush();f.read=async(id)=>id==='A'?gate.promise:f.rows.get('B')!;const old=f.observer.refresh(true);await flush();await f.observer.select({kind:'explicit',taskId:'B'});if(outcome==='success')gate.resolve(activity('A',4));else gate.reject(new TaskContractError('PRIVATE_STALE_DENIAL','TASK_HTTP_401'));await old;assert.equal(f.observer.getSnapshot().activity?.task.id,'B');assert.equal(f.observer.getSnapshot().state,'ready');f.observer.stop();}
  {const f=make(),gate=deferred<string|undefined>();f.bootstrap=async()=>gate.promise;f.observer.start();await flush();f.workspace='workspace-B';f.bootstrap=async()=>f.workspace;await f.observer.select({kind:'explicit',taskId:'B'});gate.resolve('workspace-A');await flush();assert.equal(f.observer.getSnapshot().workspaceId,'workspace-B');assert.equal(f.observer.getSnapshot().activity?.task.id,'B');f.observer.stop();}
  {const f=make(),gate=deferred<TaskActivityV2View>();f.read=async()=>gate.promise;f.observer.start();await flush();f.workspace='workspace-B';gate.resolve(activity('A',3));await flush();assert.equal(f.observer.getSnapshot().workspaceId,'workspace-B');assert.equal(f.observer.getSnapshot().activity,undefined,'Final context recheck must discard A body after workspace switches');f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.bootstrap=async()=>{throw new TaskContractError('PRIVATE_CONFIG_PAYLOAD','TASK_HUD_WORKSPACE_INVALID');};const before=f.calls.length;await f.observer.refresh(true);assert.equal(f.calls.slice(before).filter(c=>c.startsWith('list:')).length,0);assert.equal(f.observer.getSnapshot().activity,undefined);assert(!f.observer.getSnapshot().error.includes('PRIVATE'));f.observer.stop();}
}

async function actualScopedClientTests() {
  const {createTaskActivityObserver}=await import('../src/components/tasks/TaskActivityProvider');
  const {fetchTaskHudWorkspaceId}=await import('../src/components/tasks/taskHudWorkspaceScope');
  const originalFetch=globalThis.fetch,record=activity('A',3),workspaceId='fixture-current-workspace';
  let mode='valid';const calls:string[]=[];
  const envelope=(data:unknown)=>({success:true,contract:{schema:'edith.shared',version:2},...(mode==='old-server'?{}:{hud:{schemaVersion:1,view:'hud-v1',workspaceId:mode==='wrong-workspace'?'foreign-workspace':workspaceId}}),data});
  try {
    globalThis.fetch=(async(input,options)=>{
      const url=String(input);calls.push(url);assert.equal(options?.credentials,'include');assert.equal(options?.cache,'no-store');assert(options?.signal);
      if(url==='/api/workspace/status')return new Response(JSON.stringify({success:true,configured:true,config:{workspaceId,workspaceRoot:'SYNTHETIC_PRIVATE_EXTRA'},cloudMetadata:{secret:'SYNTHETIC_NOT_REAL'}}));
      if(url==='/api/edith/tasks?view=hud-v1') {
        if(mode==='denied-list')return new Response('{}',{status:401});
        return new Response(JSON.stringify(envelope({tasks:mode==='empty'?[]:[record.task]})));
      }
      if(url==='/api/edith/tasks/A/activity?view=hud-v1') {
        if(mode==='denied-activity')return new Response('{}',{status:403});
        return new Response(JSON.stringify(envelope({task:record.task,progress:record.progress,events:[]})));
      }
      throw Error('UNSCOPED_OR_UNKNOWN_ROUTE');
    }) as typeof fetch;
    const make=()=>createTaskActivityObserver({readEnabled:true,readWorkspace:fetchTaskHudWorkspaceId,
      readList:(signal,workspace)=>fetchTaskHudListV1(workspace,signal),readActivity:(id,signal,workspace)=>fetchTaskHudActivityV1(id,workspace,signal),
      now:()=>2_000_000_000_000,setInterval:()=>1,clearInterval:()=>{}});
    const observer=make();observer.start();await flush();await flush();assert.equal(observer.getSnapshot().activity?.task.id,'A');assert.equal(observer.getSnapshot().workspaceId,workspaceId);
    assert(!JSON.stringify(observer.getSnapshot()).includes('SYNTHETIC_PRIVATE_EXTRA'));assert(!JSON.stringify(observer.getSnapshot()).includes('SYNTHETIC_NOT_REAL'));
    mode='denied-activity';await observer.refresh(true);assert.equal(observer.getSnapshot().activity,undefined);assert.equal(observer.getSnapshot().lastSuccessfulReadAt,undefined);observer.stop();
    for(const nextMode of ['old-server','wrong-workspace','denied-list','empty']) {
      mode=nextMode;const f=make();f.start();await flush();await flush();assert.equal(f.getSnapshot().state,mode==='empty'?'empty':'error',mode);assert.equal(f.getSnapshot().activity,undefined);f.stop();
    }
    assert(calls.every(url=>url==='/api/workspace/status'||url.endsWith('?view=hud-v1')),'Every task read is explicitly scoped; no legacy fallback');
    const source=fs.readFileSync(new URL('../src/components/tasks/TaskActivityProvider.tsx',import.meta.url),'utf8');assert(!/fetchTaskListV2|fetchTaskActivityV2/.test(source));
  } finally {globalThis.fetch=originalFetch;}
}

function activity(id: string, revision = 1, title = 'Sentetik görev', status = 'RUNNING'): TaskActivityV2View {
  const progress = {contractVersion: 2, taskId: id, revision, status, percent: status === 'COMPLETED' ? 100 : 20, completedSteps: 0, totalSteps: 0, failedSteps: 0, recoveryAttempts: 0, terminal: status === 'COMPLETED', sources: ['task_status']};
  return parseTaskActivityV2({success: true, contract: {schema: 'edith.shared', version: 2}, data: {task: {id, title, objective: 'synthetic only', priority: 'normal', status, contractVersion: 2, revision, eventSequence: 0}, progress, events: []}});
}
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((r,j) => {resolve=r;reject=j;});return {promise,resolve,reject};}
async function flush() {for (let i=0;i<25;i++) await Promise.resolve();}
async function observerTests() {
  assert(fs.existsSync(new URL('../src/components/tasks/TaskActivityProvider.tsx', import.meta.url)), 'Shared canonical read observer must exist');
  const {createTaskActivityObserver} = await import('../src/components/tasks/TaskActivityProvider');
  const make = (readEnabled = true) => {
    let now = 2_000_000_000_000, a = activity('A'), b = activity('B');
    const calls: string[] = [], timers = new Map<number, () => void>(); let timerId=0;
    let list = async (_signal: AbortSignal) => [a.task,b.task];
    let read = async (id: string,_signal: AbortSignal) => id==='A'?a:b;
    const observer = createTaskActivityObserver({readEnabled, now:()=>now,readWorkspace:async()=> 'synthetic-workspace',
      readList: (signal: AbortSignal) => {calls.push('list');return list(signal);},
      readActivity: (id: string,signal: AbortSignal) => {calls.push(id);return read(id,signal);},
      setInterval: (f:()=>void,_ms:number) => {timers.set(++timerId,f);return timerId;}, clearInterval: (id:unknown)=>{timers.delete(id as number);}});
    return {observer,calls,timers,get a(){return a;},set a(v){a=v;},get b(){return b;},set b(v){b=v;},set list(v){list=v;},set read(v){read=v;},advance:(n:number)=>{now+=n;}};
  };
  {const f=make();f.observer.start();await flush();assert.equal(typeof (f.observer as any).readCanonical,'function','Voice locators require cancellable canonical reads');
    const gate=deferred<TaskActivityV2View>();f.read=async()=>gate.promise;
    const handle=f.observer.readCanonical({taskId:'A',revision:1,eventSequence:0},()=>true);
    assert.equal(f.observer.getSnapshot().selection.kind,'awaiting-task-link');assert.equal(f.observer.getSnapshot().activity,undefined);
    await flush();handle.cancel();gate.resolve(activity('A',2));await flush();assert.equal(f.observer.getSnapshot().activity,undefined);assert.equal(f.observer.getSnapshot().selection.kind,'automatic');assert.equal(f.timers.size,1);f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.observer.readCanonical({taskId:'B',revision:2,eventSequence:0},()=>true);await flush();assert.equal(f.observer.getSnapshot().state,'error','A locator ahead of canonical data must not become progress');assert.equal(f.observer.getSnapshot().activity,undefined);f.observer.stop();}
  {const f=make();f.observer.start();await flush();const handle=f.observer.readCanonical({taskId:'B',revision:1,eventSequence:0},()=>true);await flush();assert.equal(f.observer.getSnapshot().activity?.task.id,'B');await f.observer.select({kind:'explicit',taskId:'A'});handle.cancel();assert.equal(f.observer.getSnapshot().activity?.task.id,'A','Old voice ownership cannot clear a later manual selection');f.observer.stop();}
  {const f=make(false);f.observer.start();await flush();assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);assert.equal(f.observer.getSnapshot().state,'error');f.observer.stop();}
  {const f=make();let publications=0;const unsubscribe=f.observer.subscribe(()=>{publications++;});f.observer.start();f.observer.start();await flush();assert.equal(f.timers.size,1);assert.deepEqual(f.calls,['list','A']);assert.equal(f.observer.getSnapshot().activity?.task.id,'A');assert(publications>0);unsubscribe();f.observer.stop();assert.equal(f.timers.size,0);}
  for (const outcome of ['success','error'] as const) {
    const f=make(),gate=deferred<TaskActivityV2View>();f.observer.start();await flush();
    f.read=async(id)=>id==='A'?gate.promise:f.b;
    const old=f.observer.refresh(true);await flush();await f.observer.select({kind:'explicit',taskId:'B'});
    if(outcome==='success')gate.resolve(activity('A',2));else gate.reject(new Error('PRIVATE_OLD_FAILURE'));
    await old;await flush();assert.equal(f.observer.getSnapshot().activity?.task.id,'B');assert.equal(f.observer.getSnapshot().state,'ready');assert.equal(f.observer.getSnapshot().error,'');f.observer.stop();
  }
  {const f=make(),gate=deferred<TaskActivityV2View>();f.observer.start();await flush();f.read=async()=>gate.promise;const old=f.observer.refresh(true);await flush();f.observer.stop();const before=f.observer.getSnapshot();gate.resolve(activity('A',2));await old;assert.equal(f.observer.getSnapshot(),before);}
  {const f=make();f.observer.start();await flush();await f.observer.select({kind:'explicit',taskId:'MISSING'});assert.equal(f.observer.getSnapshot().activity,undefined);assert.equal(f.observer.getSnapshot().state,'error');f.observer.stop();}
  {const f=make();f.observer.start();await flush();await f.observer.select({kind:'awaiting-task-link'});assert.equal(f.observer.getSnapshot().activity,undefined);assert(!f.calls.slice(-1).includes('A'));f.observer.stop();}
  {const f=make();f.a=activity('A',3);f.observer.start();await flush();const successful=f.observer.getSnapshot().lastSuccessfulReadAt;f.a=activity('A',2);f.advance(12000);await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'error');assert.equal(f.observer.getSnapshot().lastSuccessfulReadAt,successful);assert.equal(f.observer.getSnapshot().activity,undefined);f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.a=activity('A',1,'Conflicting same revision');await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'error');f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.a=activity('A',2,'New revision with unchanged event sequence');await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().activity?.task.revision,2);f.observer.stop();}
  {const f=make();f.observer.start();await flush();const successful=f.observer.getSnapshot().lastSuccessfulReadAt;f.list=async()=>{throw new TypeError('PRIVATE_NETWORK');};f.advance(25000);await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'offline');assert.equal(f.observer.getSnapshot().lastSuccessfulReadAt,successful);assert(!f.observer.getSnapshot().error.includes('PRIVATE'));f.observer.stop();}
  {const f=make();f.observer.start();await flush();await f.observer.select({kind:'explicit',taskId:'B'});f.b=activity('B',2,'Finished pinned task','COMPLETED');await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().activity?.task.id,'B');assert.equal(f.observer.getSnapshot().activity?.task.status,'COMPLETED');f.observer.stop();}
  {const f=make(),gate=deferred<ReturnType<typeof activity>['task'][]>();f.list=async()=>gate.promise;f.observer.start();await flush();f.list=async()=>[f.a.task,f.b.task];await f.observer.select({kind:'explicit',taskId:'B'});gate.resolve([f.a.task]);await flush();assert.equal(f.observer.getSnapshot().activity?.task.id,'B');f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.list=async()=>[f.a.task,f.a.task];await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'error');assert.deepEqual(f.observer.getSnapshot().tasks,[]);f.observer.stop();}
  {const f=make();f.observer.start();await flush();f.read=async()=>f.b;await f.observer.refresh(true);assert.equal(f.observer.getSnapshot().state,'error');assert.equal(f.observer.getSnapshot().activity,undefined);f.observer.stop();}
  {const f=make();f.observer.start();await flush();const before=f.observer.getSnapshot();f.observer.stop();assert.equal(f.observer.getSnapshot().activity,undefined);assert.equal(f.observer.getSnapshot().lastSuccessfulReadAt,undefined);assert.notEqual(f.observer.getSnapshot(),before);assert.deepEqual(f.observer.getSnapshot().tasks,[]);}
  {const f=make();const rows=Array.from({length:70},(_,i)=>activity(`wide-${i}`,3));f.list=async()=>rows.map(row=>row.task);f.read=async(id)=>rows.find(row=>row.task.id===id)!;f.observer.start();await flush();rows[1]=activity('wide-1',2);await f.observer.select({kind:'explicit',taskId:'wide-1'});assert.equal(f.observer.getSnapshot().state,'error','Version fence must survive accepted lists larger than64');f.observer.stop();}
}

function presentationTests() {
  assert(fs.existsSync(new URL('../src/components/tasks/TaskHudHost.tsx', import.meta.url)), 'HUD presentation host must exist');
  const source=fs.readFileSync(new URL('../src/components/tasks/TaskHudHost.tsx',import.meta.url),'utf8');
  const parsed=ts.createSourceFile('TaskHudHost.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=['createTaskHudPresentation','restoreTaskHudFocus','shouldDismissTaskHud'];
  const functions=names.map(name=>{const fn=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(fn,name);return fn.getText(parsed).replace(/^export /,'');});
  const context:any=vm.createContext({});
  vm.runInContext(ts.transpileModule(functions.join('\n')+'\nglobalThis.createPresentation=createTaskHudPresentation;globalThis.restoreFocus=restoreTaskHudFocus;globalThis.dismiss=shouldDismissTaskHud;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
  let reduced=false,serial=0;const callbacks=new Map<number,()=>void>();
  const controller=context.createPresentation({reducedMotion:()=>reduced,setTimeout:(fn:()=>void)=>{callbacks.set(++serial,fn);return serial;},clearTimeout:(id:number)=>{callbacks.delete(id);}});
  controller.show();assert.equal(controller.getSnapshot().visible,true);assert.equal(controller.getSnapshot().phase,'enter');
  controller.hide();const oldExit=[...callbacks.values()][0];assert.equal(controller.getSnapshot().visible,false);assert.equal(controller.getSnapshot().present,true);
  controller.show();oldExit();assert.equal(controller.getSnapshot().visible,true);assert.notEqual(controller.getSnapshot().phase,'hidden','Old exit cannot remove newly shown HUD');
  const count=callbacks.size;controller.show();assert.equal(callbacks.size,count,'Repeated show is idempotent');
  reduced=true;controller.hide();assert.equal(controller.getSnapshot().present,false);assert.equal(callbacks.size,0);controller.show();assert.equal(controller.getSnapshot().phase,'open');
  controller.dispose();assert.equal(controller.getSnapshot().present,false);assert.equal(callbacks.size,0);
  let focused='outside';const panel={contains:(target:unknown)=>target==='inside'};
  const trigger={isConnected:true,focus:()=>{focused='trigger';}};context.restoreFocus(panel,'outside',trigger);assert.equal(focused,'outside');
  context.restoreFocus(panel,'inside',trigger);assert.equal(focused,'trigger');
  focused='unchanged';context.restoreFocus(panel,'inside',{isConnected:false,focus:()=>{focused='bad';}});assert.equal(focused,'unchanged');
  const node=(modal=false)=>({closest:()=>modal?{}:null});const inside=node();const focusPanel={contains:(n:unknown)=>n===inside};
  assert.equal(context.dismiss({key:'Escape',target:inside,defaultPrevented:false},focusPanel),true);
  assert.equal(context.dismiss({key:'Escape',target:node(true),defaultPrevented:false},{contains:()=>true}),false);
  assert.equal(context.dismiss({key:'Escape',target:node(),defaultPrevented:false},focusPanel),false);
  assert.equal(context.dismiss({key:'Escape',target:inside,defaultPrevented:true},focusPanel),false);
  const triggerNode=node();assert.equal(context.dismiss({key:'Escape',target:triggerNode,defaultPrevented:false},focusPanel,{contains:(target:unknown)=>target===triggerNode}),true,'Dedicated invoker must dismiss with Escape');
}

function sharedWiringTests() {
  const ui=fs.readFileSync(new URL('../src/components/ui/edithOS.tsx',import.meta.url),'utf8');
  const parsed=ts.createSourceFile('edithOS.tsx',ui,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const voice=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='VoiceScreen')!.getText(parsed);
  assert(voice.includes('createVoiceTaskHudBridge('),'Actual VoiceScreen must wire accepted voice HUD frames');
  assert(voice.includes('.bindReady(event.sessionId, event.generation!'),'Only accepted real ready binds HUD');
  assert(voice.includes('voiceHudBridge.clear()'),'Actual stop path must clear HUD binding');
  const timeline=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TaskTimeline')!.getText(parsed);
  assert(timeline.includes('useTaskActivitySurface('),'Timeline must consume shared observer');
  assert(!timeline.includes('setInterval('),'Timeline must not own another timer');
  assert(!timeline.includes('fetchTaskListV2('),'Timeline must not own another read loop');
  const capsule=fs.readFileSync(new URL('../src/components/tasks/DynamicTaskCapsule.tsx',import.meta.url),'utf8');
  assert(!capsule.includes('function useTaskActivitySurface('),'Capsule must remove private duplicate observer');
  const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.equal((app.match(/<TaskActivityProvider\b/g)??[]).length,1,'One shared authenticated provider');
  assert.equal((app.match(/<TaskHudHost\b/g)??[]).length,1,'One HUD host across tabs');
  assert(app.includes('readEnabled={authSession.authenticated}'),'Actual authenticated shell must guard scoped reads');
  assert(app.includes('onWorkspaceChange={clearSearchSelection}'),'Workspace change permanently clears retained task search');
  assert(app.includes('taskSearchSelectionForAuthority('),'Search task selection must be synchronously authority masked');
}

function providerAuthorityTests() {
  const source=fs.readFileSync(new URL('../src/components/tasks/TaskActivityProvider.tsx',import.meta.url),'utf8');
  const file=ts.createSourceFile('TaskActivityProvider.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const provider=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TaskActivityProvider')!.getText(file).replace(/^export /,'');
  let cursor=0,serial=0,mockScope=0;const hooks:any[]=[],scopeEffects:Array<()=>void>=[];
  const ReactHooks={createElement:(type:unknown,props:unknown)=>({type,props}),
    useMemo:(factory:()=>unknown,deps:unknown[])=>{const i=cursor++;if(!hooks[i]||deps.some((v,j)=>!Object.is(v,hooks[i].deps[j])))hooks[i]={deps,value:factory()};return hooks[i].value;},
    useState:(initial:unknown)=>{const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],(update:any)=>{hooks[i]=typeof update==='function'?update(hooks[i]):update;}];},
    useCallback:(fn:unknown,_deps:unknown[])=>{cursor++;return fn;},
    useSyncExternalStore:(_subscribe:unknown,read:()=>unknown)=>{cursor++;return read();},useEffect:(effect:()=>void)=>{cursor++;scopeEffects.push(effect);}};
  const context:any=vm.createContext({React:ReactHooks,TaskActivityContext:{Provider:'provider'},fetchTaskHudWorkspaceId:()=>{},fetchTaskHudListV1:()=>{},fetchTaskHudActivityV1:()=>{},
    createTaskActivityObserver:()=>({identity:++serial,getSnapshot:()=>({state:'loading',scopeGeneration:mockScope}),subscribe:()=>{}})});
  vm.runInContext(ts.transpileModule(provider+'\nglobalThis.renderProvider=TaskActivityProvider;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText,context);
  const render=(authorityKey:string)=>{cursor=0;scopeEffects.length=0;return context.renderProvider({authorityKey,children:null}).props.value;};
  const a=render('synthetic-owner-A');a.presentTaskHud({kind:'show',origin:'button',selection:{kind:'explicit',taskId:'old-owner-task'}});
  assert(render('synthetic-owner-A').presentation,'Local presentation is retained within same authority');
  const b=render('synthetic-owner-B');assert.notEqual(a.observer,b.observer);
  assert.equal(b.presentation,undefined,'New authority must not inherit an old show intent/task selector before effects run');
  b.presentTaskHud({kind:'show',origin:'voice'});assert(render('synthetic-owner-B').presentation);
  mockScope++;const changed=render('synthetic-owner-B');b.presentTaskHud({kind:'hide',origin:'voice'});
  assert.equal(changed.presentation,undefined,'Old-scope callback cannot present into a new scope');
  scopeEffects[0]();assert.equal(render('synthetic-owner-B').presentation?.intent.kind,'hide','Provider must deliver a current-scope hide even when old bridge callback is rejected');
  const functions=['taskSearchSelectionForAuthority','useTaskActivitySurface'].map(name=>{const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(fn,name);return fn.getText(file).replace(/^export /,'');});
  const selectedByEffects:unknown[]=[];
  const hookContext:any=vm.createContext({React:{useEffect:(effect:()=>void)=>effect(),useCallback:(fn:unknown)=>fn},
    useSharedTaskActivity:()=>({snapshot:{state:'loading',selection:{kind:'automatic'}},observer:{select:(selection:unknown)=>{selectedByEffects.push(selection);},refresh:()=>{}}})});
  vm.runInContext(ts.transpileModule(functions.join('\n')+'\nglobalThis.mask=taskSearchSelectionForAuthority;globalThis.consume=useTaskActivitySurface;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,hookContext);
  const retained={scope:'task',recordId:'prior-owner-task',requestId:'prior-request'};
  const masked=hookContext.mask(retained,'owner-A','owner-B');assert.equal(masked,undefined);hookContext.consume(masked?.recordId,undefined,masked?.requestId);assert.deepEqual(selectedByEffects,[],'Retained requested task cannot be replayed by consumer effect after authority changes');
  const current=hookContext.mask(retained,'owner-B','owner-B');hookContext.consume(current.recordId,undefined,current.requestId);assert.equal(selectedByEffects.length,1,'Same-authority explicit search still selects');
  const appSource=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const appFile=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const app=appFile.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App') as ts.FunctionDeclaration;
  const statements=(app.body as ts.Block).statements;
  const first=statements.find(n=>n.getText(appFile).startsWith('const taskReadAuthorityKey ='))!;
  const last=statements.find(n=>n.getText(appFile).startsWith('const taskSearchSelection ='))!;
  const wiring=appSource.slice(first.getStart(appFile),last.end);
  hookContext.authSession={user:{id:'synthetic-owner'},authenticatedAt:1};hookContext.activeAssistant={id:'A'};
  hookContext.searchSelection=retained;hookContext.taskSearchAuthority={current:{active:'',selected:''}};
  hookContext.taskSearchSelectionForAuthority=hookContext.mask;
  vm.runInContext('globalThis.appTaskSelection=()=>{'+wiring+';return taskSearchSelection;};',hookContext);
  hookContext.appTaskSelection();hookContext.taskSearchAuthority.current.selected=hookContext.taskSearchAuthority.current.active;
  assert(hookContext.appTaskSelection(),'Task search selected under persona A');
  hookContext.activeAssistant.id='B';assert.equal(hookContext.appTaskSelection(),undefined);
  hookContext.activeAssistant.id='A';const resurrected=hookContext.appTaskSelection();assert.equal(resurrected,undefined,'A→B→A must not resurrect the prior task search selection');
  selectedByEffects.length=0;hookContext.consume(resurrected?.recordId,undefined,resurrected?.requestId);assert.deepEqual(selectedByEffects,[]);
}

async function main() {
  await workspaceBootstrapTests();
  await scopedObserverTests();
  await actualScopedClientTests();
  await observerTests();
  presentationTests();
  sharedWiringTests();
  providerAuthorityTests();
  assert(fs.existsSync(new URL('../src/components/tasks/TaskHud.tsx', import.meta.url)), 'Shared factual HUD renderer must exist');
  const {TaskHud} = await import('../src/components/tasks/TaskHud');
  const model: any = {surface: 'ready', selectionState: 'selected', freshness: 'snapshot', lastSuccessfulReadAt: 2_000_000_000_000,
    choices: [{taskId: 'private-task-id', safeTitle: 'Sentetik görev', status: 'RUNNING'}], metrics: [],
    selected: {taskId: 'private-task-id', revision: 2, eventSequence: 1, safeTitle: 'Sentetik görev', status: 'RUNNING', historical: false, verification: 'unverified', integrity: 'contiguous', omittedStepCount: 0,
      steps: [{id: 'private-step-complete', safeTitle: 'Gerçek tamamlanan', status: 'COMPLETED'}, {id: 'private-step-skip', safeTitle: 'Atlanan', status: 'SKIPPED'}, {id: 'private-step-running', safeTitle: 'Gerçek çalışan', status: 'RUNNING'}], stepCounts: {completed: 1, skipped: 1, failed: 0, total: 3}}};
  const props = {visible: true, model, onHide: () => {}, onSelectTask: () => {}, onOpenTasks: () => {}};
  const html = renderToStaticMarkup(React.createElement(TaskHud, props));
  assert(html.includes('Sentetik görev')); assert(html.includes('Gerçek çalışan'));
  assert(!html.includes('private-task-id')); assert(!html.includes('private-step-'));
  assert(!html.includes('progressbar')); assert(!html.includes('aria-modal'));
  assert(html.includes('1/3 adım tamamlandı')); assert(html.includes('1 adım atlandı'));
  assert(!html.includes('Tamamlandı · doğrulandı'));
  for (const [surface,caption] of [['loading','yükleniyor'],['offline','Bağlantı yok'],['error','alınamadı'],['empty','Görev bulunamadı']] as const) {
    const rendered=renderToStaticMarkup(React.createElement(TaskHud,{...props,model:{...model,surface,selected:undefined,selectionState:'unselected'}}));
    assert(rendered.toLocaleLowerCase('tr-TR').includes(caption.toLocaleLowerCase('tr-TR')),surface);
  }
  const callbackEffects:string[]=[];
  const withChoices={...model,choices:[...model.choices,{taskId:'private-task-B',safeTitle:'Diğer sentetik görev',status:'RUNNING'}]};
  const tree=TaskHud({...props,model:withChoices,onHide:reason=>callbackEffects.push(reason),onSelectTask:id=>callbackEffects.push(id),onOpenTasks:()=>callbackEffects.push('details')});
  const find=(node:unknown,predicate:(element:any)=>boolean):any=>{
    if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return;}
    if(!React.isValidElement(node))return;
    if(predicate(node))return node;
    return find((node as React.ReactElement<{children?: React.ReactNode}>).props.children,predicate);
  };
  const select=find(tree,node=>node.type==='select');assert(select);select.props.onChange({currentTarget:{value:'1'}});select.props.onChange({currentTarget:{value:'1junk'}});
  const close=find(tree,node=>node.props['aria-label']==='Görev panelini gizle');close.props.onClick();
  assert.deepEqual(callbackEffects,['private-task-B','close-button'],'Selection uses internal mapping; hiding invokes presentation callback only');
  const selectionHtml=renderToStaticMarkup(React.createElement(TaskHud,{...props,model:withChoices}));assert(selectionHtml.includes('value="1"'));assert(!selectionHtml.includes('private-task-B'));
  assert.equal(renderToStaticMarkup(React.createElement(TaskHud, {...props, visible: false})), '');
  console.log(JSON.stringify({status: 'PASS', scope: 'HEADLESS_SYNTHETIC_TASK_HUD', renderer: true, mountedApp: false, native: false, network: false}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
