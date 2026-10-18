import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

// Constructor-only actual compiled class. No browser launch, backend bootstrap,
// user configuration, user profile or filesystem predicate substitutes.
assert.equal(process.env.EDITH_TEST_MODE,'true');
const workspace=process.cwd();
const evidenceBase=path.join(workspace,'artifacts/repair-20261006/chat4/overnight-browser-executable-binding/test');
const output=process.env.W5_HTTP_REPORT_DIR??path.join(evidenceBase,'runtime-'+Date.now());
fs.mkdirSync(output,{recursive:true});
const productPath=path.join(workspace,'server/browser/browserSessionStore.ts');
const baselinePath=path.join(workspace,'artifacts/repair-20261006/chat4/overnight-browser-cjs-runtime/browserSessionStore.before.ts');
const product=fs.readFileSync(productPath,'utf8'),baseline=fs.readFileSync(baselinePath,'utf8');
const serverPath=path.join(workspace,'server.ts'),adapterPath=path.join(workspace,'src/edith/browserOperatorAdapter.ts');
const observedSources=[productPath,serverPath,adapterPath].map(file=>({file,contents:fs.readFileSync(file,'utf8')}));
const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
assert.equal(sha(baseline),'09FD82B10F9D7D9C7C13C1123541E238EBF7BE9F48CCF7E8DDC02D4C9314D83F');
assert.equal(sha(fs.readFileSync(path.join(workspace,'artifacts/repair-20261006/chat4/overnight-browser-executable-binding/CONTRACT.json'),'utf8')),'1D89B445529E5D261E76618B44EC4B87EFE3A13410A9AE9221EDB4850701A67C');
type Format='cjs'|'esm';
type Execution={status:number|null;stdout:string;stderr:string;result?:{availability:{available:boolean;status:string};executable?:string;error?:string;name?:string}};
const rows:Array<{scenario:string;format:Format;execution:Execution}>=[];
const warnings:Array<{scenario:string;warnings:string[]}>=[];
const integrationRows:Array<{scenario:string;status:number|null;stdout:string;stderr:string;result:any}>=[];
const write=(file:string,contents:string)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);return file;};
const binary=(app:string,version='chromium-123',location='chrome-win64/chrome.exe')=>write(path.join(app,'runtime/Packages/Playwright-Browsers',version,location),'SYNTHETIC_REGULAR_FILE_NOT_EXECUTABLE_BROWSER');
let serial=0;
async function fixture(scenario:string,format:Format='cjs',source=product,layout?:string){
  const app=path.join(output,String(++serial).padStart(2,'0')+'-'+scenario+'-'+format);
  write(path.join(app,'package.json'),JSON.stringify({name:'edith',type:'module'}));
  const compiled=path.join(app,layout??(format==='cjs'?'dist/server.cjs':'server/browser/browserSessionStore.js'));
  const bundled=await build({stdin:{contents:source,resolveDir:path.dirname(productPath),sourcefile:productPath,loader:'ts'},bundle:true,platform:'node',format,packages:'external',write:false,logLevel:'silent'});
  warnings.push({scenario:scenario+'-'+format,warnings:bundled.warnings.map(item=>item.text)});
  write(compiled,bundled.outputFiles[0].text);
  return {app,compiled,format,scenario};
}
function run(f:{app:string;compiled:string;format:Format;scenario:string},options:Record<string,unknown>={},postImportMarker?:'malformed'|'missing'|'directory'){
  const markerPath=path.join(f.app,'package.json');
  const markerMutation=postImportMarker===undefined?'':
    'const marker='+JSON.stringify(markerPath)+';const originalMarker=fixtureFs.readFileSync(marker,"utf8");'+
    (postImportMarker==='malformed'?'fixtureFs.writeFileSync(marker,"not-json");':
      'fixtureFs.unlinkSync(marker);'+(postImportMarker==='directory'?'fixtureFs.mkdirSync(marker);':''));
  const markerRestore=postImportMarker===undefined?'':
    'finally{if(fixtureFs.existsSync(marker)&&fixtureFs.statSync(marker).isDirectory())fixtureFs.rmdirSync(marker);fixtureFs.writeFileSync(marker,originalMarker);}';
  const entry=write(path.join(f.app,'constructor.'+(f.format==='cjs'?'cjs':'mjs')),(f.format==='cjs'
    ?'const {BrowserSessionStore}=require('+JSON.stringify('./'+path.relative(f.app,f.compiled).replaceAll('\\','/'))+');'
    :'import {BrowserSessionStore} from '+JSON.stringify('./'+path.relative(f.app,f.compiled).replaceAll('\\','/'))+';')+
    (f.format==='cjs'?'const fixtureFs=require("node:fs");':'import fixtureFs from "node:fs";')+markerMutation+
    'try{const store=new BrowserSessionStore('+JSON.stringify(options)+');console.log(JSON.stringify({availability:store.availability(),executable:store.executable}));}catch(error){console.log(JSON.stringify({error:error.message,name:error.name}));process.exitCode=42;}'+markerRestore);
  const child=spawnSync(process.execPath,[entry],{cwd:f.app,encoding:'utf8',timeout:15000,env:process.env});
  assert.ifError(child.error);
  const execution:Execution={status:child.status,stdout:child.stdout,stderr:child.stderr};
  if(child.stdout.trim())execution.result=JSON.parse(child.stdout.trim());
  rows.push({scenario:f.scenario,format:f.format,execution});
  write(path.join(f.app,'execution.json'),JSON.stringify(execution,null,2));
  return execution;
}
function unavailable(value:Execution){assert.equal(value.status,0,JSON.stringify(value));assert.equal(value.result?.availability.available,false);assert.equal(value.result?.availability.status,'configuration_required');assert.equal(value.result?.executable,undefined);}
function available(value:Execution,expected:string){assert.equal(value.status,0,JSON.stringify(value));assert.equal(value.result?.availability.available,true);assert.equal(value.result?.availability.status,'available');assert.equal(value.result?.executable,fs.realpathSync(expected));}

async function compiledIntegration(kind:'server'|'adapter'){
  // Both compile actual production modules; no production statements are removed.
  const result=await build({...(kind==='server'?{entryPoints:[serverPath]}:{stdin:{contents:'export * from '+JSON.stringify(adapterPath)+'; export {parseBrowserWorkflowRequest} from '+JSON.stringify(path.join(workspace,'src/edith/browserOperatorContract.ts'))+';',resolveDir:workspace,loader:'ts' as const}}),bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
  warnings.push({scenario:'actual-'+kind+'-composition',warnings:result.warnings.map(item=>item.text)});
  return result.outputFiles[0].text;
}
function integrationFixture(scenario:string,bundle:string,layout='dist/server.cjs'){
  const app=path.join(output,String(++serial).padStart(2,'0')+'-'+scenario);
  write(path.join(app,'package.json'),JSON.stringify({name:'edith',type:'module'}));
  return {app,compiled:write(path.join(app,layout),bundle),scenario};
}
function integrationRun(f:{app:string;compiled:string;scenario:string},body:string,settings:{env?:string;pkg?:unknown;execPath?:string;testMode?:string}={}){
  const isolatedData=path.join(f.app,'isolated-data');fs.mkdirSync(isolatedData,{recursive:true});
  const env:NodeJS.ProcessEnv={...process.env,EDITH_TEST_DATA_DIR:isolatedData,DOTENV_CONFIG_PATH:write(path.join(f.app,'isolated-dotenv.txt'),''),NODE_ENV:'production'};
  delete env.EDITH_BROWSER_EXECUTABLE_PATH;
  if(Object.hasOwn(settings,'env'))env.EDITH_BROWSER_EXECUTABLE_PATH=settings.env;
  if(settings.testMode!==undefined)env.EDITH_TEST_MODE=settings.testMode;
  const prelude='const assert=require("node:assert/strict"),fs=require("node:fs"),Module=require("node:module");const compiled='+JSON.stringify(f.compiled)+';'+
    (Object.hasOwn(settings,'pkg')?'Object.defineProperty(process,"pkg",{value:'+JSON.stringify(settings.pkg)+',configurable:true});':'delete process.pkg;')+
    (settings.execPath!==undefined?'Object.defineProperty(process,"execPath",{value:'+JSON.stringify(settings.execPath)+',configurable:true});':'');
  const entry=write(path.join(f.app,'integration.cjs'),prelude+'\n(async()=>{'+body+'})().then(result=>{console.log("H_RESULT:"+JSON.stringify(result));process.exit(0);},error=>{console.log("H_RESULT:"+JSON.stringify({error:error.message,name:error.name,stack:error.stack}));process.exit(42);});');
  const child=spawnSync(process.execPath,[entry],{cwd:f.app,encoding:'utf8',timeout:20000,env});assert.ifError(child.error);
  const line=child.stdout.split(/\r?\n/).filter(item=>item.startsWith('H_RESULT:')).at(-1);
  const result=line?JSON.parse(line.slice('H_RESULT:'.length)):undefined;
  const row={scenario:f.scenario,status:child.status,stdout:child.stdout,stderr:child.stderr,result};integrationRows.push(row);write(path.join(f.app,'integration-execution.json'),JSON.stringify(row,null,2));return row;
}
const serverBarrier=String.raw`
const actualExpress=require('express'),load=Module._load;
const target=new Module(compiled,module);target.filename=compiled;target.paths=Module._nodeModulePaths(require('node:path').dirname(compiled));
const stop=Object.freeze({kind:'ACTUAL_COMPILED_PRE_APP_BARRIER'});let barriers=0,earlyFactories=0,backend;
const expressBarrier=new Proxy(actualExpress,{apply(fn,self,args){let candidate;try{candidate=target.exports.backendBrowserOperator;}catch{}if(candidate){backend=candidate;barriers++;throw stop;}earlyFactories++;return Reflect.apply(fn,self,args);}});
Module._load=function(request,...args){return request==='express'?expressBarrier:Reflect.apply(load,this,[request,...args]);};
try{target._compile(fs.readFileSync(compiled,'utf8'),compiled);throw Error('PRE_APP_BARRIER_NOT_REACHED');}catch(error){if(error!==stop)throw error;}finally{Module._load=load;}
assert.equal(barriers,1);assert.equal(backend,target.exports.backendBrowserOperator);
const resolved=target.exports.resolveBackendBrowserExecutablePath();
assert.equal(target.exports.resolveBackendBrowserExecutablePath({executablePath:'CLIENT_PATH_MUST_NOT_SELECT'}),resolved);
return {barrier:'before_actual_express_app_factory',availability:backend.availability(),executable:backend.sessions.executable,resolved,barriers,earlyFactories,simPkg:Boolean(process.pkg),browserLaunches:0,backendListen:0};
`;
async function compositionMatrix(){
  const serverBundle=await compiledIntegration('server'),adapterBundle=await compiledIntegration('adapter');
  for(const layout of ['dist/server.cjs','.edith-build/desktop/server.cjs']){
    const f=integrationFixture('server-explicit-forward-before-app-'+layout.replaceAll('/','-'),serverBundle,layout);binary(f.app,'chromium-999');const chosen=write(path.join(f.app,'backend-selected/chromium.exe'),'SYNTHETIC_CONFIGURED_BROWSER');
    const value=integrationRun(f,serverBarrier,{env:chosen});assert.equal(value.status,0,JSON.stringify(value));assert.equal(value.result.executable,fs.realpathSync(chosen));assert.equal(value.result.availability.available,true);assert.equal(value.result.barriers,1);
  }
  for(const setting of ['', 'relative/chrome.exe']){
    const f=integrationFixture('server-invalid-present-env-'+(setting?'relative':'empty'),serverBundle);binary(f.app);const value=integrationRun(f,serverBarrier,{env:setting});assert.equal(value.status,42);assert.equal(value.result?.error,'CONFIGURATION_REQUIRED');
  }
  const badName=integrationFixture('server-invalid-explicit-name',serverBundle);binary(badName.app);const named=write(path.join(badName.app,'invalid/not-browser.exe'),'SYNTHETIC');const bad=integrationRun(badName,serverBarrier,{env:named});assert.equal(bad.status,42);assert.equal(bad.result?.error,'CONFIGURATION_REQUIRED');
  const missing=integrationFixture('server-explicit-missing-no-fallback',serverBundle);binary(missing.app);const absent=integrationRun(missing,serverBarrier,{env:path.join(missing.app,'missing/chrome.exe')});assert.equal(absent.status,0,JSON.stringify(absent));assert.equal(absent.result.availability.available,false);assert.equal(absent.result.executable,undefined);
  const directory=integrationFixture('server-explicit-directory-no-fallback',serverBundle);binary(directory.app);const dir=path.join(directory.app,'directory/chrome.exe');fs.mkdirSync(dir,{recursive:true});const nonfile=integrationRun(directory,serverBarrier,{env:dir});assert.equal(nonfile.status,0,JSON.stringify(nonfile));assert.equal(nonfile.result.availability.available,false);
  const ordinary=integrationFixture('server-ordinary-node-default-discovery',serverBundle);const ordinaryBinary=binary(ordinary.app);const normal=integrationRun(ordinary,serverBarrier);assert.equal(normal.status,0,JSON.stringify(normal));assert.equal(normal.result.executable,fs.realpathSync(ordinaryBinary));
  const unavailableDefault=integrationFixture('server-ordinary-node-no-physical-exec-guess',serverBundle);const physical=path.join(output,'ordinary-node-physical');const physicalExe=write(path.join(physical,'backend.exe'),'SYNTHETIC_BACKEND');binary(physical,'chromium-1234');const noGuess=integrationRun(unavailableDefault,serverBarrier,{execPath:physicalExe});assert.equal(noGuess.status,0,JSON.stringify(noGuess));assert.equal(noGuess.result.availability.available,false);
  const unrelated=integrationFixture('server-ignores-untrusted-setting-name',serverBundle);const unwanted=write(path.join(unrelated.app,'untrusted/chrome.exe'),'SYNTHETIC');const ignored=integrationRun(unrelated,'process.env.BROWSER_EXECUTABLE_PATH='+JSON.stringify(unwanted)+';'+serverBarrier);assert.equal(ignored.status,0,JSON.stringify(ignored));assert.equal(ignored.result.availability.available,false);
  const precedence=integrationFixture('server-explicit-setting-precedes-SIMpkg',serverBundle);const explicit=write(path.join(precedence.app,'explicit/chrome.exe'),'SYNTHETIC');const wins=integrationRun(precedence,serverBarrier,{env:explicit,pkg:{},execPath:'relative-invalid-physical.exe'});assert.equal(wins.status,0,JSON.stringify(wins));assert.equal(wins.result.executable,fs.realpathSync(explicit));
  for(const present of [true,false]){
    const f=integrationFixture('SIMpkg-relocated-physical-'+(present?'valid':'missing'),serverBundle);binary(f.app,'chromium-999');const root=path.join(output,'physical-pkg-'+present);const executable=write(path.join(root,'edith-backend.exe'),'SYNTHETIC_PHYSICAL_BACKEND');const candidate=present?binary(root,'chromium-1234'):path.join(root,'runtime/Packages/Playwright-Browsers/chromium-1234/chrome-win64/chrome.exe');const value=integrationRun(f,serverBarrier,{pkg:{entrypoint:'/snapshot/edith/server.cjs'},execPath:executable});assert.equal(value.status,0,JSON.stringify(value));assert.equal(value.result.availability.available,present);assert.equal(value.result.executable,present?fs.realpathSync(candidate):undefined);
  }
  const escaped=integrationFixture('SIMpkg-physical-candidate-root-escape',serverBundle);const escapedRoot=path.join(output,'physical-pkg-escaped');const exe=write(path.join(escapedRoot,'backend.exe'),'SYNTHETIC_BACKEND');const external=path.join(output,'physical-pkg-outside');write(path.join(external,'chrome.exe'),'SYNTHETIC_OUTSIDE_BROWSER');const link=path.join(escapedRoot,'runtime/Packages/Playwright-Browsers/chromium-1234/chrome-win64');fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(external,link,process.platform==='win32'?'junction':'dir');const escape=integrationRun(escaped,serverBarrier,{pkg:{},execPath:exe});assert.equal(escape.status,42);assert.equal(escape.result?.error,'CONFIGURATION_REQUIRED');
  const pkgDirectory=integrationFixture('SIMpkg-nonregular-candidate-no-fallback',serverBundle);binary(pkgDirectory.app);const dirRoot=path.join(output,'physical-pkg-directory');const dirExe=write(path.join(dirRoot,'backend.exe'),'SYNTHETIC');fs.mkdirSync(path.join(dirRoot,'runtime/Packages/Playwright-Browsers/chromium-1234/chrome-win64/chrome.exe'),{recursive:true});const unavailablePkg=integrationRun(pkgDirectory,serverBarrier,{pkg:{},execPath:dirExe});assert.equal(unavailablePkg.status,0,JSON.stringify(unavailablePkg));assert.equal(unavailablePkg.result.availability.available,false);
  for(const invalidExec of ['relative/backend.exe',path.join(output,'nonexistent-backend.exe')]){const invalidPkg=integrationFixture('SIMpkg-invalid-physical-executable',serverBundle);const rejected=integrationRun(invalidPkg,serverBarrier,{pkg:{},execPath:invalidExec});assert.equal(rejected.status,42);assert.equal(rejected.result?.error,'CONFIGURATION_REQUIRED');}
  const singleton=integrationFixture('actual-adapter-once-only-identity',adapterBundle);const selected=write(path.join(singleton.app,'selected/chrome.exe'),'SYNTHETIC');const identity=integrationRun(singleton,`const api=require(compiled);const first=api.initializeBrowserOperatorAdapter({executablePath:${JSON.stringify(selected)}});assert.equal(first.sessions.executable,fs.realpathSync(${JSON.stringify(selected)}));const observed=await Promise.all(Array.from({length:20},async()=>api.getBrowserOperatorAdapter()));assert(observed.every(value=>value===first));assert.throws(()=>api.initializeBrowserOperatorAdapter({}),/CONFIGURATION_REQUIRED/);assert.equal(api.getBrowserOperatorAdapter(),first);for(const executablePath of ['client/chrome.exe',${JSON.stringify(selected)}]){const parsed=api.parseBrowserWorkflowRequest({action:'navigate',url:'https://example.invalid',executablePath});assert.equal(parsed.success,false);}await first.closeAll();return {sameIdentity:true,observations:observed.length,clientPathRejected:true};`);assert.equal(identity.status,0,JSON.stringify(identity));
  const failed=integrationFixture('actual-adapter-failed-init-latched',adapterBundle);binary(failed.app);const latch=integrationRun(failed,`const api=require(compiled);assert.throws(()=>api.initializeBrowserOperatorAdapter({executablePath:''}),/CONFIGURATION_REQUIRED/);assert.throws(()=>api.getBrowserOperatorAdapter(),/CONFIGURATION_REQUIRED/);assert.throws(()=>api.initializeBrowserOperatorAdapter({}),/CONFIGURATION_REQUIRED/);return {failedAttemptLatched:true};`);assert.equal(latch.status,0,JSON.stringify(latch));
  for(const invalid of [null,42,{}]){const nonstring=integrationFixture('actual-store-nonstring-through-adapter',adapterBundle);binary(nonstring.app);const rejected=integrationRun(nonstring,`const api=require(compiled);assert.throws(()=>api.initializeBrowserOperatorAdapter({executablePath:${JSON.stringify(invalid)}}),/CONFIGURATION_REQUIRED/);assert.throws(()=>api.getBrowserOperatorAdapter(),/CONFIGURATION_REQUIRED/);return {nonstringRejectedAndLatched:true};`);assert.equal(rejected.status,0,JSON.stringify(rejected));}
  const defaultUse=integrationFixture('actual-adapter-default-use-locks-init',adapterBundle);binary(defaultUse.app);const prior=integrationRun(defaultUse,`const api=require(compiled);const first=api.getBrowserOperatorAdapter();assert.equal(first.availability().available,true);assert.equal(api.getBrowserOperatorAdapter(),first);assert.throws(()=>api.initializeBrowserOperatorAdapter({}),/CONFIGURATION_REQUIRED/);await first.closeAll();return {defaultUseLocksInitialization:true};`);assert.equal(prior.status,0,JSON.stringify(prior));
  const setter=integrationFixture('actual-adapter-test-setter-guard',adapterBundle);const denied=integrationRun(setter,`const api=require(compiled);await assert.rejects(api.setBrowserOperatorTestOptions({}),/CONFIGURATION_REQUIRED/);return {productionTestSetterDenied:true};`,{testMode:'false'});assert.equal(denied.status,0,JSON.stringify(denied));
  const replacing=integrationFixture('actual-adapter-test-setter-no-race',adapterBundle);const replacement=integrationRun(replacing,`const api=require(compiled);const first=api.getBrowserOperatorAdapter();const changing=api.setBrowserOperatorTestOptions({});assert.throws(()=>api.getBrowserOperatorAdapter(),/CONFIGURATION_REQUIRED/);await changing;const next=api.getBrowserOperatorAdapter();assert.notEqual(next,first);assert.throws(()=>api.initializeBrowserOperatorAdapter({}),/CONFIGURATION_REQUIRED/);await next.closeAll();return {replacementCannotBeObservedWhilePending:true};`);assert.equal(replacement.status,0,JSON.stringify(replacement));
}

async function main(){
  const old=await fixture('baseline-actual-CJS-crash','cjs',baseline);const crash=run(old);assert.equal(crash.status,42);assert.equal(crash.result?.name,'TypeError');assert.match(crash.result?.error??'',/path|URL|undefined/i);assert(warnings[0].warnings.some(item=>item.includes('import.meta')));
  const sidecarMissing=await fixture('desktop-sidecar-no-distribution','cjs',product,'.edith-build/desktop/server.cjs');unavailable(run(sidecarMissing));
  const sidecar=await fixture('trusted-desktop-sidecar-distribution','cjs',product,'.edith-build/desktop/server.cjs');const sidecarBinary=binary(sidecar.app);available(run(sidecar),sidecarBinary);
  for(const format of ['cjs','esm'] as const){
    unavailable(run(await fixture('no-config-no-distribution',format)));
    const valid=await fixture('trusted-relocated-distribution',format);const lower=binary(valid.app,'chromium-122'),higher=binary(valid.app,'chromium-124');available(run(valid),higher);assert.notEqual(fs.realpathSync(lower),fs.realpathSync(higher));
    const ignored=await fixture('unrecognized-version-and-directory-binary',format);binary(ignored.app,'chromium-untrusted');fs.mkdirSync(path.join(ignored.app,'runtime/Packages/Playwright-Browsers/chromium-99/chrome-win64/chrome.exe'),{recursive:true});unavailable(run(ignored));
    const wrong=await fixture('wrong-application-metadata',format);binary(wrong.app);write(path.join(wrong.app,'package.json'),JSON.stringify({name:'other',type:'module'}));unavailable(run(wrong));
    // Load the actual compiled class while metadata is valid; mutate only the
    // synthetic marker before construction so Node's package loader cannot
    // preempt the actual discovery predicate. Restore it after observation.
    const malformed=await fixture('malformed-application-metadata',format);binary(malformed.app);unavailable(run(malformed,{},'malformed'));
    const missing=await fixture('missing-application-metadata',format);binary(missing.app);unavailable(run(missing,{},'missing'));
    const markerDirectory=await fixture('application-marker-not-regular-file',format);binary(markerDirectory.app);unavailable(run(markerDirectory,{},'directory'));
    const unknown=await fixture('unknown-module-layout',format,product,format==='cjs'?'untrusted/server.cjs':'untrusted/browserSessionStore.js');binary(unknown.app);unavailable(run(unknown));
    const rootEscape=await fixture('runtime-root-reparse-escape',format);const outside=path.join(output,'outside-runtime-'+format);binary(outside);fs.mkdirSync(path.join(rootEscape.app,'runtime/Packages'),{recursive:true});fs.symlinkSync(path.join(outside,'runtime/Packages/Playwright-Browsers'),path.join(rootEscape.app,'runtime/Packages/Playwright-Browsers'),process.platform==='win32'?'junction':'dir');unavailable(run(rootEscape));
    const nestedEscape=await fixture('binary-directory-reparse-escape',format);const external=path.join(output,'outside-binary-'+format);write(path.join(external,'chrome.exe'),'SYNTHETIC_OUTSIDE_BROWSER');const version=path.join(nestedEscape.app,'runtime/Packages/Playwright-Browsers/chromium-125');fs.mkdirSync(version,{recursive:true});fs.symlinkSync(external,path.join(version,'chrome-win64'),process.platform==='win32'?'junction':'dir');unavailable(run(nestedEscape));
    const fallback=await fixture('escaped-higher-version-safe-lower-fallback',format);const safe=binary(fallback.app,'chromium-123');const escapedVersion=path.join(fallback.app,'runtime/Packages/Playwright-Browsers/chromium-999');const outsideVersion=path.join(output,'outside-version-'+format);write(path.join(outsideVersion,'chrome-win64/chrome.exe'),'SYNTHETIC_OUTSIDE_BROWSER');fs.symlinkSync(outsideVersion,escapedVersion,process.platform==='win32'?'junction':'dir');
    available(run(fallback),safe);
    const explicit=await fixture('explicit-synthetic-valid',format);binary(explicit.app);const chosen=write(path.join(explicit.app,'explicit/chrome.exe'),'SYNTHETIC_REGULAR_FILE');available(run(explicit,{executablePath:chosen}),chosen);
    for(const invalid of ['relative/chrome.exe',path.join(explicit.app,'explicit/not-a-browser.exe')]){const denied=run({...explicit,scenario:'explicit-invalid-path-or-name'},{executablePath:invalid});assert.equal(denied.status,42);assert.equal(denied.result?.error,'CONFIGURATION_REQUIRED');}
    unavailable(run({...explicit,scenario:'explicit-missing-does-not-fallback'},{executablePath:path.join(explicit.app,'missing/chrome.exe')}));
    const directory=path.join(explicit.app,'directory/chrome.exe');fs.mkdirSync(directory,{recursive:true});unavailable(run({...explicit,scenario:'explicit-directory-not-file'},{executablePath:directory}));
  }
  assert.equal(rows.length,35,'Retain all 35 accepted constructor observations');
  await compositionMatrix();
  for(const source of observedSources)assert.equal(sha(fs.readFileSync(source.file,'utf8')),sha(source.contents),'Source changed during compiled composition matrix: '+source.file);
  assert.equal(sha(fs.readFileSync(productPath,'utf8')),sha(product),'Product source changed during guarded constructor matrix');
  const report={status:'PASS',productSha256:sha(product),baselineSha256:sha(baseline),rows,integrationRows,warnings,ownerLifecycleStub:false,filesystemPredicates:'ACTUAL',constructorOnly:true,compiledServerPreAppBarrier:true,syntheticBrowserFiles:true,browserLaunches:0,backendLaunches:0,networkRequests:0,genuinePackagedRuntime:'NOT_RUN',genuineBrowserAcceptance:'NOT_RUN'};
  write(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scenarios:rows.length,report:path.join(output,'report.json'),productSha256:report.productSha256,browserLaunches:0,genuineBrowserAcceptance:'NOT_RUN'}));
}
main().catch(error=>{write(path.join(output,'failure.json'),JSON.stringify({name:error?.name,message:error?.message,stack:error?.stack,rows,integrationRows,warnings},null,2));console.error(error);process.exitCode=1;});
