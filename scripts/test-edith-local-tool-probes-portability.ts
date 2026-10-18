/** Actual compiled module, synthetic filesystem/environment only. No application probes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { LocalToolProbe } from '../src/edith/localToolProbes';

const sourcePath = path.resolve('src/edith/localToolProbes.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: 'localToolProbes.ts', reportDiagnostics: true,
});
assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
// Generic detection of ANY fixed per-user Ollama literal; no developer username in this test.
const fixedUserInstall = /[a-z]:\\Users\\[^\\\r\n'"]+\\AppData\\Local\\Programs\\Ollama\\ollama\.exe/i;
for (const text of [source, compiled.outputText]) assert.equal(fixedUserInstall.test(text.replace(/\\\\/g, '\\')), false, 'Source and emitted module must not pin a named user install');

type FileState = 'file' | 'directory' | 'exists-error' | 'stat-error';
type Service = { list(): LocalToolProbe[]; get(id: LocalToolProbe['id']): LocalToolProbe | undefined };
const common = 'C:\\Program Files\\Ollama\\ollama.exe';
const profile = 'D:\\Profiles\\DifferentUser\\AppData\\Local';
const perUser = path.win32.join(profile, 'Programs', 'Ollama', 'ollama.exe');
const pathRoot = 'E:\\FixtureTools';
const onPath = path.win32.join(pathRoot, 'ollama.EXE');
const rows: Array<Record<string, unknown>> = [];

function fixture(options: { env?: Record<string, string | undefined>; files?: Record<string, FileState>; platform?: 'win32' | 'linux'; playwright?: boolean } = {}) {
  const platform = options.platform ?? 'win32', api = platform === 'win32' ? path.win32 : path.posix;
  const cwd = platform === 'win32' ? 'C:\\FixtureWorkspace' : '/fixture-workspace';
  const env: Record<string, string | undefined> = { PATH: platform === 'win32' ? pathRoot : '/fixture-bin', PATHEXT: '.EXE;.CMD;.BAT', ...options.env };
  const files = new Map(Object.entries(options.files ?? {}).map(([name, state]) => [api.normalize(name), state]));
  const calls: Array<{ operation: string; value: string }> = [];
  const forbidden = { module: 0, filesystem: 0, process: 0, environment: 0, network: 0, timer: 0, operatingSystem: 0 };
  const fail = (kind: keyof typeof forbidden, name: string): never => { forbidden[kind]++; throw new Error(`FORBIDDEN_${kind}:${name}`); };
  const mockFs = new Proxy({
    existsSync(name: string) {
      assert.equal(typeof name, 'string'); calls.push({ operation: 'exists', value: name });
      const state = files.get(api.normalize(name)); if (state === 'exists-error') throw new Error('SYNTHETIC_EXISTS_ERROR');
      return state !== undefined;
    },
    statSync(name: string) {
      calls.push({ operation: 'stat', value: name }); const state = files.get(api.normalize(name));
      if (!state || state === 'stat-error') throw new Error('SYNTHETIC_STAT_ERROR');
      return Object.freeze({ isFile: () => state === 'file' });
    },
  }, { get(target, name) { if (name === '__esModule') return false; if (name === 'existsSync' || name === 'statSync') return target[name]; return fail('filesystem', String(name)); } });
  const mockOs = new Proxy({ platform: () => platform }, { get(target, name) { if (name === '__esModule') return false; if (name === 'platform') return target.platform; return fail('operatingSystem', String(name)); } });
  // path arithmetic is pure. Resolve always receives the synthetic cwd, never a host cwd.
  const safePath = (flavor: typeof path.win32, base: string) => ({ ...flavor, resolve: (...parts: string[]) => flavor.resolve(base, ...parts), toNamespacedPath: () => fail('filesystem', 'toNamespacedPath') });
  const mockPath = { ...safePath(api, cwd), win32: safePath(path.win32, 'C:\\FixtureWorkspace'), posix: safePath(path.posix, '/fixture-workspace') };
  const mockRequire = Object.assign((name: string) => {
    calls.push({ operation: 'require', value: name });
    if (name === 'node:fs') return mockFs; if (name === 'node:os') return mockOs; if (name === 'node:path') return mockPath;
    return fail('module', name);
  }, { resolve(name: string, lookupOptions: { paths: string[] }) {
    calls.push({ operation: 'resolve', value: name }); if (name !== 'playwright') return fail('module', `resolve:${name}`);
    if (!lookupOptions || !Array.isArray(lookupOptions.paths)) return fail('module', 'resolve-options');
    assert.equal(JSON.stringify(lookupOptions.paths), JSON.stringify([cwd]));
    if (!fixturePlaywright) throw new Error('SYNTHETIC_DEPENDENCY_MISSING');
    return api.join(cwd, 'synthetic-node-modules', 'playwright', 'index.js');
  } });
  const fixturePlaywright = options.playwright ?? false;
  const mockEnv = new Proxy(env, { get(target, name) {
    if (!['PATH', 'PATHEXT', 'LOCALAPPDATA', 'CADQUERY_PYTHON', 'EDITH_CADQUERY_PYTHON'].includes(String(name))) return fail('environment', String(name));
    return target[name as keyof typeof target];
  }, set: (_target, name) => fail('environment', `write:${String(name)}`) });
  const mockProcess = new Proxy({ env: mockEnv, cwd: () => { calls.push({ operation: 'cwd', value: cwd }); return cwd; } }, {
    get(target, name) { if (name === 'env' || name === 'cwd') return target[name]; return fail('process', String(name)); },
    set: (_target, name) => fail('process', `write:${String(name)}`),
  });
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({ module, exports: module.exports, require: mockRequire, process: mockProcess,
    fetch: () => fail('network', 'fetch'), XMLHttpRequest: () => fail('network', 'XMLHttpRequest'), WebSocket: () => fail('network', 'WebSocket'),
    setTimeout: () => fail('timer', 'setTimeout'), setInterval: () => fail('timer', 'setInterval'),
    console: { log: () => fail('process', 'console'), error: () => fail('process', 'console') } });
  new vm.Script(compiled.outputText, { filename: 'actual-localToolProbes.cjs' }).runInContext(context, { timeout: 1000 });
  const Constructor = module.exports.LocalToolProbeService as new () => Service; assert.equal(typeof Constructor, 'function');
  const service = new Constructor(), singleton = module.exports.localToolProbeService as Service;
  const safe = () => {
    assert.ok(Object.values(forbidden).every(count => count === 0), JSON.stringify(forbidden));
    assert.ok(calls.filter(call => call.operation === 'require').every(call => ['node:fs', 'node:os', 'node:path'].includes(call.value)));
  };
  return { service, singleton, calls, safe };
}

function run(name: string, options: Parameters<typeof fixture>[0], expected?: string) {
  const current = fixture(options), result = current.service.get('ollama'); assert.ok(result);
  assert.equal(result.executablePath, expected); assert.equal(result.status, expected ? 'detected' : 'missing');
  assert.equal(result.detectionMethod, 'service_url_only'); assert.equal(result.safeToProbe, true); assert.equal(result.startsProcess, false);
  current.safe(); rows.push({ scenario: name, status: result.status, syntheticOnly: true, startsProcess: false });
  return current;
}

const priority = run('different_user_install_precedes_common_and_PATH', { env: { LOCALAPPDATA: profile }, files: { [perUser]: 'file', [common]: 'file', [onPath]: 'file' } }, perUser);
assert.equal(priority.calls.find(call => call.operation === 'exists' && /ollama/i.test(call.value))?.value, perUser);
assert.equal(priority.calls.some(call => call.operation === 'exists' && [common, onPath].includes(call.value)), false);
const fallback = run('common_install_precedes_PATH', { env: { LOCALAPPDATA: profile }, files: { [common]: 'file', [onPath]: 'file' } }, common);
const ollamaLookups = fallback.calls.filter(call => call.operation === 'exists' && /ollama/i.test(call.value)).map(call => call.value);
assert.deepEqual(ollamaLookups, [perUser, common]);
run('PATH_fallback_after_missing_per_user_and_common', { env: { LOCALAPPDATA: profile }, files: { [onPath]: 'file' } }, onPath);
run('PATH_PATHEXT_fallback_preserved', { env: { LOCALAPPDATA: profile, PATHEXT: '.CMD;.EXE' }, files: { [path.win32.join(pathRoot, 'ollama.CMD')]: 'file' } }, path.win32.join(pathRoot, 'ollama.CMD'));
for (const state of ['directory', 'exists-error', 'stat-error'] as const) run(`per_user_${state}_falls_through`, { env: { LOCALAPPDATA: profile }, files: { [perUser]: state, [common]: 'file' } }, common);
for (const state of ['directory', 'exists-error', 'stat-error'] as const) run(`common_${state}_falls_through_to_PATH`, { files: { [common]: state, [onPath]: 'file' } }, onPath);
run('no_executable_is_honest_missing', {});
run('missing_PATH_still_detects_common', { env: { PATH: undefined }, files: { [common]: 'file' } }, common);
run('blank_PATH_no_executable_is_missing', { env: { PATH: '' } });
run('missing_PATHEXT_retains_default_extension_order', { env: { PATHEXT: undefined }, files: { [onPath]: 'file' } }, onPath);

const invalidRoots: Array<string | undefined> = [undefined, '', ' ', '\t', 'relative', 'relative\\Local', '\\root-relative', '/root-relative', 'C:drive-relative',
  '"D:\\Profiles\\Other\\Local"', ' D:\\Profiles\\Other\\Local', 'D:\\Profiles\\Other\\Local ', 'D:\\Bad<Root', 'D:\\Bad>Root', 'D:\\Bad|Root', 'D:\\Bad?Root', 'D:\\Bad*Root',
  'D:\\Bad:Root', 'D:\\Bad\u0000Root', 'D:\\Bad\nRoot', '\\\\server', '\\\\server\\', '\\\\.\\device', '\\\\?\\D:\\Device'];
for (let index = 0; index < invalidRoots.length; index++) {
  const current = run(`invalid_localappdata_${index}_uses_only_common_fallback`, { env: { LOCALAPPDATA: invalidRoots[index] }, files: { [common]: 'file' } }, common);
  const lookups = current.calls.filter(call => call.operation === 'exists' && /ollama/i.test(call.value));
  assert.deepEqual(lookups.map(call => call.value), [common], 'Invalid LOCALAPPDATA must not yield a relative or malformed per-user candidate');
}
for (const root of ['F:\\PortableProfile\\Local', 'F:/PortableProfile/Local', '\\\\fixture-server\\profiles\\Other\\Local', 'F:\\']) {
  const executable = path.win32.join(root, 'Programs', 'Ollama', 'ollama.exe');
  run('valid_absolute_drive_or_UNC_root', { env: { LOCALAPPDATA: root }, files: { [executable]: 'file' } }, executable);
}
const nonWindows = run('non_windows_ignores_windows_LOCALAPPDATA', { platform: 'linux', env: { LOCALAPPDATA: profile }, files: { [perUser]: 'file', '/fixture-bin/ollama': 'file' } }, '/fixture-bin/ollama');
assert.equal(nonWindows.calls.some(call => call.operation === 'exists' && call.value === perUser), false);

const defaults = fixture(), catalog = defaults.service.list();
assert.equal(JSON.stringify(catalog.map(item => item.id)), JSON.stringify(['blender', 'freecad', 'cadquery', 'tesseract', 'openfoam', 'playwright', 'ollama']));
for (const item of catalog) {
  assert.equal(item.safeToProbe, true); assert.equal(item.startsProcess, false); assert.ok(item.label && item.notes && item.requiredFor.length);
  assert.equal(item.status, item.id === 'ollama' ? 'missing' : 'configuration_required');
  assert.equal(JSON.stringify(defaults.service.get(item.id)), JSON.stringify(item));
}
assert.equal(defaults.service.get('unknown' as LocalToolProbe['id']), undefined);
assert.equal(JSON.stringify(defaults.singleton.list()), JSON.stringify(catalog)); defaults.safe();
const allFiles = { 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe': 'file', 'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe': 'file',
  'C:\\Program Files\\Tesseract-OCR\\tesseract.exe': 'file', [path.win32.join(pathRoot, 'foamVersion.EXE')]: 'file' } as const;
const others = fixture({ files: allFiles, playwright: true, env: { CADQUERY_PYTHON: 'C:\\Synthetic\\first-python.exe', EDITH_CADQUERY_PYTHON: 'C:\\Synthetic\\second-python.exe' } });
for (const id of ['blender', 'freecad', 'tesseract', 'openfoam', 'playwright', 'cadquery'] as const) assert.equal(others.service.get(id)?.status, 'detected');
assert.equal(others.service.get('cadquery')?.executablePath, 'C:\\Synthetic\\first-python.exe');
assert.equal(others.service.get('cadquery')?.detectionMethod, 'env_hint'); assert.equal(others.service.get('playwright')?.detectionMethod, 'node_dependency');
assert.equal(others.calls.some(call => call.value.includes('python.exe')), false, 'CadQuery remains an env hint, not an executable/file probe'); others.safe();
const alternate = fixture({ env: { EDITH_CADQUERY_PYTHON: 'C:\\Synthetic\\alternate-python.exe' } });
assert.equal(alternate.service.get('cadquery')?.executablePath, 'C:\\Synthetic\\alternate-python.exe'); alternate.safe();
const baselineFixture = fixture({ files: allFiles, playwright: true });
const withUserFixture = fixture({ files: { ...allFiles, [perUser]: 'file' }, playwright: true, env: { LOCALAPPDATA: profile } });
const baselineOther = baselineFixture.service.list().filter(item => item.id !== 'ollama');
const withUserOther = withUserFixture.service.list().filter(item => item.id !== 'ollama');
assert.equal(JSON.stringify(withUserOther), JSON.stringify(baselineOther), 'LOCALAPPDATA change must preserve every other probe DTO');
baselineFixture.safe(); withUserFixture.safe();
rows.push({ scenario: 'catalog_singleton_list_get_other_tool_semantics_preserved', syntheticOnly: true, startsProcess: false });
console.log(JSON.stringify({ success: true, checks: rows.length, actualCompiledModule: true, syntheticWindowsAndPosixOnly: true,
  subjectFileReads: ['src/edith/localToolProbes.ts'], realApplicationDetection: false, realProcessStarts: 0, networkRequests: 0, configOrDatabaseAccess: false, rows }));
