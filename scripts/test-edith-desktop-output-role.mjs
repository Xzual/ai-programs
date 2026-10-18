import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {normalizeOutputRole,resolveDesktopOutputRole}=require('./desktop-output-role.cjs');
const root=path.resolve('OWNED_DATA_ONLY_PROJECT');
const id='a'.repeat(64);
let cases=0;
function check(fn){fn();cases++;}
check(()=>assert.deepEqual(normalizeOutputRole(),{kind:'legacy'}));
check(()=>assert.deepEqual(normalizeOutputRole({kind:'legacy'}),{kind:'legacy'}));
const input={kind:'candidate',id};
const role=normalizeOutputRole(input);input.id='b'.repeat(64);
check(()=>assert.equal(role.id,id));check(()=>assert.ok(Object.isFrozen(role)));
for(const bad of [null,[],{kind:'unknown'},{kind:'legacy',id},{kind:'candidate'},{kind:'candidate',id:id.toUpperCase()},{kind:'candidate',id:'../x'},{kind:'candidate',id,root},{kind:'candidate',id:id+'0'},{kind:'candidate',id:id+'\n'},{kind:'candidate',id:id+'\r\n'},Object.create({kind:'legacy'}),Object.create(null)])check(()=>assert.throws(()=>normalizeOutputRole(bad)));
let traps=0;
check(()=>assert.throws(()=>normalizeOutputRole(new Proxy({kind:'legacy'},{getPrototypeOf(){traps++;throw Error('TRAP')},ownKeys(){traps++;throw Error('TRAP')}}))));
check(()=>assert.equal(traps,0));
const accessor={};Object.defineProperty(accessor,'kind',{get(){traps++;throw Error('GETTER')}});
check(()=>assert.throws(()=>normalizeOutputRole(accessor)));check(()=>assert.equal(traps,0));
const legacy=resolveDesktopOutputRole(root);
check(()=>assert.equal(legacy.buildDir,path.join(root,'.edith-build/desktop')));
check(()=>assert.equal(legacy.binaryDir,path.join(root,'src-tauri/binaries')));
check(()=>assert.equal(legacy.frontendDir,path.join(root,'dist')));
check(()=>assert.equal(legacy.pkgConfigText,'{\n  "bin": "server.cjs",\n  "pkg": {\n    "assets": [\n      "../../node_modules/playwright-core/browsers.json"\n    ]\n  }\n}\n'));
for(const key of ['id','candidateRoot','tauriConfigPath'])check(()=>assert.equal(legacy[key],null));
const selected=resolveDesktopOutputRole(root,{kind:'candidate',id});
const base=path.join(root,'artifacts/desktop/candidates',id);
for(const [key,value]of Object.entries({root,role:{kind:'candidate',id},kind:'candidate',id,candidateRoot:base,buildDir:path.join(base,'stage'),binaryDir:path.join(base,'binaries'),entry:path.join(base,'stage/server.cjs'),output:path.join(base,'binaries/edith-backend-x86_64-pc-windows-msvc.exe'),resourceDir:path.join(base,'stage/resources'),frontendDir:path.join(base,'frontend'),artifactRoot:base,portableRoot:path.join(base,'portable'),tauriConfigPath:path.join(base,'tauri-candidate.json')}))check(()=>assert.deepEqual(selected[key],value));
check(()=>assert.equal(typeof selected.pkgConfigText,'string'));
check(()=>assert.equal(JSON.parse(selected.pkgConfigText).pkg.assets[0],'../../../../../node_modules/playwright-core/browsers.json'));
check(()=>assert.equal(Object.keys(selected).length,15));check(()=>assert.ok(Object.isFrozen(selected)&&Object.isFrozen(selected.role)));
for(const bad of ['relative-root','\\\\server\\share','C:relative','C:\\root:ads'])check(()=>assert.throws(()=>resolveDesktopOutputRole(bad)));
// Root-authorized inert private-plan unit fixture, not authentic-runtime admission.
// Execute original guard code without rewriting its functions or hash constants.
const fixture=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'edith-role-unit-'));
const identity=fs.lstatSync(fixture,{bigint:true});
const guardPath=require.resolve('./desktop-pkg-offline.cjs');
const context=vm.createContext({require:createRequire(guardPath),module:{exports:{}},__filename:guardPath,__dirname:path.dirname(guardPath),Buffer,process,console,Object,Array,Reflect});
new vm.Script(fs.readFileSync(guardPath,'utf8')+'\nglobalThis.unit={setPlan(value){prepared=value},api:module.exports};',{filename:guardPath}).runInContext(context,{timeout:1000});
const unit=context.unit;
let guardCases=0;
function plan(role){
 const paths=resolveDesktopOutputRole(fixture,role);
 fs.mkdirSync(paths.buildDir,{recursive:true});fs.mkdirSync(paths.binaryDir,{recursive:true});
 fs.writeFileSync(paths.entry,'INERT SOURCE NEVER EXECUTED');fs.writeFileSync(path.join(paths.buildDir,'package.json'),paths.pkgConfigText);
 return {root:fixture,cache:path.join(fixture,'owned-cache'),paths,role:paths.role,bytes:Buffer.from('INERT_UNQUALIFIED_BASE'),asset:Buffer.from('INERT_ASSET')};
}
function args(p,role=p.role){return {pkgBin:path.join(fixture,'node_modules/@yao-pkg/pkg/lib-es5/bin.js'),entry:p.paths.entry,output:p.paths.output,outputRole:role};}
function checkGuard(body){body();guardCases++;}
try{
 for(const role of [{kind:'legacy'},{kind:'candidate',id}])checkGuard(()=>{
  const p=plan(role);unit.setPlan(p);
  const actual=unit.api.getPkgArguments(args(p));
  assert.deepEqual(Array.from(actual),role.kind==='legacy'?[guardPath,'--edith-pkg-buffer',p.cache,p.paths.entry,p.paths.output]:[guardPath,'--edith-pkg-candidate',id,p.cache,p.paths.entry,p.paths.output]);
  assert.ok(Object.isFrozen(actual));assert.ok(p.bytes.every(x=>x===0)&&p.asset.every(x=>x===0));
 });
 for(const otherRole of [{kind:'legacy'},{kind:'candidate',id:'b'.repeat(64)}])checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);assert.throws(()=>unit.api.getPkgArguments(args(p,otherRole)),/ROLE_REJECTED/);});
 checkGuard(()=>{const p=plan({kind:'legacy'});unit.setPlan(p);assert.throws(()=>unit.api.getPkgArguments(args(p,{kind:'candidate',id})),/ROLE_REJECTED/);});
 for(const field of ['entry','output'])checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);assert.throws(()=>unit.api.getPkgArguments({...args(p),[field]:resolveDesktopOutputRole(fixture,{kind:'candidate',id:'b'.repeat(64)})[field]}),/PATH_REJECTED/);});
 checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);fs.writeFileSync(path.join(p.paths.buildDir,'package.json'),'{}');assert.throws(()=>unit.api.getPkgArguments(args(p)),/CONFIG_REJECTED/);});
 checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);fs.writeFileSync(p.paths.output,'INERT_EXISTING');assert.throws(()=>unit.api.getPkgArguments(args(p)),/OUTPUT_EXISTS/);fs.unlinkSync(p.paths.output);});
 checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);fs.symlinkSync(path.join(fixture,'missing-own-target'),p.paths.output,'file');try{assert.throws(()=>unit.api.getPkgArguments(args(p)),/OUTPUT_EXISTS/);}finally{fs.unlinkSync(p.paths.output);}});
 checkGuard(()=>{const p=plan({kind:'legacy'});unit.setPlan(p);fs.writeFileSync(p.paths.output,'INERT_EXISTING_LEGACY');assert.doesNotThrow(()=>unit.api.getPkgArguments(args(p)));});
 checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);assert.throws(()=>unit.api.getPkgArguments({...args(p),cachePath:'unbound-cache'}),/OPTIONS_INVALID/);});
 checkGuard(()=>{const p=plan({kind:'candidate',id});unit.setPlan(p);assert.throws(()=>unit.api.getPkgArguments({...args(p),config:'unbound-config'}),/OPTIONS_INVALID/);});
}finally{
 const current=fs.lstatSync(fixture,{bigint:true});assert.ok(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino&&current.birthtimeNs===identity.birthtimeNs);
 assert.equal(path.dirname(fixture),fs.realpathSync(os.tmpdir()));fs.rmSync(fixture,{recursive:true,force:false});
}
console.log(JSON.stringify({status:'PASS',cases,guardRoleCases:guardCases,actualChildren:0,roleFields:15,privatePlanFixture:'explicitly inert unqualified state; actual functions, no hash substitution',positiveAuthenticRuntime:'UNRUN',ownedFixtureRemoved:!fs.existsSync(fixture)}));
