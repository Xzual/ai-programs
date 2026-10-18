import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const currentPath=new URL('../src/edith/computerDesktopClient.ts',import.meta.url);
const beforePath=new URL('../artifacts/repair-20261006/chat6/overnight-stop-zero-generation/computerDesktopClient.ts.before',import.meta.url);
const zeroPath=new URL('../artifacts/repair-20261006/chat6/overnight-stop-safe-generation/computerDesktopClient.ts.before',import.meta.url);
const current=fs.readFileSync(currentPath,'utf8');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const unknown={nativeSessionId:null,originalGeneration:null,latchedGeneration:null,observedAt:null,state:'unknown'};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const fixtureAppend=`
export const __stopFixture = {
  seed(id:string) {
    canonicalSessions.clear();latestObservation.clear();localOcrTargets.clear();explorerOperations.clear();
    canonicalSessions.set(id,{session:{sessionId:id,expiresAt:'2099-01-01T00:00:00.000Z'}} as any);
    latestObservation.set(id,{observationId:'SIM-observation'} as any);
    localOcrTargets.set('SIM-target',{} as any);
    explorerOperations.set('SIM-operation','SIM-explorer');
    workflowReservation={sessionId:id,workflowId:'SIM-workflow'};sessionEpoch=41;
  },
  addId(id:string) {canonicalSessions.set(id,{session:{sessionId:id}} as any);},
  snapshot(){return {sessionEpoch,canonicalIds:[...canonicalSessions.keys()],observations:latestObservation.size,
    ocr:localOcrTargets.size,explorer:explorerOperations.size,reserved:workflowReservation!==undefined};}
};
`;
type Receipt=typeof unknown|{nativeSessionId:string;originalGeneration:number;latchedGeneration:number;observedAt:string;state:string};
function harness(source:string,tauri=true) {
  const compiled=ts.transpileModule(source+fixtureAppend,{fileName:'computerDesktopClient.actual-vm.ts',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
  assert.deepEqual((compiled.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
  let resolve!:(value:unknown)=>void, reject!:(reason:unknown)=>void;
  const pending=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});
  const calls:Array<{command:string;args:unknown}>=[], imports:string[]=[];
  const deny=()=>{throw Error('UNUSED_ADAPTER_CALLED');};
  const ledger=class {};
  const adapters:Record<string,unknown>={
    './desktopShell':{isTauriShell:()=>tauri,invokeDesktopCommand:(command:string,args:unknown)=>{calls.push({command,args});return pending;}},
    './ownerMutationClient':{ownerMutationFetch:deny},
    './computerContractAdapter':new Proxy({DesktopActionIdempotencyLedger:ledger},{get:(target,key)=>key==='DesktopActionIdempotencyLedger'?target.DesktopActionIdempotencyLedger:deny}),
    './contracts':new Proxy({EDITH_CONTRACT_AMENDMENT:'2.1',TASK_CONTRACT_VERSION:2},{get:(target,key)=>key in target?target[key as keyof typeof target]:deny}),
  };
  const module={exports:{} as Record<string,any>};
  const context=vm.createContext({module,exports:module.exports,require:(name:string)=>{imports.push(name);assert.ok(Object.hasOwn(adapters,name),`Unexpected import ${name}`);return adapters[name];},fetch:deny,setTimeout:deny,setInterval:deny});
  new vm.Script(compiled.outputText,{filename:'computerDesktopClient.actual-whole-module.cjs'}).runInContext(context,{timeout:5000});
  assert.equal(typeof module.exports.stopComputer,'function');
  const fixture=module.exports.__stopFixture as {seed:(id:string)=>void;addId:(id:string)=>void;snapshot:()=>unknown};
  return {stop:module.exports.stopComputer as ()=>Promise<Receipt>,fixture,calls,imports,resolve,reject};
}

let checks=0;
const timestamp='2026-10-08T10:00:00.000Z',id='SIM-current-native';
const receipt=(generation:number,state='native_latched')=>({nativeSessionId:id,originalGeneration:generation,latchedGeneration:generation+1,observedAt:timestamp,state});
function assertInvalidated(h:ReturnType<typeof harness>) {
  assert.deepEqual(json(h.fixture.snapshot()),{sessionEpoch:42,canonicalIds:[],observations:0,ocr:0,explorer:0,reserved:false});checks++;
  assert.deepEqual(h.calls,[{command:'computer_stop',args:undefined}]);checks++;
}
for(const generation of [0,7,Number.MAX_SAFE_INTEGER-1])for(const state of ['native_latched','native_quiescent']) {
  const h=harness(current);h.fixture.seed(id);
  const stopping=h.stop();assertInvalidated(h);
  const actual=receipt(generation,state);h.resolve(actual);
  assert.deepEqual(json(await stopping),actual);checks++;
}
const missing=receipt(0) as Record<string,unknown>;delete missing.observedAt;
const negatives:unknown[]=[
  null,undefined,{},missing,
  {...receipt(0),originalGeneration:-1,latchedGeneration:0},
  {...receipt(0),originalGeneration:0.5,latchedGeneration:1.5},
  {...receipt(0),originalGeneration:Number.MAX_SAFE_INTEGER+1,latchedGeneration:Number.MAX_SAFE_INTEGER+2},
  {...receipt(0),originalGeneration:null},
  {...receipt(0),originalGeneration:'0'},
  {...receipt(0),latchedGeneration:0},
  {...receipt(0),latchedGeneration:2},
  {...receipt(0),latchedGeneration:1.5},
  {...receipt(0),latchedGeneration:null},
  {...receipt(0),latchedGeneration:'1'},
  {...receipt(0),latchedGeneration:-1},
  {...receipt(7),latchedGeneration:Number.MAX_SAFE_INTEGER+1},
  {...receipt(7),latchedGeneration:Infinity},
  {...receipt(7),latchedGeneration:NaN},
  {...receipt(0),latchedGeneration:true},
  receipt(Number.MAX_SAFE_INTEGER),
  {...receipt(0),nativeSessionId:'SIM-stale-native'},
  {...receipt(0),nativeSessionId:null},
  {...receipt(0),observedAt:null},
  {...receipt(0),observedAt:'malformed'},
  {...receipt(0),observedAt:'2026-10-08T10:00:00Z'},
  {...receipt(0),observedAt:'2026-10-08T13:00:00.000+03:00'},
  {...receipt(0),state:'unknown'},
  {...receipt(0),state:'backend_accepted'},
  {...receipt(0),state:null},
  {...receipt(0),unexpected:true},
];
for(const value of negatives) {
  const h=harness(current);h.fixture.seed(id);
  const stopping=h.stop();assertInvalidated(h);h.resolve(value);
  assert.deepEqual(json(await stopping),unknown);checks++;
}
// Original IDs are captured synchronously, even though the local map is cleared.
{
  const h=harness(current);h.fixture.seed(id);const stopping=h.stop();assertInvalidated(h);
  h.fixture.addId('SIM-later-native');h.resolve(receipt(0));
  assert.deepEqual(json(await stopping),receipt(0));checks++;
  assert.deepEqual((json(h.fixture.snapshot()) as any).canonicalIds,['SIM-later-native']);checks++;
}
{
  const h=harness(current);h.fixture.seed(id);const stopping=h.stop();h.fixture.addId('SIM-later-native');
  h.resolve({...receipt(0),nativeSessionId:'SIM-later-native'});
  assert.deepEqual(json(await stopping),unknown);checks++;
}
{
  const h=harness(current,false);h.fixture.seed(id);
  assert.deepEqual(json(await h.stop()),unknown);checks++;
  assert.equal(h.calls.length,0);checks++;
  assert.deepEqual(json(h.fixture.snapshot()),{sessionEpoch:42,canonicalIds:[],observations:0,ocr:0,explorer:0,reserved:false});checks++;
}
{
  const h=harness(current);h.fixture.seed(id);const stopping=h.stop();assertInvalidated(h);
  h.reject(Error('SIM_NATIVE_TRANSPORT_LOST'));
  await assert.rejects(stopping,/SIM_NATIVE_TRANSPORT_LOST/);checks++;
}

// Read-only parent backup executes the same complete-module harness and proves
// the concrete pre-fix regression; no production mutation or copied validator.
const before=fs.readFileSync(beforePath,'utf8');
assert.equal(hash(before),'4f4b92596d53951ea6357bca721e5af758fb4406221878ed97976e18c6db5bed');checks++;
{
  const h=harness(before);h.fixture.seed(id);const stopping=h.stop();h.resolve(receipt(0));
  assert.deepEqual(json(await stopping),unknown);checks++;
}
// Execute genuine saved zero-source to reproduce the old unsafe-latch edge.
// The new source's only extra production guard now denies this exact receipt.
const zeroSource=fs.readFileSync(zeroPath,'utf8');
assert.equal(hash(zeroSource),'4aedf56b5b954493a3a3974f640bac2d1e83ee0eab96f41cdc726d603bd04b41');checks++;
const boundary=receipt(Number.MAX_SAFE_INTEGER);
const boundaryObserved=[];
for(const source of [zeroSource,current]) {
  const h=harness(source);h.fixture.seed(id);const stopping=h.stop();h.resolve(boundary);
  boundaryObserved.push(json(await stopping));
}
assert.deepEqual(boundaryObserved,[boundary,unknown]);checks++;
console.log(JSON.stringify({suite:'actual-stopComputer-safe-generation',result:'PASS',checks,negativeCases:negatives.length,sourceSha256:hash(current),preZeroSha256:hash(before),zeroSourceSha256:hash(zeroSource),wholeModuleTranspiled:true,validatorCopied:false,nativeAdapter:'SIM_DEFERRED',physicalStop:false,userDatabaseRead:false,networkUsed:false,zeroGenerationBefore:'unknown',zeroGenerationAfter:'native_latched/native_quiescent',cacheInvalidation:'synchronous before native await',capturedOriginalId:true,latchedGenerationBoundary:{safeOriginal:Number.MAX_SAFE_INTEGER,unsafeLatch:boundary.latchedGeneration,zeroSourceAccepted:true,currentSourceRejected:true,safeUpperOriginal:Number.MAX_SAFE_INTEGER-1,safeUpperLatch:Number.MAX_SAFE_INTEGER,safeUpperBothPhasesAccepted:true,hardwareAttestation:false}}));
