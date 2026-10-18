import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute only the real verifier block with an inert child-process boundary.
// Never import the sidecar entry point: its top-level code performs a build.
const sourcePath = fileURLToPath(new URL('./build-edith-sidecar.mjs', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const branch = source.indexOf('const externalPythonPrerequisite =');
const start = source.indexOf('  const pythonBundleDir =', branch);
const end = source.indexOf('  copyTreeStrict(pythonBundleDir, pythonResourceDir,', start);
assert.ok(branch >= 0 && start > branch && end > start, 'verifier block boundaries must exist');
const verifier = new vm.Script(source.slice(start, end), { filename: sourcePath });
const root = path.resolve('synthetic-sidecar-argv-project');
const bundle = path.join(root, 'qualified-python');
const python = path.join(bundle, 'python.exe');
const lock = path.join(root, 'crypto', 'requirements.lock.txt');

function execute({ failAt = 0, directory = true, executable = true } = {}) {
  const calls = [];
  const failure = new Error('synthetic child failure');
  const context = vm.createContext({
    root, pythonBundleSetting: bundle, pythonLock: lock, path,
    fs: Object.freeze({
      realpathSync(value) { assert.equal(value, bundle); return bundle; },
      existsSync(value) { assert.equal(value, python); return executable; },
      statSync(value) {
        assert.ok(value === bundle || value === python);
        return { isDirectory: () => value === bundle && directory, isFile: () => value === python && executable };
      },
    }),
    execFileSync(file, args, options) {
      calls.push({ file, args: Array.from(args), options: { ...options } });
      if (calls.length === failAt) throw failure;
      return Buffer.alloc(0);
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  let error;
  try { verifier.runInContext(context, { timeout: 100 }); } catch (caught) { error = caught; }
  return { calls, error, failure };
}

const normal = execute();
assert.equal(normal.error, undefined);
assert.equal(normal.calls.length, 2);
const [pins, pip] = normal.calls;
const argvFailures = [];
function checkArgv(label, actual, expected) {
  try { assert.deepEqual(actual, expected); } catch (error) { argvFailures.push(new Error(label, { cause: error })); }
}
// These are observed arguments passed by the production code, not a duplicate builder.
checkArgv('version verifier must disable input bytecode', pins.args.slice(0, -2), ['-I', '-B', '-c']);
assert.equal(typeof pins.args.at(-2), 'string');
assert.ok(pins.args.at(-2).includes('import importlib.metadata, pathlib, re, sys'));
assert.ok(pins.args.at(-2).includes('Pinned runtime verification failed: '));
assert.equal(pins.args.at(-1), lock);
checkArgv('pip check must disable input bytecode', pip.args, ['-I', '-B', '-m', 'pip', 'check']);
for (const call of normal.calls) {
  assert.equal(call.file, python);
  assert.deepEqual(call.options, { cwd: root, stdio: 'inherit', windowsHide: true });
}

for (const failAt of [1, 2]) {
  const result = execute({ failAt });
  assert.equal(result.error, result.failure, 'child error must propagate unchanged');
  assert.equal(result.calls.length, failAt, 'failure must stop further verifier commands');
}
for (const invalid of [{ directory: false }, { executable: false }]) {
  const result = execute(invalid);
  assert.equal(result.calls.length, 0);
  assert.equal(result.error?.message, 'The vetted Python bundle must contain python.exe at its root.');
}
if (argvFailures.length) throw new AggregateError(argvFailures, 'Production Python argv does not protect sealed input');
console.log('PASS: 5 verifier scenarios; actual argv, options, child failure propagation and input guards; no child spawned.');
