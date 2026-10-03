import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const results = [];
const owned = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const record = (status, check, detail, evidence) => {
  results.push({ status, check, detail, ...(evidence ? { evidence } : {}) });
  console.log(`[${status}] ${check}: ${detail}${evidence ? ` ${JSON.stringify(evidence)}` : ''}`);
};
const pass = (check, detail, evidence) => record('PASS', check, detail, evidence);
const fail = (check, detail, evidence) => record('FAIL', check, detail, evidence);
const blocker = (check, detail, evidence) => record('EXTERNAL_BLOCKER', check, detail, evidence);

function listFiles(directory, accept = () => true) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && accept(absolute)) files.push(absolute);
    }
  };
  visit(directory);
  return files;
}

function uniqueFiles(files) {
  return [...new Set(files.filter((file) => fs.existsSync(file)).map((file) => path.resolve(file)))];
}

function newestInput(files) {
  return files.reduce((latest, file) => {
    const mtimeMs = fs.statSync(file).mtimeMs;
    return !latest || mtimeMs > latest.mtimeMs ? { file, mtimeMs } : latest;
  }, null);
}

function checkFreshness(artifact, inputs, label) {
  if (!fs.existsSync(artifact)) return;
  const latest = newestInput(inputs);
  if (!latest) return fail(`artifact.freshness.${label}`, 'No package inputs were discovered.');
  const artifactMtimeMs = fs.statSync(artifact).mtimeMs;
  const evidence = {
    artifact,
    artifactUtc: new Date(artifactMtimeMs).toISOString(),
    newestInput: path.relative(root, latest.file).replaceAll('\\', '/'),
    newestInputUtc: new Date(latest.mtimeMs).toISOString(),
  };
  artifactMtimeMs >= latest.mtimeMs
    ? pass(`artifact.freshness.${label}`, 'Artifact postdates all scoped package inputs.', evidence)
    : blocker(`artifact.freshness.${label}`, 'Artifact predates a scoped package input.', evidence);
}

function checkHashMatch(left, right, label) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) {
    return blocker(`artifact.hash.${label}`, 'A hash comparison input is missing.', { left, right });
  }
  const leftHash = sha256(left);
  const rightHash = sha256(right);
  leftHash === rightHash
    ? pass(`artifact.hash.${label}`, 'Packaged file matches the current release/build output.', { sha256: leftHash })
    : blocker(`artifact.hash.${label}`, 'Packaged file does not match the current release/build output.', { leftHash, rightHash });
}

function checkTreeMatch(leftDirectory, rightDirectory, label) {
  const tree = (directory) => listFiles(directory, (file) => {
    const relative = path.relative(directory, file).replaceAll('\\', '/');
    return relative === 'index.html' || relative.startsWith('assets/');
  })
    .map((file) => ({
      path: path.relative(directory, file).replaceAll('\\', '/'),
      sha256: sha256(file),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const left = tree(leftDirectory);
  const right = tree(rightDirectory);
  const leftHash = crypto.createHash('sha256').update(JSON.stringify(left)).digest('hex');
  const rightHash = crypto.createHash('sha256').update(JSON.stringify(right)).digest('hex');
  leftHash === rightHash
    ? pass(`artifact.hash.${label}`, 'Packaged file tree matches the current build output.', { files: left.length, sha256: leftHash })
    : blocker(`artifact.hash.${label}`, 'Packaged file tree does not match the current build output.', { leftFiles: left.length, rightFiles: right.length, leftHash, rightHash });
}

function ps(script, env = process.env) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env, timeout: 20_000 }).trim();
}

function authenticode(file) {
  const script = '$s=Get-AuthenticodeSignature -LiteralPath $env:EDITH_FILE; [string]$s.Status';
  let lastError;
  for (const executable of ['pwsh.exe', 'powershell.exe']) {
    try {
      return execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', windowsHide: true, timeout: 20_000, env: { ...process.env, EDITH_FILE: file },
      }).trim();
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('Authenticode tooling unavailable.');
}

function snapshot() {
  const raw = ps("$items=Get-CimInstance Win32_Process -Filter \"Name='edith.exe' OR Name='edith-backend.exe'\" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath; @($items) | ConvertTo-Json -Compress; [Environment]::Exit(0)");
  const value = raw ? JSON.parse(raw) : [];
  return Array.isArray(value) ? value : [value];
}

function descendants(pids, items = snapshot()) {
  const ids = new Set([...pids].map(Number));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) if (ids.has(Number(item.ParentProcessId)) && !ids.has(Number(item.ProcessId))) { ids.add(Number(item.ProcessId)); changed = true; }
  }
  return items.filter((item) => ids.has(Number(item.ProcessId)));
}

async function waitFor(fn, timeout = 15_000, interval = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

function postClose(pid) {
  return Number(ps(String.raw`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class EdithClose {
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr state);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 public delegate bool Callback(IntPtr h, IntPtr state);
}
'@
$target=[uint32]$env:EDITH_PID; $count=0
$cb=[EdithClose+Callback]{param($h,$s) $owner=[uint32]0; [void][EdithClose]::GetWindowThreadProcessId($h,[ref]$owner); if($owner -eq $target -and [EdithClose]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){$script:count++}; return $true}
[void][EdithClose]::EnumWindows($cb,[IntPtr]::Zero); $count`, { ...process.env, EDITH_PID: String(pid) }));
}

function staticChecks() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
  const lib = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const sidecarBuild = fs.readFileSync(path.join(root, 'scripts', 'build-edith-sidecar.mjs'), 'utf8');
  const desktopShell = fs.readFileSync(path.join(root, 'src', 'edith', 'desktopShell.ts'), 'utf8');
  const csp = config.app?.security?.csp ?? '';
  const forbidden = capability.permissions.filter((item) => /shell|http|fs:|global-shortcut|clipboard|process/i.test(item));
  const checks = {
    csp: csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && !csp.includes("'unsafe-eval'"),
    capability: capability.windows?.length === 1 && capability.windows[0] === 'main' && forbidden.length === 0,
    singleInstance: cargo.includes('tauri-plugin-single-instance') && lib.includes('tauri_plugin_single_instance::init'),
    boundedRestart: lib.includes('MAX_SIDECAR_RESTARTS: usize = 3') && lib.includes('RESTART_BACKOFF_MS[attempt]'),
    coordinatedClose: /fn close_window[\s\S]{0,180}begin_shutdown/.test(lib) && lib.includes('api.prevent_exit()'),
    loopbackSidecar: lib.includes('TcpListener::bind(("127.0.0.1", 0))') && lib.includes('.sidecar("edith-backend")'),
    sidecarTargetLayout: sidecarBuild.includes('edith-backend-x86_64-pc-windows-msvc.exe') && JSON.stringify(config.bundle?.externalBin).includes('binaries/edith-backend'),
    ownerBootstrap: lib.includes('.env("EDITH_OWNER_TOKEN", owner_token)') && lib.includes('.env("EDITH_OWNER_TOKEN_ONE_TIME", "true")') && lib.includes('desktop_owner_bootstrap_token') && lib.includes('.take()') && desktopShell.includes("fetch('/api/security/session'") && !/localStorage|sessionStorage|indexedDB/i.test(desktopShell),
  };
  for (const [check, ok] of Object.entries(checks)) ok ? pass(`static.${check}`, 'Invariant present.') : fail(`static.${check}`, 'Invariant missing.');
}

async function runtime(exe) {
  const normalized = path.resolve(exe).toLowerCase();
  const preexisting = snapshot().filter((item) => item.ExecutablePath && path.resolve(item.ExecutablePath).toLowerCase() === normalized);
  if (preexisting.length) return blocker('runtime.launch', 'Existing exact executable instance prevents isolated smoke.', { pids: preexisting.map((item) => item.ProcessId) });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-release-'));
  fs.writeFileSync(path.join(temp, '.edith-phase11e-root'), 'EDITH_PHASE11E_ISOLATED_RUNTIME_V1\n', { encoding: 'utf8', flag: 'wx' });
  const env = {
    ...process.env,
    LOCALAPPDATA: temp,
    APPDATA: temp,
    EDITH_PACKAGED_E2E: 'true',
    EDITH_PACKAGED_E2E_ROOT: temp,
  };
  let first;
  let second;
  try {
    first = spawn(exe, [], { cwd: path.dirname(exe), env, stdio: 'ignore', windowsHide: false });
    owned.add(first.pid);
    if (!await waitFor(() => snapshot().some((item) => Number(item.ProcessId) === first.pid), 10_000)) return fail('runtime.launch', 'App did not remain alive.', { pid: first.pid });
    pass('runtime.launch', 'Packaged app launched.', { pid: first.pid });
    let sidecar = await waitFor(() => descendants(new Set([first.pid])).find((item) => String(item.Name).toLowerCase() === 'edith-backend.exe'), 30_000);
    if (!sidecar) fail('runtime.sidecar', 'Managed sidecar did not appear.');
    else {
      owned.add(Number(sidecar.ProcessId));
      pass('runtime.sidecar', 'Managed sidecar is an app descendant.', { pid: sidecar.ProcessId });
      process.kill(Number(sidecar.ProcessId), 'SIGTERM');
      const replacement = await waitFor(() => descendants(new Set([first.pid])).find((item) => String(item.Name).toLowerCase() === 'edith-backend.exe' && Number(item.ProcessId) !== Number(sidecar.ProcessId)), 15_000);
      if (replacement) { owned.add(Number(replacement.ProcessId)); pass('runtime.restart', 'Sidecar restarted after one controlled crash.', { oldPid: sidecar.ProcessId, newPid: replacement.ProcessId }); sidecar = replacement; }
      else fail('runtime.restart', 'Sidecar did not restart within the bounded window.');
    }
    second = spawn(exe, [], { cwd: path.dirname(exe), env, stdio: 'ignore', windowsHide: false });
    owned.add(second.pid);
    const secondExited = await waitFor(() => !snapshot().some((item) => Number(item.ProcessId) === second.pid), 10_000);
    if (secondExited && snapshot().some((item) => Number(item.ProcessId) === first.pid)) pass('runtime.single-instance', 'Second launch exited and first remained.', { first: first.pid, second: second.pid });
    else fail('runtime.single-instance', 'Duplicate instance was not rejected cleanly.');
    const tree = descendants(new Set([first.pid]));
    tree.forEach((item) => owned.add(Number(item.ProcessId)));
    const posted = postClose(first.pid);
    if (!posted) fail('runtime.close', 'No app window accepted normal close.');
    else if (await waitFor(() => tree.every((item) => !snapshot().some((current) => Number(current.ProcessId) === Number(item.ProcessId))), 15_000)) pass('runtime.close', 'Normal close left no observed app descendants.', { posted });
    else fail('runtime.close', 'Normal close left an observed process alive.');
  } finally {
    for (const item of snapshot()) if (owned.has(Number(item.ProcessId))) { try { process.kill(Number(item.ProcessId), 'SIGTERM'); } catch {} }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

staticChecks();
const release = path.join(root, 'src-tauri', 'target', 'release');
const exe = path.join(release, 'edith.exe');
const rustSources = fs.readdirSync(path.join(root, 'src-tauri', 'src'))
  .filter((name) => name.endsWith('.rs'))
  .map((name) => path.join(root, 'src-tauri', 'src', name));
const releaseInputs = [
  ...rustSources,
  path.join(root, 'src-tauri', 'build.rs'),
  path.join(root, 'src-tauri', 'Cargo.toml'),
  path.join(root, 'src-tauri', 'Cargo.lock'),
  path.join(root, 'src-tauri', 'tauri.conf.json'),
  path.join(root, 'src-tauri', 'capabilities', 'default.json'),
  path.join(root, 'scripts', 'build-edith-sidecar.mjs'),
];
const frontendInputs = uniqueFiles([
  ...listFiles(path.join(root, 'src')),
  path.join(root, 'index.html'),
  path.join(root, 'vite.config.ts'),
  path.join(root, 'tsconfig.json'),
  path.join(root, 'package.json'),
  path.join(root, 'package-lock.json'),
]);
const backendInputs = uniqueFiles([
  path.join(root, 'server.ts'),
  ...listFiles(path.join(root, 'server')),
  ...listFiles(path.join(root, 'src', 'edith')),
  path.join(root, 'package.json'),
  path.join(root, 'package-lock.json'),
  path.join(root, 'scripts', 'build-edith-sidecar.mjs'),
]);
const cryptoPackageInputs = listFiles(path.join(root, 'crypto'), (file) => {
  const relative = path.relative(path.join(root, 'crypto'), file).replaceAll('\\', '/');
  return /^(?:run_agent\.py|requirements(?:\.lock)?\.txt)$/i.test(relative)
    || /^src\/(?!test[^/]*\.py$)[^/]+\.py$/i.test(relative)
    || /^templates\/[^/]+\.html$/i.test(relative)
    || /^config\/[^/]+\.json$/i.test(relative);
});
const packagingInputs = uniqueFiles([
  ...releaseInputs,
  ...frontendInputs,
  ...backendInputs,
  ...cryptoPackageInputs,
  ...[
    'build-edith-tauri.mjs',
    'desktop-python-lock.mjs',
    'edith-crypto-python.mjs',
    'package-edith-portable.mjs',
    'portable-edith-lib.mjs',
    'run-edith-crypto-python.mjs',
    'stage-edith-crypto-resources.mjs',
    'verify-edith-portable.mjs',
  ].map((name) => path.join(root, 'scripts', name)),
]);
const newestReleaseInput = newestInput(releaseInputs)?.mtimeMs ?? Number.POSITIVE_INFINITY;
const artifacts = [exe, path.join(release, 'edith-backend.exe'), ...['msi', 'nsis'].flatMap((kind) => {
  const dir = path.join(release, 'bundle', kind); return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => path.join(dir, name)).filter((file) => fs.statSync(file).isFile()) : [];
})];
for (const file of artifacts) {
  if (!fs.existsSync(file)) { blocker('artifact.present', 'Release artifact missing.', { file }); continue; }
  pass('artifact.present', 'Release artifact found.', { file, bytes: fs.statSync(file).size, sha256: sha256(file) });
  try {
    const status = authenticode(file);
    status === 'Valid' ? pass('artifact.authenticode', 'Authenticode signature is valid.', { file }) : blocker('artifact.authenticode', 'Production signature is not valid.', { file, status });
  } catch (error) {
    blocker('artifact.authenticode', 'Authenticode tooling could not verify the artifact.', { file, error: String(error) });
  }
}
const msi = path.join(release, 'bundle', 'msi', 'E.D.I.T.H._1.0.0_x64_en-US.msi');
const nsis = path.join(release, 'bundle', 'nsis', 'E.D.I.T.H._1.0.0_x64-setup.exe');
const portableRoot = path.join(root, 'artifacts', 'desktop', 'portable', 'E.D.I.T.H.-1.0.0-windows-x64');
const portableZip = path.join(root, 'artifacts', 'desktop', 'E.D.I.T.H.-1.0.0-windows-x64.zip');
checkFreshness(exe, uniqueFiles([...releaseInputs, ...frontendInputs]), 'desktop-exe');
checkFreshness(path.join(release, 'edith-backend.exe'), backendInputs, 'backend-sidecar');
checkFreshness(msi, packagingInputs, 'msi');
checkFreshness(nsis, packagingInputs, 'nsis');
checkFreshness(portableZip, packagingInputs, 'portable-zip');
checkHashMatch(exe, path.join(portableRoot, 'edith.exe'), 'portable-desktop-exe');
checkHashMatch(path.join(release, 'edith-backend.exe'), path.join(portableRoot, 'edith-backend.exe'), 'portable-backend-sidecar');
checkTreeMatch(path.join(root, 'dist'), path.join(portableRoot, 'dist'), 'portable-frontend-tree');
const currentArtifact = fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= newestReleaseInput;
if (fs.existsSync(exe) && !currentArtifact) blocker('artifact.freshness', 'Packaged executable predates current release inputs; runtime smoke is refused.', { exe });
if (currentArtifact) await runtime(exe);
else if (!fs.existsSync(exe)) blocker('runtime.launch', 'Packaged executable is absent.');
else blocker('runtime.launch', 'Runtime smoke skipped because the packaged executable is stale.');
const summary = { status: results.some((item) => item.status === 'FAIL') ? 'FAIL' : results.some((item) => item.status === 'EXTERNAL_BLOCKER') ? 'EXTERNAL_BLOCKER' : 'PASS', counts: Object.fromEntries(['PASS', 'FAIL', 'EXTERNAL_BLOCKER'].map((status) => [status, results.filter((item) => item.status === status).length])), results };
console.log(`EDITH_DESKTOP_RELEASE_SMOKE_RESULT=${JSON.stringify(summary)}`);
process.exitCode = summary.status === 'FAIL' ? 1 : summary.status === 'EXTERNAL_BLOCKER' ? 2 : 0;
