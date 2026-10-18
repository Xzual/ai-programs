import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { types } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';
import { stageCryptoResources } from './stage-edith-crypto-resources.mjs';
import { copyTreeStrict, isExcludedPythonRuntime } from './portable-edith-lib.mjs';
import outputRoleHelpers from './desktop-output-role.cjs';

// Catches deleting prior delivery before missing/invalid Python, lock or verifier
// rejection. Execute the real build function; replace only tool/package boundaries.
const sourcePath = fileURLToPath(new URL('./build-edith-sidecar.mjs', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('export async function buildEdithSidecar(');
const end = source.indexOf('\nif(process.argv[1]', start);
assert.ok(start >= 0 && end > start, 'sidecar entry function must be available');
const common = source.slice(source.indexOf('const MAX_FILE ='), source.indexOf('export function validateThirdPartyResources'));
const admission = source.slice(source.indexOf('function capturePublicCryptoSource('), start);
// An optional parent must already exist; never create or reuse an evidence root.
const fixtureParent = path.resolve(process.argv[2] ?? os.tmpdir());
const tempParent = path.resolve(os.tmpdir());
assert.ok(fixtureParent === tempParent || fixtureParent.startsWith(`${tempParent}${path.sep}`), 'optional fixture parent must stay in temporary storage');
const parentStat = fs.lstatSync(fixtureParent);
assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink());
assert.equal(fs.realpathSync(fixtureParent), fixtureParent);
const temp = fs.mkdtempSync(path.join(fixtureParent, 'sidecar-fixtures-'));
const tempIdentity = fs.lstatSync(temp);
const failures = [];
const cases = [
  { name: 'missing-python', error: /VETTED_PYTHON_REQUIRED/ },
  { name: 'bad-lock', bundle: true, badLock: true, error: /UNPINNED_PYTHON_REQUIREMENT/ },
  { name: 'missing-executable', bundle: true, missingExe: true, error: /contain python.exe/ },
  { name: 'pins-verifier-failure', bundle: true, failVerifier: 1, error: /synthetic verifier rejection/ },
  { name: 'pip-verifier-failure', bundle: true, failVerifier: 2, error: /synthetic verifier rejection/ },
  { name: 'crypto-resource-failure', bundle: true, badCrypto: true, error: /Required Crypto resource/ },
  { name: 'copy-failure', bundle: true, failCopy: true, error: /synthetic copy rejection/ },
  { name: 'catalog-failure', bundle: true, failCatalog: true, error: /synthetic catalog rejection/ },
  { name: 'external-runtime-supported', external: true },
  { name: 'bundled-runtime-qualified', bundle: true },
  { name: 'bundle-inside-prior-staging', bundle: true, insideStage: true },
  { name: 'public-input-missing-digest', external: true, publicOption: {}, error: /PUBLIC_CRYPTO/ },
  { name: 'public-input-external', external: true, publicMode: true },
  { name: 'public-input-bundled', bundle: true, publicMode: true },
];
const write = (root, relative, bytes) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
function snapshot(root) {
  const values = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else values.push([path.relative(root, file).replaceAll('\\', '/'), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return values.sort((a, b) => a[0].localeCompare(b[0]));
}
try {
  for (const item of cases) {
    const root = path.join(temp, item.name);
    const build = path.join(root, '.edith-build/desktop');
    const output = path.join(root, 'src-tauri/binaries/edith-backend-x86_64-pc-windows-msvc.exe');
    write(root, '.edith-build/desktop/previous-stage.txt', 'previous sole staged payload');
    write(root, 'src-tauri/binaries/edith-backend-x86_64-pc-windows-msvc.exe', 'previous sole executable');
    const oldOutput = fs.readFileSync(output);
    for (const [file, value] of Object.entries({
      'crypto/run_agent.py': '# inert fixture', 'crypto/requirements.txt': 'demo==1\n',
      'crypto/requirements.lock.txt': item.badLock ? 'demo>=1\n' : 'demo==1\n',
      'crypto/config/coin_permissions.json': '{}', 'crypto/config/demo_asset_modes.json': '{}',
      'crypto/config/observer_config.json': '{}', 'crypto/src/module.py': '# inert', 'crypto/templates/view.html': '<p>fixture</p>',
    })) write(root, file, value);
    if (item.badCrypto) fs.unlinkSync(path.join(root, 'crypto/run_agent.py'));
    let publicPin;
    if (item.publicMode) {
      const directory = path.join(root, 'approved-public');
      const names = ['requirements.lock.txt', 'requirements.txt', 'run_agent.py', 'templates/dashboard.html',
        'config/coin_permissions.json', 'config/demo_asset_modes.json', 'config/observer_config.json',
        ...Array.from({ length: 27 }, (_, index) => `src/module_${String(index).padStart(2, '0')}.py`)].sort();
      const files = names.map(relative => {
        const bytes = Buffer.from(relative.endsWith('.json') ? '{}\n' : relative.startsWith('requirements') ? 'demo==1\n' : '# inert public fixture\n');
        write(directory, relative, bytes);
        return { path: relative, sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      });
      const manifestPath = path.join(root, 'PUBLIC_CRYPTO_INPUT.json');
      const bytes = Buffer.from(`${JSON.stringify({ formatVersion: 1, kind: 'EDITH_PUBLIC_CRYPTO_SOURCE', files }, null, 2)}\n`);
      fs.writeFileSync(manifestPath, bytes);
      publicPin = { directory, manifestPath, manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      // Any accidental fallback must reject rather than silently using defaults.
      fs.rmSync(path.join(root, 'crypto'), { recursive: true });
    }
    const bundle = path.join(root, item.insideStage ? '.edith-build/desktop/resources/python' : 'source-python');
    if (item.bundle) { fs.mkdirSync(bundle, { recursive: true }); if (!item.missingExe) fs.writeFileSync(path.join(bundle, 'python.exe'), 'inert nonexecutable bytes'); }
    const oldStage = snapshot(build);
    const env = Object.freeze({ ...(item.bundle ? { EDITH_CRYPTO_PYTHON_BUNDLE_DIR: bundle } : {}), ...(item.external ? { EDITH_CRYPTO_EXTERNAL_PYTHON_PREREQUISITE: 'true' } : {}) });
    const calls = [];
    let verifierCalls = 0;
    const require = specifier => {
      assert.equal(specifier, './desktop-pkg-offline.cjs');
      return { preflight() {}, getPkgArguments({ entry, output: target }) { return ['synthetic-pkg', entry, target]; } };
    };
    require.resolve = specifier => path.join(root, 'inert-tools', specifier);
    const context = vm.createContext({
      fs, path, crypto, types, os: { tmpdir: () => temp }, Buffer, console: { log() {} },
      resolveDesktopOutputRole: outputRoleHelpers.resolveDesktopOutputRole,
      process: { cwd: () => root, execPath: 'synthetic-node', env, once() { throw new Error('unexpected exit cleanup registration'); } },
      createRequire: () => require, isExcludedPythonRuntime,
      readExactRequirementsLock(file) {
        if (item.publicMode) assert.ok(file.startsWith(`${root}${path.sep}.edith-sidecar-prepare-`), 'public verifier lock must come from captured own preparation');
        return readExactRequirementsLock(file);
      },
      stageCryptoResources(options) {
        if (item.publicMode) assert.ok(options.source.startsWith(`${root}${path.sep}.edith-sidecar-prepare-`), 'public stager must consume captured own preparation');
        return stageCryptoResources(options);
      },
      copyTreeStrict(source, destination, options) {
        if (item.failCopy) { fs.writeFileSync(path.join(destination, 'partial.txt'), 'partial own candidate'); throw new Error('synthetic copy rejection'); }
        return copyTreeStrict(source, destination, options);
      },
      safeStat: file => fs.lstatSync(file), canonical: value => Buffer.from(`${JSON.stringify(value)}\n`), FIXED_PKG_CONFIG: { bin: 'server.cjs' },
      async collectThirdPartyCatalog(project, entry) { assert.equal(project, root); if (item.failCatalog) throw new Error('synthetic catalog rejection'); return { bundleBytes: fs.readFileSync(entry) }; },
      disposeCatalog() {},
      stagePreparedCatalog() {},
      execFileSync(file, args, options) {
        assert.equal(options.windowsHide, true);
        calls.push({ file, args: Array.from(args), options });
        if (file === path.join(bundle, 'python.exe')) {
          verifierCalls++;
          if (item.failVerifier === verifierCalls) throw new Error('synthetic verifier rejection');
        } else if (args.includes('--bundle')) {
          const target = args.find(value => value.startsWith('--outfile=')).slice('--outfile='.length);
          assert.ok(target.startsWith(`${root}${path.sep}`)); fs.writeFileSync(target, 'synthetic server bytes');
        } else if (args[0] === 'synthetic-pkg') {
          fs.writeFileSync(args[2], 'synthetic new executable');
        } else throw new Error('unexpected process boundary');
        return Buffer.alloc(0);
      },
    }, { codeGeneration: { strings: false, wasm: false } });
    // import.meta is used only as a createRequire base, never evaluated or imported.
    const options = publicPin ? { publicCryptoSource: publicPin } : item.publicOption ? { publicCryptoSource: item.publicOption } : undefined;
    const executable = new vm.Script(`${common}\n${admission}\n${source.slice(start, end).replace('export async', 'async').replaceAll('import.meta.url', JSON.stringify(sourcePath))}\nbuildEdithSidecar(${options ? JSON.stringify(options) : ''});`, { filename: sourcePath });
    let error;
    try { await executable.runInContext(context, { timeout: 1000 }); } catch (caught) { error = caught; }
    try {
      if (item.error) {
        assert.match(error?.message ?? '', item.error);
        assert.deepEqual(snapshot(build), oldStage, 'prior staging must survive rejected preflight');
        assert.deepEqual(fs.readFileSync(output), oldOutput, 'sole output must survive rejected preflight');
        assert.equal(calls.some(call => call.args[0] === 'synthetic-pkg'), false);
      } else {
        assert.equal(error, undefined);
        if (item.publicMode) {
          assert.equal(snapshot(path.join(build, 'resources/crypto')).length, 34);
          assert.equal(fs.existsSync(path.join(root, 'crypto')), false, 'public mode never creates or requires original crypto/config');
        }
        if (item.external) { assert.equal(verifierCalls, 0); assert.ok(fs.existsSync(path.join(build, 'resources/python/EXTERNAL_RUNTIME_REQUIRED.txt'))); }
        else {
          assert.equal(verifierCalls, 2);
          assert.deepEqual(calls.filter(call => call.file === path.join(bundle, 'python.exe')).map(call => call.args.slice(0, 3)), [['-I', '-B', '-c'], ['-I', '-B', '-m']]);
          const marker = JSON.parse(fs.readFileSync(path.join(build, 'resources/python/EDITH_RUNTIME_VERIFIED.json'), 'utf8'));
          assert.equal(marker.lockSha256, crypto.createHash('sha256').update('demo==1\n').digest('hex'));
        }
      }
      console.log(`PASS ${item.name}`);
    } catch (caught) { failures.push(new Error(`${item.name}: ${caught.message}`, { cause: caught })); console.log(`FAIL ${item.name}: ${caught.message}`); }
  }
  let bytes = 0;
  function size(directory) { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) size(file); else bytes += fs.statSync(file).size; } }
  size(temp); assert.ok(bytes <= 64 * 1024 * 1024, 'fixture byte budget');
  if (failures.length) throw new AggregateError(failures, 'Sidecar delivery preflight regression');
  console.log(JSON.stringify({ status: 'PASS', scenarios: cases.length, actualChildren: 0, fixtureBytes: bytes, realStagingTouched: false }));
} finally {
  const relative = path.relative(fixtureParent, temp);
  assert.ok(relative.startsWith('sidecar-fixtures-') && !relative.includes(path.sep));
  const current = fs.lstatSync(temp);
  assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === tempIdentity.dev && current.ino === tempIdentity.ino);
  fs.rmSync(temp, { recursive: true, force: true });
}
