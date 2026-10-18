import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import outputRoles from './desktop-output-role.cjs';
import { assertOrdinaryPath, runTauri } from './build-edith-tauri.mjs';

const ID = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{64}$/;
const validHex = value => typeof value === 'string' && value.length === 64 && SHA.test(value);
const INPUT_FLAGS = ['public-crypto-directory', 'public-crypto-manifest', 'public-crypto-sha256',
  'frontend-directory', 'frontend-manifest', 'frontend-sha256', 'python-runtime'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function parseCandidateArguments(argv) {
  if (!Array.isArray(argv) || !['prepare', 'native', 'portable', 'verify'].includes(argv[0])) throw new Error('CANDIDATE_ARGUMENTS');
  const result = { phase: argv[0] };
  const allowed = ['id', ...(result.phase === 'prepare' ? INPUT_FLAGS : [])];
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (typeof flag !== 'string' || !flag.startsWith('--') || !allowed.includes(flag.slice(2))
        || Object.hasOwn(result, flag.slice(2)) || typeof argv[index + 1] !== 'string' || !argv[index + 1]) throw new Error('CANDIDATE_ARGUMENTS');
    result[flag.slice(2)] = argv[index + 1];
  }
  if (allowed.some(key => !Object.hasOwn(result, key)) || !validHex(result.id)) throw new Error('CANDIDATE_ARGUMENTS');
  if (result.phase === 'prepare' && (!validHex(result['public-crypto-sha256']) || !validHex(result['frontend-sha256']))) throw new Error('CANDIDATE_INPUT_DIGEST');
  return Object.freeze(result);
}

export function assertPublicInputSelector(root, value, candidateRoot) {
  if (typeof value !== 'string' || value !== path.resolve(value) || value.startsWith('\\\\')
      || /[\x00-\x1f]/.test(value) || value.slice(path.parse(value).root.length).includes(':')) throw new Error('CANDIDATE_INPUT_PATH');
  const within = (parent, child) => child.toLowerCase() === parent.toLowerCase() || child.toLowerCase().startsWith(parent.toLowerCase() + path.sep);
  // Lexical check occurs before stat/read, including in synthetic path-trap tests.
  for (const protectedRoot of [path.join(root, '.edith-build', 'desktop'), path.join(root, 'dist'),
    path.join(root, 'src-tauri', 'binaries'), path.join(root, 'artifacts', 'desktop', 'portable'), candidateRoot]) {
    if (within(protectedRoot, value)) throw new Error('CANDIDATE_PROTECTED_INPUT');
  }
  const legacyArtifacts = path.join(root, 'artifacts', 'desktop');
  if (path.dirname(value).toLowerCase() === legacyArtifacts.toLowerCase() && /\.(zip|sha256)$/i.test(value)) throw new Error('CANDIDATE_PROTECTED_INPUT');
}

export function captureFrontend({ projectRoot, directory, manifestPath, manifestSha256, candidateRoot }) {
  assertPublicInputSelector(projectRoot, directory, candidateRoot);
  assertPublicInputSelector(projectRoot, manifestPath, candidateRoot);
  if (!validHex(manifestSha256)) throw new Error('CANDIDATE_FRONTEND_DIGEST');
  assertOrdinaryPath(directory, { directory: true });
  assertOrdinaryPath(manifestPath);
  const manifestInfo = fs.statSync(manifestPath);
  if (manifestInfo.size > 4 * 1024 * 1024) throw new Error('CANDIDATE_FRONTEND_MANIFEST_LIMIT');
  const raw = fs.readFileSync(manifestPath);
  if (hash(raw) !== manifestSha256) throw new Error('CANDIDATE_FRONTEND_DIGEST');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs) || manifest.outputs.length < 2
      || manifest.outputs.length > 4096 || manifest.outputFiles !== manifest.outputs.length) throw new Error('CANDIDATE_FRONTEND_SCHEMA');
  const files = new Map();
  const folded = new Set();
  let total = 0;
  for (const row of manifest.outputs) {
    if (!row || Object.keys(row).sort().join(',') !== 'path,sha256,size' || typeof row.path !== 'string'
        || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(row.path) || row.path.split('/').some(part => part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
        || !Number.isSafeInteger(row.size) || row.size < 0 || typeof row.sha256 !== 'string' || row.sha256.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(row.sha256)
        || folded.has(row.path.toLowerCase())) throw new Error('CANDIDATE_FRONTEND_SCHEMA');
    total += row.size;
    if (total > 128 * 1024 * 1024) throw new Error('CANDIDATE_FRONTEND_LIMIT');
    folded.add(row.path.toLowerCase());
    files.set(row.path, row);
  }
  if (manifest.outputBytes !== total || !files.has('index.html') || !files.has('.vite/manifest.json')) throw new Error('CANDIDATE_FRONTEND_SCHEMA');
  const captured = new Map();
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(dir, entry.name);
      const info = fs.lstatSync(absolute);
      if (info.isDirectory()) {
        assertOrdinaryPath(absolute, { directory: true });
        if (![...files.keys()].some(name => name.startsWith(relative + '/'))) throw new Error('CANDIDATE_FRONTEND_EXTRA');
        walk(absolute, relative + '/');
      } else {
        assertOrdinaryPath(absolute);
        const row = files.get(relative);
        if (!row || info.size !== row.size) throw new Error('CANDIDATE_FRONTEND_EXTRA');
        const bytes = fs.readFileSync(absolute);
        if (bytes.length !== row.size || hash(bytes) !== row.sha256.toLowerCase()) throw new Error('CANDIDATE_FRONTEND_BYTES');
        captured.set(relative, bytes);
      }
    }
  };
  walk(directory);
  if (captured.size !== files.size) throw new Error('CANDIDATE_FRONTEND_MISSING');
  return captured; // Private captured bytes; rich audit metadata never grants output authority.
}

export function candidateEnvironment(source) {
  const result = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME',
    'APPDATA', 'LOCALAPPDATA', 'CARGO_HOME', 'RUSTUP_HOME', 'RUSTC', 'RUSTDOC', 'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_NET_OFFLINE', 'CARGO_TARGET_DIR', 'PKG_CACHE_PATH', 'CI', 'VCToolsInstallDir', 'VCINSTALLDIR',
    'VSINSTALLDIR', 'WindowsSdkDir', 'WindowsSDKVersion', 'INCLUDE', 'LIB', 'LIBPATH',
    'PIP_CONFIG_FILE', 'PIP_NO_INDEX', 'PIP_DISABLE_PIP_VERSION_CHECK', 'PIP_CACHE_DIR',
    'PYTHONNOUSERSITE', 'PYTHONDONTWRITEBYTECODE', 'CARGO_BUILD_JOBS', 'EDITH_NATIVE_BUILD_ID',
    'CARGO', 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER', 'CC', 'CXX', 'AR', 'RC', 'COMSPEC', 'NO_COLOR']) {
    if (typeof source[name] === 'string') result[name] = source[name];
  }
  return result;
}

async function withEnvironment(environment, action) {
  const previousEnvironment = process.env;
  try {
    process.env = environment;
    return await action();
  } finally { process.env = previousEnvironment; }
}

export async function runCandidate(argv = process.argv.slice(2), { projectRoot = process.cwd(), env = process.env, exec } = {}) {
  const args = parseCandidateArguments(argv); // No I/O before closed CLI admission.
  const role = Object.freeze({ kind: 'candidate', id: args.id });
  const paths = outputRoles.resolveDesktopOutputRole(projectRoot, role);
  if (env.PROFILE !== undefined && env.PROFILE !== 'release') throw new Error('CANDIDATE_RELEASE_REQUIRED');
  const childEnv = candidateEnvironment(env);
  if (env.EDITH_DESKTOP_CANDIDATE_ID !== undefined && env.EDITH_DESKTOP_CANDIDATE_ID !== args.id) throw new Error('CANDIDATE_SELECTOR_MISMATCH');
  childEnv.EDITH_DESKTOP_CANDIDATE_ID = args.id;
  if (args.phase === 'native') return runTauri(['--candidate-id', args.id], { projectRoot: paths.root, env: childEnv, ...(exec ? { exec } : {}) });
  if (args.phase === 'portable') return withEnvironment(childEnv, async () =>
    (await import('./package-edith-portable.mjs')).packagePortable({ projectRoot: paths.root, outputRole: role }));
  if (args.phase === 'verify') return withEnvironment(childEnv, async () =>
    (await import('./verify-edith-portable.mjs')).verifyPortable({ projectRoot: paths.root, outputRole: role }));
  for (const key of ['public-crypto-directory', 'public-crypto-manifest', 'frontend-directory', 'frontend-manifest', 'python-runtime']) assertPublicInputSelector(paths.root, args[key], paths.candidateRoot);
  const frontend = captureFrontend({ projectRoot: paths.root, directory: args['frontend-directory'], manifestPath: args['frontend-manifest'], manifestSha256: args['frontend-sha256'], candidateRoot: paths.candidateRoot });
  assertOrdinaryPath(paths.candidateRoot, { directory: true, missing: true });
  assertOrdinaryPath(paths.frontendDir, { directory: true, missing: true });
  fs.mkdirSync(paths.candidateRoot, { recursive: true });
  fs.mkdirSync(paths.frontendDir); // Exclusive: no retry, overwrite, or legacy output cleanup.
  for (const [relative, bytes] of frontend) {
    const destination = path.join(paths.frontendDir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
  }
  const { buildEdithSidecar } = await import('./build-edith-sidecar.mjs');
  childEnv.EDITH_CRYPTO_PYTHON_BUNDLE_DIR = args['python-runtime'];
  const previousEnvironment = process.env;
  const previousCwd = process.cwd();
  try {
    process.env = childEnv;
    process.chdir(paths.root);
    return await buildEdithSidecar({ publicCryptoSource: { directory: args['public-crypto-directory'], manifestPath: args['public-crypto-manifest'], manifestSha256: args['public-crypto-sha256'] }, outputRole: role });
  } finally { process.env = previousEnvironment; process.chdir(previousCwd); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCandidate();
