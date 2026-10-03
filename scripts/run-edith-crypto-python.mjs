import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonPath = resolveEdithCryptoPython(root);
const args = process.argv.slice(2);

if (args.length === 0) {
  throw new Error('Expected a Python module or script argument.');
}

const result = spawnSync(pythonPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Crypto Python exited from signal ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
