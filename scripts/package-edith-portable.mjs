import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { createRequire } from 'node:module';
import { assertInside, copyTreeStrict, findDeveloperPathLeaks, isExcludedPythonRuntime, manifestFor, sha256 } from './portable-edith-lib.mjs';
import { assertPackagedCryptoResources, stageCryptoResources } from './stage-edith-crypto-resources.mjs';
import { validateThirdPartyResources } from './build-edith-sidecar.mjs';
const {resolveDesktopOutputRole}=createRequire(import.meta.url)('./desktop-output-role.cjs');
function portableOptions(options) {
  const reject=()=>{throw new Error('EDITH_PORTABLE_OPTIONS_REJECTED');};
  if(!options || typeof options!=='object' || types.isProxy(options) || ![Object.prototype,null].includes(Object.getPrototypeOf(options))) reject();
  const descriptors=Object.getOwnPropertyDescriptors(options),result=Object.create(null);
  for(const key of Reflect.ownKeys(descriptors)) {
    if(typeof key!=='string' || !['projectRoot','outputRole'].includes(key) || !Object.hasOwn(descriptors[key],'value')) reject();
    result[key]=descriptors[key].value;
  }
  return result;
}
function candidateAncestors(target) {
  let cursor=path.parse(target).root;
  for(const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    try {const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink!==1)) throw noticeFailure();}
    catch(error){if(error.code==='ENOENT') break;throw error;}
  }
}

const noticeFailure = () => new Error('EDITH_THIRD_PARTY_INVALID');
function noticeOptions(options) {
  if (!options || typeof options !== 'object' || types.isProxy(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw noticeFailure();
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const keys = ['directory', 'bundlePath', 'sidecarPath'];
  if (Reflect.ownKeys(descriptors).length !== keys.length ||
      Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value'))) throw noticeFailure();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function regularNoticeFile(file) {
  let cursor = path.resolve(file);
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw noticeFailure();
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) throw noticeFailure();
  return stat;
}
function snapshotNoticeFile(file, expected) {
  const before = regularNoticeFile(file);
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1 || !stat.isFile()) throw noticeFailure();
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.nlink !== 1 || after.size !== bytes.length || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs ||
        (expected && (bytes.length !== expected.sizeBytes || crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase() !== expected.sha256.toUpperCase()))) throw noticeFailure();
    return bytes;
  } finally { fs.closeSync(fd); }
}

// Capture all verified bytes before the caller removes any existing release.
// Only this closure owns the payload snapshots; no Buffer is returned.
export function preparePortableThirdParty(options) {
  const { directory, bundlePath, sidecarPath } = noticeOptions(options);
  const manifest = validateThirdPartyResources({ directory, bundlePath, sidecarPath });
  const originalManifest = snapshotNoticeFile(path.join(directory, 'manifest.json'));
  if (JSON.stringify(JSON.parse(originalManifest.toString('utf8'))) !== JSON.stringify(manifest)) throw noticeFailure();
  let total = originalManifest.length;
  const snapshots = manifest.files.map(file => {
    total += file.sizeBytes;
    if (total > 128 * 1024 * 1024) throw noticeFailure();
    return { path: file.path, bytes: snapshotNoticeFile(path.join(directory, file.path), file) };
  });
  let consumed = false;
  return Object.freeze({ manifest, copyTo(destination) {
    if (consumed || typeof destination !== 'string' || !path.isAbsolute(destination) || destination.startsWith('\\\\')) throw noticeFailure();
    const resolved = path.resolve(destination);
    if (resolved === path.parse(resolved).root || fs.existsSync(resolved)) throw noticeFailure();
    let parent = path.dirname(resolved);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!fs.lstatSync(parent).isDirectory()) throw noticeFailure();
    let cursor = parent;
    while (true) {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw noticeFailure();
      const next = path.dirname(cursor); if (next === cursor) break; cursor = next;
    }
    consumed = true;
    let created = false;
    try {
      fs.mkdirSync(resolved); created = true;
      for (const file of snapshots) {
        const target = assertInside(resolved, path.join(resolved, file.path), 'notice payload');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.bytes, { flag: 'wx' });
      }
      fs.writeFileSync(path.join(resolved, 'manifest.json'), originalManifest, { flag: 'wx' });
      return validateThirdPartyResources({ directory: resolved, bundlePath, sidecarPath });
    } catch (error) {
      if (created && resolved !== path.parse(resolved).root) fs.rmSync(resolved, { recursive: true, force: true });
      throw error;
    } finally {
      originalManifest.fill(0); for (const file of snapshots) file.bytes.fill(0);
    }
  } });
}

export function writePortableManifest({ portable, version }) {
  const manifest = manifestFor(portable, { version, architecture: 'x86_64' });
  fs.writeFileSync(path.join(portable, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(portable, 'SHA256SUMS.txt'), `${manifest.files.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`, { flag: 'wx' });
  return manifest;
}

export function packagePortable(options = {}) {
const {projectRoot=process.cwd(),outputRole}=portableOptions(options);
const root = path.resolve(projectRoot);
const locations=resolveDesktopOutputRole(root,outputRole);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = assertInside(root, path.join(root, 'src-tauri', 'target', 'release'), 'release directory');
const artifactRoot = assertInside(root, locations.artifactRoot, 'artifact directory');
const name = `E.D.I.T.H.-${pkg.version}-windows-x64`;
const portable = assertInside(artifactRoot, path.join(locations.portableRoot, name), 'portable directory');
const zip = assertInside(artifactRoot, path.join(artifactRoot, `${name}.zip`), 'portable ZIP');
if(locations.kind==='candidate') {
  for(const p of [portable,zip,`${zip}.sha256`]) candidateAncestors(p);
  for(const p of [portable,zip,`${zip}.sha256`]) if(fs.existsSync(p)) throw new Error('CANDIDATE_OUTPUT_EXISTS');
  let ancestor=artifactRoot;while(!fs.existsSync(ancestor)) ancestor=path.dirname(ancestor);
  if(!fs.lstatSync(ancestor).isDirectory()) throw noticeFailure();
  for(let p=ancestor;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink()) throw noticeFailure();if(path.dirname(p)===p) break;}
}
const app = path.join(release, 'edith.exe');
const sidecar = path.join(release, 'edith-backend.exe');
for (const required of [app, sidecar, path.join(locations.frontendDir, 'index.html')]) {
  if (!fs.existsSync(required)) throw new Error(`Required release file is missing: ${required}`);
}
if(locations.kind==='candidate') {regularNoticeFile(locations.output);regularNoticeFile(sidecar);if(sha256(locations.output)!==sha256(sidecar)) throw new Error('CANDIDATE_COPIED_SIDECAR_MISMATCH');}
const staged = locations.resourceDir;
const stagedCrypto = path.join(staged, 'crypto');
const stagedPython = path.join(staged, 'python');
const thirdParty = preparePortableThirdParty({
  directory: path.join(staged, 'third-party'),
  bundlePath: locations.entry,
  sidecarPath: sidecar,
});
if (!fs.existsSync(path.join(stagedCrypto, 'run_agent.py'))) throw new Error('EXTERNAL_BLOCKER CRYPTO_RESOURCES_REQUIRED: run desktop:sidecar first.');
if (!fs.existsSync(path.join(stagedPython, 'python.exe')) || !fs.existsSync(path.join(stagedPython, 'EDITH_RUNTIME_VERIFIED.json'))) throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: portable releases require a lock-verified staged Python bundle.');

if(locations.kind==='legacy') {fs.rmSync(portable, { recursive: true, force: true });fs.mkdirSync(portable, { recursive: true });}
else {fs.mkdirSync(locations.portableRoot,{recursive:true});fs.mkdirSync(portable);}
fs.copyFileSync(app, path.join(portable, 'edith.exe'), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(sidecar, path.join(portable, 'edith-backend.exe'), fs.constants.COPYFILE_EXCL);
thirdParty.copyTo(path.join(portable, 'third-party'));
validateThirdPartyResources({
  directory: path.join(portable, 'third-party'),
  bundlePath: locations.entry,
  sidecarPath: path.join(portable, 'edith-backend.exe'),
});
copyTreeStrict(locations.frontendDir, path.join(portable, 'dist'));
stageCryptoResources({
  source: stagedCrypto,
  destination: path.join(portable, 'crypto'),
  allowedDestinationRoot: portable,
});
copyTreeStrict(stagedPython, path.join(portable, 'python'), { exclude: isExcludedPythonRuntime });
assertPackagedCryptoResources(path.join(portable, 'crypto'));
const leaks = findDeveloperPathLeaks(portable);
if (leaks.length) throw new Error(`Developer-specific absolute paths found: ${leaks.join(', ')}`);
const manifest = writePortableManifest({ portable, version: pkg.version });
fs.mkdirSync(path.dirname(zip), { recursive: true });
if(locations.kind==='legacy') fs.rmSync(zip, { force: true });
const createZip = String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [IO.Path]::GetFullPath($env:EDITH_PORTABLE_SOURCE).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ($env:EDITH_PORTABLE_EXCLUSIVE -eq 'true') {
  $zipStream = [IO.File]::Open($env:EDITH_PORTABLE_ZIP, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $archive = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $false)
} else { $archive = [IO.Compression.ZipFile]::Open($env:EDITH_PORTABLE_ZIP, [IO.Compression.ZipArchiveMode]::Create) }
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
    EDITH_PORTABLE_EXCLUSIVE: locations.kind==='candidate'?'true':'false',
  },
  stdio: 'inherit',
  windowsHide: true,
});
const zipHash = sha256(zip);
fs.writeFileSync(`${zip}.sha256`, `${zipHash}  ${path.basename(zip)}\n`, locations.kind==='candidate'?{encoding:'utf8',flag:'wx'}:'utf8');
console.log(JSON.stringify({ portable, zip, zipSha256: zipHash, files: manifest.files.length }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) packagePortable();
