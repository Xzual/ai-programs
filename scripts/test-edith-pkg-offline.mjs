import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);
const guardPath=path.join(root,'scripts/desktop-pkg-offline.cjs');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function boundaryTraps({cold=false}={}){
 const counters={};
 const deny=operation=>function(){counters[operation]=(counters[operation]??0)+1;const error=new Error('TEST_PRE_OS_BOUNDARY_REACHED');error.code='TEST_PRE_OS_BOUNDARY_REACHED';throw error;};
 const patch=(object,names,prefix)=>{for(const name of names)if(typeof object[name]==='function')object[name]=deny(`${prefix}.${name}`);};
 const cp=require('node:child_process');patch(cp,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],'child_process');patch(cp.ChildProcess.prototype,['spawn'],'ChildProcess');
 const net=require('node:net');patch(net,['connect','createConnection','createServer'],'net');patch(net.Socket.prototype,['connect'],'net.Socket');patch(net.Server.prototype,['listen'],'net.Server');
 patch(require('node:tls'),['connect','createServer'],'tls');patch(require('node:dgram'),['createSocket'],'dgram');
 if(!cold)for(const name of ['node:http','node:https','node:http2']){const api=require(name);patch(api,['request','get','connect','createServer','createSecureServer'],name);if(api.Agent)patch(api.Agent.prototype,['createConnection'],'http.Agent');}
 const dns=require('node:dns'),names=o=>Object.getOwnPropertyNames(o).filter(n=>/^(lookup|resolve|reverse|setServers)/.test(n));patch(dns,names(dns),'dns');patch(dns.promises,names(dns.promises),'dns.promises');patch(dns.Resolver.prototype,names(dns.Resolver.prototype),'dns.Resolver');patch(dns.promises.Resolver.prototype,names(dns.promises.Resolver.prototype),'dns.promises.Resolver');
 globalThis.fetch=deny('fetch');
 syncBuiltinESMExports();
 return {counters,coverage:['net','net.Socket','net.Server','tls','dgram','http','https','http2','http.Agent','dns','dns.promises','dns.Resolver','dns.promises.Resolver','fetch','child_process','ChildProcess.prototype.spawn']};
}
if(process.argv[2]==='--child'){
 const config=JSON.parse(process.argv[3]);
 const traps=boundaryTraps({cold:config.kind==='cold-cli'});
 const coldRelatedBuiltinsAtGuardEntry=process.moduleLoadList.filter(s=>/^NativeModule (?:https?|http2)$/.test(s));
 const guard=require(guardPath);guard.installDenyOnly();
 let errorCode=null,errorMessage=null,resolved=false,coverage=[],getterReads=0,proxyTrapReads=0;
 try{
  if(config.kind==='vendor'){
   const actual=require('@yao-pkg/pkg-fetch');
   await actual.need(config.options);resolved=true;
  }else if(config.kind==='fabricator'){
   const actual=require('@yao-pkg/pkg/lib-es5/fabricator.js');
   actual[config.method]([],{binaryPath:config.binaryPath,nodeRange:'node22',arch:'x64'},'synthetic-snapshot',Buffer.from('SYNTHETIC SOURCE ONLY'),()=>{});resolved=true;
  }else if(config.kind==='cold-cli'){
   if(coldRelatedBuiltinsAtGuardEntry.length)throw Error('COLD_START_HTTP_PRELOADED');
   const actual=require('@yao-pkg/pkg/lib-es5/index.js');
   await actual.exec(config.args);resolved=true;
  }else if(config.kind==='preflight'){
   guard.preflight({projectRoot:root,cachePath:config.cachePath,env:config.env,...config.extra});resolved=true;
  }else if(config.kind==='api-negative'){
   let options=config.options;
   if(config.shape==='preflight-accessor'){options={projectRoot:root,cachePath:config.cachePath,env:{}};Object.defineProperty(options,'projectRoot',{enumerable:true,get(){getterReads++;throw Error('UNEXPECTED_GETTER_READ');}});}
   if(config.shape==='preflight-env-accessor'){options={projectRoot:root,cachePath:config.cachePath,env:{}};Object.defineProperty(options.env,'NODE_OPTIONS',{enumerable:true,get(){getterReads++;throw Error('UNEXPECTED_ENV_GETTER_READ');}});}
   if(config.shape==='arguments-accessor'){options={pkgBin:config.pkgBin,entry:config.entry,output:config.output};Object.defineProperty(options,'entry',{enumerable:true,get(){getterReads++;throw Error('UNEXPECTED_GETTER_READ');}});}
   if(config.shape==='inherited-record')options=Object.create({projectRoot:root,cachePath:config.cachePath,env:{}});
   if(config.shape==='symbol-key'){options={projectRoot:root,cachePath:config.cachePath,env:{}};options[Symbol('unexpected')]=1;}
   if(config.shape==='proxy-record')options=new Proxy(config.method==='preflight'?{projectRoot:root,cachePath:config.cachePath,env:{}}:{pkgBin:config.pkgBin,entry:config.entry,output:config.output},{getPrototypeOf(){proxyTrapReads++;throw Error('UNEXPECTED_PROXY_TRAP');},ownKeys(){proxyTrapReads++;throw Error('UNEXPECTED_PROXY_TRAP');},getOwnPropertyDescriptor(){proxyTrapReads++;throw Error('UNEXPECTED_PROXY_TRAP');},get(){proxyTrapReads++;throw Error('UNEXPECTED_PROXY_TRAP');}});
   guard[config.method](options);resolved=true;
  }else if(config.kind==='arguments'){
   guard.getPkgArguments();resolved=true;
  }else if(config.kind==='integration'){
   const actual=await import(pathToFileURL(path.join(root,'scripts/build-edith-sidecar.mjs')).href);
   await actual.buildEdithSidecar();resolved=true;
  }else if(config.kind==='coverage'){
   const net=require('node:net'),cp=require('node:child_process'),dns=require('node:dns');
   const probes=[['net.connect',()=>net.connect(1,'127.0.0.1')],['net.createConnection',()=>net.createConnection(1,'127.0.0.1')],['Socket.connect',()=>new net.Socket().connect(1,'127.0.0.1')],['Server.listen',()=>new net.Server().listen(0)],['tls.connect',()=>require('node:tls').connect(1,'127.0.0.1')],['dgram.createSocket',()=>require('node:dgram').createSocket('udp4')],['http.request',()=>require('node:http').request('http://127.0.0.1:1')],['http.get',()=>require('node:http').get('http://127.0.0.1:1')],['https.request',()=>require('node:https').request('https://example.invalid')],['https.get',()=>require('node:https').get('https://example.invalid')],['http2.connect',()=>require('node:http2').connect('https://example.invalid')],['dns.lookup',()=>dns.lookup('example.invalid',()=>{})],['dns.resolve',()=>dns.resolve('example.invalid',()=>{})],['dns.promises.lookup',()=>dns.promises.lookup('example.invalid')],['dns.promises.resolve',()=>dns.promises.resolve('example.invalid')],['dns.Resolver.resolve',()=>new dns.Resolver().resolve('example.invalid',()=>{})],['dns.promises.Resolver.resolve',()=>new dns.promises.Resolver().resolve('example.invalid')],['fetch',()=>fetch('https://example.invalid')],...['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'].map(n=>[`child_process.${n}`,()=>cp[n](process.execPath,[])]),['ChildProcess.spawn',()=>new cp.ChildProcess().spawn({file:process.execPath,args:[]})],['fs.unlinkSync',()=>fs.unlinkSync(config.marker)],['fs.openSync.write',()=>fs.openSync(config.marker,'w')],['fs.promises.writeFile',()=>fs.promises.writeFile(config.marker,'SYNTHETIC REPLACEMENT')]];
   for(const [name,call]of probes){let code=null;try{await call();}catch(error){code=error?.code??null;}coverage.push({name,denied:code==='EDITH_PKG_OFFLINE_DENIED',code});}
  }
 }catch(error){errorCode=typeof error?.code==='string'?error.code:'VENDOR_REJECTION';errorMessage=error?.message??null;}
 console.log(JSON.stringify({childCase:config.id,resolved,errorCode,errorMessage,getterReads,proxyTrapReads,coldRelatedBuiltinsAtGuardEntry,diagnostic:guard.diagnosticState(),bottomBoundaryAttempts:traps.counters,bottomBoundaryCoverage:traps.coverage,coverage,qualification:'Trusted pinned vendor and listed public entrypoints only; not a hostile-JS/native-addon sandbox. Cold CLI does not preload HTTP/HTTPS/HTTP2; lower socket/process traps installed before guard.'}));
}else{
 const adapterSource=path.join(root,'artifacts/repair-20261006/chat6/overnight-playwright-asset/tests');
 const artifact=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'p-'));
 const adapterSyntax=[];
 for(const name of ['guard-main-preload.cjs','notice-adapters.mjs','asset-adapters.mjs']){
  let text=fs.readFileSync(path.join(adapterSource,name),'utf8');
  if(name.endsWith('.mjs')){
   const original="root=path.resolve(own,'../../../../..')";
   assert.equal(text.split(original).length,2,'one test-only project root rebind');
   text=text.replace(original,'root='+JSON.stringify(root));
  }
  const destination=path.join(artifact,name);fs.writeFileSync(destination,text,{flag:'wx'});
  const parsed=spawnSync(process.execPath,['--check',destination],{cwd:root,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:path.dirname(process.execPath),TEMP:artifact,TMP:artifact,USERPROFILE:artifact,APPDATA:artifact,LOCALAPPDATA:artifact},encoding:'utf8',timeout:15000,maxBuffer:65536,windowsHide:true});
  assert.equal(parsed.status,0,'rehosted adapter syntax');adapterSyntax.push({name,status:parsed.status});
 }
 const guard=require(guardPath);
 const expectedRuntimeSha='fd78dc295241575f07a545385915bdf238d4fa9972679a984c5f82cd8361f005';
 const expectedTablePath=path.join(root,'node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json');
 const patchPath='node_modules/@yao-pkg/pkg-fetch/patches/node.v22.15.1.cpp.patch';
 const expectedTable=JSON.parse(fs.readFileSync(expectedTablePath,'utf8'));
 const targetIdentity={target:'node22-win-x64',runtimeVersion:'v22.15.1',runtimeSha256:expectedRuntimeSha,tableSha256:hash(expectedTablePath),patchSha256:hash(path.join(root,patchPath)),qualification:'Installed vendor table/source identity checks only; no runtime bytes qualified or executed'};
 assert.equal(expectedTable['node-v22.15.1-win-x64'],expectedRuntimeSha);
 assert.equal(guard.EXPECTED_RUNTIME_SHA256,expectedRuntimeSha);
 assert.equal(guard.FETCHED_NAME,'fetched-v22.15.1-win-x64');
 assert.equal(guard.CACHE_TAG,'v3.5');
 assert.equal(targetIdentity.tableSha256,'53e87b746d9f32df70f5584639a7321f63b5e258493c5b106ad3bd209f6e1f9d');
 assert.equal(targetIdentity.patchSha256,'67f26e6ca89fbda19975fde81d36b1cbe88941774440906cd965d9920cd1b7dc');
 assert.equal(guard.vendorPins.find(p=>p.path===patchPath)?.sha256.toLowerCase(),targetIdentity.patchSha256);
 assert.equal(guard.vendorPins.find(p=>p.path==='node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json')?.sha256.toLowerCase(),targetIdentity.tableSha256);
 const fixture=fs.mkdtempSync(path.join(artifact,'fixture-'));
 const sources=['scripts/test-edith-pkg-offline.mjs','scripts/desktop-pkg-offline.cjs','scripts/build-edith-sidecar.mjs','node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json',patchPath].map(p=>({path:p,sha256:hash(path.join(root,p))}));
 const cases=[],links=[];let noticeEvidence,assetEvidence;
 function cache(id,{fetched=false,built=false}={}){const dir=path.join(fixture,id);fs.mkdirSync(path.join(dir,guard.CACHE_TAG),{recursive:true});if(fetched)fs.writeFileSync(path.join(dir,guard.CACHE_TAG,guard.FETCHED_NAME),'SYNTHETIC INVALID PATCHED RUNTIME');if(built)fs.writeFileSync(path.join(dir,guard.CACHE_TAG,'built-v22.15.1-win-x64'),'SYNTHETIC INVALID BUILT RUNTIME');return dir;}
 function run(config,envExtra={},cwd=root){
  const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:path.dirname(process.execPath),TEMP:fixture,TMP:fixture,USERPROFILE:fixture,APPDATA:fixture,LOCALAPPDATA:fixture,PKG_CACHE_PATH:config.cachePath??path.join(fixture,'default-cache'),...envExtra};
  const command=[process.execPath,fileURLToPath(import.meta.url),'--child',JSON.stringify(config)];
  const result=spawnSync(command[0],command.slice(1),{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  fs.writeFileSync(path.join(artifact,config.id+'.log'),(result.stdout??'')+(result.stderr??''));
  const report=(result.stdout??'').split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).find(s=>s.childCase===config.id);
  cases.push({id:config.id,config,exitCode:result.status,error:result.error?.code??null,report,command:command.slice(0,3),cwd});return report;
 }
 function runGuardMain(id,args,expected,cachePath){
  const preload=path.join(artifact,'guard-main-preload.cjs');
  const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:path.dirname(process.execPath),TEMP:fixture,TMP:fixture,USERPROFILE:fixture,APPDATA:fixture,LOCALAPPDATA:fixture,PKG_CACHE_PATH:cachePath};
  const command=[process.execPath,'--require',preload,guardPath,...args];
  const result=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,windowsHide:true});
  fs.writeFileSync(path.join(artifact,id+'.log'),(result.stdout??'')+(result.stderr??''));
  const line=(result.stdout??'').split(/\r?\n/).find(s=>s.startsWith('EDITH_MAIN_TRAPS '));
  const traps=line?JSON.parse(line.slice('EDITH_MAIN_TRAPS '.length)):null;
  const report={childCase:id,resolved:false,errorCode:(result.stderr??'').trim(),coldRelatedBuiltinsAtGuardEntry:traps?.relatedBuiltinsAtPreloadEnd,getterReads:0,coverage:[],diagnostic:{mode:'ACTUAL_GUARD_MAIN_EARLY_DENIAL',productionAllowed:false,counters:{}},bottomBoundaryAttempts:traps?.attempts??{},qualification:'Actual guard require.main CLI with artifact-owned public lower-boundary traps; no HTTP preload/source transformation/hash override. Role/cache denial only; no post-authentic-SHA production admission.'};
  cases.push({id,config:{kind:'guard-main',expected},exitCode:result.status,error:result.error?.code??null,expectedExitCode:1,report,command,cwd:root});
 }
 let cleaned=false;
 try{
  const defaults={nodeRange:'node22',platform:'win',arch:'x64'};
  for(const [id,options,setup]of [['vendor-miss',{},{}],['vendor-corrupt',{},{fetched:true}],['vendor-force-build',{forceBuild:true},{}],['vendor-force-fetch',{forceFetch:true},{}],['vendor-built-result-refused',{},{built:true}],['vendor-dry-run-result-refused',{dryRun:true},{}]]){const dir=cache(id,setup);run({id,kind:'vendor',cachePath:dir,options:{...defaults,...options}});}
  for(const [id,options]of [['vendor-wrong-node',{nodeRange:'node20'}],['vendor-wrong-platform',{platform:'linux'}],['vendor-wrong-arch',{arch:'arm64'}],['vendor-output-override',{output:path.join(fixture,'output')}]])run({id,kind:'vendor',cachePath:cache(id),options:{...defaults,...options}});
  run({id:'vendor-wrong-node18',kind:'vendor',cachePath:cache('vendor-wrong-node18'),options:{...defaults,nodeRange:'node18'}});
  for(const name of ['PKG_NODE_PATH','PKG_IGNORE_TAG','PKG_BUILD_PATH']){const id=`vendor-override-${name.toLowerCase()}`;const dir=cache(id,{fetched:true});run({id,kind:'vendor',cachePath:dir,options:defaults},{[name]:path.join(dir,guard.CACHE_TAG,guard.FETCHED_NAME)});}
  const valid=cache('preflight-corrupt',{fetched:true});
  run({id:'preflight-missing',kind:'preflight',cachePath:path.join(fixture,'missing-cache'),env:{}});
  run({id:'preflight-corrupt',kind:'preflight',cachePath:valid,env:{}});
  run({id:'preflight-relative',kind:'preflight',cachePath:'relative-cache',env:{}});
  run({id:'preflight-unc',kind:'preflight',cachePath:'\\\\example.invalid\\cache',env:{}});
  run({id:'preflight-env-cache-override',kind:'preflight',cachePath:valid,env:{PKG_CACHE_PATH:path.join(fixture,'other-cache')}});
  for(const name of ['PKG_NODE_PATH','PKG_IGNORE_TAG','PKG_BUILD_PATH','NODE_OPTIONS','NODE_PATH'])run({id:`preflight-override-${name.toLowerCase()}`,kind:'preflight',cachePath:valid,env:{[name]:'SYNTHETIC_OVERRIDE'}});
  run({id:'preflight-unknown-options',kind:'preflight',cachePath:valid,env:{},extra:{target:'node20-linux-arm64'}});
  run({id:'preflight-built-cache',kind:'preflight',cachePath:cache('preflight-built-cache',{built:true}),env:{}});
  const file=path.join(fixture,'cache-file');fs.writeFileSync(file,'SYNTHETIC');run({id:'preflight-cache-file',kind:'preflight',cachePath:file,env:{}});
  const runtimeDir=cache('runtime-directory');fs.mkdirSync(path.join(runtimeDir,guard.CACHE_TAG,guard.FETCHED_NAME));run({id:'preflight-runtime-directory',kind:'preflight',cachePath:runtimeDir,env:{}});
  for(const kind of ['cache-directory','runtime-directory','runtime-file']){
   const target=kind==='runtime-file'?path.join(fixture,'owned-link-file'):cache(`owned-link-target-${kind}`,{fetched:true});if(kind==='runtime-file')fs.writeFileSync(target,'SYNTHETIC');
   const dir=kind==='cache-directory'?path.join(fixture,'cache-junction'):cache(`link-${kind}`);const link=kind==='cache-directory'?dir:path.join(dir,guard.CACHE_TAG,guard.FETCHED_NAME);
   try{fs.symlinkSync(target,link,kind==='runtime-file'?'file':process.platform==='win32'?'junction':'dir');links.push({kind,status:'EXECUTED'});run({id:`preflight-link-${kind}`,kind:'preflight',cachePath:dir,env:{}});}catch(error){links.push({kind,status:'NOT_RUN',reason:error?.code??'LINK_UNAVAILABLE'});}
  }
  run({id:'immutable-arguments-refused',kind:'arguments'});
  for(const method of ['fabricate','fabricateTwice'])run({id:`actual-fabricator-${method}`,kind:'fabricator',method,binaryPath:path.join(valid,guard.CACHE_TAG,guard.FETCHED_NAME)});
  const marker=path.join(fixture,'coverage-marker');fs.writeFileSync(marker,'SYNTHETIC SENTINEL');const coverage=run({id:'guard-entrypoint-coverage',kind:'coverage',marker});assert.equal(fs.readFileSync(marker,'utf8'),'SYNTHETIC SENTINEL');
  const project=path.join(fixture,'synthetic-project'),sentinel=path.join(project,'.edith-build/desktop/sentinel.txt');fs.mkdirSync(path.dirname(sentinel),{recursive:true});fs.writeFileSync(sentinel,'SYNTHETIC SENTINEL');
  fs.mkdirSync(path.join(project,'crypto'),{recursive:true});fs.copyFileSync(path.join(root,'crypto/requirements.lock.txt'),path.join(project,'crypto/requirements.lock.txt'));
  const missing=path.join(project,'missing-cache');run({id:'actual-build-invalid-preflight',kind:'integration',cachePath:missing},{PKG_CACHE_PATH:missing,EDITH_CRYPTO_PYTHON_BUNDLE_DIR:path.join(project,'python-must-not-read')},project);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'SYNTHETIC SENTINEL');
  const cliEntry=path.join(fixture,'cli-entry.cjs'),cliOutput=path.join(fixture,'never-produced.exe');fs.writeFileSync(cliEntry,'module.exports="SYNTHETIC OWNED CLI";');
  for(const [id,args]of [['cold-cli-no-entry',['--no-bytecode','--no-native-build']],['cold-cli-invalid-compression',[cliEntry,'--no-bytecode','--no-native-build','--compress','invalid']],['cold-cli-wrong-target',[cliEntry,'--target','node22-linux-x64','--no-bytecode','--no-native-build','--output',cliOutput]],['cold-cli-exact-target-empty-cache',[cliEntry,'--target','node22-win-x64','--no-bytecode','--no-native-build','--output',cliOutput]]])run({id,kind:'cold-cli',cachePath:cache(id),args});
  assert.equal(fs.existsSync(cliOutput),false);
  run({id:'cold-cli-node18-rejected',kind:'cold-cli',cachePath:cache('cold-cli-node18-rejected'),args:[cliEntry,'--target','node18-win-x64','--no-bytecode','--no-native-build','--output',cliOutput]});
  const argumentOptions={pkgBin:path.join(root,'node_modules/@yao-pkg/pkg/lib-es5/bin.js'),entry:cliEntry,output:cliOutput};
  const preflightOptions={projectRoot:root,cachePath:valid,env:{}};
  for(const config of [
   {id:'api-preflight-null',method:'preflight',options:null,expected:'OPTIONS_INVALID'},
   {id:'api-preflight-array',method:'preflight',options:[],expected:'OPTIONS_INVALID'},
   {id:'api-preflight-missing-keys',method:'preflight',options:{projectRoot:root},expected:'OPTIONS_INVALID'},
   {id:'api-preflight-inherited',method:'preflight',shape:'inherited-record',expected:'OPTIONS_INVALID'},
   {id:'api-preflight-symbol',method:'preflight',shape:'symbol-key',expected:'OPTIONS_INVALID'},
   {id:'api-preflight-accessor',method:'preflight',shape:'preflight-accessor',expected:'OPTIONS_INVALID'},
   {id:'api-preflight-proxy',method:'preflight',shape:'proxy-record',expected:'OPTIONS_INVALID'},
   {id:'api-env-accessor',method:'preflight',shape:'preflight-env-accessor',expected:'ENV_REQUIRED'},
   {id:'api-env-null',method:'preflight',options:{...preflightOptions,env:null},expected:'ENV_REQUIRED'},
   {id:'api-env-numeric',method:'preflight',options:{...preflightOptions,env:{BENIGN:1}},expected:'ENV_REQUIRED'},
   {id:'api-env-chdir',method:'preflight',options:{...preflightOptions,env:{CHDIR:fixture}},expected:'OVERRIDE_REJECTED'},
   {id:'api-relative-project',method:'preflight',options:{...preflightOptions,projectRoot:'relative-project'},expected:'PROJECT_REQUIRED'},
   {id:'api-cache-outside-root',method:'preflight',options:{...preflightOptions,cachePath:path.dirname(root)},expected:'CACHE_OUTSIDE_OWNED_ROOT'},
   {id:'api-cache-build-directory',method:'preflight',options:{...preflightOptions,cachePath:path.join(root,'.edith-build','synthetic-not-read')},expected:'CACHE_OUTSIDE_OWNED_ROOT'},
   {id:'api-arguments-null',method:'getPkgArguments',options:null,expected:'OPTIONS_INVALID'},
   {id:'api-arguments-accessor',method:'getPkgArguments',shape:'arguments-accessor',...argumentOptions,expected:'OPTIONS_INVALID'},
   {id:'api-arguments-proxy',method:'getPkgArguments',shape:'proxy-record',...argumentOptions,expected:'OPTIONS_INVALID'},
   {id:'api-arguments-unknown-flag',method:'getPkgArguments',options:{...argumentOptions,bytecode:true},expected:'OPTIONS_INVALID'},
   {id:'api-arguments-without-preflight',method:'getPkgArguments',options:argumentOptions,expected:'PREFLIGHT_REQUIRED'},
   {id:'api-install-options-refused',method:'installDenyOnly',options:{production:true},expected:'OPTIONS_INVALID'},
  ])run({...config,kind:'api-negative',cachePath:valid});
  const fixedEntry=path.join(root,'.edith-build/desktop/server.cjs'),fixedOutput=path.join(root,'src-tauri/binaries/edith-backend-x86_64-pc-windows-msvc.exe'),missingMainCache=path.join(fixture,'main-missing-cache');
  for(const [id,args,expected,cachePath]of [
   ['main-role-missing',[],'ROLE_REJECTED',valid],
   ['main-role-extra-flags',['--edith-pkg-buffer',valid,fixedEntry,fixedOutput,'--no-bytecode'],'ROLE_REJECTED',valid],
   ['main-role-output-override-flag',['--edith-pkg-buffer',valid,fixedEntry,fixedOutput,'--output',cliOutput],'ROLE_REJECTED',valid],
   ['main-cache-relative',['--edith-pkg-buffer','relative-cache',fixedEntry,fixedOutput],'CACHE_REQUIRED','relative-cache'],
   ['main-cache-missing',['--edith-pkg-buffer',missingMainCache,fixedEntry,fixedOutput],'PATH_MISSING',missingMainCache],
   ['main-cache-synthetic-corrupt',['--edith-pkg-buffer',valid,fixedEntry,fixedOutput],'RUNTIME_MISMATCH',valid],
   ['candidate-invalid-id',['--edith-pkg-candidate','not-an-id',valid,fixedEntry,fixedOutput],'ROLE_REJECTED',valid],
   ['candidate-newline-id',['--edith-pkg-candidate','a'.repeat(64)+'\n',valid,fixedEntry,fixedOutput],'ROLE_REJECTED',valid],
   ['candidate-extra-child-flag',['--edith-pkg-candidate','a'.repeat(64),valid,fixedEntry,fixedOutput,'--output'],'ROLE_REJECTED',valid],
   ['candidate-missing-cache',['--edith-pkg-candidate','a'.repeat(64),missingMainCache,fixedEntry,fixedOutput],'PATH_MISSING',missingMainCache],
  ])runGuardMain(id,args,expected,cachePath);
  const noticeCommand=[process.execPath,'--require',path.join(artifact,'guard-main-preload.cjs'),path.join(artifact,'notice-adapters.mjs')];
  const noticeChild=spawnSync(noticeCommand[0],noticeCommand.slice(1),{cwd:root,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:path.dirname(process.execPath),TEMP:fixture,TMP:fixture,USERPROFILE:fixture,APPDATA:fixture,LOCALAPPDATA:fixture,PKG_CACHE_PATH:path.join(fixture,'notice-never-runtime')},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,windowsHide:true});
  fs.writeFileSync(path.join(artifact,'notice-adapters.log'),(noticeChild.stdout??'')+(noticeChild.stderr??''));
  const noticeLines=(noticeChild.stdout??'').split(/\r?\n/),noticeLine=noticeLines.find(s=>s.startsWith('EDITH_NOTICE_RESULT ')),noticeTrapLine=noticeLines.find(s=>s.startsWith('EDITH_MAIN_TRAPS '));
  noticeEvidence={exitCode:noticeChild.status,error:noticeChild.error?.code??null,command:noticeCommand,report:noticeLine?JSON.parse(noticeLine.slice('EDITH_NOTICE_RESULT '.length)):null,boundary:noticeTrapLine?JSON.parse(noticeTrapLine.slice('EDITH_MAIN_TRAPS '.length)):null};
  const assetCommand=[process.execPath,'--require',path.join(artifact,'guard-main-preload.cjs'),path.join(artifact,'asset-adapters.mjs')];
  const assetChild=spawnSync(assetCommand[0],assetCommand.slice(1),{cwd:root,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:path.dirname(process.execPath),TEMP:fixture,TMP:fixture,USERPROFILE:fixture,APPDATA:fixture,LOCALAPPDATA:fixture,PKG_CACHE_PATH:path.join(fixture,'asset-never-runtime')},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
  fs.writeFileSync(path.join(artifact,'asset-adapters.log'),(assetChild.stdout??'')+(assetChild.stderr??''));
  const assetLines=(assetChild.stdout??'').split(/\r?\n/),assetLine=assetLines.find(s=>s.startsWith('EDITH_ASSET_RESULT ')),assetTrapLine=assetLines.find(s=>s.startsWith('EDITH_MAIN_TRAPS '));
  assetEvidence={exitCode:assetChild.status,error:assetChild.error?.code??null,command:assetCommand,report:assetLine?JSON.parse(assetLine.slice('EDITH_ASSET_RESULT '.length)):null,boundary:assetTrapLine?JSON.parse(assetTrapLine.slice('EDITH_MAIN_TRAPS '.length)):null};
  assert.ok(coverage?.coverage.length>20);
 }finally{if(path.dirname(path.resolve(fixture))!==path.resolve(artifact)||!path.basename(fixture).startsWith('fixture-'))throw Error('OWNED_FIXTURE_CLEANUP_DENIED');fs.rmSync(fixture,{recursive:true,force:true});cleaned=!fs.existsSync(fixture);}
 const expectedPreflightCodes={'preflight-missing':'PATH_MISSING','preflight-corrupt':'RUNTIME_MISMATCH','preflight-relative':'CACHE_REQUIRED','preflight-unc':'CACHE_REQUIRED','preflight-env-cache-override':'CACHE_OVERRIDE_REJECTED','preflight-unknown-options':'OPTIONS_INVALID','preflight-built-cache':'BUILT_CACHE_REJECTED','preflight-cache-file':'CACHE_NOT_DIRECTORY','preflight-runtime-directory':'RUNTIME_MISMATCH'};
 const expectedVendorRoutes={'vendor-miss':'pkg-fetch.utils.downloadUrl','vendor-force-fetch':'pkg-fetch.utils.downloadUrl','vendor-force-build':'pkg-fetch.build.default','vendor-corrupt':'fs.unlinkSync','vendor-built-result-refused':'pkg-fetch.need.result','vendor-dry-run-result-refused':'pkg-fetch.need.result'};
 const failures=[];
 if(noticeEvidence?.exitCode!==0||noticeEvidence?.report?.result!=='PASS'||!noticeEvidence?.boundary||Object.keys(noticeEvidence.boundary.attempts).length)failures.push('actual-notice-producer-consumer-suite');
 if(assetEvidence?.exitCode!==0||assetEvidence?.report?.result!=='PASS'||!assetEvidence?.boundary||Object.keys(assetEvidence.boundary.attempts).length)failures.push('actual-fixed-asset-public-adapter-suite');
 for(const row of cases){const r=row.report;if(row.exitCode!==(row.expectedExitCode??0)||!r||r.resolved||Object.values(r.bottomBoundaryAttempts).some(n=>n!==0))failures.push(row.id);if(r?.coverage.some(c=>!c.denied))failures.push(row.id+':coverage');if(row.id.startsWith('vendor-')&&(!r?.errorCode||r?.diagnostic.counters['pkg-fetch.need.called']!==1))failures.push(row.id+':vendor-call');if(/^vendor-(?:miss|corrupt|force|built|dry)/.test(row.id)&&r?.diagnostic.counters['pkg-fetch.need.bodyEntered']!==1)failures.push(row.id+':actual-body');if(row.id.startsWith('preflight-')&&!r?.errorCode?.startsWith('EDITH_PKG_OFFLINE_'))failures.push(row.id+':preflight-code');}
 for(const row of cases){const r=row.report,counters=r?.diagnostic.counters??{};
  if(expectedVendorRoutes[row.id]&&!(counters[expectedVendorRoutes[row.id]]>=1))failures.push(row.id+':exact-deny-route');
  if(expectedVendorRoutes[row.id]&&row.id!=='vendor-force-fetch'&&r?.errorCode!=='EDITH_PKG_OFFLINE_DENIED')failures.push(row.id+':exact-deny-code');
  if(row.id.startsWith('vendor-wrong-')||row.id==='vendor-output-override'){if(r?.errorCode!=='EDITH_PKG_OFFLINE_TARGET_REJECTED'||counters['pkg-fetch.need.bodyEntered'])failures.push(row.id+':target-prebody');}
  if(row.id.startsWith('vendor-override-')){if(r?.errorCode!=='EDITH_PKG_OFFLINE_OVERRIDE_REJECTED'||counters['pkg-fetch.need.bodyEntered'])failures.push(row.id+':override-prebody');}
  const suffix=expectedPreflightCodes[row.id]??(row.id.startsWith('preflight-override-')?'OVERRIDE_REJECTED':row.id.startsWith('preflight-link-')?'LINK_REJECTED':null);
  if(suffix&&r?.errorCode!==`EDITH_PKG_OFFLINE_${suffix}`)failures.push(row.id+':exact-preflight-code');
  if(row.id==='actual-build-invalid-preflight'&&(r?.errorCode!=='EDITH_PKG_OFFLINE_PATH_MISSING'||Object.keys(counters).length!==0))failures.push(row.id+':preflight-before-effects');
  if(row.id==='immutable-arguments-refused'&&r?.errorCode!=='EDITH_PKG_OFFLINE_OPTIONS_INVALID')failures.push(row.id+':missing-argument-options');
  if(row.config.kind==='fabricator'&&(r?.errorCode!=='EDITH_PKG_OFFLINE_DENIED'||counters['child_process.spawn']!==1))failures.push(row.id+':actual-fabricator-spawn-deny');
  if(row.config.kind==='cold-cli'){
   if(r?.coldRelatedBuiltinsAtGuardEntry.length!==0)failures.push(row.id+':not-cold');
   if(row.id==='cold-cli-no-entry'&&!r?.errorMessage?.includes('Entry file/directory is expected'))failures.push(row.id+':actual-entry-validation');
   if(row.id==='cold-cli-invalid-compression'&&!r?.errorMessage?.includes('Invalid compression algorithm'))failures.push(row.id+':actual-compression-validation');
   if(row.id==='cold-cli-wrong-target'&&(r?.errorCode!=='EDITH_PKG_OFFLINE_TARGET_REJECTED'||counters['pkg-fetch.need.bodyEntered']))failures.push(row.id+':actual-target-validation');
   if(row.id==='cold-cli-node18-rejected'&&(r?.errorCode!=='EDITH_PKG_OFFLINE_TARGET_REJECTED'||counters['pkg-fetch.need.bodyEntered']))failures.push(row.id+':old-node18-target-rejected');
   if(row.id==='cold-cli-exact-target-empty-cache'&&(r?.errorCode!=='EDITH_PKG_OFFLINE_DENIED'||counters['pkg-fetch.need.bodyEntered']!==1||counters['pkg-fetch.need.result']!==1))failures.push(row.id+':actual-empty-cache-dryrun-result-denial');
  }
  if(row.config.kind==='api-negative'&&(r?.errorCode!==`EDITH_PKG_OFFLINE_${row.config.expected}`||r?.getterReads!==0||r?.proxyTrapReads!==0))failures.push(row.id+':exact-api-route-or-getter-or-proxy');
  if(row.config.kind==='guard-main'&&(r?.errorCode!==`EDITH_PKG_OFFLINE_${row.config.expected}`||r?.coldRelatedBuiltinsAtGuardEntry?.length!==0))failures.push(row.id+':actual-main-route-or-cold-start');
 }
 const sourceParity=sources.map(r=>({...r,unchanged:hash(path.join(root,r.path))===r.sha256}));if(sourceParity.some(r=>!r.unchanged))failures.push('source-parity');
 const summary={artifact,adapterSyntax,suite:'actual-installed-pkg-fetch-offline-negatives',result:failures.length?'FAIL':'PASS',cases:cases.length,failures,targetIdentity,pinnedTargetIdentityAssertions:8,noticeDelivery:noticeEvidence,assetDelivery:assetEvidence,prior65NegativeCasesRetained:true,originalNegativeCasesRetained:35,coldActualCliCases:cases.filter(r=>r.config.kind==='cold-cli').length,actualApiNegativeCases:cases.filter(r=>r.config.kind==='api-negative').length,actualGuardMainEarlyNegativeCases:cases.filter(r=>r.config.kind==='guard-main').length,authorizedHarnessNodeChildren:cases.length+5,actualVendorBodyCases:cases.filter(r=>(r.report?.diagnostic.counters['pkg-fetch.need.bodyEntered']??0)>0).length,actualVendorFabricatorCases:cases.filter(r=>r.config.kind==='fabricator').length,wrapperOnlyCases:cases.filter(r=>r.id.startsWith('vendor-')&&!r.report?.diagnostic.counters['pkg-fetch.need.bodyEntered']).length,guardCoverageProbes:cases.find(r=>r.id==='guard-entrypoint-coverage')?.report?.coverage.length??0,bottomOSNetworkOrSubprocessAttemptsWithinGuard:cases.reduce((n,r)=>n+Object.values(r.report?.bottomBoundaryAttempts??{}).reduce((a,b)=>a+b,0),0),links,ownedFixtureCleaned:cleaned,sourceParity,positiveGenuinePatchedRuntime:'NOT_RUN',productionPostQualificationGates:{bootstrapCachedModules:'NOT_RUN',wrapperFlagsAndReadCardinality:'NOT_RUN',concurrentReentrantAdmission:'NOT_RUN',privateCopyConsumer:'NOT_RUN',outputContainmentPromotionCleanup:'NOT_RUN',reason:'Authentic constant-SHA runtime unavailable; no production hash override or test admission seam'},separateSyntheticProducerEvidence:'overnight-pkg-buffer-feasibility/tests/SOURCE_STOP.json; not new production guard admission',mockPositive:false,policyOrVendorHashChanged:false,actualBuildPreflightBeforeSentinelDeletion:true,pythonOrPkgSubprocessExecuted:false,applicationExecuted:false,qualification:'Actual pinned vendor need body for marked cases; target/override intercepted before body. Guard coverage limited to listed trusted vendor/public pathways, not unconditional hostile-JS sandbox. Authorized harness Node children are outside guard; counted zero applies only to guarded vendor/API attempts.'};
 fs.writeFileSync(path.join(artifact,'case-results.json'),JSON.stringify({summary,cases},null,2)+'\n');console.log(JSON.stringify(summary));process.exitCode=failures.length||!cleaned?1:0;
}
