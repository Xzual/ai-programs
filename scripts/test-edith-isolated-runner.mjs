import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installConfinement, runIsolatedTest } from './run-edith-isolated-test.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const approved = path.resolve(project, process.argv[2] ?? 'artifacts/isolated-runner-regression');
assert.ok(approved.startsWith(path.join(project,'artifacts') + path.sep));
fs.mkdirSync(approved,{recursive:true});
const root = fs.mkdtempSync(path.join(approved,'fixture-'));
let checks = 0;
try {
  const syntheticProject = path.join(root,'project');
  fs.mkdirSync(path.join(syntheticProject,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(syntheticProject,'node_modules/tsx/dist'),{recursive:true});
  fs.mkdirSync(path.join(syntheticProject,'.edith'));
  fs.writeFileSync(path.join(syntheticProject,'node_modules/tsx/dist/loader.mjs'),'export {};');
  fs.writeFileSync(path.join(syntheticProject,'.env'),'SYNTHETIC_PROVIDER=DO_NOT_INHERIT');
  fs.writeFileSync(path.join(syntheticProject,'.edith/edith.db'),'OWNED_SYNTHETIC_SENTINEL');
  const external = path.join(root,'synthetic-external');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external,'hidden.ts'),'owned sentinel');
  fs.symlinkSync(external,path.join(syntheticProject,'scripts','linked'),'junction');
  const descendant = path.join(syntheticProject,'scripts','test-edith-descendant.ts');
  fs.writeFileSync(descendant,`import fs from 'node:fs';
    if(process.env.OPENAI_API_KEY) throw Error('descendant inherited provider');
    try { fs.readFileSync(process.cwd()+'/.edith/edith.db'); throw Error('descendant escaped'); }
    catch(e) { if(!e.message.includes('EDITH_ISOLATION_READ_DENIED')) throw e; }
    console.log('DESCENDANT_GUARD_PASS');`);
  const fixture = `import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import {spawnSync} from 'node:child_process'; import {pathToFileURL} from 'node:url'; import {createServer} from 'node:http';
    const denials=[];
    for(const p of ['.env','.edith/edith.db']) { try { fs.readFileSync(path.join(process.cwd(),p)); throw Error('sentinel read escaped'); } catch(e) { if(!e.message.includes('EDITH_ISOLATION_READ_DENIED')) throw e; denials.push(p); } }
    try { fs.writeFileSync(path.join(process.cwd(),'foreign-write.txt'),'bad'); throw Error('write escaped'); } catch(e) { if(!e.message.includes('EDITH_ISOLATION_WRITE_DENIED')) throw e; }
    if(process.env.SYNTHETIC_PROVIDER_KEY || process.env.OPENAI_API_KEY || process.env.NODE_EXTRA_CA_CERTS) throw Error('inherited credential/config');
    if(fs.readFileSync(process.env.DOTENV_CONFIG_PATH,'utf8')!=='') throw Error('dotenv is not empty');
    const config=JSON.parse(fs.readFileSync(process.env.EDITH_WORKSPACE_CONFIG_PATH,'utf8'));
    if(config.workspaceRoot!==process.env.EDITH_WORKSPACE_ROOT || !process.env.TEMP.startsWith(config.workspaceRoot)) throw Error('wrong workspace');
    const dataRelative=path.relative(os.tmpdir(),process.env.EDITH_TEST_DATA_DIR);
    if(!dataRelative || dataRelative.startsWith('..') || path.isAbsolute(dataRelative)) throw Error('unsafe persistence temp relationship');
    fs.writeFileSync(path.join(process.env.EDITH_TEST_DATA_DIR,'own-write.txt'),'own');
    try { fs.readFileSync(path.join(process.cwd(),'scripts/linked/hidden.ts')); throw Error('symlink escaped'); } catch(e) { if(!e.message.includes('EDITH_ISOLATION_READ_DENIED')) throw e; }
    const fd=fs.openSync(path.join(process.cwd(),'scripts/test-edith-descendant.ts'),'r');
    try { fs.fchmodSync(fd,0o777); throw Error('readonly descriptor mutation escaped'); } catch(e) { if(!e.message.includes('EDITH_ISOLATION_DESCRIPTOR_DENIED')) throw e; }
    fs.closeSync(fd);
    await new Promise((resolve,reject)=>fs.open(path.join(process.env.EDITH_TEST_DATA_DIR,'own-write.txt'),'r',(error,handle)=>{if(error)return reject(error);fs.close(handle,error=>error?reject(error):resolve());}));
    const child=spawnSync(process.execPath,['--import',pathToFileURL(path.join(process.cwd(),'node_modules/tsx/dist/loader.mjs')).href,path.join(process.cwd(),'scripts/test-edith-descendant.ts')],{env:{...process.env,OPENAI_API_KEY:'owned-override',NODE_OPTIONS:''},windowsHide:false,stdio:'inherit',encoding:'utf8'});
    if(child.status!==0 || !child.stdout.includes('DESCENDANT_GUARD_PASS')) throw Error('descendant confinement failed: '+child.stderr);
    const server=createServer((req,res)=>res.end('own-loopback'));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try { const response=await fetch('http://127.0.0.1:'+server.address().port,{signal:AbortSignal.timeout(2000)}); if(await response.text()!=='own-loopback')throw Error('loopback failed'); }
    finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
    console.log(JSON.stringify({sentinelDenials:denials.length,ownWrites:true,credentialAbsent:true,symlinkDenied:true,readonlyFdDenied:true,descendantGuard:true}));
    process.exitCode=Number(path.basename(import.meta.url).includes('failure')?7:0);`;
  for (const name of ['test-edith-fixture.ts','test-edith-failure.ts']) fs.writeFileSync(path.join(syntheticProject,'scripts',name),fixture);
  const artifactRoot = path.join(syntheticProject,'artifacts','approved');
  const environment = { SystemRoot:process.env.SystemRoot, WINDIR:process.env.WINDIR, SYNTHETIC_PROVIDER_KEY:'owned-test-canary', OPENAI_API_KEY:'owned-test-canary', NODE_EXTRA_CA_CERTS:'owned-test-canary' };
  let output = '', errors = '', launches = 0;
  const spawn = (exe,args,options) => {
    assert.equal(options.windowsHide,true); assert.equal(options.shell,false); assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    for(const key of ['SYNTHETIC_PROVIDER_KEY','OPENAI_API_KEY','NODE_EXTRA_CA_CERTS']) assert.equal(options.env[key],undefined);
    assert.ok(options.env.TEMP.startsWith(artifactRoot)); assert.ok(options.env.NODE_OPTIONS.includes('confinement.cjs'));
    launches++; checks += 8;
    return spawnSync(exe,args,options);
  };
  const options = { projectRoot:syntheticProject,artifactRoot,environment,spawn,output:{write:s=>{output+=s;}},errors:{write:s=>{errors+=s;}} };
  assert.equal(await runIsolatedTest('scripts/test-edith-fixture.ts',options),0); checks++;
  assert.match(output,/"sentinelDenials":2/); assert.match(output,/"cleanupComplete":true/); checks+=2;
  assert.equal(fs.readdirSync(artifactRoot).length,0); checks++;
  output=''; assert.equal(await runIsolatedTest('scripts/test-edith-failure.ts',options),7); checks++;
  assert.match(output,/"exitCode":7/); assert.ok(!output.includes('sourceRuntimeDatabaseUnchanged')); checks+=2;
  assert.equal(fs.readdirSync(artifactRoot).length,0); checks++;
  for(const requested of ['../scripts/test-edith-fixture.ts','scripts/../scripts/test-edith-fixture.ts','scripts/test-edith-fixture.ts/extra','scripts/test-edith-fixture.mjs','C:/foreign/test-edith-fixture.ts']) {
    await assert.rejects(runIsolatedTest(requested,options),/EDITH_TEST_TARGET_INVALID/); checks++;
  }
  await assert.rejects(runIsolatedTest('scripts/test-edith-fixture.ts',{...options,artifactRoot:root}),/EDITH_TEST_PATH_INVALID/); checks++;
  fs.symlinkSync(external,path.join(syntheticProject,'artifacts','linked'),'junction');
  await assert.rejects(runIsolatedTest('scripts/test-edith-fixture.ts',{...options,artifactRoot:path.join(syntheticProject,'artifacts','linked','child')}),/EDITH_TEST_LINK_ESCAPE/); checks++;
  assert.equal(launches,2); assert.equal(errors,''); checks+=2;

  // Instrument the underlying synthetic fs BEFORE installing the real guard:
  // protected read/hash/metadata operations must be rejected without reaching it.
  const require = createRequire(import.meta.url), calls = [], fakeFs = Object.create(fs);
  Object.defineProperty(fakeFs,'promises',{value:Object.create(fs.promises)});
  for(const name of ['readFileSync','statSync','lstatSync']) fakeFs[name]=(...args)=>{calls.push({name,path:String(args[0])});throw Object.assign(Error('synthetic absent'),{code:'ENOENT'});};
  const modules = new Map();
  const fakeRequire = name => {
    if(name==='node:fs')return fakeFs;
    if(name==='node:path'||name==='node:url')return require(name);
    if(name==='node:module')return {syncBuiltinESMExports(){}};
    if(!modules.has(name)) {
      if(name==='node:net')modules.set(name,{Server:class {emit(){}listen(){}},Socket:class {connect(){}}});
      else modules.set(name,{...require(name)});
    }
    return modules.get(name);
  };
  const config={projectRoot:syntheticProject,runRoot:path.join(syntheticProject,'artifacts','run-own'),publicFiles:[],publicRoots:[path.join(syntheticProject,'scripts')],esbuild:[]};
  vm.runInNewContext(`(${installConfinement.toString()})(${JSON.stringify(config)})`,{require:fakeRequire,process:{env:{},dlopen(){}},URL,queueMicrotask});
  for(const target of ['.env','.edith/edith.db']) for(const name of ['readFileSync','statSync','lstatSync']) {
    assert.throws(()=>fakeFs[name](path.join(syntheticProject,target)),/EDITH_ISOLATION_READ_DENIED/); checks++;
  }
  assert.equal(calls.length,0); checks++;
  console.log(JSON.stringify({pass:true,checks,actualHiddenChildRuns:launches,underlyingProtectedFsCalls:calls.length,credentialInheritance:false,realUserDataAccess:false,statusPropagation:true,cleanupVerified:true}));
} finally {
  assert.ok(root.startsWith(approved+path.sep));
  assert.equal(fs.realpathSync(root),root);
  fs.rmSync(root,{recursive:true,force:true});
}
