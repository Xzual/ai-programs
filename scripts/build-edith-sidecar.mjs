import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { copyTreeStrict, isExcludedPythonRuntime } from './portable-edith-lib.mjs';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';
import { stageCryptoResources } from './stage-edith-crypto-resources.mjs';

const adapterRequire = createRequire(import.meta.url);
const { resolveDesktopOutputRole } = adapterRequire('./desktop-output-role.cjs');
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const PLAYWRIGHT_ASSET='node_modules/playwright-core/browsers.json';
const FIXED_PKG_CONFIG=Object.freeze({bin:'server.cjs',pkg:Object.freeze({assets:Object.freeze(['../../node_modules/playwright-core/browsers.json'])})});
const PLAYWRIGHT_PINS=Object.freeze([
  [PLAYWRIGHT_ASSET,'f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99',1780],
  ['node_modules/playwright-core/package.json','07c47543631fef9508760365dee9fbe958c562093ec8d122543949ed231f233f'],
  ['node_modules/playwright-core/lib/coreBundle.js','9393fa79e1c67c74edc26b610d65a4f7ed73d345a762465cc88340a33a2454ac'],
]);
function reject(code) { const error=new Error(`EDITH_THIRD_PARTY_${code}`); error.code=error.message; throw error; }
function record(value,keys,code='OPTIONS_INVALID') {
  if(!value || typeof value!=='object' || types.isProxy(value) || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) reject(code);
  const descriptors=Object.getOwnPropertyDescriptors(value),result=Object.create(null);
  if(Reflect.ownKeys(descriptors).length!==keys.length) reject(code);
  for(const key of Reflect.ownKeys(descriptors)) {
    if(typeof key!=='string' || !keys.includes(key) || !Object.hasOwn(descriptors[key],'value')) reject(code);
    result[key]=descriptors[key].value;
  }
  return result;
}
function array(value) {
  if(types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype) reject('MANIFEST_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value),result=[];
  if(Reflect.ownKeys(descriptors).length!==descriptors.length.value+1 || descriptors.length.value>100000) reject('MANIFEST_INVALID');
  for(let index=0;index<descriptors.length.value;index++) { if(!Object.hasOwn(descriptors[index]??{},'value')) reject('MANIFEST_INVALID'); result.push(descriptors[index].value); }
  return result;
}
function inside(root,candidate) { const relative=path.relative(root,candidate); return relative!=='' && relative!=='..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function absolute(value) {
  if(typeof value!=='string' || !path.isAbsolute(value) || /^(?:\\\\|\/\/)/.test(value) || value.includes('\0')) reject('PATH_REJECTED');
  const normalized=path.resolve(value);
  if(normalized!==value || value.slice(path.parse(value).root.length).split(/[\\/]/).some(part=>/[ .:]$/.test(part) || part.includes(':'))) reject('PATH_REJECTED');
  return normalized;
}
function relative(value) {
  if(typeof value!=='string' || !value || value.length>2048 || value.includes('\\') || value.includes('\0') || value.startsWith('/')) reject('PATH_REJECTED');
  const parts=value.split('/');
  if(parts.some(part=>!part || part==='.' || part==='..' || /[:<>"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) reject('PATH_REJECTED');
  return value;
}
function allowedSource(value) {
  relative(value);
  if(!value.startsWith('node_modules/')) reject('PATH_REJECTED');
  const parts=value.split('/');
  if(parts.some((part,index)=>/^\.env(?:\.|$)/i.test(part) || /^(?:\.git|\.ssh|\.npmrc|\.netrc|\.pypirc|id_rsa|id_ecdsa|id_ed25519|vault|user[-_]?data)$/i.test(part) || /^(?:secrets?|credentials?)(?:[._-].*)?$/i.test(part) && !(index===parts.length-1 && /\.(?:[cm]?js|jsx|ts|tsx)(?:\.map)?$/i.test(part)) || /\.(?:sqlite3?|db|pem|pfx|p12|key)(?:-(?:wal|shm))?$/i.test(part))) reject('PATH_REJECTED');
  return value;
}
function packageName(root) {
  const parts=allowedSource(root).split('/'); let index=0,name;
  while(index<parts.length) {
    if(parts[index++]!=='node_modules') reject('MANIFEST_INVALID');
    const first=parts[index++];
    if(typeof first!=='string') reject('MANIFEST_INVALID');
    if(first.startsWith('@')) {
      const second=parts[index++];
      if(!/^@[A-Za-z0-9._~-]+$/.test(first) || !/^[A-Za-z0-9._~-]+$/.test(second??'')) reject('MANIFEST_INVALID');
      name=`${first}/${second}`;
    } else { if(!/^[A-Za-z0-9._~-]+$/.test(first)) reject('MANIFEST_INVALID'); name=first; }
  }
  return name;
}
function safeStat(value) {
  const file=absolute(value),root=path.parse(file).root;
  let cursor=root;
  for(const part of file.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    let stat; try { stat=fs.lstatSync(cursor); } catch { reject('PATH_REJECTED'); }
    if(stat.isSymbolicLink()) reject('LINK_REJECTED');
    if(stat.isFile() && stat.nlink!==1) reject('ALIAS_REJECTED');
  }
  return fs.lstatSync(file);
}
function readBytes(file,limit=MAX_FILE) {
  const before=safeStat(file);
  if(!before.isFile() || before.size>limit) reject('PATH_REJECTED');
  const bytes=fs.readFileSync(file),after=safeStat(file);
  if(bytes.length>limit || before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs || bytes.length!==after.size) reject('HASH_MISMATCH');
  return bytes;
}
function binding(file) { const bytes=readBytes(absolute(file),512*1024*1024); return {sha256:digest(bytes),sizeBytes:bytes.length}; }
function isolatedCopy(bytes) { const copy=Buffer.allocUnsafeSlow(bytes.length); try { bytes.copy(copy); return copy; } catch(error) { copy.fill(0); throw error; } }
function copyPinnedPlaywrightInputs(root) {
  const held=new Map();
  try {
    for(const [relativePath,expected,size] of PLAYWRIGHT_PINS) {
      const original=readBytes(path.join(root,...relativePath.split('/'))); let bytes;
      try {
        bytes=isolatedCopy(original);
        if(digest(bytes)!==expected || size!==undefined && bytes.length!==size) reject('HASH_MISMATCH');
        if(relativePath.endsWith('/package.json') && JSON.parse(bytes.toString('utf8')).version!=='1.62.1') reject('HASH_MISMATCH');
        held.set(path.join(root,...relativePath.split('/')),bytes); bytes=undefined;
      } finally { original.fill(0); bytes?.fill(0); }
    }
    return held;
  } catch(error) { for(const bytes of held.values()) bytes.fill(0); throw error; }
}
function deepFreeze(value) { if(value && typeof value==='object') { for(const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function canonical(value) { return Buffer.from(`${JSON.stringify(value,null,2)}\n`); }
function sortedStrings(value) {
  const values=array(value);
  if(values.some(item=>typeof item!=='string') || values.some((item,index)=>index && compare(values[index-1],item)>=0)) reject('MANIFEST_INVALID');
  return values;
}
function uniqueInsensitive(values) { const seen=new Set(); for(const value of values) { const key=value.toLowerCase(); if(seen.has(key)) reject('MANIFEST_INVALID'); seen.add(key); } }
function storedBinding(value) {
  const item=record(value,['sha256','sizeBytes'],'MANIFEST_INVALID');
  if(typeof item.sha256!=='string' || !/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes<0) reject('MANIFEST_INVALID');
  return {sha256:item.sha256,sizeBytes:item.sizeBytes};
}
function validateBinding(value,expected) {
  const item=storedBinding(value);
  if(item.sha256!==expected.sha256 || item.sizeBytes!==expected.sizeBytes) reject('BINDING_MISMATCH');
  return {sha256:item.sha256,sizeBytes:item.sizeBytes};
}
function treeFiles(directory,expectedFiles) {
  const files=[],names=new Set(); let visited=0;
  const expectedDirectories=new Set(expectedFiles.flatMap(value=>{const parts=value.split('/');return parts.slice(0,-1).map((_,index)=>parts.slice(0,index+1).join('/'));}));
  function walk(dir,prefix) {
    for(const name of fs.readdirSync(dir).sort(compare)) {
      if(++visited>100000) reject('MANIFEST_INVALID');
      const rel=relative(prefix?`${prefix}/${name}`:name),key=rel.toLowerCase();
      if(names.has(key)) reject('MANIFEST_INVALID'); names.add(key);
      const full=path.join(dir,name),stat=safeStat(full);
      if(stat.isDirectory()) { if(!expectedDirectories.has(rel)) reject('UNLISTED_FILE'); walk(full,rel); } else if(stat.isFile()) files.push(rel); else reject('PATH_REJECTED');
    }
  }
  if(!safeStat(directory).isDirectory()) reject('PATH_REJECTED'); walk(directory,''); return files.sort(compare);
}
export function validateThirdPartyResources(options) {
  const {directory,bundlePath,sidecarPath}=record(options,['directory','bundlePath','sidecarPath']);
  return validateThirdPartyTree(directory,sidecarPath,()=>binding(bundlePath));
}
// A delivered tree does not contain the candidate server bundle. Validate its
// recorded identity shape only; this API does not attest those absent bytes.
// Actual delivered sidecar bytes and the complete notices still qualify below.
export function validateDeliveredThirdPartyResources(options) {
  const {directory,sidecarPath}=record(options,['directory','sidecarPath']);
  return validateThirdPartyTree(directory,sidecarPath,null);
}
function validateThirdPartyTree(directory,sidecarPath,bundleBinding) {
  const base=absolute(directory),raw=readBytes(path.join(base,'manifest.json'),16*1024*1024);
  let parsed; try { parsed=JSON.parse(raw.toString('utf8')); } catch { reject('MANIFEST_INVALID'); }
  const top=record(parsed,['formatVersion','target','bundle','sidecar','packages','files'],'MANIFEST_INVALID');
  if(top.formatVersion!==1 || top.target!=='node22-win-x64') reject('MANIFEST_INVALID');
  const bundle=bundleBinding===null?storedBinding(top.bundle):validateBinding(top.bundle,bundleBinding());
  const sidecar=validateBinding(top.sidecar,binding(sidecarPath));
  const files=array(top.files).map(value=>{
    const row=record(value,['path','sourcePath','packageRoot','roles','sha256','sizeBytes'],'MANIFEST_INVALID');
    relative(row.path); allowedSource(row.sourcePath); allowedSource(row.packageRoot);
    if(row.path!==`payload/${row.sourcePath}` || !row.sourcePath.startsWith(`${row.packageRoot}/`) || row.sourcePath.slice(row.packageRoot.length+1).split('/').includes('node_modules')) reject('PATH_REJECTED');
    const roles=sortedStrings(row.roles);
    if(!roles.length || roles.some(role=>!['CONTENT','METADATA','NOTICE'].includes(role))) reject('MANIFEST_INVALID');
    if(typeof row.sha256!=='string' || !/^[0-9a-f]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes<0 || row.sizeBytes>MAX_FILE) reject('MANIFEST_INVALID');
    return {path:row.path,sourcePath:row.sourcePath,packageRoot:row.packageRoot,roles,sha256:row.sha256,sizeBytes:row.sizeBytes};
  });
  if(files.some((row,index)=>index && compare(files[index-1].path,row.path)>=0)) reject('MANIFEST_INVALID'); uniqueInsensitive(files.map(row=>row.path));
  const byPath=new Map(files.map(row=>[row.path,row]));
  const packages=array(top.packages).map(value=>{
    const row=record(value,['root','name','version','metadataPath','sourcePaths','noticePaths','readmeFallback'],'MANIFEST_INVALID');
    if(packageName(row.root)!==row.name) reject('MANIFEST_INVALID');
    if(typeof row.name!=='string' || !row.name || typeof row.version!=='string' || !row.version || typeof row.readmeFallback!=='boolean') reject('MANIFEST_INVALID');
    const sourcePaths=sortedStrings(row.sourcePaths),noticePaths=sortedStrings(row.noticePaths);
    if(!noticePaths.length || row.metadataPath!==`payload/${row.root}/package.json` || row.readmeFallback && noticePaths.length!==1) reject('MANIFEST_INVALID');
    for(const notice of noticePaths) if(row.readmeFallback ? !/\/readme\.md$/i.test(notice) : !noticeName(notice.split('/').at(-1))) reject('MANIFEST_INVALID');
    for(const [paths,role] of [[[row.metadataPath],'METADATA'],[sourcePaths,'CONTENT'],[noticePaths,'NOTICE']]) for(const file of paths) {
      const item=byPath.get(file); if(!item || item.packageRoot!==row.root || !item.roles.includes(role)) reject('MANIFEST_INVALID');
    }
    return {root:row.root,name:row.name,version:row.version,metadataPath:row.metadataPath,sourcePaths,noticePaths,readmeFallback:row.readmeFallback};
  });
  if(packages.some((row,index)=>index && compare(packages[index-1].root,row.root)>=0)) reject('MANIFEST_INVALID'); uniqueInsensitive(packages.map(row=>row.root));
  if(!packages.length || !files.length) reject('MANIFEST_INVALID');
  const byRoot=new Map(packages.map(row=>[row.root,row]));
  // The mandatory dynamic resource cannot disappear through a self-consistent
  // manifest rewrite. Its content and owning metadata retain the pinned identity.
  const coreRoot='node_modules/playwright-core',coreOwner=byRoot.get(coreRoot);
  const assetRow=byPath.get(`payload/${PLAYWRIGHT_ASSET}`);
  const metadataRow=byPath.get(`payload/${PLAYWRIGHT_PINS[1][0]}`);
  if(!coreOwner || coreOwner.name!=='playwright-core' || coreOwner.version!=='1.62.1'
    || !assetRow || assetRow.packageRoot!==coreRoot || !assetRow.roles.includes('CONTENT') || !coreOwner.sourcePaths.includes(assetRow.path)
    || !metadataRow || metadataRow.packageRoot!==coreRoot || !metadataRow.roles.includes('METADATA') || coreOwner.metadataPath!==metadataRow.path) reject('MANIFEST_INVALID');
  if(assetRow.sha256!==PLAYWRIGHT_PINS[0][1] || assetRow.sizeBytes!==PLAYWRIGHT_PINS[0][2] || metadataRow.sha256!==PLAYWRIGHT_PINS[1][1]) reject('HASH_MISMATCH');
  const coreContent=byPath.get(`payload/${PLAYWRIGHT_PINS[2][0]}`);
  if(coreContent?.roles.includes('CONTENT') && coreContent.sha256!==PLAYWRIGHT_PINS[2][1]) reject('HASH_MISMATCH');
  let total=0;
  for(const row of files) {
    const owner=byRoot.get(row.packageRoot); if(!owner) reject('MANIFEST_INVALID');
    for(const role of row.roles) if(!(role==='METADATA' ? owner.metadataPath===row.path : (role==='CONTENT'?owner.sourcePaths:owner.noticePaths).includes(row.path))) reject('MANIFEST_INVALID');
    const bytes=readBytes(path.join(base,...row.path.split('/')));
    if((total+=bytes.length)>MAX_TOTAL || bytes.length!==row.sizeBytes || digest(bytes)!==row.sha256) reject('HASH_MISMATCH');
    if(row.roles.includes('NOTICE') && (!bytes.length || bytes.includes(0))) reject('NOTICE_INVALID');
    if(row.roles.includes('METADATA')) {
      let metadata; try { metadata=JSON.parse(bytes.toString('utf8')); } catch { reject('MANIFEST_INVALID'); }
      if(metadata?.name!==owner.name || metadata?.version!==owner.version) reject('MANIFEST_INVALID');
    }
    if(owner.readmeFallback && owner.noticePaths.includes(row.path) && (!/Permission is hereby granted/i.test(bytes.toString('utf8')) || !/(?:Copyright|\(c\))/i.test(bytes.toString('utf8')))) reject('NOTICE_INVALID');
  }
  const manifest={formatVersion:1,target:'node22-win-x64',bundle,sidecar,packages,files};
  if(!canonical(manifest).equals(raw)) reject('MANIFEST_INVALID');
  const expected=['manifest.json',...files.map(row=>row.path)].sort(compare),actual=treeFiles(base,expected);
  if(expected.length!==actual.length || expected.some((value,index)=>value!==actual[index])) reject('UNLISTED_FILE');
  return deepFreeze(manifest);
}

let activeWalk;
let stageBusy=false;
const walkOriginal=Object.create(null);
function walkCheck(value,metadata=false) {
  if(!activeWalk) reject('CLOSURE_REJECTED');
  if(typeof value==='number') return;
  const candidate=path.resolve(value instanceof URL?fileURLToPath(value):String(value));
  if(candidate===path.join(activeWalk.root,'package.json')) return;
  if(metadata && (candidate===activeWalk.modules || candidate===activeWalk.vendor || candidate===activeWalk.root || inside(candidate,activeWalk.root) || inside(candidate,activeWalk.bundle))) return;
  const allowed=candidate===activeWalk.bundle || inside(activeWalk.modules,candidate) || inside(activeWalk.vendor,candidate);
  if(allowed) {
    if(candidate!==activeWalk.bundle) {
      try { allowedSource(`node_modules/${path.relative(inside(activeWalk.modules,candidate)?activeWalk.modules:activeWalk.vendor,candidate).replaceAll('\\','/')}`); }
      catch(error) { if(!metadata) throw error; const absent=new Error('EDITH_THIRD_PARTY_LOOKUP_ABSENT'); absent.code='ENOENT'; throw absent; }
    }
    return;
  }
  // Module resolution probes ancestors. Refuse without reading those paths.
  if(metadata) { const error=new Error('EDITH_THIRD_PARTY_LOOKUP_ABSENT'); error.code='ENOENT'; throw error; }
  reject('CLOSURE_REJECTED');
}
async function observeClosure(root,bundle,asset) {
  let phase='PIN_VALIDATION';
  const toolingRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const vendor=path.join(toolingRoot,'node_modules');
  const guard=adapterRequire('./desktop-pkg-offline.cjs');
  for(const pin of guard.vendorPins) if(digest(readBytes(path.join(toolingRoot,...pin.path.split('/'))))!==pin.sha256.toLowerCase()) reject('CLOSURE_REJECTED');
  const cp=adapterRequire('node:child_process'),net=adapterRequire('node:net'),tls=adapterRequire('node:tls'),dgram=adapterRequire('node:dgram');
  const http=['node:http','node:https','node:http2'].map(name=>adapterRequire(name)),dns=adapterRequire('node:dns');
  void dns.promises; void fs.promises;
  const restores=[];
  const replace=(object,key,value)=>{ const original=Object.getOwnPropertyDescriptor(object,key); if(!original || original.writable===false) reject('CLOSURE_REJECTED'); restores.push(()=>Object.defineProperty(object,key,original)); Object.defineProperty(object,key,{...original,value}); };
  const deny=()=>reject('CLOSURE_REJECTED');
  activeWalk={root,bundle,modules:path.join(root,'node_modules'),vendor};
  try {
    phase='GUARD_INSTALL';
    for(const key of ['readFileSync','readFile','createReadStream','statSync','stat','lstatSync','lstat','realpathSync','realpath','existsSync','accessSync','access','readdirSync','readdir','openSync','open']) {
      walkOriginal[key]??=fs[key].bind(fs);
      replace(fs,key,function(value,...args){
        walkCheck(value,!['readFileSync','readFile','createReadStream','openSync','open'].includes(key));
        if(['open','openSync'].includes(key) && !['r','rs',fs.constants.O_RDONLY].includes(args[0])) reject('CLOSURE_REJECTED');
        return walkOriginal[key](value,...args);
      });
    }
    for(const key of ['readFile','stat','lstat','realpath','access','readdir','open']) {
      walkOriginal[`promise.${key}`]??=fs.promises[key].bind(fs.promises);
      replace(fs.promises,key,function(value,...args){
        try { walkCheck(value,!['readFile','open'].includes(key)); if(key==='open' && !['r','rs',fs.constants.O_RDONLY].includes(args[0])) reject('CLOSURE_REJECTED'); return walkOriginal[`promise.${key}`](value,...args); } catch(error) { return Promise.reject(error); }
      });
    }
    const mutations=['writeFile','appendFile','truncate','ftruncate','unlink','rm','rmdir','mkdir','rename','copyFile','cp','link','symlink','chmod','fchmod','chown','fchown','lchown','utimes','futimes','lutimes','mkdtemp'];
    for(const key of mutations.flatMap(name=>[name,`${name}Sync`]).concat('createWriteStream','write','writeSync','writev','writevSync')) if(typeof fs[key]==='function') replace(fs,key,deny);
    for(const key of mutations) if(typeof fs.promises[key]==='function') replace(fs.promises,key,deny);
    for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']) replace(cp,key,deny);
    replace(cp.ChildProcess.prototype,'spawn',deny);
    for(const [object,keys] of [[net,['connect','createConnection','createServer']],[net.Socket.prototype,['connect']],[net.Server.prototype,['listen']],[tls,['connect','createServer']],[dgram,['createSocket']],...http.map(api=>[api,['request','get','connect','createServer','createSecureServer']])]) for(const key of keys) if(typeof object[key]==='function') replace(object,key,deny);
    for(const object of [dns,dns.promises,dns.Resolver?.prototype,dns.promises.Resolver?.prototype]) if(object) for(const key of Object.getOwnPropertyNames(object).filter(name=>/^(?:lookup|resolve|reverse|setServers)/.test(name))) if(typeof object[key]==='function') replace(object,key,deny);
    if(typeof globalThis.fetch==='function') replace(globalThis,'fetch',deny);
    replace(process,'dlopen',deny);
    syncBuiltinESMExports();
    phase='VENDOR_IMPORT';
    const base=path.join(vendor,'@yao-pkg','pkg','lib-es5');
    const walker=adapterRequire(path.join(base,'walker.js')).default;
    const refiner=adapterRequire(path.join(base,'refiner.js')).default;
    const packer=adapterRequire(path.join(base,'packer.js')).default;
    const log=adapterRequire(path.join(base,'log.js')).log;
    const warnings=[]; const previousWarn=log.warn; log.warn=(...args)=>{warnings.push(args);}; restores.push(()=>{log.warn=previousWarn;});
    phase='WALK';
    // The temporary and final marker bases differ. Resolve the one fixed asset
    // to the same absolute source; no caller-supplied config/catalog is admitted.
    const markerBase=path.dirname(bundle),assetPattern=path.relative(markerBase,asset).replaceAll('\\','/');
    if(path.resolve(markerBase,assetPattern)!==asset || /[*?\[\]{}!]/.test(assetPattern)) reject('CLOSURE_REJECTED');
    const config={bin:FIXED_PKG_CONFIG.bin,pkg:{assets:[assetPattern]}};
    const result=await walker({config,base:markerBase,configPath:bundle,toplevel:true},bundle,undefined,{publicToplevel:true});
    if(warnings.length) reject('CLOSURE_REJECTED');
    const records=Object.values(result.records).filter(Boolean).map(item=>({file:item.file,content:!!item[1]}));
    phase='REFINE';
    const refined=refiner(result.records,result.entrypoint,result.symLinks);
    phase='PACK';
    const backpack=packer({records:refined.records,entrypoint:refined.entrypoint,bytecode:false,symLinks:refined.symLinks});
    if(warnings.length || backpack.stripes.some(stripe=>stripe.store===0)) reject('CLOSURE_REJECTED');
    const assetRecords=records.filter(item=>item.file===asset && item.content);
    const assetSnaps=Object.entries(refined.records).filter(([,item])=>item?.file===asset && item[1]).map(([snap])=>snap);
    if(assetRecords.length!==1 || assetSnaps.length!==1 || backpack.stripes.filter(stripe=>stripe.snap===assetSnaps[0] && stripe.store===1).length!==1) reject('CLOSURE_REJECTED');
    return records;
  } catch(error) {
    const code=typeof error?.code==='string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNCLASSIFIED';
    const failure=new Error('EDITH_THIRD_PARTY_CLOSURE_REJECTED',{cause:Object.freeze({phase,code})}); failure.code='EDITH_THIRD_PARTY_CLOSURE_REJECTED'; throw failure;
  }
  finally { activeWalk=undefined; for(const restore of restores.reverse()) restore(); syncBuiltinESMExports(); }
}
const noticeName=name=>/^(?:LICEN[CS]E|COPYING|NOTICE|AUTHORS)(?:[._-].*)?$/i.test(name) || /(?:\.LICEN[CS]E|ThirdPartyNotices(?:\.[^.]+)?)$/i.test(name);
function stagePaths(projectRoot,bundlePath,sidecarPath,destination) {
  const root=absolute(projectRoot),bundle=absolute(bundlePath),sidecar=absolute(sidecarPath),dest=absolute(destination),modules=path.join(root,'node_modules');
  if(!safeStat(root).isDirectory() || !inside(root,bundle) || !inside(root,sidecar) || !inside(root,dest) || inside(dest,bundle) || inside(dest,sidecar) || inside(modules,dest) || dest===modules) reject('PATH_REJECTED');
  if(fs.existsSync(dest)) { safeStat(dest); reject('DESTINATION_EXISTS'); }
  if(!safeStat(path.dirname(dest)).isDirectory()) reject('PATH_REJECTED');
  return {root,bundle,sidecar,dest};
}
async function collectThirdPartyCatalog(root,bundle) {
  if(stageBusy) reject('CLOSURE_REJECTED');
  const modules=path.join(root,'node_modules'),bundleIdentity=binding(bundle),payload=new Map();
  stageBusy=true;
  let completed,pinnedInputs;
  try {
    // Copy and qualify all mandatory identities before any build cleanup.
    // Only the private copied JSON enters the notice payload after discovery.
    pinnedInputs=copyPinnedPlaywrightInputs(root);
    const asset=path.join(root,...PLAYWRIGHT_ASSET.split('/'));
    const observed=await observeClosure(root,bundle,asset);
    const packageMap=new Map(); let total=0;
    const sourceRelative=file=>allowedSource(path.relative(root,file).replaceAll('\\','/'));
    const ownerFor=file=>{
      let directory=path.dirname(file);
      while(inside(modules,directory)) {
        const metadataFile=path.join(directory,'package.json');
        if(fs.existsSync(metadataFile)) {
          const bytes=pinnedInputs.get(metadataFile)??readBytes(metadataFile); let metadata;
          try { metadata=JSON.parse(bytes.toString('utf8')); } catch { reject('CLOSURE_REJECTED'); }
          if(typeof metadata?.name==='string' && metadata.name && typeof metadata?.version==='string' && metadata.version) {
            const packageRoot=sourceRelative(directory);
            if(packageName(packageRoot)!==metadata.name) reject('CLOSURE_REJECTED');
            if(!packageMap.has(packageRoot)) packageMap.set(packageRoot,{root:packageRoot,name:metadata.name,version:metadata.version,metadataPath:`payload/${packageRoot}/package.json`,sourcePaths:[],noticePaths:[],readmeFallback:false,directory});
            return packageMap.get(packageRoot);
          }
        }
        directory=path.dirname(directory);
      }
      return undefined;
    };
    const add=(owner,file,role)=>{
      const sourcePath=sourceRelative(file),relativeToPackage=path.relative(owner.directory,file).replaceAll('\\','/');
      if(!inside(owner.directory,file) || relativeToPackage.split('/').includes('node_modules')) reject('PATH_REJECTED');
      const name=`payload/${sourcePath}`,mandatory=pinnedInputs.has(file),bytes=mandatory?isolatedCopy(pinnedInputs.get(file)):readBytes(file);
      let retained=false;
      try {
        const sha256=digest(bytes),existing=payload.get(name);
        if(existing) { if(existing.row.sha256!==sha256 || existing.row.packageRoot!==owner.root) reject('HASH_MISMATCH'); if(!existing.row.roles.includes(role)) existing.row.roles.push(role); }
        else { if((total+=bytes.length)>MAX_TOTAL || payload.size>=100000) reject('CLOSURE_REJECTED'); payload.set(name,{row:{path:name,sourcePath,packageRoot:owner.root,roles:[role],sha256,sizeBytes:bytes.length},bytes}); retained=true; }
        if(role==='CONTENT') owner.sourcePaths.push(name); if(role==='NOTICE') owner.noticePaths.push(name);
      } finally { if(mandatory && !retained) bytes.fill(0); }
    };
    for(const item of observed) {
      if(item.file===bundle) continue;
      if(typeof item.file!=='string') reject('CLOSURE_REJECTED');
      if(!inside(modules,item.file)) { if(item.content) reject('CLOSURE_REJECTED'); continue; }
      const stat=safeStat(item.file);
      if(!stat.isFile()) { if(item.content) reject('CLOSURE_REJECTED'); continue; }
      const owner=ownerFor(item.file);
      if(!owner) { if(item.content) reject('CLOSURE_REJECTED'); continue; }
      if(item.content) { if(!stat.isFile()) reject('CLOSURE_REJECTED'); add(owner,item.file,'CONTENT'); }
    }
    for(const owner of packageMap.values()) {
      add(owner,path.join(owner.directory,'package.json'),'METADATA');
      let visited=0; const notices=[];
      const walk=directory=>{
        for(const name of fs.readdirSync(directory).sort(compare)) {
          if(++visited>30000) reject('CLOSURE_REJECTED');
          if(name==='node_modules') continue;
          const file=path.join(directory,name),stat=safeStat(file);
          if(stat.isDirectory()) walk(file); else if(stat.isFile() && noticeName(name)) notices.push(file); else if(!stat.isFile()) reject('PATH_REJECTED');
        }
      };
      walk(owner.directory);
      if(!notices.length) {
        const fallback=['README.md','Readme.md','readme.md'].map(name=>path.join(owner.directory,name)).find(file=>fs.existsSync(file));
        if(!fallback) reject('NOTICE_MISSING');
        const bytes=readBytes(fallback),text=bytes.toString('utf8');
        if(!/Permission is hereby granted/i.test(text) || !/(?:Copyright|\(c\))/i.test(text)) reject('NOTICE_MISSING');
        notices.push(fallback); owner.readmeFallback=true;
      }
      for(const file of notices.sort(compare)) { sourceRelative(file); const bytes=readBytes(file,8*1024*1024); if(!bytes.length || bytes.includes(0)) reject('NOTICE_INVALID'); add(owner,file,'NOTICE'); }
    }
    const packages=[...packageMap.values()].sort((a,b)=>compare(a.root,b.root)).map(({directory,...owner})=>({...owner,sourcePaths:[...new Set(owner.sourcePaths)].sort(compare),noticePaths:[...new Set(owner.noticePaths)].sort(compare)}));
    const files=[...payload.values()].map(value=>({...value.row,roles:value.row.roles.sort(compare)})).sort((a,b)=>compare(a.path,b.path));
    if(!packages.length || !files.length) reject('CLOSURE_REJECTED');
    uniqueInsensitive(files.map(row=>row.path)); uniqueInsensitive(packages.map(row=>row.root));
    // Validate every private constructor output before build cleanup. This
    // upper bound reserves the longest allowed sidecar size representation;
    // it is a format-size calculation, never a sidecar admission or receipt.
    if(canonical({formatVersion:1,target:'node22-win-x64',bundle:bundleIdentity,sidecar:{sha256:'f'.repeat(64),sizeBytes:Number.MAX_SAFE_INTEGER},packages,files}).length>16*1024*1024) reject('MANIFEST_INVALID');
    const byRoot=new Map(packages.map(owner=>[owner.root,owner]));
    for(const owner of packages) {
      if(packageName(owner.root)!==owner.name || !owner.noticePaths.length || owner.readmeFallback && owner.noticePaths.length!==1) reject('MANIFEST_INVALID');
      let metadata; try { metadata=JSON.parse(payload.get(owner.metadataPath).bytes.toString('utf8')); } catch { reject('MANIFEST_INVALID'); }
      if(metadata?.name!==owner.name || metadata?.version!==owner.version) reject('MANIFEST_INVALID');
    }
    for(const row of files) {
      const owner=byRoot.get(row.packageRoot); relative(row.path); allowedSource(row.sourcePath);
      if(!owner || row.path!==`payload/${row.sourcePath}` || !row.sourcePath.startsWith(`${owner.root}/`) || row.sourcePath.slice(owner.root.length+1).split('/').includes('node_modules')) reject('MANIFEST_INVALID');
      for(const role of row.roles) if(!(role==='METADATA' ? owner.metadataPath===row.path : (role==='CONTENT'?owner.sourcePaths:owner.noticePaths).includes(row.path))) reject('MANIFEST_INVALID');
      const bytes=payload.get(row.path).bytes;
      if(bytes.length!==row.sizeBytes || digest(bytes)!==row.sha256) reject('HASH_MISMATCH');
      if(row.roles.includes('NOTICE') && (!bytes.length || bytes.includes(0))) reject('NOTICE_INVALID');
      if(owner.readmeFallback && owner.noticePaths.includes(row.path) && (!/Permission is hereby granted/i.test(bytes.toString('utf8')) || !/(?:Copyright|\(c\))/i.test(bytes.toString('utf8')))) reject('NOTICE_INVALID');
    }
    const bundleBytes=readBytes(bundle,512*1024*1024);
    if(digest(bundleBytes)!==bundleIdentity.sha256 || bundleBytes.length!==bundleIdentity.sizeBytes) reject('BINDING_MISMATCH');
    completed={root,bundle:bundleIdentity,bundleBytes,packages,files,payload};
    return completed;
  } finally { if(pinnedInputs) for(const bytes of pinnedInputs.values()) bytes.fill(0); stageBusy=false; if(!completed) for(const item of payload.values()) item.bytes.fill(0); }
}
function disposeCatalog(catalog) { if(catalog) { catalog.bundleBytes.fill(0); for(const item of catalog.payload.values()) item.bytes.fill(0); } }
function stagePreparedCatalog(catalog,bundle,sidecar,dest) {
  stagePaths(catalog.root,bundle,sidecar,dest);
  const bundleIdentity=binding(bundle),sidecarIdentity=binding(sidecar);
  if(JSON.stringify(bundleIdentity)!==JSON.stringify(catalog.bundle)) reject('BINDING_MISMATCH');
  const {packages,files,payload}=catalog;
  const manifest={formatVersion:1,target:'node22-win-x64',bundle:bundleIdentity,sidecar:sidecarIdentity,packages,files};
  let temporary,temporaryIdentity;
  try {
    temporary=fs.mkdtempSync(path.join(path.dirname(dest),'.third-party-'));
    temporaryIdentity=safeStat(temporary);
    for(const row of files) {
      const file=path.join(temporary,...row.path.split('/'));
      fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,payload.get(row.path).bytes,{flag:'wx'});
    }
    fs.writeFileSync(path.join(temporary,'manifest.json'),canonical(manifest),{flag:'wx'});
    validateThirdPartyResources({directory:temporary,bundlePath:bundle,sidecarPath:sidecar});
    if(fs.existsSync(dest)) reject('DESTINATION_EXISTS');
    fs.renameSync(temporary,dest); temporary=undefined;
    return validateThirdPartyResources({directory:dest,bundlePath:bundle,sidecarPath:sidecar});
  } finally {
    if(temporary) {
      const current=safeStat(temporary);
      if(current.isDirectory() && current.dev===temporaryIdentity.dev && current.ino===temporaryIdentity.ino) fs.rmSync(temporary,{recursive:true});
    }
  }
}
export async function stageThirdPartyResources(options) {
  const {projectRoot,bundlePath,sidecarPath,destination}=record(options,['projectRoot','bundlePath','sidecarPath','destination']);
  const {root,bundle,sidecar,dest}=stagePaths(projectRoot,bundlePath,sidecarPath,destination);
  binding(sidecar);
  let catalog;
  try { catalog=await collectThirdPartyCatalog(root,bundle); return stagePreparedCatalog(catalog,bundle,sidecar,dest); }
  finally { disposeCatalog(catalog); }
}

// The caller approves privacy; this boundary verifies its explicit input integrity.
function capturePublicCryptoSource(options) {
  if(types.isProxy(options)) reject('PUBLIC_CRYPTO_OPTIONS_INVALID');
  const outer=record(options,Reflect.ownKeys(Object(options)).length?['publicCryptoSource']:[],'PUBLIC_CRYPTO_OPTIONS_INVALID');
  if(!Object.hasOwn(outer,'publicCryptoSource')) return undefined;
  const input=record(outer.publicCryptoSource,['directory','manifestPath','manifestSha256'],'PUBLIC_CRYPTO_OPTIONS_INVALID');
  if(typeof input.manifestSha256!=='string' || !/^[0-9a-f]{64}$/.test(input.manifestSha256)) reject('PUBLIC_CRYPTO_PIN_REJECTED');
  const directory=absolute(input.directory),manifestPath=absolute(input.manifestPath);
  if(!safeStat(directory).isDirectory() || !safeStat(manifestPath).isFile()) reject('PUBLIC_CRYPTO_PATH_REJECTED');
  let actualDirectory,actualManifest;
  try { actualDirectory=fs.realpathSync(directory); actualManifest=fs.realpathSync(manifestPath); } catch { reject('PUBLIC_CRYPTO_PATH_REJECTED'); }
  if(actualDirectory!==directory || actualManifest!==manifestPath) reject('PUBLIC_CRYPTO_PATH_REJECTED');
  const raw=readBytes(manifestPath);
  if(digest(raw)!==input.manifestSha256) reject('PUBLIC_CRYPTO_PIN_REJECTED');
  let parsed; try { parsed=JSON.parse(raw.toString('utf8')); } catch { reject('PUBLIC_CRYPTO_MANIFEST_INVALID'); }
  const manifest=record(parsed,['formatVersion','kind','files'],'PUBLIC_CRYPTO_MANIFEST_INVALID');
  if(manifest.formatVersion!==1 || manifest.kind!=='EDITH_PUBLIC_CRYPTO_SOURCE') reject('PUBLIC_CRYPTO_MANIFEST_INVALID');
  const rows=array(manifest.files).map(value=>{
    const row=record(value,['path','sizeBytes','sha256'],'PUBLIC_CRYPTO_MANIFEST_INVALID');
    const name=relative(row.path),binding=storedBinding({sizeBytes:row.sizeBytes,sha256:row.sha256});
    if(!/^(?:run_agent\.py|requirements(?:\.lock)?\.txt|src\/[A-Za-z0-9_]+\.py|templates\/[A-Za-z0-9_.-]+\.html|config\/(?:coin_permissions|demo_asset_modes|observer_config)\.json)$/.test(name)) reject('PUBLIC_CRYPTO_PATH_REJECTED');
    if(binding.sizeBytes>MAX_FILE) reject('PUBLIC_CRYPTO_SIZE_REJECTED');
    return {path:name,sizeBytes:binding.sizeBytes,sha256:binding.sha256};
  });
  const names=rows.map(row=>row.path);
  if(rows.length!==34 || !names.includes('requirements.lock.txt') || names.some((name,index)=>index && compare(names[index-1],name)>=0)) reject('PUBLIC_CRYPTO_MANIFEST_INVALID');
  uniqueInsensitive(names);
  if(!canonical({formatVersion:1,kind:'EDITH_PUBLIC_CRYPTO_SOURCE',files:rows}).equals(raw)) reject('PUBLIC_CRYPTO_MANIFEST_INVALID');
  const actual=treeFiles(directory,names);
  if(actual.length!==names.length || actual.some((name,index)=>name!==names[index])) reject('PUBLIC_CRYPTO_TREE_REJECTED');
  const held=new Map(); let total=0;
  try {
    for(const row of rows) {
      if((total+=row.sizeBytes)>MAX_TOTAL) reject('PUBLIC_CRYPTO_SIZE_REJECTED');
      const bytes=readBytes(path.join(directory,...row.path.split('/')));
      if(bytes.length!==row.sizeBytes || digest(bytes)!==row.sha256) { bytes.fill(0); reject('PUBLIC_CRYPTO_HASH_REJECTED'); }
      held.set(row.path,bytes);
    }
    return held;
  } catch(error) { for(const bytes of held.values()) bytes.fill(0); throw error; }
}

function sidecarOptions(options) {
  if(!options || typeof options!=='object' || types.isProxy(options) || ![Object.prototype,null].includes(Object.getPrototypeOf(options))) reject('PUBLIC_CRYPTO_OPTIONS_INVALID');
  const keys=Reflect.ownKeys(Object.getOwnPropertyDescriptors(options));
  if(keys.some(key=>typeof key!=='string' || !['publicCryptoSource','outputRole'].includes(key))) reject('PUBLIC_CRYPTO_OPTIONS_INVALID');
  return record(options,keys,'PUBLIC_CRYPTO_OPTIONS_INVALID');
}
function candidateInput(root,value) {
  const input=absolute(value);
  const protectedRoots=['.edith-build/desktop','dist','src-tauri/binaries','artifacts/desktop/portable'].map(p=>path.join(root,p));
  if(protectedRoots.some(p=>input.toLowerCase()===p.toLowerCase() || inside(p.toLowerCase(),input.toLowerCase())) || path.dirname(input).toLowerCase()===path.join(root,'artifacts/desktop').toLowerCase() && /^E\.D\.I\.T\.H\..*\.zip(?:\.sha256)?$/i.test(path.basename(input))) reject('CANDIDATE_LEGACY_INPUT_REJECTED');
  return input;
}
function candidateDirectory(directory) {
  if(fs.existsSync(directory)) { if(!safeStat(directory).isDirectory()) reject('PATH_REJECTED'); return; }
  candidateDirectory(path.dirname(directory));fs.mkdirSync(directory);
  if(!safeStat(directory).isDirectory()) reject('PATH_REJECTED');
}
function candidateAncestors(target) {
  let cursor=path.parse(target).root;
  for(const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    try { const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink!==1)) reject('LINK_REJECTED'); }
    catch(error) {if(error.code==='ENOENT') break;throw error;}
  }
}

export async function buildEdithSidecar(options = {}) {
const selected=sidecarOptions(options);
const root = path.resolve(process.cwd());
const paths=resolveDesktopOutputRole(root,selected.outputRole);
if(paths.kind==='candidate') {
  if(!Object.hasOwn(selected,'publicCryptoSource')) reject('CANDIDATE_PUBLIC_INPUT_REQUIRED');
  const input=record(selected.publicCryptoSource,['directory','manifestPath','manifestSha256'],'PUBLIC_CRYPTO_OPTIONS_INVALID');
  candidateInput(root,input.directory);candidateInput(root,input.manifestPath);
  if(process.env.EDITH_CRYPTO_PYTHON_BUNDLE_DIR?.trim()) candidateInput(root,process.env.EDITH_CRYPTO_PYTHON_BUNDLE_DIR.trim());
  for(const target of [paths.buildDir,paths.binaryDir]) {candidateAncestors(target);if(fs.existsSync(target)) reject('CANDIDATE_OUTPUT_EXISTS');}
}
const publicInput=capturePublicCryptoSource(Object.hasOwn(selected,'publicCryptoSource')?{publicCryptoSource:selected.publicCryptoSource}:{});
try {
const {buildDir,binaryDir,entry,output,resourceDir}=paths;
let pythonLock = publicInput ? undefined : path.join(root, 'crypto', 'requirements.lock.txt');
const require = createRequire(import.meta.url);
const { preflight, getPkgArguments } = require('./desktop-pkg-offline.cjs');
const esbuildBin = require.resolve('esbuild/bin/esbuild');
const pkgBin = path.join(path.dirname(require.resolve('@yao-pkg/pkg/package.json')), 'lib-es5', 'bin.js');
let pythonBundleSetting = process.env.EDITH_CRYPTO_PYTHON_BUNDLE_DIR?.trim();
const externalPythonPrerequisite = process.env.EDITH_CRYPTO_EXTERNAL_PYTHON_PREREQUISITE === 'true';

if (!buildDir.startsWith(`${root}${path.sep}`) || !binaryDir.startsWith(`${root}${path.sep}`)) {
  throw new Error('Desktop build paths must stay inside the project root.');
}

// Deterministic rejection must not remove the only prior staging or executable.
if(!publicInput) readExactRequirementsLock(pythonLock);
if (!pythonBundleSetting && !externalPythonPrerequisite) {
  throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: set EDITH_CRYPTO_PYTHON_BUNDLE_DIR to an absolute portable runtime directory.');
}

// Qualify the genuine base bytes before output cleanup, Python or subprocesses.
// The fixed guard child independently qualifies its private copy and packages
// source-visible own JavaScript without executing the fetched runtime.
preflight({ projectRoot: root, cachePath: process.env.PKG_CACHE_PATH, env: process.env, ...(paths.kind==='candidate'?{outputRole:paths.role}:{}) });

// Compile and validate the real closure/notices before replacing old outputs.
// The exact compiled bytes and private source snapshots survive later cleanup.
let preparation,catalog,preparationIdentity;
try {
if(paths.kind==='candidate') candidateDirectory(paths.candidateRoot);
preparation=fs.mkdtempSync(path.join(paths.kind==='candidate'?paths.candidateRoot:root,paths.kind==='candidate'?'.prepare-':'.edith-sidecar-prepare-'));
preparationIdentity=safeStat(preparation);
const preparedEntry=path.join(preparation,'server.cjs');
const preparedResources=path.join(preparation,'resources');
const pythonResourceDir=path.join(preparedResources,'python');
let cryptoSource=path.join(root,'crypto');
if(publicInput) {
  // All consumers use captured approved bytes, including the verifier's lock.
  cryptoSource=path.join(preparation,'public-crypto');
  for(const [relativePath,bytes] of publicInput) {
    const target=path.join(cryptoSource,...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,bytes,{flag:'wx'});
  }
  pythonLock=path.join(cryptoSource,'requirements.lock.txt');
  readExactRequirementsLock(pythonLock);
}

if (pythonBundleSetting) {
  if (!path.isAbsolute(pythonBundleSetting) || pythonBundleSetting.startsWith('\\\\')) throw new Error('EDITH_CRYPTO_PYTHON_BUNDLE_DIR must be a local absolute directory.');
  if(paths.kind==='candidate' && !safeStat(absolute(pythonBundleSetting)).isDirectory()) reject('PATH_REJECTED');
}

fs.mkdirSync(pythonResourceDir, { recursive: true });

stageCryptoResources({
  source: cryptoSource,
  destination: path.join(preparedResources, 'crypto'),
  allowedDestinationRoot: preparedResources,
});

if (pythonBundleSetting) {
  const pythonBundleDir = fs.realpathSync(pythonBundleSetting);
  const sourcePython = path.join(pythonBundleDir, 'python.exe');
  if (!fs.statSync(pythonBundleDir).isDirectory() || !fs.existsSync(sourcePython) || !fs.statSync(sourcePython).isFile()) throw new Error('The vetted Python bundle must contain python.exe at its root.');
  const requirements = pythonLock;
  const verifyPins = `import importlib.metadata, pathlib, re, sys\nlines=pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()\nerrors=[]\nfor line in lines:\n line=line.strip()\n if not line or line.startswith("#"): continue\n match=re.fullmatch(r"([A-Za-z0-9_.-]+)==([^;\\s]+)",line)\n if not match: errors.append("unpinned: "+line); continue\n name,expected=match.groups()\n try: actual=importlib.metadata.version(name)\n except importlib.metadata.PackageNotFoundError: errors.append(name+" missing"); continue\n if actual!=expected: errors.append(name+" expected "+expected+" found "+actual)\nif errors: raise SystemExit("Pinned runtime verification failed: "+"; ".join(errors))`;
  execFileSync(sourcePython, ['-I', '-B', '-c', verifyPins, requirements], { cwd: root, stdio: 'inherit', windowsHide: true });
  execFileSync(sourcePython, ['-I', '-B', '-m', 'pip', 'check'], { cwd: root, stdio: 'inherit', windowsHide: true });
  copyTreeStrict(pythonBundleDir, pythonResourceDir, {
    exclude: (relative) => isExcludedPythonRuntime(relative)
      || relative.replaceAll('\\', '/').toLowerCase() === 'edith_runtime_verified.json',
  });
  fs.writeFileSync(path.join(pythonResourceDir, 'EDITH_RUNTIME_VERIFIED.json'), `${JSON.stringify({
    formatVersion: 1,
    lockSha256: crypto.createHash('sha256').update(fs.readFileSync(pythonLock)).digest('hex'),
  }, null, 2)}\n`, { flag: 'wx' });
} else if (externalPythonPrerequisite) {
  fs.writeFileSync(path.join(pythonResourceDir, 'EXTERNAL_RUNTIME_REQUIRED.txt'), 'EDITH_CRYPTO_PYTHON_PATH must identify a vetted absolute Python executable on the target machine.\n', { flag: 'wx' });
} else {
  throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: set EDITH_CRYPTO_PYTHON_BUNDLE_DIR to an absolute portable runtime directory.');
}

// Candidate copies are complete before replacement, even when the selected
// Python source lives inside the previous build tree. No exit-time source copy.
execFileSync(process.execPath, [esbuildBin, 'server.ts', '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--packages=external', `--outfile=${preparedEntry}`], {cwd:root,stdio:'inherit',windowsHide:true});
catalog=await collectThirdPartyCatalog(root,preparedEntry);
if(paths.kind==='legacy') fs.rmSync(buildDir, { recursive: true, force: true });
else if(fs.existsSync(buildDir) || fs.existsSync(binaryDir)) reject('CANDIDATE_OUTPUT_EXISTS');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(binaryDir, { recursive: true });
fs.renameSync(preparedResources,resourceDir);

fs.writeFileSync(entry,catalog.bundleBytes,{flag:'wx'});
// Data-only, build-owned input: no project config, glob or scripts authority.
fs.writeFileSync(path.join(buildDir,'package.json'),paths.pkgConfigText,{flag:'wx'});

// This returns only the guard-owned role, never arbitrary vendor CLI arguments.
const pkgArguments = getPkgArguments({ pkgBin, entry, output, ...(paths.kind==='candidate'?{outputRole:paths.role}:{}) });
execFileSync(process.execPath, pkgArguments, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

stagePreparedCatalog(catalog,entry,output,path.join(resourceDir,'third-party'));
console.log(`[EDITH Desktop] Backend sidecar created: ${output}`);
console.log(`[EDITH Desktop] Crypto resources staged: ${path.join(resourceDir, 'crypto')}`);
} finally {
  disposeCatalog(catalog);
  if(preparation) {
    const current=safeStat(preparation);
    if(current.isDirectory() && current.dev===preparationIdentity.dev && current.ino===preparationIdentity.ino) fs.rmSync(preparation,{recursive:true});
  }
}
} finally { if(publicInput) for(const bytes of publicInput.values()) bytes.fill(0); }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await buildEdithSidecar();
