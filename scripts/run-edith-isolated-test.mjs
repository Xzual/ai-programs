import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const defaultProject = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inside = (root, target) => { const r = path.relative(root, target); return !r.startsWith('..') && !path.isAbsolute(r); };
function verifyPath(root, target) {
  if (!inside(root,target) || root===target) throw Error('EDITH_TEST_PATH_INVALID');
  for(let p=target; inside(root,p); p=path.dirname(p)) {
    try { if(fs.lstatSync(p).isSymbolicLink()) throw Error('EDITH_TEST_LINK_ESCAPE'); } catch(e) { if(!['ENOENT','ENOTDIR'].includes(e.code)) throw e; }
    if(p===root) break;
  }
}
// Owned preload, installed before tsx/test imports. Reviewed-test confinement,
// not a hostile JavaScript sandbox. Never examines a real runtime DB or .env.
export function installConfinement(config) {
  const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'), net=require('node:net');
  const inside=(a,b)=>{const r=path.relative(a,b);return !r.startsWith('..')&&!path.isAbsolute(r);};
  const resolve=v=>path.resolve(v instanceof URL?require('node:url').fileURLToPath(v):String(v));
  const rawLstat=fs.lstatSync, rawAppend=fs.appendFileSync, descriptors=new Map();
  const deny=k=>{const e=Error('EDITH_ISOLATION_'+k+'_DENIED');e.code='EACCES';throw e;};
  const privatePath=p=>/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.edith|Data|Conversations|Logs|Backups|Exports|profiles|secrets|cache)(?:[\\/]|$)/i.test(p)||/\.(?:db|sqlite\d*|pem|key)(?:-|$)/i.test(p);
  function owned(p) { if(!inside(config.runRoot,p))return false; for(let q=p;inside(config.runRoot,q);q=path.dirname(q)){try{if(rawLstat(q).isSymbolicLink())return false;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}if(q===config.runRoot)break;}return true; }
  function noLinks(p) { for(let q=p;;q=path.dirname(q)){try{if(rawLstat(q).isSymbolicLink())return false;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}if(q===path.dirname(q))break;}return true; }
  const readable=p=>owned(p)||(!privatePath(p)&&noLinks(p)&&(inside(path.join(config.projectRoot,'node_modules'),p)||config.publicFiles.includes(p)||config.publicRoots.some(r=>inside(r,p)&&/\.(?:[cm]?js|jsx|tsx?|json|css)$/.test(p))));
  const check=(v,w=false)=>{if(typeof v==='number'){if(!descriptors.has(v)||w&&!descriptors.get(v))deny('DESCRIPTOR');return;}const p=resolve(v);if(w?!owned(p):!readable(p))deny(w?'WRITE':'READ');};
  const ancestors=new Set();for(let p=config.projectRoot;;p=path.dirname(p)){ancestors.add(p);if(p===path.dirname(p))break;}
  const metadata=p=>!privatePath(p)&&noLinks(p)&&(ancestors.has(p)||config.publicRoots.some(r=>inside(r,p)));
  for(const n of ['readFileSync','readFile','readdirSync','readdir','statSync','stat','lstatSync','lstat','realpathSync','realpath','accessSync','access','existsSync','watch','watchFile','readlink','readlinkSync','createReadStream']) {
    const original=fs[n];fs[n]=function(v,...a){if(n==='existsSync'){try{check(v);}catch{return false;}}else if(!['statSync','lstatSync','realpathSync'].includes(n)||!metadata(resolve(v)))check(v);return original.call(this,v,...a);};
    if(original.native)fs[n].native=(v,...a)=>{if(!metadata(resolve(v)))check(v);return original.native(v,...a);};
  }
  const writes=['writeFileSync','writeFile','appendFileSync','appendFile','mkdirSync','mkdir','unlinkSync','unlink','rmSync','rm','rmdirSync','rmdir','truncateSync','truncate','chmodSync','chmod','createWriteStream','mkdtemp','mkdtempSync','chown','chownSync','utimes','utimesSync','lutimes','lutimesSync'];
  for(const n of writes){const original=fs[n];fs[n]=function(v,...a){check(v,true);return original.call(this,v,...a);};}
  for(const n of ['renameSync','rename','copyFileSync','copyFile']){const original=fs[n];fs[n]=function(a,b,...c){check(a,n.startsWith('rename'));check(b,true);return original.call(this,a,b,...c);};}
  for(const n of ['link','linkSync','symlink','symlinkSync','cp','cpSync'])fs[n]=()=>deny('LINK');
  const writing=f=>typeof f==='string'?/[wa+]/.test(f):Boolean(f&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND));
  for(const n of ['openSync','open']){const original=fs[n];fs[n]=function(v,f,...a){check(v,writing(f));if(n==='openSync'){const fd=original.call(this,v,f,...a);descriptors.set(fd,writing(f));return fd;}const cb=a.pop();return original.call(this,v,f,...a,(e,fd)=>{if(!e)descriptors.set(fd,writing(f));cb(e,fd);});};}
  for(const n of ['readSync','read','writeSync','write','ftruncateSync','ftruncate','fchmodSync','fchmod','fchownSync','fchown','futimesSync','futimes','writev','writevSync']){const original=fs[n];fs[n]=function(fd,...a){check(fd,!n.startsWith('read'));return original.call(this,fd,...a);};}
  for(const n of ['close','closeSync']){const original=fs[n];fs[n]=function(fd,...a){check(fd);descriptors.delete(fd);return original.call(this,fd,...a);};}
  for(const n of ['readFile','readdir','stat','lstat','realpath','access','writeFile','appendFile','mkdir','unlink','rm','rmdir','truncate','chmod','mkdtemp','readlink','watch','chown','utimes','lutimes']){const original=fs.promises[n];fs.promises[n]=async function(v,...a){check(v,['writeFile','appendFile','mkdir','unlink','rm','rmdir','truncate','chmod','mkdtemp','chown','utimes','lutimes'].includes(n));return original.call(this,v,...a);};}
  for(const n of ['rename','copyFile']){const original=fs.promises[n];fs.promises[n]=async function(a,b,...c){check(a,n==='rename');check(b,true);return original.call(this,a,b,...c);};}
  for(const n of ['link','symlink','cp'])fs.promises[n]=async()=>deny('LINK');
  const promiseOpen=fs.promises.open;fs.promises.open=async function(v,f,...a){check(v,writing(f));const handle=await promiseOpen.call(this,v,f,...a);if(!writing(f))for(const n of ['chmod','chown','utimes','truncate','write','writev','writeFile','appendFile','createWriteStream'])handle[n]=()=>deny('DESCRIPTOR');return handle;};
  const ports=new Set(Number(process.env.PORT)>=1024?[Number(process.env.PORT)]:[]),emit=net.Server.prototype.emit,listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect;
  net.Server.prototype.emit=function(event,...a){if(event==='listening'){const addr=this.address();if(addr?.port){ports.add(addr.port);rawAppend(config.childReport,JSON.stringify({port:addr.port})+'\n');}}return emit.call(this,event,...a);};
  net.Server.prototype.listen=function(...a){const first=a[0],host=typeof first==='object'?first.host:a[1];if(host!=='127.0.0.1')deny('LISTEN');return listen.apply(this,a);};
  net.Socket.prototype.connect=function(...a){const first=Array.isArray(a[0])?a[0][0]:a[0],host=typeof first==='object'?first.host??'localhost':a[1],port=Number(typeof first==='object'?first.port:first);if(!['127.0.0.1','localhost','::1'].includes(host)||!ports.has(port)||port===11434)deny('NETWORK');return connect.apply(this,a);};
  for(const [m,ns]of [['node:tls',['connect']],['node:https',['request','get']],['node:http2',['connect']],['node:dgram',['createSocket']]])for(const n of ns)require(m)[n]=()=>deny('NETWORK');
  const dns=require('node:dns');dns.lookup=(host,o,cb)=>{cb=typeof o==='function'?o:cb;if(!['localhost','127.0.0.1','::1'].includes(host))deny('NETWORK');const address=host==='::1'?'::1':'127.0.0.1',family=host==='::1'?6:4;queueMicrotask(()=>o?.all?cb(null,[{address,family}]):cb(null,address,family));};
  for(const m of [dns,require('node:dns/promises')])for(const n of Object.keys(m))if(/^(resolve|reverse)/.test(n)||m!==dns&&n==='lookup')m[n]=()=>deny('NETWORK');
  for(const n of ['spawn','spawnSync']){const original=cp[n];cp[n]=function(exe,args=[],o={}){
    const esbuild=config.esbuild.includes(path.resolve(exe))&&/^--service=\d+\.\d+\.\d+$/.test(args[0]??'')&&args.length===2&&args[1]==='--ping';
    if(path.resolve(exe)===config.node&&args[0]===config.tsxCli)args=['--import',config.loaderUrl,...args.slice(1)];
    const node=path.resolve(exe)===config.node&&args.length===3&&args[0]==='--import'&&args[1]===config.loaderUrl&&(args[2]===path.join(config.projectRoot,'server.ts')||/^test-edith-[A-Za-z0-9._-]+\.ts$/.test(path.basename(args[2]))&&path.dirname(args[2])===path.join(config.projectRoot,'scripts'));
    if((!esbuild&&!node)||o.shell||(!owned(path.resolve(o.cwd??process.cwd()))&&path.resolve(o.cwd??process.cwd())!==config.projectRoot))deny('PROCESS');
    const supplied=o.env??process.env,env={...config.environment};
    for(const k of ['NODE_ENV','PORT','EDITH_OWNER_TOKEN','EDITH_OWNER_TOKEN_ONE_TIME','EDITH_DESKTOP_BRIDGE_TOKEN','EDITH_PERSISTENCE'])if(supplied[k]!==undefined)env[k]=supplied[k];
    for(const k of ['EDITH_WORKSPACE_ROOT','EDITH_WORKSPACE_CONFIG_PATH','EDITH_TEST_DATA_DIR','W6_HTTP_REPORT_DIR','W5_HTTP_REPORT_DIR'])if(supplied[k]!==undefined){if(!owned(path.resolve(supplied[k])))deny('PROCESS_ENV');env[k]=supplied[k];}
    env.NODE_OPTIONS=config.nodeOptions;env.EDITH_HOST='127.0.0.1';env.TSX_DISABLE_CACHE='1';
    const child=original.call(this,exe,args,{...o,env,shell:false,windowsHide:true,stdio:esbuild?['pipe','pipe','pipe']:['ignore','pipe','pipe']});if(esbuild&&n==='spawn')child.stderr.resume();if(child.pid)rawAppend(config.childReport,JSON.stringify({pid:child.pid})+'\n');return child;
  };}
  for(const n of ['exec','execSync','execFile','execFileSync','fork'])cp[n]=()=>deny('PROCESS');
  process.dlopen=()=>deny('NATIVE');require('node:module').syncBuiltinESMExports();
}
export async function runIsolatedTest(requested,{projectRoot=defaultProject,artifactRoot=path.join(projectRoot,'artifacts','isolated-tests'),environment=process.env,spawn=spawnSync,output=process.stdout,errors=process.stderr}={}) {
  if(!/^scripts[\\/]test-edith-[A-Za-z0-9._-]+\.ts$/.test(requested??''))throw Error('EDITH_TEST_TARGET_INVALID');
  projectRoot=fs.realpathSync(path.resolve(projectRoot));const testFile=path.resolve(projectRoot,requested);verifyPath(projectRoot,testFile);if(!fs.statSync(testFile).isFile())throw Error('EDITH_TEST_TARGET_INVALID');
  artifactRoot=path.resolve(projectRoot,artifactRoot);verifyPath(path.join(projectRoot,'artifacts'),artifactRoot);fs.mkdirSync(artifactRoot,{recursive:true});
  const runRoot=fs.mkdtempSync(path.join(artifactRoot,'run-')),dataPath=path.join(runRoot,'Data'),temp=runRoot,configPath=path.join(runRoot,'workspace.json'),dotenv=path.join(runRoot,'empty.env'),preload=path.join(runRoot,'confinement.cjs');let status=1,cleanup=false,trackedPids=[],trackedPorts=[];
  try {
    const dirs={chatHistoryPath:path.join(runRoot,'Conversations'),logsPath:path.join(runRoot,'Logs'),dataPath,backupPath:path.join(runRoot,'Backups'),exportsPath:path.join(runRoot,'Exports')};for(const d of [...Object.values(dirs),temp,path.join(runRoot,'home')])fs.mkdirSync(d,{recursive:true});
    const at=new Date().toISOString();fs.writeFileSync(configPath,JSON.stringify({schemaVersion:1,workspaceId:'edith-isolated-test',deviceId:'fixture-device',workspaceRoot:runRoot,obsidianVaultPath:'',...dirs,portableMode:false,createdAt:at,updatedAt:at}));fs.writeFileSync(dotenv,'');
    const env={};for(const k of ['SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(environment[k])env[k]=environment[k];
    const loader=path.join(projectRoot,'node_modules/tsx/dist/loader.mjs'),nodeOptions=`--require "${preload.replaceAll('\\','/')}"`;
    Object.assign(env,{NODE_ENV:'test',PATH:'',TEMP:temp,TMP:temp,HOME:path.join(runRoot,'home'),USERPROFILE:path.join(runRoot,'home'),APPDATA:path.join(runRoot,'home','AppData/Roaming'),LOCALAPPDATA:path.join(runRoot,'home','AppData/Local'),EDITH_TEST_MODE:'true',EDITH_PERSISTENCE:'json',EDITH_TEST_DATA_DIR:dataPath,EDITH_WORKSPACE_ROOT:runRoot,EDITH_WORKSPACE_CONFIG_PATH:configPath,DOTENV_CONFIG_PATH:dotenv,EDITH_OBSIDIAN_ENABLED:'false',EDITH_KNOWLEDGE_GRAPH_AUTOSYNC:'false',EDITH_OBSIDIAN_SYNC_REGISTRY_ON_STARTUP:'false',EDITH_CRYPTO_AUTOSTART:'false',CRYPTO_OBSIDIAN_ENABLED:'false',TSX_DISABLE_CACHE:'1',TSX_TSCONFIG_PATH:path.join(projectRoot,'tsconfig.json'),EDITH_STATIC_DIR:path.join(runRoot,'empty-static'),W6_HTTP_REPORT_DIR:runRoot,W5_HTTP_REPORT_DIR:runRoot,NODE_OPTIONS:nodeOptions});
    const config={environment:env,projectRoot,runRoot,node:path.resolve(process.execPath),tsxCli:path.join(projectRoot,'node_modules/tsx/dist/cli.mjs'),loaderUrl:pathToFileURL(loader).href,nodeOptions,childReport:path.join(runRoot,'children.jsonl'),publicRoots:['src','server','scripts'].map(p=>path.join(projectRoot,p)),publicFiles:['server.ts','package.json','tsconfig.json'].map(p=>path.join(projectRoot,p)),esbuild:[path.join(projectRoot,'node_modules/@esbuild/win32-x64/esbuild.exe'),path.join(projectRoot,'node_modules/tsx/node_modules/@esbuild/win32-x64/esbuild.exe')]};fs.writeFileSync(preload,`(${installConfinement.toString()})(${JSON.stringify(config)});`);
    const result=spawn(process.execPath,['--import',config.loaderUrl,testFile],{cwd:projectRoot,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});if(result.stdout)output.write(result.stdout);if(result.stderr)errors.write(result.stderr);status=result.status??1;if(result.error||result.signal)errors.write(`EDITH_TEST_CHILD_FAILED:${result.error?.code??result.signal}\n`);
    const records=fs.existsSync(config.childReport)?fs.readFileSync(config.childReport,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
    trackedPids=[...new Set([result.pid,...records.map(r=>r.pid)].filter(Number.isInteger))];trackedPorts=[...new Set(records.map(r=>r.port).filter(Number.isInteger))];const pids=trackedPids;
    const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};for(let a=0;pids.some(alive)&&a<30;a++)await new Promise(r=>setTimeout(r,100));if(pids.some(alive))throw Error('EDITH_TEST_CHILDREN_STILL_ACTIVE');cleanup=true;
  } finally {
    if(cleanup){verifyPath(artifactRoot,runRoot);if(!inside(fs.realpathSync(artifactRoot),fs.realpathSync(runRoot)))throw Error('EDITH_TEST_CLEANUP_ESCAPE');try{fs.rmSync(runRoot,{recursive:true,force:true});}catch(e){cleanup=false;status=1;errors.write('EDITH_TEST_CLEANUP_FAILED\n');throw e;}}
    output.write(JSON.stringify({isolation:'owned_artifact_workspace',test:path.basename(testFile),sourceRuntimeDatabaseAccess:'NOT_PROBED',cleanupComplete:cleanup&&!fs.existsSync(runRoot),childPids:trackedPids,loopbackPorts:trackedPorts,exitCode:status})+'\n');
  }
  return status;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const [requested,...options]=process.argv.slice(2);if(options.length&&(options.length!==2||options[0]!=='--artifact-root'))throw Error('EDITH_TEST_ARGUMENT_INVALID');process.exitCode=await runIsolatedTest(requested,{...(options.length?{artifactRoot:options[1]}:{})});}catch(e){console.error(e.message);process.exitCode=2;}
}
