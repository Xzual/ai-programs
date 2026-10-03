import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const lock = path.join(root, 'crypto', 'requirements.lock.txt');
const pins = readExactRequirementsLock(lock);
const python = resolveEdithCryptoPython(root);
const verification = String.raw`
import importlib.metadata, json, pathlib, sys
pins=[]
for raw in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    line=raw.strip()
    if line and not line.startswith('#'):
        name,version=line.split('==',1)
        pins.append((name,version))
errors=[]
for name,expected in pins:
    try: actual=importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError: actual=None
    if actual != expected: errors.append({'name':name,'expected':expected,'actual':actual})
if errors: raise SystemExit(json.dumps(errors))
`;
const versions = spawnSync(python, ['-I', '-c', verification, lock], {
  cwd: root, windowsHide: true, encoding: 'utf8',
});
assert.equal(versions.status, 0, versions.stderr || versions.stdout);
const imports = spawnSync(python, [path.join(root, 'crypto', 'test_packaged_import_closure.py')], {
  cwd: root, windowsHide: true, encoding: 'utf8',
});
assert.equal(imports.status, 0, imports.stderr || imports.stdout);
console.log(JSON.stringify({ pass: true, exactPins: pins.length, importClosure: true }, null, 2));
