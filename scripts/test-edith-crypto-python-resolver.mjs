import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const original = { ...process.env };
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-python-resolver-test-'));
try {
  for (const key of ['EDITH_CRYPTO_PYTHON_PATH', 'EDITH_PACKAGED', 'EDITH_APP_RESOURCE_DIR', 'EDITH_CRYPTO_RESOURCE_DIR']) delete process.env[key];
  const vetted = path.join(root, '.edith-build', 'desktop', 'resources', 'python', 'python.exe');
  assert.equal(resolveEdithCryptoPython(root), vetted, 'repo-relative vetted runtime is preferred to broken venv');
  process.env.EDITH_CRYPTO_PYTHON_PATH = vetted;
  assert.equal(resolveEdithCryptoPython(root), vetted);
  for (const bad of ['relative/python.exe', '\\\\server\\python.exe', path.join(fixture, 'missing.exe'), path.join(root, 'crypto', '.venv', 'Scripts', 'python.exe')]) {
    process.env.EDITH_CRYPTO_PYTHON_PATH = bad;
    assert.throws(() => resolveEdithCryptoPython(root));
  }
  delete process.env.EDITH_CRYPTO_PYTHON_PATH;
  assert.throws(() => resolveEdithCryptoPython(fixture), /No vetted Crypto/);
  process.env.EDITH_PACKAGED = 'true';
  assert.throws(() => resolveEdithCryptoPython(root), /No vetted Crypto/, 'packaged mode cannot silently use development .edith-build fallback');
  process.env.EDITH_APP_RESOURCE_DIR = path.join(root, '.edith-build', 'desktop', 'resources');
  process.env.EDITH_CRYPTO_RESOURCE_DIR = path.join(process.env.EDITH_APP_RESOURCE_DIR, 'crypto');
  assert.equal(resolveEdithCryptoPython(root), vetted, 'packaged resource sibling is independently vetted');
  const source = fs.readFileSync(path.join(root, 'scripts', 'edith-crypto-python.mjs'), 'utf8');
  assert.equal(source.includes('C:\\Users'), false);
  console.log('PASS deterministic vetted dev/runtime selection, native imports/pins, explicit validation and packaged separation');
} finally {
  process.env = original;
  fs.rmSync(fixture, { recursive: true, force: true });
}
