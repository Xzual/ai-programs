import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { syncBuiltinESMExports, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertInside, assertSafeRelative, findDeveloperPathLeaks, listFilesStrict, PORTABLE_FORMAT, sha256, validateZipEntries } from './portable-edith-lib.mjs';
import { assertPackagedCryptoResources } from './stage-edith-crypto-resources.mjs';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';
import { packagePortable, writePortableManifest } from './package-edith-portable.mjs';
import * as thirdParty from './build-edith-sidecar.mjs';
import {verifyPortable} from './verify-edith-portable.mjs';
import {types} from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const verifierFile = fileURLToPath(new URL('./verify-edith-portable.mjs', import.meta.url));
const fixtureParent = fs.realpathSync(os.tmpdir());
const runRoot = fs.mkdtempSync(path.join(fixtureParent, 'edith-portable-security-'));
const runIdentity = fs.lstatSync(runRoot, { bigint: true });
let report;
try {
const lockBytes = fs.readFileSync(path.join(projectRoot, 'crypto/requirements.lock.txt'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (root, relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { flag: 'wx' }); };

// Stored ZIP fixtures: no archiver or executable payload is launched.
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function storedZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data ?? 'x'), crc = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(entry.attributes ?? 0, 38); index.writeUInt32LE(offset, 42);
    local.push(head, name, data); central.push(index, name); offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function notices(directory, sidecar, bundle, corrupt = false) {
  const root = 'node_modules/playwright-core', base = 'payload/' + root;
  const rows = [['LICENSE', 'NOTICE'], ['browsers.json', 'CONTENT'], ['package.json', 'METADATA']].map(([name, role]) => {
    const bytes = fs.readFileSync(path.join(projectRoot, root, name)), relative = `${base}/${name}`; write(directory, relative, bytes);
    return { path: relative, sourcePath: `${root}/${name}`, packageRoot: root, roles: [role], sha256: hash(bytes), sizeBytes: bytes.length };
  });
  const manifest = { formatVersion: 1, target: 'node22-win-x64', bundle: { sha256: hash(bundle), sizeBytes: bundle.length }, sidecar: { sha256: corrupt ? '0'.repeat(64) : hash(sidecar), sizeBytes: sidecar.length }, packages: [{ root, name: 'playwright-core', version: '1.62.1', metadataPath: `${base}/package.json`, sourcePaths: [`${base}/browsers.json`], noticePaths: [`${base}/LICENSE`], readmeFallback: false }], files: rows };
  write(directory, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
let serial = 0;
function fixture(options = {}) {
  const root = path.join(runRoot, String(++serial)), version = options.version ?? '1.2.3', name = `E.D.I.T.H.-${version}-windows-x64`;
  write(root, 'package.json', JSON.stringify({ version })); write(root, 'crypto/requirements.lock.txt', lockBytes);
  const portable = path.join(root, 'artifacts/desktop/portable', name), sidecar = Buffer.from('INERT_BACKEND_DATA'), bundle = Buffer.from('/* inert server bundle fixture */');
  write(portable, 'edith.exe', 'INERT_APP_DATA'); write(portable, 'edith-backend.exe', sidecar); write(portable, 'dist/index.html', options.html ?? '<html>one</html>');
  write(portable, 'crypto/run_agent.py', '# inert fixture; never executed'); write(portable, 'crypto/requirements.txt', 'requests==2.34.2\n');
  for (const file of ['coin_permissions', 'demo_asset_modes', 'observer_config']) write(portable, `crypto/config/${file}.json`, '{}');
  write(portable, 'crypto/src/fixture.py', '# inert'); write(portable, 'crypto/templates/fixture.html', '<html></html>');
  if (!options.noLock) write(portable, 'crypto/requirements.lock.txt', options.lock ?? lockBytes);
  write(portable, 'python/python.exe', 'INERT_PYTHON_DATA');
  if (!options.noMarker) write(portable, 'python/EDITH_RUNTIME_VERIFIED.json', JSON.stringify({ formatVersion: options.markerVersion ?? 1, lockSha256: options.markerHash ?? hash(options.lock ?? lockBytes) }));
  if (!options.noNotices) notices(path.join(portable, 'third-party'), sidecar, bundle, options.corruptBinding);
  writePortableManifest({ portable, version });
  return { root, version, name, portable, sidecar, bundle };
}
function archive(f, source = f.portable, extraRoot = false) {
  const zip = path.join(f.root, 'artifacts/desktop', `${f.name}.zip`);
  const entries = listFilesStrict(source).map(({ absolute, relative }) => ({ name: f.name + '/' + relative, data: fs.readFileSync(absolute) }));
  if (extraRoot) entries.push({ name: 'EXTRA.txt', data: 'inert extra root file' });
  fs.writeFileSync(zip, storedZip(entries), { flag: 'wx' }); fs.writeFileSync(zip + '.sha256', `${sha256(zip)}  ${path.basename(zip)}\n`, { flag: 'wx' }); return entries.length;
}
let current;
const originalChild = childProcess.execFileSync;
// Only OS archive inspection/extraction is mocked during inert delivery regressions.
// Production payload/notice/lock validation and actual packager preflight are exercised.
childProcess.execFileSync = (_file, args, options) => {
  const script = args.at(-1);
  if(current?.packaging && script.includes('CreateEntryFromFile')) {
    const entries=listFilesStrict(options.env.EDITH_PORTABLE_SOURCE).map(({absolute,relative})=>({name:current.name+'/'+relative,data:fs.readFileSync(absolute)}));
    fs.writeFileSync(options.env.EDITH_PORTABLE_ZIP,storedZip(entries),{flag:'wx'});current.entries=entries.length;return Buffer.alloc(0);
  }
  if (current && script.includes('ExtractToDirectory')) { fs.cpSync(current.archiveSource, path.join(options.env.EDITH_PORTABLE_DEST, current.name), { recursive: true, errorOnExist: true }); if (current.extraRoot) write(options.env.EDITH_PORTABLE_DEST, 'EXTRA.txt', 'inert extra root file'); current.extractions++; return Buffer.alloc(0); }
  if (current && options?.env?.EDITH_ZIP) { current.zipGuards++; return String(current.entries); }
  throw new Error('Unexpected child boundary in inert portable regression');
};
syncBuiltinESMExports();
function executeVerifier(f, source = f.portable, extraRoot = false) {
  current = { ...f, archiveSource: source, extraRoot, entries: archive(f, source, extraRoot), zipGuards: 0, extractions: 0 };
  const sourceText = fs.readFileSync(verifierFile, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(verifierFile).href));
  const output = [];
  // Preserve strict production plain-record admission: bridge VM option values to a host
  // plain object, then call the REAL validator. No manifest or validation result is mocked.
  const delivered = options => thirdParty.validateDeliveredThirdPartyResources({ directory: options.directory, sidecarPath: options.sidecarPath });
  const context = vm.createContext({ fs, path, crypto, types, createRequire, assertInside, assertSafeRelative, findDeveloperPathLeaks, listFilesStrict, PORTABLE_FORMAT, sha256, validateZipEntries, assertPackagedCryptoResources, readExactRequirementsLock, validateDeliveredThirdPartyResources: delivered, execFileSync: childProcess.execFileSync, fileURLToPath, os: { tmpdir: () => runRoot }, process: { cwd: () => f.root, env: { USERPROFILE: runRoot }, argv: ['node', verifierFile] }, console: { log: value => output.push(value) }, Buffer, Set, Map });
  new vm.Script(sourceText, { filename: verifierFile }).runInContext(context, { timeout: 10000 });
  assert.equal(current.zipGuards, 1, 'production ZIP validation still invoked before extraction'); assert.equal(current.extractions, 1);
  return output;
}
const failures = [], passed = [];
function check(name, body) { try { body(); passed.push(name); } catch (error) { failures.push({ name, message: error.message }); } }
function reManifest(f) { for (const name of ['manifest.json', 'SHA256SUMS.txt']) fs.unlinkSync(assertInside(runRoot, path.join(f.portable, name), 'own synthetic manifest')); writePortableManifest({ portable: f.portable, version: f.version }); }
try {
  check('closed-outer-options-reject-before-code-or-filesystem',()=>{
    for(const api of [packagePortable,verifyPortable]) for(const kind of ['unknown','accessor','proxy']) {
      let getters=0,touches=0,traps=0;
      const input=kind==='unknown'?{unknown:true}:kind==='accessor'?Object.defineProperty({},'outputRole',{get(){getters++;return {kind:'legacy'};}}):new Proxy({},{get(){traps++;return undefined;},ownKeys(){traps++;return [];},getPrototypeOf(){traps++;return Object.prototype;}});
      const original=fs.readFileSync;fs.readFileSync=()=>{touches++;throw Error('UNEXPECTED_OPTIONS_IO');};
      try{assert.throws(()=>api(input),/EDITH_PORTABLE_OPTIONS_REJECTED/);assert.equal(getters,0);assert.equal(traps,0);assert.equal(touches,0);}finally{fs.readFileSync=original;}
    }
  });
  check('valid-matching-delivery', () => { const f = fixture(); assert.ok(executeVerifier(f).some(text => JSON.parse(text).status === 'PASS')); });
  check('different-self-valid-extraction-rejected', () => { const a = fixture(), b = fixture({ html: '<html>two</html>' }); assert.throws(() => executeVerifier(a, b.portable), /parity|identity|payload.*differ/i); });
  check('extra-extracted-root-entry-rejected', () => { const f = fixture(); assert.throws(() => executeVerifier(f, f.portable, true), /extracted.*root|ZIP.*root/i); });
  check('missing-notices-rejected', () => { const f = fixture({ noNotices: true }); assert.throws(() => executeVerifier(f), /third.party|Required portable file/i); });
  check('missing-marker-rejected', () => { const f = fixture({ noMarker: true }); assert.throws(() => executeVerifier(f), /RUNTIME_VERIFIED|Python.*marker|Required portable file/i); });
  check('wrong-marker-lock-rejected', () => { const f = fixture({ markerHash: '0'.repeat(64) }); assert.throws(() => executeVerifier(f), /Python.*lock|runtime.*lock/i); });
  check('wrong-marker-format-rejected', () => { const f = fixture({ markerVersion: 2 }); assert.throws(() => executeVerifier(f), /Python.*marker|runtime.*marker/i); });
  check('missing-packaged-lock-rejected', () => { const f = fixture({ noLock: true }); assert.throws(() => executeVerifier(f), /requirements.lock|Python.*lock|Required portable file/i); });
  check('changed-lock-and-matching-marker-rejected', () => { const f = fixture({ lock: Buffer.from('requests==0.0.0\n') }); assert.throws(() => executeVerifier(f), /Python.*lock|runtime.*lock/i); });
  check('corrupt-delivered-notice-binding-rejected', () => { const f = fixture({ corruptBinding: true }); assert.throws(() => executeVerifier(f), /EDITH_THIRD_PARTY/); });
  check('original-validator-keeps-actual-bundle-binding', () => {
    const f = fixture(), bundlePath = path.join(f.root, 'candidate/server.cjs'); write(f.root, 'candidate/server.cjs', f.bundle);
    const options = { directory: path.join(f.portable, 'third-party'), bundlePath, sidecarPath: path.join(f.portable, 'edith-backend.exe') };
    assert.equal(thirdParty.validateThirdPartyResources(options).target, 'node22-win-x64');
    fs.writeFileSync(bundlePath, 'DIFFERENT_INERT_BUNDLE'); assert.throws(() => thirdParty.validateThirdPartyResources(options), /EDITH_THIRD_PARTY_BINDING_MISMATCH/);
  });
  check('modified-sidecar-rehashed-outermanifest-rejected', () => {
    const f = fixture(); fs.writeFileSync(path.join(f.portable, 'edith-backend.exe'), 'DIFFERENT_INERT_BACKEND'); reManifest(f);
    assert.throws(() => executeVerifier(f), /EDITH_THIRD_PARTY_BINDING_MISMATCH/);
  });
  check('omitted-notice-payload-rehashed-outermanifest-rejected', () => {
    const f = fixture(); fs.unlinkSync(path.join(f.portable, 'third-party/payload/node_modules/playwright-core/LICENSE')); reManifest(f);
    assert.throws(() => executeVerifier(f), /EDITH_THIRD_PARTY/);
  });
  check('actual-package-missing-python-fails-before-replacement', () => {
    const f = fixture(); write(f.root, 'src-tauri/target/release/edith.exe', 'INERT_APP_DATA'); write(f.root, 'src-tauri/target/release/edith-backend.exe', f.sidecar); write(f.root, 'dist/index.html', '<html></html>');
    const staged = path.join(f.root, '.edith-build/desktop/resources'); write(f.root, '.edith-build/desktop/server.cjs', f.bundle); write(staged, 'crypto/run_agent.py', '# inert'); notices(path.join(staged, 'third-party'), f.sidecar, f.bundle);
    const before = sha256(path.join(f.portable, 'manifest.json')); current = null;
    assert.throws(() => packagePortable({ projectRoot: f.root }), /EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED/);
    assert.equal(sha256(path.join(f.portable, 'manifest.json')), before, 'existing release must survive actual missing-runtime branch');
  });
  check('candidate-delivery-isolated-fresh-and-byte-bound', () => {
    const f=fixture(), role={kind:'candidate',id:'2'.repeat(64)};
    const candidate=path.join(f.root,'artifacts/desktop/candidates',role.id), stage=path.join(candidate,'stage');
    write(f.root,'src-tauri/target/release/edith.exe','INERT_APP_DATA');write(f.root,'src-tauri/target/release/edith-backend.exe',f.sidecar);
    write(stage,'server.cjs',f.bundle);write(candidate,'binaries/edith-backend-x86_64-pc-windows-msvc.exe',f.sidecar);
    for(const name of ['crypto','python','third-party']) fs.cpSync(path.join(f.portable,name),path.join(stage,'resources',name),{recursive:true});
    fs.cpSync(path.join(f.portable,'dist'),path.join(candidate,'frontend'),{recursive:true});
    const protectedPaths=['.edith-build/desktop','dist','src-tauri/binaries','artifacts/desktop/portable'].map(p=>path.join(f.root,p).toLowerCase());
    const restored=[];let touches=0;
    for(const key of ['existsSync','lstatSync','statSync','readFileSync','readdirSync','mkdirSync','rmSync','renameSync','copyFileSync','cpSync','writeFileSync']) {
      const original=fs[key];restored.push(()=>{fs[key]=original;});
      fs[key]=function(value,...args){for(const p of [value,...(['renameSync','copyFileSync','cpSync'].includes(key)?[args[0]]:[])])if(typeof p==='string'&&protectedPaths.some(base=>path.resolve(p).toLowerCase()===base||path.resolve(p).toLowerCase().startsWith(base+path.sep))){touches++;throw Error('LEGACY_OUTPUT_IO');}return original.call(this,value,...args);};
    }
    current={...f,packaging:true,archiveSource:path.join(candidate,'portable',f.name),entries:0,extractions:0,zipGuards:0};
    try {
      packagePortable({projectRoot:f.root,outputRole:role});
      const result=verifyPortable({projectRoot:f.root,outputRole:role});assert.equal(result.payloadParity,true);assert.equal(result.pythonEvidence,'recorded exact lock binding only; runtime execution not performed');
      assert.throws(()=>packagePortable({projectRoot:f.root,outputRole:role}),/CANDIDATE_OUTPUT_EXISTS/);
      assert.equal(touches,0,'candidate APIs must not inspect or mutate legacy output slots');
    } finally {for(const restore of restored.reverse())restore();}
    const mismatch={kind:'candidate',id:'3'.repeat(64)}, other=path.join(f.root,'artifacts/desktop/candidates',mismatch.id);
    write(other,'binaries/edith-backend-x86_64-pc-windows-msvc.exe','DIFFERENT_BACKEND');write(other,'frontend/index.html','inert');
    assert.throws(()=>packagePortable({projectRoot:f.root,outputRole:mismatch}),/CANDIDATE_COPIED_SIDECAR_MISMATCH/);
    const alias=path.join(other,'portable');fs.symlinkSync(path.join(candidate,'portable'),alias,'junction');
    try {assert.throws(()=>packagePortable({projectRoot:f.root,outputRole:mismatch}),/EDITH_THIRD_PARTY_INVALID/);}finally{fs.unlinkSync(alias);}
  });
} finally { childProcess.execFileSync = originalChild; syncBuiltinESMExports(); }

// Separately authorized native ZIP checks use only these tiny own stored archives, never extract them.
const maliciousNames = ['../escape.txt', '/absolute.txt', 'C:/drive.txt', 'safe.txt:stream', 'Folder/File.txt|folder/file.txt'];
let nativeZipStatus = 'UNRUN_INERT_DEFAULT';
if (process.argv.includes('--native-zip-security')) {
  let rejected = 0; const destination = path.join(runRoot, 'native-extract'); fs.mkdirSync(destination);
  childProcess.execFileSync = (file, args, options) => originalChild(file, args, { ...options, windowsHide: true, timeout: Math.min(options?.timeout ?? 20000, 20000), maxBuffer: 1048576 }); syncBuiltinESMExports();
  try {
    const control = path.join(runRoot, 'benign-control.zip'); fs.writeFileSync(control, storedZip([{ name: 'safe/file.txt', data: 'benign' }]));
    assert.equal(validateZipEntries(control, destination), 1, 'real ZIP validator must first accept a known-valid archive');
    for (let index = 0; index < maliciousNames.length; index++) {
      const zip = path.join(runRoot, `malicious-${index}.zip`); fs.writeFileSync(zip, storedZip(maliciousNames[index].split('|').map(name => ({ name, data: 'x' }))));
      try { validateZipEntries(zip, destination); }
      catch (error) { if (error.status !== 1 || error.signal != null || error.code === 'ETIMEDOUT' || !/Unsafe ZIP entry:|Duplicate or case-colliding ZIP entry:/.test(String(error.stderr ?? ''))) throw error; rejected++; }
    }
    assert.equal(rejected, maliciousNames.length); nativeZipStatus = 'PASS';
  } finally { childProcess.execFileSync = originalChild; syncBuiltinESMExports(); }
}
report = { success: failures.length === 0, passed, failures, missingPythonBranchExecuted: passed.includes('actual-package-missing-python-fails-before-replacement'), pythonExecuted: false, appOrPkgExecuted: false, nativeZipStatus, retainedMaliciousZipCases: maliciousNames.length, archiveBoundary: 'mocked OS inspection/extraction for delivery cases; production tree validation executed', fixtures: runRoot };
if (failures.length) process.exitCode = 1;
} finally {
  // Remove only this freshly-created directory after identity and strict tree checks.
  const currentIdentity = fs.lstatSync(runRoot, { bigint: true });
  assert.ok(currentIdentity.isDirectory() && !currentIdentity.isSymbolicLink());
  assert.equal(currentIdentity.dev, runIdentity.dev);
  assert.equal(currentIdentity.ino, runIdentity.ino);
  assert.equal(currentIdentity.birthtimeNs, runIdentity.birthtimeNs);
  assert.equal(fs.realpathSync(runRoot), path.join(fixtureParent, path.basename(runRoot)));
  assert.equal(path.dirname(runRoot), fixtureParent);
  const fixtureBytes = listFilesStrict(runRoot).reduce((sum, { absolute }) => sum + fs.statSync(absolute).size, 0);
  assert.ok(fixtureBytes <= 64 * 1024 * 1024, 'own fixture size cap');
  fs.rmSync(runRoot, { recursive: true, force: false });
  assert.equal(fs.existsSync(runRoot), false);
  if (report) Object.assign(report, { fixtureBytes, fixtureCleanup: 'exact-created-root-identity-verified-and-removed' });
}
console.log(JSON.stringify(report, null, 2));
