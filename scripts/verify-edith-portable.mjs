import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { assertInside, assertSafeRelative, findDeveloperPathLeaks, listFilesStrict, PORTABLE_FORMAT, sha256, validateZipEntries } from './portable-edith-lib.mjs';
import { assertPackagedCryptoResources } from './stage-edith-crypto-resources.mjs';

const root = path.resolve(process.cwd());
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactRoot = assertInside(root, path.join(root, 'artifacts', 'desktop'), 'artifact directory');
const name = `E.D.I.T.H.-${pkg.version}-windows-x64`;
const portable = assertInside(artifactRoot, path.join(artifactRoot, 'portable', name), 'portable directory');
const zip = assertInside(artifactRoot, path.join(artifactRoot, `${name}.zip`), 'portable ZIP');

function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.formatVersion !== PORTABLE_FORMAT || manifest.product !== 'E.D.I.T.H.' || manifest.platform !== 'windows-x64') throw new Error('Portable manifest identity is invalid.');
  const declared = new Set();
  for (const entry of manifest.files) {
    const relative = assertSafeRelative(entry.path, 'manifest path');
    const file = assertInside(directory, path.join(directory, relative), 'manifest file');
    if (declared.has(relative) || !fs.statSync(file).isFile() || fs.statSync(file).size !== entry.size || sha256(file) !== entry.sha256) throw new Error(`Manifest mismatch: ${relative}`);
    declared.add(relative);
  }
  const actual = listFilesStrict(directory).map(({ relative }) => relative).filter((value) => !['manifest.json', 'SHA256SUMS.txt'].includes(value));
  if (actual.length !== declared.size || actual.some((value) => !declared.has(value))) throw new Error('Portable payload contains undeclared or missing files.');
  for (const required of ['edith.exe', 'edith-backend.exe', 'dist/index.html', 'crypto/run_agent.py', 'python/python.exe']) if (!fs.existsSync(path.join(directory, required))) throw new Error(`Required portable file missing: ${required}`);
  assertPackagedCryptoResources(path.join(directory, 'crypto'));
  const leaks = findDeveloperPathLeaks(directory);
  if (leaks.length) throw new Error(`Developer-specific absolute paths found: ${leaks.join(', ')}`);
  return manifest.files.length;
}

if (!fs.existsSync(portable) || !fs.existsSync(zip) || !fs.existsSync(`${zip}.sha256`)) throw new Error('Portable directory, ZIP, or hash sidecar is missing.');
const files = verify(portable);
const expected = fs.readFileSync(`${zip}.sha256`, 'utf8').match(/^([a-f0-9]{64})\s{2}/i)?.[1]?.toLowerCase();
if (!expected || sha256(zip) !== expected) throw new Error('Portable ZIP hash mismatch.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-portable-'));
try {
  validateZipEntries(zip, temp);
  const extractZip = String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($env:EDITH_PORTABLE_ZIP, $env:EDITH_PORTABLE_DEST)
`;
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', extractZip], {
    env: { ...process.env, EDITH_PORTABLE_ZIP: zip, EDITH_PORTABLE_DEST: temp },
    windowsHide: true,
  });
  verify(path.join(temp, name));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: 'PASS', portable, zip, zipSha256: expected, files }, null, 2));
