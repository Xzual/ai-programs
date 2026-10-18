import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { types } from 'node:util';
import { assertInside, assertSafeRelative, findDeveloperPathLeaks, listFilesStrict, PORTABLE_FORMAT, sha256, validateZipEntries } from './portable-edith-lib.mjs';
import { assertPackagedCryptoResources } from './stage-edith-crypto-resources.mjs';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';
import { validateDeliveredThirdPartyResources } from './build-edith-sidecar.mjs';
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
    try {const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink!==1)) throw new Error('CANDIDATE_ALIAS_REJECTED');}
    catch(error){if(error.code==='ENOENT') break;throw error;}
  }
}

function verifyPythonEvidence(directory, expectedLockPath) {
  const lock = path.join(directory, 'crypto/requirements.lock.txt');
  const pins = readExactRequirementsLock(lock), expectedPins = readExactRequirementsLock(expectedLockPath);
  const normalize = values => {
    const seen = new Set();
    return values.map(({ name, version }) => {
      const key = name.toLowerCase().replace(/[-_.]+/g, '-');
      if (seen.has(key)) throw new Error('Python runtime lock contains duplicate package names.');
      seen.add(key); return [key, version];
    }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  };
  if (sha256(lock) !== sha256(expectedLockPath) || JSON.stringify(normalize(pins)) !== JSON.stringify(normalize(expectedPins))) throw new Error('Python runtime lock differs from the reviewed project lock.');
  let marker;
  try { marker = JSON.parse(fs.readFileSync(path.join(directory, 'python/EDITH_RUNTIME_VERIFIED.json'), 'utf8')); }
  catch { throw new Error('Python runtime marker is invalid.'); }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || Object.keys(marker).sort().join(',') !== 'formatVersion,lockSha256' || marker.formatVersion !== 1 || typeof marker.lockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(marker.lockSha256)) throw new Error('Python runtime marker is invalid.');
  if (marker.lockSha256 !== sha256(lock)) throw new Error('Python runtime marker lock binding mismatch.');
  // This establishes recorded lock binding only. No Python execution or runtime qualification occurs here.
}

export function verifyPortableDirectory(directory, { expectedVersion, expectedLockPath }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Object.keys(manifest).sort().join(',') !== 'architecture,files,formatVersion,platform,product,version' || manifest.formatVersion !== PORTABLE_FORMAT || manifest.product !== 'E.D.I.T.H.' || manifest.platform !== 'windows-x64' || manifest.architecture !== 'x86_64' || manifest.version !== expectedVersion || !Array.isArray(manifest.files)) throw new Error('Portable manifest identity is invalid.');
  const declared = new Set(), caseNames = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'path,sha256,size' || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Portable manifest file record is invalid.');
    const relative = assertSafeRelative(entry.path, 'manifest path');
    if (relative.includes(':') || relative.split('/').some(part => !part || part === '.') || caseNames.has(relative.toLowerCase()) || ['manifest.json', 'SHA256SUMS.txt'].includes(relative)) throw new Error('Portable manifest contains an invalid or case-colliding path.');
    const file = assertInside(directory, path.join(directory, relative), 'manifest file');
    const stat = fs.lstatSync(file);
    if (declared.has(relative) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== entry.size || sha256(file) !== entry.sha256) throw new Error(`Manifest mismatch: ${relative}`);
    declared.add(relative); caseNames.add(relative.toLowerCase());
  }
  const allFiles = listFilesStrict(directory);
  const actual = allFiles.map(({ relative }) => relative).filter((value) => !['manifest.json', 'SHA256SUMS.txt'].includes(value));
  if (actual.length !== declared.size || actual.some((value) => !declared.has(value))) throw new Error('Portable payload contains undeclared or missing files.');
  for (const required of ['edith.exe', 'edith-backend.exe', 'dist/index.html', 'crypto/run_agent.py', 'crypto/requirements.lock.txt', 'python/python.exe', 'python/EDITH_RUNTIME_VERIFIED.json', 'third-party/manifest.json', 'SHA256SUMS.txt']) if (!fs.existsSync(path.join(directory, required))) throw new Error(`Required portable file missing: ${required}`);
  assertPackagedCryptoResources(path.join(directory, 'crypto'));
  verifyPythonEvidence(directory, expectedLockPath);
  validateDeliveredThirdPartyResources({ directory: path.join(directory, 'third-party'), sidecarPath: path.join(directory, 'edith-backend.exe') });
  const leaks = findDeveloperPathLeaks(directory);
  if (leaks.length) throw new Error(`Developer-specific absolute paths found: ${leaks.join(', ')}`);
  return {
    identity: { formatVersion: manifest.formatVersion, product: manifest.product, platform: manifest.platform, version: manifest.version, architecture: manifest.architecture },
    files: allFiles.map(({ absolute, relative }) => ({ path: relative, size: fs.statSync(absolute).size, sha256: sha256(absolute) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    payloadFiles: manifest.files.length,
  };
}

export function verifyPortable(options = {}) {
const {projectRoot=process.cwd(),outputRole}=portableOptions(options);
const root = path.resolve(projectRoot);
const locations=resolveDesktopOutputRole(root,outputRole);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactRoot = assertInside(root, locations.artifactRoot, 'artifact directory');
const name = `E.D.I.T.H.-${pkg.version}-windows-x64`;
const portable = assertInside(artifactRoot, path.join(locations.portableRoot, name), 'portable directory');
const zip = assertInside(artifactRoot, path.join(artifactRoot, `${name}.zip`), 'portable ZIP');
if(locations.kind==='candidate') for(const p of [portable,zip,`${zip}.sha256`]) candidateAncestors(p);
const policy = { expectedVersion: pkg.version, expectedLockPath: path.join(root, 'crypto/requirements.lock.txt') };
if (!fs.existsSync(portable) || !fs.existsSync(zip) || !fs.existsSync(`${zip}.sha256`)) throw new Error('Portable directory, ZIP, or hash sidecar is missing.');
const directoryIdentity = verifyPortableDirectory(portable, policy);
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
    windowsHide: true, timeout: 120000, maxBuffer: 1048576,
  });
  const extractedRoots = fs.readdirSync(temp);
  if (extractedRoots.length !== 1 || extractedRoots[0] !== name) throw new Error('Portable ZIP extracted root must contain only the expected directory.');
  const extractedRoot = fs.lstatSync(path.join(temp, name));
  if (!extractedRoot.isDirectory() || extractedRoot.isSymbolicLink()) throw new Error('Portable ZIP extracted root must be an ordinary directory.');
  const extractedIdentity = verifyPortableDirectory(path.join(temp, name), policy);
  if (JSON.stringify(directoryIdentity) !== JSON.stringify(extractedIdentity)) throw new Error('Portable directory and ZIP payload identity parity mismatch.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
const result = { status: 'PASS', portable, zip, zipSha256: expected, files: directoryIdentity.payloadFiles, payloadParity: true, pythonEvidence: 'recorded exact lock binding only; runtime execution not performed', thirdPartyBundleEvidence: 'recorded bundle identity shape only; delivered sidecar and notice bytes verified' };
console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyPortable();
