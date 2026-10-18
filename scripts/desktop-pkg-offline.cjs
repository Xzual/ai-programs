'use strict';
// No positive fabricator admission exists: hash-before-spawn is insufficient.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const {isProxy} = require('node:util').types;
const {normalizeOutputRole,resolveDesktopOutputRole}=require('./desktop-output-role.cjs');
const EXPECTED_RUNTIME_SHA256 = 'fd78dc295241575f07a545385915bdf238d4fa9972679a984c5f82cd8361f005';
const CACHE_TAG = 'v3.5';
const FETCHED_NAME = 'fetched-v22.15.1-win-x64';
const BUILT_NAME = 'built-v22.15.1-win-x64';
const ASSET_RELATIVE = 'node_modules/playwright-core/browsers.json';
const ASSET_PINS = [
  {path:ASSET_RELATIVE,size:1780,sha256:'f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99'},
  {path:'node_modules/playwright-core/package.json',sha256:'07c47543631fef9508760365dee9fbe958c562093ec8d122543949ed231f233f'},
  {path:'node_modules/playwright-core/lib/coreBundle.js',sha256:'9393fa79e1c67c74edc26b610d65a4f7ed73d345a762465cc88340a33a2454ac'}
];
const VENDOR_PINS = [{"path":"node_modules/@yao-pkg/pkg/package.json","sha256":"65D8D9D47B9F482FFAE294865F27803737797A28EF87DEDC7C892C59C6011D4F"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/bin.js","sha256":"F127BAF5F8323E9A6F5E499B86939443F63C4DFF127789D4032054FE8B1CF103"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/chmod.js","sha256":"85D7BA9294CAEFE36D2F79C3DED8E5F9C3C8222E7CC02AE13F32756D8D3D3A9F"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/colors.js","sha256":"9B9A43DF939C5B59EEA75D3912C1305CF87F831DA601C88D56C64311B4701921"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/common.js","sha256":"9AEDAE62061067B89BB0790D214449E2CFA8BE1B73232E5F56F2F6B93C8150E8"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/compress_type.js","sha256":"C7C6752F47EB9391B4009D3F375F2BDFCDB8DCD42547C19E3064F6D6B100FF18"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/detector.js","sha256":"94363561CBC419C034FC5FF027325E3480461357460A8841B6CCC11074CA8503"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/fabricator.js","sha256":"DDFA8D3FC3EA4009496A7BE6AD05C21C7DA947EB2FEB49925C1DD2BEC8335587"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/follow.js","sha256":"2388034B327E96814F24149719ECE19FCEA5CD6B7C8AD1AA5545CE31CA6334D7"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/help.js","sha256":"15201996CB08324017665075263FBC48DA9C6AFAC93396206DFEB079897148C9"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/index.d.ts","sha256":"4AE85DCA2941155920F5F4B7DE360890F63A11D15CC24661C8F4E276973A5610"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/index.js","sha256":"56D8C39A4579CFAA58947F4BE211B6AC54552D56BCF0FB40A845B2005F80C63B"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/log.js","sha256":"8F3B9C36FA478818B3B1D9E20A353E2345FDEFFAD9EDD8DEF59ECEB4A1FC1056"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/mach-o.js","sha256":"BCF58F35D0664EA9225CF3326386A0EE01129B919B13A590F42BEF85A6C4ACC8"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/options.js","sha256":"9C9728F0225440E460CD8530FA0E575F3FCDE2EFBCDDAF185D45A43C60CD66A3"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/packer.js","sha256":"6D62E4E1B2AEB4D5CD7865E40787EC40997B73170E65821D3F8F296F517AC1BE"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/producer.js","sha256":"7114107AFD0B14135035DF5E6DCAA07F6296E4CD72D009DB775868B9456C0E9F"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/refiner.js","sha256":"E4E2F6CD028B29A41BF5DA1152B953816D837F57306588E387C8CCD3EE1B196D"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/sea.js","sha256":"DB9269D7BD42599C36FE0A720FBF9015B856CD52E4EBB0EE1D8580189E26F598"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/types.js","sha256":"066C16D76A4C6CAC2A7151D03810F01A8045232E822EE893ED5029C1C144BED1"},{"path":"node_modules/@yao-pkg/pkg/lib-es5/walker.js","sha256":"215E8D322B498EFD876E0069151F1901A66BE4C11B056596179A1DFEEFF548DF"},{"path":"node_modules/@yao-pkg/pkg-fetch/package.json","sha256":"7378D040802C5CC20AE6DD6DC383E496F474EC715E59F6A6FBFB1E5E788EB748"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/apply-patches.d.ts","sha256":"4089E2738E97EC8D6FFF73775ABC88922EBA06685987A9CC598B8E257C66F284"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/apply-patches.js","sha256":"9AD2413A3486CA581DEF6AA93912FF96FC62D16BE549E56B4FE6C4957FC7514F"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/bin.d.ts","sha256":"EACBA108EC9DD580CAA5068FE681580D84C4AFA3473D19FD2B5B607237F3A25C"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/bin.js","sha256":"E49598A54D7D59A087ECE9977D363F9AE0ECCC6241021B9BC11D2DE172FE0FDB"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/build.d.ts","sha256":"9149AD8F82C9130692E7AD43627CE033A525D005B1AB5F7A0A5D115C69104137"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/build.js","sha256":"5D3EC43D331AAA633C0EEB31171EF41B325230D4812EBC0259611D76811A7CF4"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/expected-shas.json","sha256":"53E87B746D9F32DF70F5584639A7321F63B5E258493C5B106AD3BD209F6E1F9D"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/expected.d.ts","sha256":"5127BBE20B62C400874630EBB9A7DA04635B4039F8F7951820C8A7AE7ABAE892"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/expected.js","sha256":"5DC178EC15A3117A10BD2E6A97298CCB25ABE5CACE8193128D6D48C00D3714CF"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/generate-expected-shas.d.ts","sha256":"1B320CD959A1A5462F3FFABBA187D252A8608AD4C622A99D6DC2A4B960342EFD"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/generate-expected-shas.js","sha256":"5D5F67CB55F9C3F87047CF8CCDD4D71E8419EE9A788DDE99F3D0E066DDBF4B0D"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/index.d.ts","sha256":"20D197AD0DF3F12505932A7C35ADDF19936F28834F94E5642E5321B0C0803F3F"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/index.js","sha256":"080A985A5F017E7E1AF3A1A786735D3CCC628E936167CAD356F8E58AD2CB7C4D"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/log.d.ts","sha256":"EE48B35DB1F759A30A908E6FD89A8D1FF419F303B4DD67730D82990EA1A2E14C"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/log.js","sha256":"D2D8BC06D20FF88C977D4C4768846C3B2D45D5D7D07E8C17427CEB27E114EE7C"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/places.d.ts","sha256":"965381C4A83EFD0A8D9E5F8FF6601D919C2A3FE1D1001D0014E396C2CAC1F5AC"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/places.js","sha256":"052CD18450EAB045F13D3C3AC9173601272DF4BF4AB54E7E5B2DF2D059506350"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/print-hashes.d.ts","sha256":"234BA01D0D47185C559BA852C4FAD9AAA6FA9B3C5428632F9B7BF0909B56C18B"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/print-hashes.js","sha256":"C91236E4F8255A925DAE67CF6C95B6E90610572FD30BD722D7B436F0DD6F988D"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/system.d.ts","sha256":"739AAABB6A19ADE9FF6259EBC74E7B4AA9AD29AF190F827F4494071B3FE21BAE"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/system.js","sha256":"71870A2E3A0B1CE659FE2F4904F5B4694C6593BD3D22CC858870339455DE054D"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/tsconfig.json","sha256":"096F221A5325E5F90BFFC9C0505C4DE4DC44DB11ED7D00662D765C27FD8A8E4F"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/utils.d.ts","sha256":"2A02A0DE76400B05228715B34FDFBA9038F113E2CE1515BD80EFEC3570C6903B"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/utils.js","sha256":"0246A923B6D288FA940CAAAC3734C59E71E17D94084F9E4B5046037FA6C18A8C"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/verify.d.ts","sha256":"93925E38DE154CF88C8AB04E95DE1376D067FC2D495698BAA7B81F89153F4EE0"},{"path":"node_modules/@yao-pkg/pkg-fetch/lib-es5/verify.js","sha256":"FF3E8874D3F7585D685DAF71738746ED1D4A834980F21BA79BD6AD1866AD3BD4"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v10.24.1.cpp.patch","sha256":"B2BDAB5A241F3771C36115CFB23598DC9DC2673ABD23A4B60BCFC14E10F68DBC"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v12.22.11.cpp.patch","sha256":"5325E090345731EE689235D349A80C665D2903FB169DD2A7266257AFEFE3D785"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v14.21.3.cpp.patch","sha256":"99E8DD5D795A632B094E8D93E13D9727B0078BAA81056CD98314348006417155"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v16.20.2.cpp.patch","sha256":"2113B5F9855CF853D216B62956BC438BA224230AE8B2B8D8117AFE132EE90937"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v18.20.8.cpp.patch","sha256":"AB65CF23B5C0A33358A1522C9CC485BC1CC38ABA9E7B45405FB0A2AC3E63E770"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v20.19.1.cpp.patch","sha256":"6026BE7EF266FE22F534324B5CF1F9EB82E7D8AAEF7D14688ECA7647E1D04A3E"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v22.15.1.cpp.patch","sha256":"67F26E6CA89FBDA19975FDE81D36B1CBE88941774440906CD965D9920CD1B7DC"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/node.v8.17.0.cpp.patch","sha256":"F17F330AF6B8D6CAC86A386295C76F7B5428E694D781F19CB3AB7FF46044D834"},{"path":"node_modules/@yao-pkg/pkg-fetch/patches/patches.json","sha256":"8976B914FEC9DC7EDA4E820770DB384A2BC4022FE06D2813CD747F8E945E3940"}];
function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function localAbsolute(value, code) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^(?:\\\\|\/\/)/.test(value)
      || /[\0]/.test(value) || value.slice(path.parse(value).root.length).split(/[\\/]/).some(part=>/[ .:]$/.test(part) || part.includes(':'))) throw failure(code);
  return path.resolve(value);
}
function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function noLinks(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch { throw failure('EDITH_PKG_OFFLINE_PATH_MISSING'); }
    if (stat.isSymbolicLink()) throw failure('EDITH_PKG_OFFLINE_LINK_REJECTED');
  }
  return fs.lstatSync(absolute);
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function validateVendorPins(root) {
  for (const pin of VENDOR_PINS) {
    const file = path.join(root, pin.path);
    if (!noLinks(file).isFile() || sha(file) !== pin.sha256.toLowerCase()) throw failure('EDITH_PKG_OFFLINE_VENDOR_MISMATCH');
  }
}
// Reject proxies before reflection: their descriptor/prototype traps are code.
// Accept only own data descriptors and copy them before reading any field.
function dataRecord(value, keys, code, optional=[], environment=false) {
  if (!value || typeof value!=='object' || isProxy(value) || Array.isArray(value)
      || !(environment && value===process.env) && ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw failure(code);
  const descriptors=Object.getOwnPropertyDescriptors(value), result=Object.create(null);
  for(const key of Reflect.ownKeys(descriptors)) {
    if(typeof key!=='string' || !keys.includes(key) || !Object.hasOwn(descriptors[key],'value')) throw failure(code);
    result[key]=descriptors[key].value;
  }
  if(keys.some(key=>!optional.includes(key) && !Object.hasOwn(result,key))) throw failure(code);
  return result;
}
let prepared;
function isolatedCopy(source) {
  if(isProxy(source) || !Buffer.isBuffer(source)) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
  const size=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get.call(source);
  const copy=Buffer.allocUnsafeSlow(size);
  Buffer.prototype.copy.call(source,copy);
  return copy;
}
function dataArray(value,code) {
  if(isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype) throw failure(code);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const length=descriptors.length.value;
  if(Reflect.ownKeys(descriptors).length!==length+1) throw failure(code);
  const result=[];
  for(let index=0;index<length;index++) {
    const descriptor=descriptors[index];
    if(!descriptor || !Object.hasOwn(descriptor,'value')) throw failure(code);
    result.push(descriptor.value);
  }
  return result;
}
function anyDataRecord(value,code,environment=false) {
  if(!value || typeof value!=='object' || isProxy(value)) throw failure(code);
  return dataRecord(value,Object.keys(Object.getOwnPropertyDescriptors(value)),code,[],environment);
}
function disposePrepared() { if(prepared) { prepared.bytes.fill(0); prepared.asset.fill(0); } prepared=undefined; }
function pinnedAsset(root) {
  let asset;
  try {
    for(const pin of ASSET_PINS) {
      const file=path.join(root,pin.path),stat=noLinks(file);
      if(!within(root,file) || !stat.isFile() || stat.size>16*1024*1024 || pin.size!==undefined && stat.size!==pin.size) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
      if(stat.nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
      const read=fs.readFileSync(file),copy=isolatedCopy(read); read.fill(0);
      try {
        if(crypto.createHash('sha256').update(copy).digest('hex')!==pin.sha256) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
        if(pin.path===ASSET_RELATIVE) asset=isolatedCopy(copy);
      } finally { copy.fill(0); }
    }
    return asset;
  } catch(error) { if(asset) asset.fill(0); throw error; }
}
function fixedConfig(plan) {
  const expected=Buffer.from(plan.paths.pkgConfigText,'utf8');
  const file=path.join(plan.paths.buildDir,'package.json'),stat=noLinks(file);
  if(!stat.isFile() || stat.size!==expected.length) throw failure('EDITH_PKG_OFFLINE_CONFIG_REJECTED');
  if(stat.nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
  const read=fs.readFileSync(file),copy=isolatedCopy(read); read.fill(0);
  if(!copy.equals(expected)) { copy.fill(0); throw failure('EDITH_PKG_OFFLINE_CONFIG_REJECTED'); }
  return copy;
}
function qualify(options) {
  const {projectRoot,cachePath,env,outputRole}=dataRecord(options,['projectRoot','cachePath','env','outputRole'],'EDITH_PKG_OFFLINE_OPTIONS_INVALID',['outputRole']);
  const root = localAbsolute(projectRoot, 'EDITH_PKG_OFFLINE_PROJECT_REQUIRED');
  const paths=resolveDesktopOutputRole(root,outputRole);
  const cache = localAbsolute(cachePath, 'EDITH_PKG_OFFLINE_CACHE_REQUIRED');
  if (!env || typeof env !== 'object' || isProxy(env) || Array.isArray(env)) throw failure('EDITH_PKG_OFFLINE_ENV_REQUIRED');
  const environment=anyDataRecord(env,'EDITH_PKG_OFFLINE_ENV_REQUIRED',true);
  for (const key of Object.keys(environment)) {
    const upper = key.toUpperCase();
    if(typeof environment[key]!=='string') throw failure('EDITH_PKG_OFFLINE_ENV_REQUIRED');
    if (['PKG_NODE_PATH','PKG_IGNORE_TAG','PKG_BUILD_PATH','NODE_OPTIONS','NODE_PATH','CHDIR'].includes(upper)) throw failure('EDITH_PKG_OFFLINE_OVERRIDE_REJECTED');
    if (upper === 'PKG_CACHE_PATH' && path.resolve(environment[key]) !== cache) throw failure('EDITH_PKG_OFFLINE_CACHE_OVERRIDE_REJECTED');
  }
  if (!within(root,cache) || cache.split(path.sep).some(part => part.toLowerCase()==='.edith-build')) throw failure('EDITH_PKG_OFFLINE_CACHE_OUTSIDE_OWNED_ROOT');
  if (!noLinks(root).isDirectory() || !noLinks(cache).isDirectory()) throw failure('EDITH_PKG_OFFLINE_CACHE_NOT_DIRECTORY');
  validateVendorPins(root);
  const tag = path.join(cache,CACHE_TAG);
  if (!noLinks(tag).isDirectory()) throw failure('EDITH_PKG_OFFLINE_CACHE_TAG_REQUIRED');
  if (fs.existsSync(path.join(tag,BUILT_NAME)) || fs.existsSync(path.join(cache,BUILT_NAME))) throw failure('EDITH_PKG_OFFLINE_BUILT_CACHE_REJECTED');
  const asset=pinnedAsset(root);
  try {
  const runtime = path.join(tag,FETCHED_NAME);
  const stat=noLinks(runtime);
  if(stat.nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
  if(!stat.isFile() || stat.size<=0 || stat.size>256*1024*1024) throw failure('EDITH_PKG_OFFLINE_RUNTIME_MISMATCH');
  const read=fs.readFileSync(runtime), bytes=isolatedCopy(read);
  read.fill(0);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==EXPECTED_RUNTIME_SHA256) {
    bytes.fill(0); throw failure('EDITH_PKG_OFFLINE_RUNTIME_MISMATCH');
  }
  return {root,cache,bytes,asset,paths,role:paths.role};
  } catch(error) { asset.fill(0); throw error; }
}
function preflight(options) {
  disposePrepared();
  prepared=qualify(options);
  return Object.freeze({mode:'PRIVATE_BUFFER_NO_EXEC',target:'node22-win-x64',runtimeSha256:EXPECTED_RUNTIME_SHA256,sizeBytes:prepared.bytes.length});
}
function fixedPaths(plan,entry,output) {
  if(entry!==plan.paths.entry || output!==plan.paths.output) throw failure('EDITH_PKG_OFFLINE_PATH_REJECTED');
  const inputStat=noLinks(entry);
  if(!inputStat.isFile() || !noLinks(path.dirname(output)).isDirectory()) throw failure('EDITH_PKG_OFFLINE_PATH_REJECTED');
  if(inputStat.nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
  const outputExists=plan.role.kind==='candidate'?fs.lstatSync(output,{throwIfNoEntry:false})!==undefined:fs.existsSync(output);
  if(outputExists) {
    if(plan.role.kind==='candidate') throw failure('EDITH_PKG_OFFLINE_OUTPUT_EXISTS');
    const outputStat=noLinks(output);
    if(!outputStat.isFile()) throw failure('EDITH_PKG_OFFLINE_PATH_REJECTED');
    if(outputStat.nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
  }
}
function getPkgArguments(options) {
  const {pkgBin,entry,output,outputRole}=dataRecord(options,['pkgBin','entry','output','outputRole'],'EDITH_PKG_OFFLINE_OPTIONS_INVALID',['outputRole']);
  if([pkgBin,entry,output].some(value=>typeof value!=='string')) throw failure('EDITH_PKG_OFFLINE_OPTIONS_INVALID');
  if(!prepared) throw failure('EDITH_PKG_OFFLINE_PREFLIGHT_REQUIRED');
  const plan=prepared;
  try {
    const role=normalizeOutputRole(outputRole);
    if(role.kind!==plan.role.kind || role.id!==plan.role.id) throw failure('EDITH_PKG_OFFLINE_ROLE_REJECTED');
    if(pkgBin!==path.join(plan.root,'node_modules','@yao-pkg','pkg','lib-es5','bin.js')) throw failure('EDITH_PKG_OFFLINE_PATH_REJECTED');
    fixedPaths(plan,entry,output);
    fixedConfig(plan).fill(0);
    return Object.freeze(plan.role.kind==='candidate'?[__filename,'--edith-pkg-candidate',plan.role.id,plan.cache,entry,output]:[__filename,'--edith-pkg-buffer',plan.cache,entry,output]);
  } finally { disposePrepared(); }
}
let installed = false;
const counters = Object.create(null);
function denied(operation) {
  counters[operation]=(counters[operation] || 0)+1;
  const error = failure('EDITH_PKG_OFFLINE_DENIED');
  error.message += `: ${operation}`;
  throw error;
}
function lock(target,key,value) {
  Object.defineProperty(target,key,{value,writable:false,configurable:false,enumerable:true});
}
function denyMethods(target,names,prefix) {
  for(const name of names) if(typeof target[name]==='function') lock(target,name,function(){return denied(`${prefix}.${name}`);});
}
function installDenyOnly() {
  if(arguments.length) throw failure('EDITH_PKG_OFFLINE_OPTIONS_INVALID');
  return installGuards();
}
function installGuards(production) {
  if (installed) return diagnosticState();
  installed = true;
  // Install before vendor initialization. Reviewed vendor paths only: this is
  // not a sandbox against hostile JS, native addons or process.binding.
  // Complete lazy builtin initialization before changing shared prototypes.
  const cp=require('node:child_process');
  const net=require('node:net'),tls=require('node:tls'),dgram=require('node:dgram');
  const httpApis=['node:http','node:https','node:http2'].map(name=>[name,require(name)]);
  const dns=require('node:dns');
  void dns.promises; void fs.promises;
  denyMethods(cp,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],'child_process');
  denyMethods(cp.ChildProcess.prototype,['spawn'],'child_process.ChildProcess');
  denyMethods(net,['connect','createConnection','createServer'],'net');
  denyMethods(net.Socket.prototype,['connect'],'net.Socket');
  denyMethods(net.Server.prototype,['listen'],'net.Server');
  denyMethods(tls,['connect','createServer'],'tls');
  denyMethods(dgram,['createSocket'],'dgram');
  for(const [name,api] of httpApis) {
    denyMethods(api,['request','get','connect','createServer','createSecureServer'],name);
    if(api.Agent) denyMethods(api.Agent.prototype,['createConnection'],'http.Agent');
  }
  const dnsMethods = target => Object.getOwnPropertyNames(target).filter(k=>/^(?:lookup|resolve|reverse|setServers)/.test(k));
  denyMethods(dns,dnsMethods(dns),'dns');
  denyMethods(dns.promises,dnsMethods(dns.promises),'dns.promises');
  if(dns.Resolver) denyMethods(dns.Resolver.prototype,dnsMethods(dns.Resolver.prototype),'dns.Resolver');
  if(dns.promises.Resolver) denyMethods(dns.promises.Resolver.prototype,dnsMethods(dns.promises.Resolver.prototype),'dns.promises.Resolver');
  if(typeof globalThis.fetch==='function') lock(globalThis,'fetch',function(){return denied('fetch');});
  const writes=['writeFile','appendFile','truncate','ftruncate','unlink','rm','rmdir','mkdir','rename','copyFile','cp','link','symlink','chmod','fchmod','chown','fchown','lchown','utimes','futimes','lutimes','mkdtemp'];
  denyMethods(fs,writes.flatMap(n=>[n,`${n}Sync`]).concat('createWriteStream'),'fs');
  denyMethods(fs.promises,writes.filter(name=>!production || name!=='mkdir'),'fs.promises');
  if(production) lock(fs.promises,'mkdir',async function(file,options){
    if(file!==path.dirname(production.temp) || !options || options.recursive!==true || Object.keys(options).length!==1) return denied('fs.promises.mkdir');
    // The parent is already present and qualified; no recursive creation.
    if(!noLinks(file).isDirectory()) return denied('fs.promises.mkdir');
    return undefined;
  });
  // Diagnostics may write only inherited stdout/stderr, never a cache file.
  for(const key of ['write','writeSync','writev','writevSync']) if(typeof fs[key]==='function') {
    const original=fs[key];
    lock(fs,key,function(fd,...args){
      if(fd!==1 && fd!==2) return denied(`fs.${key}`);
      return original.call(this,fd,...args);
    });
  }
  for(const [api,key,prefix] of [[fs,'open','fs'],[fs,'openSync','fs'],[fs.promises,'open','fs.promises']]) {
    const original=api[key];
    lock(api,key,function(file,flags,...rest){
      if(flags!=='r' && flags!=='rs' && flags!==fs.constants.O_RDONLY) return denied(`${prefix}.${key}.write`);
      return original.call(this,file,flags,...rest);
    });
  }
  const originalLoad=Module._load;
  const guardedLoad=function(request,parent,isMain){
    if(production && (request==='fs' || request==='node:fs') && parent?.filename===production.producerFile) return production.facade;
    if(production && (request==='fs/promises' || request==='node:fs/promises')) {
      if(parent?.filename===production.indexFile) return production.indexFacade;
      if(parent?.filename===production.walkerFile) return production.walkerFacade;
    }
    const exported=originalLoad.call(this,request,parent,isMain);
    let resolved;
    try { resolved=Module._resolveFilename(request,parent,isMain).replaceAll('\\','/'); } catch { return exported; }
    if(/\/@yao-pkg\/pkg-fetch\/lib-es5\/utils\.js$/.test(resolved)) {
      for(const key of ['downloadUrl','spawn','plusx']) if(typeof exported[key]==='function' && Object.getOwnPropertyDescriptor(exported,key)?.writable!==false) lock(exported,key,function(){return denied(`pkg-fetch.utils.${key}`);});
    }
    if(/\/@yao-pkg\/pkg-fetch\/lib-es5\/build\.js$/.test(resolved)) {
      for(const key of ['default','fetchExtractApply','prepBuildPath']) if(typeof exported[key]==='function' && Object.getOwnPropertyDescriptor(exported,key)?.writable!==false) lock(exported,key,function(){return denied(`pkg-fetch.build.${key}`);});
    }
    if(/\/@yao-pkg\/pkg-fetch\/lib-es5\/index\.js$/.test(resolved) && typeof exported.need==='function' && Object.getOwnPropertyDescriptor(exported,'need')?.writable!==false) {
      if(production) {
        lock(exported,'need',options=>production.need(options));
        return exported;
      }
      const actualNeed=exported.need;
      lock(exported,'need',function(options){
        counters['pkg-fetch.need.called']=(counters['pkg-fetch.need.called']||0)+1;
        if(Object.keys(process.env).some(k=>['PKG_NODE_PATH','PKG_IGNORE_TAG','PKG_BUILD_PATH'].includes(k.toUpperCase()))) return Promise.reject(failure('EDITH_PKG_OFFLINE_OVERRIDE_REJECTED'));
        if(!options || options.nodeRange!=='node22' || options.platform!=='win' || options.arch!=='x64' || options.output) return Promise.reject(failure('EDITH_PKG_OFFLINE_TARGET_REJECTED'));
        counters['pkg-fetch.need.bodyEntered']=(counters['pkg-fetch.need.bodyEntered']||0)+1;
        return Promise.resolve(actualNeed.call(this,options)).then(()=>denied('pkg-fetch.need.result'));
      });
    }
    return exported;
  };
  if(production) {
    Module._load=guardedLoad;
    production.restoreLoader=()=>{ if(Module._load!==guardedLoad) throw failure('EDITH_PKG_OFFLINE_BOOTSTRAP_REJECTED'); Module._load=originalLoad; };
  } else lock(Module,'_load',guardedLoad);
  Module.syncBuiltinESMExports();
  return diagnosticState();
}
function diagnosticState() { return Object.freeze({mode:installed?'DENY_ONLY':'NOT_INSTALLED',productionAllowed:false,counters:Object.freeze({...counters})}); }
function placeholderRanges(bytes) {
  const searches=[`\0${'// BAKERY '.repeat(20)}`,'// PAYLOAD_POSITION //','// PAYLOAD_SIZE //','// PRELUDE_POSITION //','// PRELUDE_SIZE //'];
  return searches.map((search,index)=>{
    const needle=Buffer.from(search);
    let position=bytes.indexOf(needle);
    if(position<0) throw failure('EDITH_PKG_OFFLINE_PLACEHOLDER_REJECTED');
    // Match the pinned producer's source-literal disambiguation exactly.
    if(bytes[position-1]===39) {
      let next=bytes.indexOf(needle,position+needle.length);
      while(next>=0) { position=next; if(bytes[position-1]!==39) break; next=bytes.indexOf(needle,position+needle.length); }
    }
    return {position,size:needle.length,index};
  }).sort((a,b)=>a.position-b.position);
}
function validateOutput(state) {
  const stat=noLinks(state.temp);
  if(!stat.isFile() || stat.nlink!==1 || !state.identity || stat.dev!==state.identity.dev || stat.ino!==state.identity.ino
      || stat.size<=state.bytes.length || stat.size>1024*1024*1024) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
  const result=state.io.readFileSync(state.temp);
  try {
    let cursor=0;
    const values=[];
    for(const range of state.ranges) {
      if(range.position<cursor || !result.subarray(cursor,range.position).equals(state.bytes.subarray(cursor,range.position))) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
      const value=result.subarray(range.position,range.position+range.size);
      if(range.index===0) { if(value.some(byte=>byte!==0)) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED'); }
      else {
        const text=value.toString('ascii');
        if(!/^(?:0|[1-9][0-9]*) *$/.test(text)) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
        values[range.index]=Number(text.trim());
      }
      cursor=range.position+range.size;
    }
    if(!result.subarray(cursor,state.bytes.length).equals(state.bytes.subarray(cursor))) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
    if(values[1]!==state.bytes.length || values[2]<0 || values[3]!==values[1]+values[2] || values[4]<=0 || values[3]+values[4]!==result.length) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
  } finally { result.fill(0); }
}
function createProduction(plan,entry,output,config) {
  const io={};
  for(const key of ['createWriteStream','createReadStream','open','write','writev','close','readFileSync','renameSync','unlinkSync','fstatSync','fsyncSync']) io[key]=fs[key].bind(fs);
  const temp=path.join(path.dirname(output),`.edith-pkg-${crypto.randomBytes(24).toString('hex')}.tmp.exe`);
  const token=path.join(plan.paths.buildDir,`.verified-runtime-${crypto.randomBytes(24).toString('hex')}`);
  const pkgDir=path.join(plan.root,'node_modules','@yao-pkg','pkg','lib-es5');
  const state={...plan,entry,output,temp,token,io,config,configFile:path.join(path.dirname(entry),'package.json'),assetFile:path.join(plan.root,ASSET_RELATIVE),indexFile:path.join(pkgDir,'index.js'),walkerFile:path.join(pkgDir,'walker.js'),refinerFile:path.join(pkgDir,'refiner.js'),producerFile:path.join(pkgDir,'producer.js'),active:false,importsActive:true,configReads:0,walkerConfigReads:0,walkerAssetReads:0,refinerCalls:0,calls:0,reads:0,dryNeeds:0,realNeeds:0,fds:new Set(),streams:new Set(),pendingIo:new Set(),identity:null,ranges:placeholderRanges(plan.bytes)};
  const readFile=fs.promises.readFile.bind(fs.promises);
  // Forward methods at call time so facades cannot retain pre-guard writers.
  const promiseFacade=Object.fromEntries(Object.keys(fs.promises).map(key=>[key,typeof fs.promises[key]==='function'?(...args)=>fs.promises[key](...args):fs.promises[key]]));
  state.indexFacade=Object.freeze({...promiseFacade,async readFile(file,...options) {
    if(!state.importsActive || file!==state.configFile || options.length!==1 || options[0]!=='utf-8' || ++state.configReads!==1) throw failure('EDITH_PKG_OFFLINE_CONFIG_REJECTED');
    return state.config.toString('utf8');
  }});
  state.walkerFacade=Object.freeze({...promiseFacade,async readFile(file,...options) {
    if(file===state.configFile || file===state.assetFile) {
      if(!state.importsActive || options.length) throw failure('EDITH_PKG_OFFLINE_CONFIG_REJECTED');
      const key=file===state.configFile?'walkerConfigReads':'walkerAssetReads';
      if(++state[key]!==1) throw failure('EDITH_PKG_OFFLINE_CONFIG_REJECTED');
      const copy=isolatedCopy(file===state.configFile?state.config:state.asset);
      state.walkerCopies.push(copy); return copy;
    }
    return readFile(file,...options);
  }});
  state.walkerCopies=[];
  state.stripeCopies=[];
  const stripeCopy=bytes=>{ const copy=isolatedCopy(bytes); state.stripeCopies.push(copy); return copy; };
  state.wrapRefiner=actual=>(...args)=>{
    if(!state.importsActive || ++state.refinerCalls!==1) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
    const result=actual(...args);
    const refined=dataRecord(result,['records','entrypoint','symLinks'],'EDITH_PKG_OFFLINE_ASSET_REJECTED');
    if(typeof refined.entrypoint!=='string') throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
    const records=anyDataRecord(refined.records,'EDITH_PKG_OFFLINE_ASSET_REJECTED');
    const mapping=new Map();
    for(const [snap,value] of Object.entries(records)) {
      if(!value) continue;
      const record=anyDataRecord(value,'EDITH_PKG_OFFLINE_ASSET_REJECTED');
      if(record.file!==state.configFile && record.file!==state.assetFile) continue;
      if(!record[1] || mapping.has(record.file) || [...mapping.values()].includes(snap)) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
      mapping.set(record.file,snap);
    }
    if(mapping.size!==2) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
    state.heldSnaps=mapping; state.refinedEntrypoint=refined.entrypoint;
    return result;
  };
  const requireActive=()=>{if(!state.active) throw failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED');};
  const recordFd=fd=>{
    const stat=io.fstatSync(fd);
    if(!stat.isFile() || stat.nlink!==1 || state.identity && (state.identity.dev!==stat.dev || state.identity.ino!==stat.ino)) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
    state.identity={dev:stat.dev,ino:stat.ino}; state.fds.add(fd);
  };
  const safeOpen=(file,flags,mode,callback)=>{
    let finish;
    const pending=new Promise(resolve=>{finish=resolve;}); state.pendingIo.add(pending);
    const done=(error,fd)=>{ try { callback(error,fd); } finally { state.pendingIo.delete(pending); finish(); } };
    io.open(file,flags,mode,(error,fd)=>{
      if(error) return done(error);
      if(!state.active) {
        // A late exclusive create is still ours to clean, but never becomes
        // an admitted descriptor or a successful producer callback.
        let reason=failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED');
        try {
          if(flags==='wx') {
            const stat=io.fstatSync(fd);
            if(stat.isFile() && stat.nlink===1) state.identity={dev:stat.dev,ino:stat.ino};
          }
        } catch(error) { reason=error; }
        return io.close(fd,()=>done(reason));
      }
      try { recordFd(fd); } catch(reason) { return io.close(fd,()=>done(reason)); }
      done(null,fd);
    });
  };
  const streamFs=Object.freeze({
    open(file,flags,mode,callback) {
      if(!state.active) return callback(failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED'));
      if(file!==temp || flags!=='wx' || state.identity) return callback(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED'));
      safeOpen(file,flags,mode,callback);
    },
    write(fd,...args) { if(!state.fds.has(fd)) return args.at(-1)(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED')); return io.write(fd,...args); },
    writev(fd,...args) { if(!state.fds.has(fd)) return args.at(-1)(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED')); return io.writev(fd,...args); },
    close(fd,callback) { if(!state.fds.delete(fd)) return callback(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED')); return io.close(fd,callback); }
  });
  let allowedFiles=new Set();
  state.facade=Object.freeze({
    readFileSync(file,...options) {
      requireActive();
      if(file!==token || options.length || ++state.reads!==1) throw failure('EDITH_PKG_OFFLINE_RUNTIME_READ_REJECTED');
      state.consumer=isolatedCopy(state.bytes); return state.consumer;
    },
    createReadStream(file,...options) {
      requireActive();
      if(options.length || !allowedFiles.has(file)) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
      const stream=io.createReadStream(file); state.streams.add(stream); return stream;
    },
    createWriteStream(file,...options) {
      requireActive();
      if(file!==temp || options.length || state.outputStream) throw failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED');
      const stream=io.createWriteStream(file,{flags:'wx',fs:streamFs}); state.outputStream=stream; state.streams.add(stream); return stream;
    },
    open(file,flags,callback) {
      if(!state.active) return callback(failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED'));
      if(file!==temp || flags!=='r+' || state.patchOpened || !state.identity) return callback(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED'));
      state.patchOpened=true;
      safeOpen(file,flags,undefined,callback);
    },
    write(fd,buffer,offset,length,position,callback) {
      if(!state.active) return callback(failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED'));
      const range=state.ranges.find(item=>item.position===position && item.size===length);
      if(!state.fds.has(fd) || !range || offset!==0 || buffer.length!==length) return callback(failure('EDITH_PKG_OFFLINE_OUTPUT_REJECTED'));
      return io.write(fd,buffer,offset,length,position,callback);
    },
    close:streamFs.close,
    existsSync(){return denied('producer.existsSync');}, copyFileSync(){return denied('producer.copyFileSync');}, renameSync(){return denied('producer.renameSync');}
  });
  state.need=options=>{
    const item=dataRecord(options,['dryRun','forceBuild','nodeRange','platform','arch'],'EDITH_PKG_OFFLINE_TARGET_REJECTED',['dryRun']);
    if(item.forceBuild!==false || item.nodeRange!=='node22' || item.platform!=='win' || item.arch!=='x64') throw failure('EDITH_PKG_OFFLINE_TARGET_REJECTED');
    if(item.dryRun===true && ++state.dryNeeds===1 && state.realNeeds===0) return Promise.resolve('exists');
    if(!Object.hasOwn(item,'dryRun') && state.dryNeeds===1 && ++state.realNeeds===1) return Promise.resolve(token);
    throw failure('EDITH_PKG_OFFLINE_TARGET_REJECTED');
  };
  state.wrap=actual=>async options=>{
    if(++state.calls!==1 || state.active) throw failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED');
    const item=dataRecord(options,['backpack','bakes','slash','target','symLinks','doCompress','nativeBuild'],'EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
    const target=dataRecord(item.target,['nodeRange','platform','arch','output','forceBuild','fabricator','binaryPath'],'EDITH_PKG_OFFLINE_TARGET_REJECTED');
    const fabricator=dataRecord(target.fabricator,['nodeRange','platform','arch'],'EDITH_PKG_OFFLINE_TARGET_REJECTED');
    const bakes=dataArray(item.bakes,'EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
    if(item.nativeBuild!==false || item.slash!=='\\' || item.doCompress!==1 || bakes.length
        || target.nodeRange!=='node22' || target.platform!=='win' || target.arch!=='x64' || target.output!==temp || target.binaryPath!==token || target.forceBuild!==false
        || fabricator.nodeRange!=='node22' || fabricator.platform!=='win' || fabricator.arch!=='x64') throw failure('EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
    const backpack=dataRecord(item.backpack,['prelude','entrypoint','stripes'],'EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
    if(typeof backpack.prelude!=='string' || typeof backpack.entrypoint!=='string' || state.refinerCalls!==1 || !state.heldSnaps || backpack.entrypoint!==state.refinedEntrypoint) throw failure('EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
    const snapFiles=new Map([...state.heldSnaps].map(([file,snap])=>[snap,file]));
    const heldCounts=new Map([...snapFiles.keys()].map(snap=>[snap,0]));
    const stripes=dataArray(backpack.stripes,'EDITH_PKG_OFFLINE_PRODUCER_REJECTED').map(stripe=>{
      const data=dataRecord(stripe,['snap','store','file','buffer'],'EDITH_PKG_OFFLINE_SOURCE_REJECTED',['file','buffer']);
      if(typeof data.snap!=='string' || ![1,2,3].includes(data.store) || Object.hasOwn(data,'file')===Object.hasOwn(data,'buffer')) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
      for(const field of ['snap','file']) if(typeof data[field]==='string') {
        const alias=path.resolve(data[field]).toLowerCase();
        for(const required of [...snapFiles.keys(),...snapFiles.values()]) if(alias===path.resolve(required).toLowerCase() && data[field]!==required) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
      }
      if(data.store===1 && heldCounts.has(data.snap)) {
        const originalFile=snapFiles.get(data.snap);
        if(Object.hasOwn(data,'file') && data.file!==originalFile || heldCounts.get(data.snap)!==0) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
        heldCounts.set(data.snap,1);
        if(Object.hasOwn(data,'buffer') && (isProxy(data.buffer) || !Buffer.isBuffer(data.buffer))) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
        return Object.freeze({snap:data.snap,store:1,buffer:stripeCopy(originalFile===state.configFile?state.config:state.asset)});
      }
      if(Object.hasOwn(data,'file') && state.heldSnaps.has(data.file)) throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
      if(Object.hasOwn(data,'file')) {
        if(data.store!==1 || typeof data.file!=='string' || !within(plan.root,data.file) || data.file===output || data.file===temp || within(plan.cache,data.file) || !noLinks(data.file).isFile()) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
        if(noLinks(data.file).nlink!==1) throw failure('EDITH_PKG_OFFLINE_ALIAS_REJECTED');
        allowedFiles.add(data.file);
      } else { data.buffer=stripeCopy(data.buffer); }
      return Object.freeze({...data});
    });
    if([...heldCounts.values()].some(count=>count!==1) || state.configReads!==1) {
      for(const stripe of stripes) if(stripe.buffer) stripe.buffer.fill(0);
      throw failure('EDITH_PKG_OFFLINE_ASSET_REJECTED');
    }
    const links=anyDataRecord(item.symLinks,'EDITH_PKG_OFFLINE_SOURCE_REJECTED');
    if(Object.values(links).some(value=>typeof value!=='string')) throw failure('EDITH_PKG_OFFLINE_SOURCE_REJECTED');
    const snapshot={...item,bakes:[],target:{...target,fabricator:{...fabricator}},backpack:{...backpack,stripes},symLinks:{...links}};
    state.active=true;
    try {
      const pending=actual(snapshot);
      if(!(pending instanceof Promise)) throw failure('EDITH_PKG_OFFLINE_PRODUCER_REJECTED');
      await pending;
      if(state.reads!==1 || state.fds.size!==0) throw failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED');
    } finally {
      state.active=false;
      await Promise.all([...state.streams].map(stream=>stream.closed ? undefined : new Promise(resolve=>{stream.once('close',resolve); stream.destroy();})));
      await Promise.all([...state.pendingIo]);
      await Promise.all([...state.fds].map(fd=>new Promise(resolve=>{state.fds.delete(fd); io.close(fd,()=>resolve());})));
      if(state.consumer) state.consumer.fill(0);
      for(const stripe of stripes) if(stripe.buffer) stripe.buffer.fill(0);
      allowedFiles.clear();
    }
  };
  return state;
}
async function main() {
  const args=process.argv.slice(2);
  let outputRole,cachePath,entry,output;
  if(args.length===4 && args[0]==='--edith-pkg-buffer') {[,cachePath,entry,output]=args;}
  else if(args.length===5 && args[0]==='--edith-pkg-candidate' && args[1].length===64 && /^[a-f0-9]{64}$/.test(args[1])) {outputRole={kind:'candidate',id:args[1]};[, ,cachePath,entry,output]=args;}
  else throw failure('EDITH_PKG_OFFLINE_ROLE_REJECTED');
  if(process.platform!=='win32' || process.arch!=='x64') throw failure('EDITH_PKG_OFFLINE_PLATFORM_REJECTED');
  const plan=qualify({projectRoot:process.cwd(),cachePath,env:process.env,outputRole});
  let state,config;
  try {
    fixedPaths(plan,entry,output);
    config=fixedConfig(plan);
    const vendorRoot=path.join(plan.root,'node_modules','@yao-pkg');
    if(Object.keys(require.cache).some(file=>within(vendorRoot,file))) throw failure('EDITH_PKG_OFFLINE_BOOTSTRAP_REJECTED');
    state=createProduction(plan,entry,output,config);
    installGuards(state);
    const producer=require(state.producerFile);
    if(typeof producer.default!=='function') throw failure('EDITH_PKG_OFFLINE_BOOTSTRAP_REJECTED');
    lock(producer,'default',state.wrap(producer.default));
    const refiner=require(state.refinerFile);
    if(typeof refiner.default!=='function') throw failure('EDITH_PKG_OFFLINE_BOOTSTRAP_REJECTED');
    lock(refiner,'default',state.wrapRefiner(refiner.default));
    const pkg=require(state.indexFile);
    state.restoreLoader();
    state.restoreLoader=undefined;
    await pkg.exec([state.configFile,'--targets','node22-win-x64','--no-bytecode','--no-native-build','--no-signature','--public','--compress','GZip','--output',state.temp]);
    state.importsActive=false;
    if(state.calls!==1 || state.reads!==1 || state.dryNeeds!==1 || state.realNeeds!==1) throw failure('EDITH_PKG_OFFLINE_SCOPE_REJECTED');
    validateOutput(state);
    fixedPaths(plan,state.entry,state.output);
    state.io.renameSync(state.temp,state.output);
    state.promoted=true;
  } finally {
    if(state) { state.importsActive=false; for(const copy of [...state.walkerCopies,...state.stripeCopies]) copy.fill(0); }
    if(config) config.fill(0);
    if(state?.restoreLoader) state.restoreLoader();
    if(state && !state.promoted && state.identity && fs.existsSync(state.temp)) {
      const stat=noLinks(state.temp);
      if(stat.isFile() && stat.nlink===1 && stat.dev===state.identity.dev && stat.ino===state.identity.ino) state.io.unlinkSync(state.temp);
    }
    plan.bytes.fill(0);
    plan.asset.fill(0);
  }
}
module.exports=Object.freeze({preflight,getPkgArguments,installDenyOnly,diagnosticState,EXPECTED_RUNTIME_SHA256,CACHE_TAG,FETCHED_NAME,vendorPins:Object.freeze(VENDOR_PINS.map(pin=>Object.freeze({...pin})))});
if(require.main===module) main().catch(error=>{
  // Vendor errors can contain paths or source text. Emit only our code.
  const code=typeof error?.code==='string' && /^EDITH_PKG_OFFLINE_[A-Z_]+$/.test(error.code) ? error.code : 'EDITH_PKG_OFFLINE_PACKAGING_FAILED';
  process.stderr.write(`${code}\n`); process.exitCode=1;
});
