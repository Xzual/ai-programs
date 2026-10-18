import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writePortableManifest } from './package-edith-portable.mjs';
import { parseCandidateArguments, assertPublicInputSelector, captureFrontend, candidateEnvironment, runCandidate } from './build-edith-candidate.mjs';
import { buildCandidateTauriOverlay, mergeTauriConfig, runTauri, assertOrdinaryPath } from './build-edith-tauri.mjs';
import outputRoles from './desktop-output-role.cjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-candidate-test-'));
const rootIdentity = fs.statSync(root);
const id = 'a'.repeat(64);
const role = { kind: 'candidate', id };
let passed = 0;
let fixtureBytes = 0;
const test = (name, action) => { action(); passed++; };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); fixtureBytes += Buffer.byteLength(value); };
const paths = outputRoles.resolveDesktopOutputRole(root, role);
const base = { build: { beforeBuildCommand: 'npm run desktop:prepare', beforeDevCommand: 'unchanged', frontendDist: '../dist' },
  app: { security: { csp: 'unchanged-csp' }, windows: [{ width: 1400, decorations: false }] },
  bundle: { active: true, resources: { '../dist/': 'dist/', '../.edith-build/desktop/resources/crypto/': 'crypto/', 'extra-legacy/': 'extra/' }, externalBin: ['binaries/edith-backend'], icon: ['icon.ico'] } };
const protectedRoots = [path.join(root, '.edith-build', 'desktop'), path.join(root, 'dist'), path.join(root, 'src-tauri', 'binaries'), path.join(root, 'artifacts', 'desktop', 'portable')];
let protectedAttempts = 0;
const originals = new Map();
// Trap synthetic legacy paths before any underlying filesystem call. No denied real path is used.
for (const name of ['lstatSync', 'statSync', 'readFileSync', 'writeFileSync', 'mkdirSync', 'readdirSync', 'existsSync', 'rmSync', 'renameSync', 'copyFileSync']) {
  originals.set(name, fs[name]);
  fs[name] = function (...args) {
    for (const value of args.slice(0, name === 'renameSync' || name === 'copyFileSync' ? 2 : 1)) {
      if (typeof value === 'string' && protectedRoots.some(prefix => value.toLowerCase() === prefix.toLowerCase() || value.toLowerCase().startsWith(prefix.toLowerCase() + path.sep))) {
        protectedAttempts++; throw new Error('SYNTHETIC_LEGACY_PATH_TRAP');
      }
    }
    return originals.get(name).apply(fs, args);
  };
}
try {
  test('strict CLI phases', () => {
    for (const phase of ['native', 'portable', 'verify']) assert.equal(parseCandidateArguments([phase, '--id', id]).phase, phase);
    for (const args of [[], ['debug', '--id', id], ['native'], ['native', '--id', id.toUpperCase()], ['native', '--id', '../escape'],
      ['native', '--id', id, '--debug', 'yes'], ['native', '--id', id, '--target', 'other'], ['native', '--id', id, '--config', 'x'],
      ['native', '--id', id + '\n'], ['native', '--id', id + '\r\n'],
      ['native', '--id', id, '--id', id], ['prepare', '--id', id]]) assert.throws(() => parseCandidateArguments(args));
  });
  test('prepare exact required inputs', () => {
    const args = ['prepare', '--id', id];
    for (const flag of ['public-crypto-directory', 'public-crypto-manifest', 'frontend-directory', 'frontend-manifest', 'python-runtime']) args.push('--' + flag, path.join(root, flag));
    args.push('--public-crypto-sha256', 'b'.repeat(64), '--frontend-sha256', 'c'.repeat(64));
    assert.equal(parseCandidateArguments(args)['python-runtime'], path.join(root, 'python-runtime'));
    assert.throws(() => parseCandidateArguments([...args, '--unknown', 'x']));
  });
  test('selector guard precedes all protected input IO', () => {
    for (const prefix of protectedRoots) assert.throws(() => captureFrontend({ projectRoot: root, directory: prefix, manifestPath: prefix, manifestSha256: 'b'.repeat(64), candidateRoot: paths.candidateRoot }), /CANDIDATE_PROTECTED_INPUT/);
    for (const invalid of [path.join(root, 'x') + path.sep + '..' + path.sep + 'y', '\\\\server\\share\\x', path.join(root, 'x:stream')]) assert.throws(() => assertPublicInputSelector(root, invalid, paths.candidateRoot));
  });
  test('RFC7396 removes every original resource key', () => {
    const overlay = buildCandidateTauriOverlay(base, paths);
    for (const key of Object.keys(base.bundle.resources)) assert.equal(overlay.bundle.resources[key], null);
    const effective = mergeTauriConfig(base, overlay);
    assert.equal(Object.keys(effective.bundle.resources).length, 4);
    assert.deepEqual(Object.values(effective.bundle.resources).sort(), ['crypto/', 'dist/', 'python/', 'third-party/']);
    assert.deepEqual(effective.app, base.app);
    assert.deepEqual(effective.bundle.icon, base.bundle.icon);
    assert.equal(effective.build.beforeDevCommand, base.build.beforeDevCommand);
    assert.equal(path.posix.basename(effective.bundle.externalBin[0]), 'edith-backend');
    assert.deepEqual(base.bundle.externalBin, ['binaries/edith-backend']);
  });
  test('config shape rejects instead of guessing', () => {
    for (const broken of [{}, { ...base, bundle: { resources: [] } }, { ...base, bundle: { resources: { x: 42 } } }]) assert.throws(() => buildCandidateTauriOverlay(broken, paths));
  });
  test('native malformed args and selector/profile rejected before IO', () => {
    const noExec = () => { throw new Error('TOOL_MUST_NOT_RUN'); };
    for (const args of [['--candidate-id', id, '--debug'], ['--candidate-id', id + '\n'], ['--candidate-id', id + '\r\n'], ['--candidate-id', 'x'], ['--candidate-id=' + id]]) assert.throws(() => runTauri(args, { projectRoot: root, env: {}, exec: noExec }), /CANDIDATE_ARGUMENTS/);
    assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: { EDITH_DESKTOP_CANDIDATE_ID: 'b'.repeat(64) }, exec: noExec }), /MISMATCH/);
    assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: { PROFILE: 'debug' }, exec: noExec }), /RELEASE/);
  });
  const source = path.join(root, 'public-frontend');
  const manifestPath = path.join(root, 'frontend-manifest.json');
  const frontendRows = [{ path: '.vite/manifest.json', bytes: Buffer.from('{}\n') }, { path: 'index.html', bytes: Buffer.from('<html>public</html>') }];
  for (const row of frontendRows) write(path.join(source, ...row.path.split('/')), row.bytes);
  const manifest = { schemaVersion: 1, outputFiles: 2, outputBytes: frontendRows.reduce((n, row) => n + row.bytes.length, 0),
    outputs: frontendRows.map(row => ({ path: row.path, size: row.bytes.length, sha256: hash(row.bytes) })), staticRoot: 'ignored-audit-authority', status: 'NOT_TRUSTED_AS_APPROVAL' };
  const setManifest = object => { const bytes = JSON.stringify(object); write(manifestPath, bytes); return hash(bytes); };
  let digest = setManifest(manifest);
  const capture = (sha = digest) => captureFrontend({ projectRoot: root, directory: source, manifestPath, manifestSha256: sha, candidateRoot: paths.candidateRoot });
  test('real public frontend bytes captured; audit paths inert', () => { const files = capture(); assert.equal(files.size, 2); assert.deepEqual(files.get('index.html'), frontendRows[1].bytes); });
  test('wrong manifest digest rejects', () => assert.throws(() => capture('f'.repeat(64)), /DIGEST/));
  test('extra file and missing file reject', () => {
    write(path.join(source, 'extra.txt'), 'extra'); assert.throws(() => capture(), /EXTRA/); fs.unlinkSync(path.join(source, 'extra.txt'));
    fs.renameSync(path.join(source, 'index.html'), path.join(root, 'index-saved')); assert.throws(() => capture(), /MISSING/); fs.renameSync(path.join(root, 'index-saved'), path.join(source, 'index.html'));
  });
  test('changed frontend byte rejects', () => { write(path.join(source, 'index.html'), 'x'.repeat(frontendRows[1].bytes.length)); assert.throws(() => capture(), /BYTES/); write(path.join(source, 'index.html'), frontendRows[1].bytes); });
  test('manifest paths/schema/case/total bounds reject with matching digest', () => {
    for (const object of [{ ...manifest, schemaVersion: 2 }, { ...manifest, outputBytes: 1 },
      { ...manifest, outputs: [{ ...manifest.outputs[0], path: '../escape' }, manifest.outputs[1]] },
      { ...manifest, outputs: [manifest.outputs[1], { ...manifest.outputs[1], path: 'INDEX.HTML' }] },
      { ...manifest, outputs: [{ ...manifest.outputs[0], size: 129 * 1024 * 1024 }, manifest.outputs[1]] }]) {
      digest = setManifest(object); assert.throws(() => capture());
    }
    digest = setManifest(manifest);
  });
  test('hardlinked input rejects before content read', () => {
    const alias = path.join(root, 'input-hardlink'); fs.linkSync(path.join(source, 'index.html'), alias);
    try { assert.throws(() => capture(), /ALIAS/); } finally { fs.unlinkSync(alias); }
  });
  test('directory junction rejects before content walk', () => {
    const alias = path.join(root, 'input-junction'); fs.symlinkSync(source, alias, 'junction');
    try { assert.throws(() => captureFrontend({ projectRoot: root, directory: alias, manifestPath, manifestSha256: digest, candidateRoot: paths.candidateRoot }), /ALIAS/); } finally { fs.unlinkSync(alias); }
  });
  test('explicit env allowlist excludes unrelated/private selectors', () => {
    assert.deepEqual(candidateEnvironment({ PATH: 'literal', PKG_CACHE_PATH: 'cache', SECRET: 'never', EDITH_CRYPTO_PYTHON_BUNDLE_DIR: 'implicit', NODE_OPTIONS: 'unsafe', RUSTFLAGS: 'unsafe' }), { PATH: 'literal', PKG_CACHE_PATH: 'cache' });
  });
  test('explicit public isolation/budget/association env survives selection', () => {
    const publicEnvironment = { PIP_CONFIG_FILE: 'NUL', PIP_NO_INDEX: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_CACHE_DIR: path.join(root, 'pip-cache'), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
      CARGO_BUILD_JOBS: '1', EDITH_NATIVE_BUILD_ID: id, CARGO: path.join(root, 'toolchain', 'cargo.exe'),
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: path.join(root, 'tools', 'link.exe'),
      CC: 'cl.exe', CXX: 'cl.exe', AR: 'lib.exe', RC: 'rc.exe', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', NO_COLOR: '1' };
    assert.deepEqual(candidateEnvironment({ ...publicEnvironment, PRIVATE_KEY: 'never' }), publicEnvironment);
  });
  test('actual non-Windows host rejects before input IO', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: {}, exec: () => assert.fail('must not execute') }), /HOST_REQUIRED/);
    } finally { Object.defineProperty(process, 'platform', original); }
  });
  test('missing/relative Cargo selector rejects before IO', () => {
    for (const cargo of [undefined, 'cargo', 'relative/cargo.exe', '\\\\server\\share\\cargo.exe']) assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: { CARGO: cargo }, exec: () => assert.fail('must not execute') }), /CARGO_REQUIRED/);
  });
  test('target override rejects before Cargo or candidate input IO', () => {
    for (const override of [{ CARGO_BUILD_TARGET: 'other' }, { CARGO_TARGET_DIR: path.join(root, 'alternate-target') }]) assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: { CARGO: path.join(root, 'not-created', 'cargo.exe'), ...override }, exec: () => assert.fail('must not execute') }), /TARGET_OVERRIDE/);
  });
  write(path.join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify(base));
  fs.mkdirSync(paths.frontendDir, { recursive: true });
  for (const name of ['crypto', 'python', 'third-party']) fs.mkdirSync(path.join(paths.resourceDir, name), { recursive: true });
  write(paths.output, 'synthetic-backend-not-executable');
  test('native actual production branch, mock tool only, effective config', () => {
    const calls = [];
    const cargo = path.join(root, 'toolchain', 'cargo.exe');
    write(cargo, 'inert-not-executable');
    runTauri(['--candidate-id', id], { projectRoot: root, env: { CARGO_NET_OFFLINE: 'true', CARGO: cargo }, exec: (...args) => calls.push(args) });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1].slice(1), ['build', '--no-bundle', '--ci', '--runner', cargo, '--config', paths.tauriConfigPath, '--', '--frozen']);
    assert.ok(!calls[0][1].includes('--target'), 'host target/release remains the package source; no cross-target mirror');
    assert.equal(calls[0][2].env.EDITH_DESKTOP_CANDIDATE_ID, id);
    const effective = mergeTauriConfig(base, JSON.parse(fs.readFileSync(paths.tauriConfigPath, 'utf8')));
    assert.equal(Object.keys(effective.bundle.resources).length, 4); assert.deepEqual(effective.app, base.app);
  });
  test('existing overlay collision never overwrites', () => assert.throws(() => runTauri(['--candidate-id', id], { projectRoot: root, env: { CARGO: path.join(root, 'toolchain', 'cargo.exe') }, exec: () => assert.fail('must not execute') }), /EEXIST/));
  test('legacy default argv and remap behavior retained', () => {
    let call;
    runTauri(['--debug', '--config', 'legacy.json'], { projectRoot: root, env: { USERPROFILE: path.join(root, 'profile'), CARGO_ENCODED_RUSTFLAGS: '--old' }, exec: (...args) => { call = args; } });
    assert.deepEqual(call[1].slice(1), ['build', '--debug', '--config', 'legacy.json']);
    assert.equal(call[2].env.CARGO_ENCODED_RUSTFLAGS, ['--old', '--remap-path-prefix=' + root + '=/edith-src', '--remap-path-prefix=' + path.join(root, 'profile') + '=/build-user'].join('\x1f'));
  });
  await assert.rejects(runCandidate(['native', '--id', id], { projectRoot: root, env: { PROFILE: 'debug' } }), /RELEASE/); passed++;
  test('build.rs candidate validation precedes every legacy directory operation', () => {
    const rust = fs.readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
    const branch = rust.indexOf('if let Some(selector)');
    assert.ok(branch > 0 && branch < rust.indexOf('create_dir_all'));
    assert.ok(rust.indexOf('return;', branch) < rust.indexOf('create_dir_all'));
    assert.match(rust, /rerun-if-env-changed=EDITH_DESKTOP_CANDIDATE_ID/);
    assert.match(rust, /PROFILE/); assert.match(rust, /id.len\(\) == 64/);
  });
  test('Rust config admission uses real libraries before resource IO (source assertion only)', () => {
    const rust = fs.readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
    const main = rust.slice(rust.indexOf('fn main()'));
    assert.ok(main.indexOf('assert_candidate_config(&manifest_dir, id)') < main.indexOf('std::fs::symlink_metadata(&resource)'));
    assert.match(rust, /serde_json::from_slice/);
    assert.match(rust, /json_patch::merge\(&mut effective, &overlay\)/);
    assert.match(rust, /effective == expected/);
    assert.match(rust, /MAX_CONFIG_BYTES: usize = 1024 \* 1024/);
    assert.match(rust, /tauri.windows.conf.json/);
    const cargo = fs.readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    assert.match(cargo, /serde_json = "=1\.0\.151"/);
    assert.match(cargo, /json-patch = \{ version = "=3\.0\.1", default-features = false \}/);
  });
  // Missing candidate environment scoping must fail at the real consumers' OS sinks.
  // All payload, notice, crypto, lock and parity validators below remain production code.
  const environmentCases = [];
  const publicLock = fs.readFileSync(new URL('../crypto/requirements.lock.txt', import.meta.url));
  const noticeRoot = new URL('../node_modules/playwright-core/', import.meta.url);
  const cleanTemp = path.join(root, 'clean-env-temp');
  fs.mkdirSync(cleanTemp);
  function deliveryFixture(number, phase) {
    const project = path.join(root, 'clean-env-fixtures', String(number));
    const candidate = path.join(project, 'artifacts/desktop/candidates', id);
    const resources = path.join(candidate, 'stage/resources');
    const sidecar = Buffer.from('INERT_CLEAN_ENV_BACKEND');
    const bundle = Buffer.from('/* inert clean environment bundle */');
    write(path.join(project, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    write(path.join(project, 'crypto/requirements.lock.txt'), publicLock);
    write(path.join(project, 'src-tauri/target/release/edith.exe'), 'INERT_CLEAN_ENV_APP');
    write(path.join(project, 'src-tauri/target/release/edith-backend.exe'), sidecar);
    write(path.join(candidate, 'binaries/edith-backend-x86_64-pc-windows-msvc.exe'), sidecar);
    write(path.join(candidate, 'stage/server.cjs'), bundle);
    write(path.join(candidate, 'frontend/index.html'), '<html>inert clean environment</html>');
    for (const [file, bytes] of Object.entries({ 'run_agent.py': '# inert', 'requirements.txt': 'requests==2.34.2\n',
      'requirements.lock.txt': publicLock, 'config/coin_permissions.json': '{}', 'config/demo_asset_modes.json': '{}',
      'config/observer_config.json': '{}', 'src/fixture.py': '# inert', 'templates/fixture.html': '<html></html>' })) write(path.join(resources, 'crypto', file), bytes);
    write(path.join(resources, 'python/python.exe'), 'INERT_CLEAN_ENV_PYTHON');
    write(path.join(resources, 'python/EDITH_RUNTIME_VERIFIED.json'), JSON.stringify({ formatVersion: 1, lockSha256: hash(publicLock) }));
    const packageRoot = 'node_modules/playwright-core', payload = 'payload/' + packageRoot;
    const files = [['LICENSE', 'NOTICE'], ['browsers.json', 'CONTENT'], ['package.json', 'METADATA']].map(([name, purpose]) => {
      const bytes = fs.readFileSync(new URL(name, noticeRoot));
      write(path.join(resources, 'third-party', payload, name), bytes);
      return { path: payload + '/' + name, sourcePath: packageRoot + '/' + name, packageRoot, roles: [purpose], sha256: hash(bytes), sizeBytes: bytes.length };
    });
    const metadata = JSON.parse(fs.readFileSync(new URL('package.json', noticeRoot), 'utf8'));
    write(path.join(resources, 'third-party/manifest.json'), JSON.stringify({ formatVersion: 1, target: 'node22-win-x64',
      bundle: { sha256: hash(bundle), sizeBytes: bundle.length }, sidecar: { sha256: hash(sidecar), sizeBytes: sidecar.length },
      packages: [{ root: packageRoot, name: 'playwright-core', version: metadata.version, metadataPath: payload + '/package.json',
        sourcePaths: [payload + '/browsers.json'], noticePaths: [payload + '/LICENSE'], readmeFallback: false }], files }, null, 2) + '\n');
    const name = 'E.D.I.T.H.-1.2.3-windows-x64', portable = path.join(candidate, 'portable', name), zip = path.join(candidate, name + '.zip');
    if (phase === 'verify') {
      for (const name of ['crypto', 'python', 'third-party']) fs.cpSync(path.join(resources, name), path.join(portable, name), { recursive: true, errorOnExist: true });
      fs.cpSync(path.join(candidate, 'frontend'), path.join(portable, 'dist'), { recursive: true, errorOnExist: true });
      write(path.join(portable, 'edith.exe'), 'INERT_CLEAN_ENV_APP');
      write(path.join(portable, 'edith-backend.exe'), sidecar);
      writePortableManifest({ portable, version: '1.2.3' });
      write(zip, 'INERT_ARCHIVE_BOUNDARY_DATA');
      write(zip + '.sha256', hash(fs.readFileSync(zip)) + '  ' + path.basename(zip) + '\n');
    }
    return { project, portable, zip, name };
  }
  for (const [phase, failBoundary] of [['portable', null], ['portable', 'create'], ['verify', null], ['verify', 'inspect'], ['verify', 'extract']]) {
    const f = deliveryFixture(environmentCases.length, phase), previous = process.env;
    const parent = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32', TEMP: cleanTemp, TMP: cleanTemp,
      PIP_CONFIG_FILE: 'NUL', PIP_NO_INDEX: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_CACHE_DIR: path.join(cleanTemp, 'pip-cache'),
      PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', EDITH_NATIVE_BUILD_ID: id, EDITH_TEST_UNAUTHORIZED_SENTINEL: 'synthetic-only' };
    const originalChild = childProcess.execFileSync, originalLog = console.log;
    const observed = [];
    let caught, restored = false;
    try {
      process.env = parent;
      console.log = () => {};
      childProcess.execFileSync = (file, args, options) => {
        assert.equal(file, 'powershell.exe');
        const script = args.at(-1);
        const boundary = script.includes('CreateEntryFromFile') ? 'create' : script.includes('ExtractToDirectory') ? 'extract' : options?.env?.EDITH_ZIP ? 'inspect' : undefined;
        assert.ok(boundary, 'Unexpected child execution is forbidden');
        const literalFields = ['TEMP', 'TMP', 'PIP_CONFIG_FILE', 'PIP_NO_INDEX', 'PIP_DISABLE_PIP_VERSION_CHECK', 'PIP_CACHE_DIR', 'PYTHONNOUSERSITE', 'PYTHONDONTWRITEBYTECODE'];
        observed.push({ boundary, unauthorizedAbsent: !Object.hasOwn(options.env, 'EDITH_TEST_UNAUTHORIZED_SENTINEL'),
          literalsRetained: literalFields.every(key => options.env[key] === parent[key]), selectedCandidateRetained: options.env.EDITH_DESKTOP_CANDIDATE_ID === id });
        if (boundary === failBoundary) throw new Error('SYNTHETIC_ARCHIVE_BOUNDARY_FAILURE');
        if (boundary === 'create') { write(options.env.EDITH_PORTABLE_ZIP, 'INERT_ARCHIVE_BOUNDARY_DATA'); return Buffer.alloc(0); }
        if (boundary === 'extract') { fs.cpSync(f.portable, path.join(options.env.EDITH_PORTABLE_DEST, f.name), { recursive: true, errorOnExist: true }); return Buffer.alloc(0); }
        return '1';
      };
      syncBuiltinESMExports();
      try { await runCandidate([phase, '--id', id], { projectRoot: f.project, env: parent }); } catch (error) { caught = error; }
      restored = process.env === parent && parent.EDITH_TEST_UNAUTHORIZED_SENTINEL === 'synthetic-only';
    } finally {
      process.env = previous;
      childProcess.execFileSync = originalChild;
      syncBuiltinESMExports();
      console.log = originalLog;
    }
    const expectedBoundaries = phase === 'portable' ? ['create'] : failBoundary === 'inspect' ? ['inspect'] : ['inspect', 'extract'];
    const checks = { phase, outcome: failBoundary ?? 'success', boundaries: observed.map(row => row.boundary),
      unauthorizedAbsent: observed.length > 0 && observed.every(row => row.unauthorizedAbsent),
      literalsRetained: observed.length > 0 && observed.every(row => row.literalsRetained && row.selectedCandidateRetained), parentRestored: restored,
      expectedOutcome: failBoundary ? caught?.message === 'SYNTHETIC_ARCHIVE_BOUNDARY_FAILURE' : caught === undefined };
    environmentCases.push(checks);
    if (!observed.length && caught) throw caught;
    assert.deepEqual(checks.boundaries, expectedBoundaries, 'Actual production consumer boundaries must be reached');
  }
  console.log(JSON.stringify({ candidateConsumerEnvironment: environmentCases }));
  for (const check of environmentCases) {
    assert.ok(check.unauthorizedAbsent, 'Candidate consumer copied unauthorized parent environment');
    assert.ok(check.literalsRetained, 'Candidate consumer lost required isolated environment');
    assert.ok(check.parentRestored, 'Candidate consumer did not restore parent environment');
    assert.ok(check.expectedOutcome, 'Candidate consumer success/error behavior changed');
    passed++;
  }
  assert.equal(protectedAttempts, 0);
  assert.ok(fixtureBytes < 64 * 1024 * 1024);
  console.log(JSON.stringify({ status: 'PASS', tests: passed, protectedAttempts, fixtureBytes, toolCallsMocked: true, actualToolChildren: 0, rustCompile: 'UNRUN', prepareSidecarEndToEnd: 'UNRUN' }));
} finally {
  for (const [name, original] of originals) fs[name] = original;
  const now = fs.lstatSync(root);
  assert.ok(now.isDirectory() && !now.isSymbolicLink() && now.dev === rootIdentity.dev && now.ino === rootIdentity.ino);
  assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
  fs.rmSync(root, { recursive: true });
}
