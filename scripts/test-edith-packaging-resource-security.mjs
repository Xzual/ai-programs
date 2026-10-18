import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertPackagedCryptoResources,stageCryptoResources} from './stage-edith-crypto-resources.mjs';
import {assertInside,assertSafeRelative,copyTreeStrict,isExcludedPythonRuntime,listFilesStrict} from './portable-edith-lib.mjs';

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'edith-packaging-resource-security-'));
const cases=[],links=[];
let serial=0,cleaned=false;
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const helperHashes=['portable-edith-lib.mjs','stage-edith-crypto-resources.mjs'].map(name=>({path:`scripts/${name}`,sha256:sha(fileURLToPath(new URL(name,import.meta.url)))}));
function check(id,kind,action){try{action();cases.push({id,kind,status:'PASS'});}catch{cases.push({id,kind,status:'FAIL'});}}
function cryptoFixture(config='{}'){
 const dir=path.join(fixture,`crypto-${++serial}`);
 const files={'run_agent.py':'print("synthetic fixture")\n','requirements.txt':'synthetic==0.0.0\n','src/fixture.py':'def fixture(): return 0\n','templates/index.html':'<p>Synthetic fixture</p>','config/coin_permissions.json':'{}','config/demo_asset_modes.json':'{}','config/observer_config.json':config};
 for(const [relative,content]of Object.entries(files)){const p=path.join(dir,relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);}
 return dir;
}
function rejectsJSON(id,config){
 check(`${id}:direct`,'negative',()=>assert.throws(()=>assertPackagedCryptoResources(cryptoFixture(config))));
 check(`${id}:stage`,'negative',()=>assert.throws(()=>stageCryptoResources({source:cryptoFixture(config),destination:path.join(fixture,`staged-${++serial}`),allowedDestinationRoot:fixture})));
}
function rejectsRedactedJSON(id,config,sentinel){
 for(const operation of ['direct','stage'])check(`${id}:${operation}`,'negative',()=>{
  const source=cryptoFixture(config);
  let caught;
  try{if(operation==='direct')assertPackagedCryptoResources(source);else stageCryptoResources({source,destination:path.join(fixture,`redacted-staged-${++serial}`),allowedDestinationRoot:fixture});}catch(error){caught=error;}
  assert.ok(caught instanceof Error);
  assert.equal(caught.message.includes(sentinel),false);
  assert.equal(caught.message.includes(config),false);
  assert.equal(caught.message.includes(fixture),false);
  assert.match(caught.message,/^(?:Embedded credential-like JSON literal rejected|Malformed packaged JSON rejected): config\/observer_config\.json(?: \(credential-bearing field\))?$/);
 });
}
const runtimeDenied=['.env','.env.local','.ENV.PRODUCTION','nested/.env','nested\\.ENV.test','credentials','credentials.json','NESTED/CREDENTIALS.ini','secrets.json','nested/SECRETS.json','edith.db','nested/STATE.DB-WAL','state.db-shm','state.sqlite','nested/STATE.SQLITE-WAL','state.sqlite-shm','state.sqlite3','state.sqlite3-wal','state.sqlite3-shm','run.log','nested/RUN.LOG','logs/current.txt','LOGS/session.txt','__pycache__/module.pyc','NESTED/__PYCACHE__/module.dat','module.pyc','module.PYO','.pytest_cache/state','nested/.cache/pip/cache.dat','pip.ini','nested/PIP.CONF','.config/pip/pip.conf'];
const runtimeAllowed=['python.exe','python312.dll','Lib/config.py','Lib/packageconfig.json','Lib/secrets.py','Lib/token.py','Lib/logging/__init__.py','Lib/sqlite3/__init__.py','Lib/site-packages/pip/__init__.py','Lib/site-packages/fixture-1.0.dist-info/METADATA','Lib/site-packages/fixture-1.0.dist-info/RECORD','Lib/site-packages/fixture-1.0.dist-info/WHEEL','certificates/cacert.pem'];
const pipCacheModules=['__init__.py','file_cache.py','redis_cache.py'].map(name=>`Lib/site-packages/pip/_vendor/cachecontrol/caches/${name}`);
const cacheImpostors=['extra.py','data.json','state.db','state.db-wal','state.db-shm','.env','private_key.pem','credentials.json','nested/file_cache.py'].map(name=>`Lib/site-packages/pip/_vendor/cachecontrol/caches/${name}`);
const cachePathVariants=pipCacheModules.flatMap(name=>[name.toLowerCase(),name.replace('pip/','PIP/'),name.replace('.py','.PY'),`prefix/${name}`,`./${name}`,name.replace('Lib/','Lib//'),`${name}/`,name.replace('/caches/','/caches/../caches/')]);
try {
 for(const [index,name]of pipCacheModules.entries())check(`pip-exact3-admission-${index}`,'positive',()=>{
  assert.equal(isExcludedPythonRuntime(name),false);assert.equal(isExcludedPythonRuntime(name.replaceAll('/','\\')),false);
 });
 for(const [index,name]of [...cacheImpostors,...cachePathVariants,'Lib/site-packages/pip/_vendor/cachecontrol/caches','Lib/site-packages/pip/_vendor/cachecontrol/caches/','Lib/site-packages/pip/_vendor/cachecontrol/cache/file_cache.py'].entries())check(`pip-exact3-deny-${index}`,'negative',()=>assert.equal(isExcludedPythonRuntime(name),true));
 check('pip-exact3-strict-copy-bytes-and-created-parents','positive',()=>{
  const source=path.join(fixture,'pip-exact3'),destination=path.join(fixture,'pip-exact3-copy');
  const payloads=new Map(pipCacheModules.map((name,index)=>[name,Buffer.from(`# SYNTHETIC MODULE ONLY ${index}\nVALUE = ${index}\n`)]));
  for(const name of [...pipCacheModules,...cacheImpostors]){const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,payloads.get(name)??'SYNTHETIC EXCLUDED STATE ONLY');}
  copyTreeStrict(source,destination,{exclude:isExcludedPythonRuntime});
  assert.deepEqual(listFilesStrict(destination).map(row=>row.relative).sort(),[...pipCacheModules].sort());
  for(const [name,bytes]of payloads){const file=path.join(destination,name);assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(sha(file),sha(path.join(source,name)));assert.ok(fs.statSync(path.dirname(file)).isDirectory());}
 });
 check('pip-exact3-ancestor-name-in-file-position-remains-excluded','negative',()=>{
  const source=path.join(fixture,'pip-ancestor-file'),destination=path.join(fixture,'pip-ancestor-file-copy');
  const file=path.join(source,'Lib/site-packages/pip/_vendor/cachecontrol/caches');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'SYNTHETIC ANCESTOR FILE ONLY');
  copyTreeStrict(source,destination,{exclude:isExcludedPythonRuntime});assert.deepEqual(listFilesStrict(destination),[]);
 });
 check('strict-copy-no-overwrite-preserved','negative',()=>{
  const source=path.join(fixture,'no-overwrite'),destination=path.join(fixture,'no-overwrite-copy');fs.mkdirSync(source);fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source,'module.py'),'SYNTHETIC NEW');fs.writeFileSync(path.join(destination,'module.py'),'SYNTHETIC ORIGINAL');
  assert.throws(()=>copyTreeStrict(source,destination,{exclude:isExcludedPythonRuntime}),{code:'EEXIST'});assert.equal(fs.readFileSync(path.join(destination,'module.py'),'utf8'),'SYNTHETIC ORIGINAL');
 });
 check('strict-relative-and-root-containment-preserved','negative',()=>{
  for(const name of ['../escape','nested/../../escape','/absolute','C:\\absolute','\\\\server\\share'])assert.throws(()=>assertSafeRelative(name,'synthetic'));
  assert.throws(()=>assertInside(fixture,path.join(fixture,'..','synthetic-outside'),'synthetic'));
 });
 {
  const target=path.join(fixture,'excluded-link-owned-target'),source=path.join(fixture,'excluded-link-source'),destination=path.join(fixture,'excluded-link-copy');
  fs.mkdirSync(target);fs.writeFileSync(path.join(target,'owned.txt'),'SYNTHETIC OWNED TARGET ONLY');
  const link=path.join(source,'Lib/site-packages/pip/_vendor/cachecontrol/caches/linked');fs.mkdirSync(path.dirname(link),{recursive:true});
  let available=false,reason=null;try{fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');available=true;}catch(error){reason=typeof error?.code==='string'?error.code:'LINK_CREATION_UNAVAILABLE';}
  if(available){check('excluded-cache-actual-link-rejected-before-filter','negative',()=>{let filtered=0;assert.throws(()=>copyTreeStrict(source,destination,{exclude:name=>{filtered++;return isExcludedPythonRuntime(name);}}),/Portable payload may not contain links/);assert.equal(filtered,0);assert.deepEqual(listFilesStrict(destination),[]);});links.push({kind:'excluded-runtime-cache',status:'EXECUTED',mechanism:process.platform==='win32'?'actual_owned_directory_junction':'actual_owned_directory_symlink'});}
  else links.push({kind:'excluded-runtime-cache',status:'NOT_RUN',reason});
 }
 // Original JSON desired-policy regression, not an assertion of the previous bug.
 rejectsJSON('original-json-secret',JSON.stringify({api_key:'SYNTHETIC_ONLY_NOT_A_SECRET'}));
 const aliases=['Api-Key','s_e_c_r_e_t','CREDENTIAL','Access.Token','PRIVATE_key','pass-word','api.secret','Client_Secret','Secret-Key','AUTH_token','Refresh.Token','t_o_k_e_n','credentials','Access-Key','access_key_id','secret.access.key','Bearer-Token','AUTHORIZATION','passwd','p_w_d'];
 for(const [index,key]of aliases.entries())rejectsJSON(`normalized-alias-${index}`,JSON.stringify({[key]:'x'}));
 rejectsJSON('nested-object',JSON.stringify({settings:{provider:{client_secret:'x'}}}));
 rejectsJSON('nested-array',JSON.stringify({providers:[{safe:true},{settings:{refreshToken:'x'}}]}));
 rejectsJSON('root-array',JSON.stringify([{settings:{password:'x'}}]));
 rejectsJSON('literal-placeholder',JSON.stringify({apiKey:'YOUR_API_KEY_HERE'}));
 rejectsJSON('duplicate-secret-then-empty','{"api_key":"x","api_key":""}');
 rejectsJSON('duplicate-empty-then-secret','{"api_key":"","api_key":"x"}');
 rejectsJSON('escaped-duplicate-secret-then-empty',String.raw`{"api_key":"x","api\u005fkey":""}`);
 rejectsJSON('sensitive-array-context',JSON.stringify({secret:['x']}));
 rejectsJSON('sensitive-object-context',JSON.stringify({authorization:{value:'x'}}));
 rejectsJSON('sensitive-boolean',JSON.stringify({secret:false}));
 rejectsJSON('sensitive-number',JSON.stringify({token:0}));
 for(const [index,malformed]of ['{','{"safe":true,}','not-json'].entries())rejectsJSON(`malformed-json-${index}`,malformed);
 const redactionSentinel='SYNTHETIC_REDACTION_SENTINEL_NOT_A_SECRET';
 rejectsRedactedJSON('credential-error-redaction',JSON.stringify({apiKey:redactionSentinel}),redactionSentinel);
 rejectsRedactedJSON('malformed-error-redaction',`{"api_key":"${redactionSentinel}`,redactionSentinel);
 const benign=[{},{apiKey:'',secret:null},{providers:[{password:null,token:''}]},{credentialType:'oauth',tokenCount:3},{enabled:true,count:0},{settings:{label:'Synthetic fixture',safe:true}}];
 for(const [index,config]of benign.entries())check(`benign-json-${index}`,'positive',()=>{
  const result=stageCryptoResources({source:cryptoFixture(JSON.stringify(config)),destination:path.join(fixture,`clean-staged-${++serial}`),allowedDestinationRoot:fixture});
  assertPackagedCryptoResources(result.destination);assert.ok(result.files.includes('config/observer_config.json'));
 });
 for(const [index,assignment]of ["api_key = 'SYNTHETIC_ONLY_NOT_A_SECRET'\n","self.password = 'SYNTHETIC_ONLY_NOT_A_SECRET'\n"].entries())check(`python-assignment-${index}`,'negative',()=>{const source=cryptoFixture();fs.appendFileSync(path.join(source,'src/fixture.py'),assignment);assert.throws(()=>assertPackagedCryptoResources(source));});
 for(const [index,header]of ['PRIVATE KEY','RSA PRIVATE KEY','EC PRIVATE KEY','OPENSSH PRIVATE KEY'].entries())check(`pem-${index}`,'negative',()=>{const source=cryptoFixture();fs.appendFileSync(path.join(source,'run_agent.py'),`# -----BEGIN ${header}-----\n`);assert.throws(()=>assertPackagedCryptoResources(source));});
 for(const [index,name]of runtimeDenied.entries())check(`runtime-exclude-${index}`,'negative',()=>assert.equal(isExcludedPythonRuntime(name),true));
 for(const [index,name]of runtimeAllowed.entries())check(`runtime-preserve-${index}`,'positive',()=>assert.equal(isExcludedPythonRuntime(name),false));
 check('original-runtime-sensitive-copy','negative',()=>{
  const source=path.join(fixture,'original-runtime'),destination=path.join(fixture,'original-runtime-copy');fs.mkdirSync(source);
  for(const name of ['.env','credentials.json','edith.db'])fs.writeFileSync(path.join(source,name),'SYNTHETIC FIXTURE ONLY');
  copyTreeStrict(source,destination,{exclude:isExcludedPythonRuntime});
  assert.equal(fs.readdirSync(destination).length,0);
 });
 check('integrated-runtime-filter-copy','positive',()=>{
  const source=path.join(fixture,'runtime'),destination=path.join(fixture,'runtime-copy');fs.mkdirSync(source);
  for(const name of [...runtimeDenied.filter(n=>!n.includes('\\')),...runtimeAllowed]){const p=path.join(source,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'SYNTHETIC FIXTURE ONLY');}
  copyTreeStrict(source,destination,{exclude:isExcludedPythonRuntime});
  for(const name of runtimeDenied.filter(n=>!n.includes('\\')))assert.equal(fs.existsSync(path.join(destination,name)),false);
  for(const name of runtimeAllowed)assert.equal(fs.existsSync(path.join(destination,name)),true);
 });
 for(const kind of ['runtime','crypto']){
  const target=path.join(fixture,`link-target-${kind}`);fs.mkdirSync(target);fs.writeFileSync(path.join(target,'owned.txt'),'SYNTHETIC FIXTURE ONLY');
  const source=kind==='crypto'?cryptoFixture():path.join(fixture,'runtime-link-source');fs.mkdirSync(source,{recursive:true});
  const link=path.join(source,kind==='crypto'?'src/linked':'linked');
  let available=false,reason=null;
  try{fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');available=true;}catch(error){reason=typeof error?.code==='string'?error.code:'LINK_CREATION_UNAVAILABLE';}
  if(available){check(`${kind}-actual-directory-link-rejected`,'negative',()=>assert.throws(()=>kind==='crypto'?stageCryptoResources({source,destination:path.join(fixture,`linked-copy-${kind}`),allowedDestinationRoot:fixture}):copyTreeStrict(source,path.join(fixture,'runtime-linked-copy'),{exclude:isExcludedPythonRuntime})));links.push({kind,status:'EXECUTED',mechanism:process.platform==='win32'?'actual_owned_directory_junction':'actual_owned_directory_symlink'});}
  else links.push({kind,status:'NOT_RUN',reason});
 }
}finally{
 const resolved=path.resolve(fixture);
 if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('edith-packaging-resource-security-'))throw Error('OWNED_FIXTURE_CLEANUP_DENIED');
 fs.rmSync(resolved,{recursive:true,force:true});cleaned=!fs.existsSync(resolved);
}
const failures=cases.filter(c=>c.status==='FAIL');
console.log(JSON.stringify({suite:'actual-packaging-resource-security',result:failures.length?'FAIL':'PASS',cases:cases.length,positiveCases:cases.filter(c=>c.kind==='positive').length,negativeCases:cases.filter(c=>c.kind==='negative').length,failures:failures.map(c=>c.id),links,helperHashes,syntheticOnly:true,actualModules:true,ownedFixtureCleaned:cleaned,realConfigOrPythonRead:false,userDatabaseRead:false,networkUsed:false,applicationExecuted:false,releaseAcceptance:false}));
process.exitCode=failures.length||!cleaned?1:0;
