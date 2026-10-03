import fs from 'node:fs';
import path from 'node:path';
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
    '-c',
    'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)',
  ], {
    stdio: 'ignore',
    timeout: 5000,
    windowsHide: true,
  });
  return !probe.error && probe.status === 0;
}

export function resolveEdithCryptoPython(root = process.cwd()) {
  const explicit = process.env.EDITH_CRYPTO_PYTHON_PATH?.trim();
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

  const cryptoRoot = path.join(path.resolve(root), 'crypto');
  const candidates = process.platform === 'win32'
    ? [path.join(cryptoRoot, '.venv', 'Scripts', 'python.exe')]
    : [
        path.join(cryptoRoot, '.venv', 'bin', 'python3'),
        path.join(cryptoRoot, '.venv', 'bin', 'python'),
      ];
  const local = candidates.find((candidate) => isFile(candidate) && isSupportedPython(candidate));
  if (local) return local;

  throw new Error(
    'No supported Crypto Python runtime was found. Set EDITH_CRYPTO_PYTHON_PATH to an absolute vetted Python executable, or provision crypto/.venv for this platform.',
  );
}
