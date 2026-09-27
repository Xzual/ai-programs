import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { assertCryptoResourcesSafe, assertInside, copyTreeStrict, findDeveloperPathLeaks, manifestFor, sha256 } from './portable-edith-lib.mjs';

const root = path.resolve(process.cwd());
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = assertInside(root, path.join(root, 'src-tauri', 'target', 'release'), 'release directory');
const artifactRoot = assertInside(root, path.join(root, 'artifacts', 'desktop'), 'artifact directory');
const name = `E.D.I.T.H.-${pkg.version}-windows-x64`;
const portable = assertInside(artifactRoot, path.join(artifactRoot, 'portable', name), 'portable directory');
const zip = assertInside(artifactRoot, path.join(artifactRoot, `${name}.zip`), 'portable ZIP');
const app = path.join(release, 'edith.exe');
const sidecar = path.join(release, 'edith-backend.exe');
for (const required of [app, sidecar, path.join(root, 'dist', 'index.html')]) {
  if (!fs.existsSync(required)) throw new Error(`Required release file is missing: ${required}`);
}

fs.rmSync(portable, { recursive: true, force: true });
fs.mkdirSync(portable, { recursive: true });
fs.copyFileSync(app, path.join(portable, 'edith.exe'), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(sidecar, path.join(portable, 'edith-backend.exe'), fs.constants.COPYFILE_EXCL);
copyTreeStrict(path.join(root, 'dist'), path.join(portable, 'dist'));
const staged = path.join(root, '.edith-build', 'desktop', 'resources');
const stagedCrypto = path.join(staged, 'crypto');
const stagedPython = path.join(staged, 'python');
if (!fs.existsSync(path.join(stagedCrypto, 'run_agent.py'))) throw new Error('EXTERNAL_BLOCKER CRYPTO_RESOURCES_REQUIRED: run desktop:sidecar first.');
if (!fs.existsSync(path.join(stagedPython, 'python.exe'))) throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: portable releases cannot use a developer venv or target-machine prerequisite.');
copyTreeStrict(stagedCrypto, path.join(portable, 'crypto'));
copyTreeStrict(stagedPython, path.join(portable, 'python'));
assertCryptoResourcesSafe(path.join(portable, 'crypto'));
const leaks = findDeveloperPathLeaks(portable);
if (leaks.length) throw new Error(`Developer-specific absolute paths found: ${leaks.join(', ')}`);
const manifest = manifestFor(portable, { version: pkg.version, architecture: 'x86_64' });
fs.writeFileSync(path.join(portable, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
fs.writeFileSync(path.join(portable, 'SHA256SUMS.txt'), `${manifest.files.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`, { flag: 'wx' });
fs.mkdirSync(path.dirname(zip), { recursive: true });
fs.rmSync(zip, { force: true });
execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:EDITH_PORTABLE_SOURCE -DestinationPath $env:EDITH_PORTABLE_ZIP -CompressionLevel Optimal -Force'], {
  env: { ...process.env, EDITH_PORTABLE_SOURCE: portable, EDITH_PORTABLE_ZIP: zip }, stdio: 'inherit', windowsHide: true,
});
const zipHash = sha256(zip);
fs.writeFileSync(`${zip}.sha256`, `${zipHash}  ${path.basename(zip)}\n`, 'utf8');
console.log(JSON.stringify({ portable, zip, zipSha256: zipHash, files: manifest.files.length }, null, 2));
