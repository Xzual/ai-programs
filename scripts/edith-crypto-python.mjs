import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isSupportedPython(candidate) {
  const probe = spawnSync(candidate, [
    '-I', '-B', '-c',
    'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)',
  ], {
    stdio: 'ignore',
    timeout: 5000,
    windowsHide: true,
  });
  return !probe.error && probe.status === 0;
}

function isVettedPython(candidate, lock, env) {
  if (!isFile(candidate) || !isFile(lock)) return false;
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-crypto-python-probe-'));
  try {
    const code = [
      'import sys, pathlib, importlib.metadata',
      'assert sys.version_info >= (3, 12)',
      "pins = [line.strip().split('==') for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if line.strip() and not line.lstrip().startswith('#')]",
      'assert pins and all(importlib.metadata.version(name) == version for name, version in pins)',
      'import numpy, pandas, requests, flask, ccxt, pandas_ta',
    ].join('\n');
    const probe = spawnSync(candidate, ['-I', '-B', '-c', code, lock], {
      stdio: 'ignore', timeout: 20000, windowsHide: true,
      env: { ...env, PYTHONDONTWRITEBYTECODE: '1', NUMBA_CACHE_DIR: cache },
    });
    return !probe.error && probe.status === 0;
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
}

export function resolveEdithCryptoPython(root = process.cwd(), env = process.env) {
  const explicit = env.EDITH_CRYPTO_PYTHON_PATH?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error('EDITH_CRYPTO_PYTHON_PATH must be an absolute local path.');
    }
    if (process.platform === 'win32' && /^(?:\\\\|\/\/)/.test(explicit)) {
      throw new Error('EDITH_CRYPTO_PYTHON_PATH must be local; UNC paths are not supported.');
    }
    const resolved = path.normalize(explicit);
    if (!isFile(resolved)) {
      throw new Error(`EDITH_CRYPTO_PYTHON_PATH does not name a Python executable: ${resolved}`);
    }
    if (!isSupportedPython(resolved)) {
      throw new Error(`EDITH_CRYPTO_PYTHON_PATH is not a supported Python 3.12+ executable: ${resolved}`);
    }
    return resolved;
  }

  const projectRoot = path.resolve(root);
  const packaged = env.EDITH_PACKAGED === 'true' || Boolean(env.EDITH_APP_RESOURCE_DIR);
  const cryptoRoot = packaged && env.EDITH_CRYPTO_RESOURCE_DIR
    ? path.resolve(env.EDITH_CRYPTO_RESOURCE_DIR) : path.join(projectRoot, 'crypto');
  const lock = path.join(cryptoRoot, 'requirements.lock.txt');
  // Packaged runs must never fall back to development/source-tree runtimes.
  const candidates = packaged
    ? [path.join(env.EDITH_APP_RESOURCE_DIR || path.dirname(cryptoRoot), 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3')]
    : process.platform === 'win32'
    ? [
        path.join(projectRoot, '.edith-build', 'desktop', 'resources', 'python', 'python.exe'),
        path.join(cryptoRoot, '.venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(cryptoRoot, '.venv', 'bin', 'python3'),
        path.join(cryptoRoot, '.venv', 'bin', 'python'),
      ];
  const local = candidates.find((candidate) => isVettedPython(candidate, lock, env));
  if (local) return local;

  throw new Error(
    'No vetted Crypto Python 3.12+ runtime matching requirements.lock.txt was found. Set EDITH_CRYPTO_PYTHON_PATH to an absolute vetted executable, or provision the local runtime.',
  );
}
