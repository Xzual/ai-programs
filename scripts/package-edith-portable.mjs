import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { assertInside, copyTreeStrict, findDeveloperPathLeaks, isExcludedPythonRuntime, manifestFor, sha256 } from './portable-edith-lib.mjs';
import { assertPackagedCryptoResources, stageCryptoResources } from './stage-edith-crypto-resources.mjs';

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
const staged = path.join(root, '.edith-build', 'desktop', 'resources');
const stagedCrypto = path.join(staged, 'crypto');
const stagedPython = path.join(staged, 'python');
if (!fs.existsSync(path.join(stagedCrypto, 'run_agent.py'))) throw new Error('EXTERNAL_BLOCKER CRYPTO_RESOURCES_REQUIRED: run desktop:sidecar first.');
if (!fs.existsSync(path.join(stagedPython, 'python.exe')) || !fs.existsSync(path.join(stagedPython, 'EDITH_RUNTIME_VERIFIED.json'))) throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: portable releases require a lock-verified staged Python bundle.');

fs.rmSync(portable, { recursive: true, force: true });
fs.mkdirSync(portable, { recursive: true });
fs.copyFileSync(app, path.join(portable, 'edith.exe'), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(sidecar, path.join(portable, 'edith-backend.exe'), fs.constants.COPYFILE_EXCL);
copyTreeStrict(path.join(root, 'dist'), path.join(portable, 'dist'));
stageCryptoResources({
  source: stagedCrypto,
  destination: path.join(portable, 'crypto'),
  allowedDestinationRoot: portable,
});
copyTreeStrict(stagedPython, path.join(portable, 'python'), { exclude: isExcludedPythonRuntime });
assertPackagedCryptoResources(path.join(portable, 'crypto'));
const leaks = findDeveloperPathLeaks(portable);
if (leaks.length) throw new Error(`Developer-specific absolute paths found: ${leaks.join(', ')}`);
const manifest = manifestFor(portable, { version: pkg.version, architecture: 'x86_64' });
fs.writeFileSync(path.join(portable, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
fs.writeFileSync(path.join(portable, 'SHA256SUMS.txt'), `${manifest.files.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`, { flag: 'wx' });
fs.mkdirSync(path.dirname(zip), { recursive: true });
fs.rmSync(zip, { force: true });
const createZip = String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [IO.Path]::GetFullPath($env:EDITH_PORTABLE_SOURCE).TrimEnd([IO.Path]::DirectorySeparatorChar)
$archive = [IO.Compression.ZipFile]::Open($env:EDITH_PORTABLE_ZIP, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in [IO.Directory]::EnumerateFiles($source, '*', [IO.SearchOption]::AllDirectories)) {
    $relative = $file.Substring($source.Length).TrimStart([IO.Path]::DirectorySeparatorChar).Replace('\', '/')
    $entry = "$env:EDITH_PORTABLE_NAME/$relative"
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }
`;
execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', createZip], {
  env: {
    ...process.env,
    EDITH_PORTABLE_SOURCE: portable,
    EDITH_PORTABLE_ZIP: zip,
    EDITH_PORTABLE_NAME: name,
  },
  stdio: 'inherit',
  windowsHide: true,
});
const zipHash = sha256(zip);
fs.writeFileSync(`${zip}.sha256`, `${zipHash}  ${path.basename(zip)}\n`, 'utf8');
console.log(JSON.stringify({ portable, zip, zipSha256: zipHash, files: manifest.files.length }, null, 2));
