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

function ps(script, env = process.env) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env, timeout: 20_000 }).trim();
}

function snapshot() {
  const raw = ps('$items=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath; @($items) | ConvertTo-Json -Compress');
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
  const csp = config.app?.security?.csp ?? '';
  const forbidden = capability.permissions.filter((item) => /shell|http|fs:|global-shortcut|clipboard|process/i.test(item));
  const checks = {
    csp: csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && !csp.includes("'unsafe-eval'"),
    capability: capability.windows?.length === 1 && capability.windows[0] === 'main' && forbidden.length === 0,
    singleInstance: cargo.includes('tauri-plugin-single-instance') && lib.includes('tauri_plugin_single_instance::init'),
    boundedRestart: lib.includes('MAX_SIDECAR_RESTARTS: usize = 3') && lib.includes('RESTART_BACKOFF_MS[attempt]'),
    coordinatedClose: /fn close_window[\s\S]{0,180}begin_shutdown/.test(lib) && lib.includes('api.prevent_exit()'),
    loopbackSidecar: lib.includes('TcpListener::bind(("127.0.0.1", 0))') && lib.includes('.sidecar("edith-backend")'),
  };
  for (const [check, ok] of Object.entries(checks)) ok ? pass(`static.${check}`, 'Invariant present.') : fail(`static.${check}`, 'Invariant missing.');
}

async function runtime(exe) {
  const normalized = path.resolve(exe).toLowerCase();
  const preexisting = snapshot().filter((item) => item.ExecutablePath && path.resolve(item.ExecutablePath).toLowerCase() === normalized);
  if (preexisting.length) return blocker('runtime.launch', 'Existing exact executable instance prevents isolated smoke.', { pids: preexisting.map((item) => item.ProcessId) });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-release-'));
  const env = { ...process.env, LOCALAPPDATA: temp, APPDATA: temp };
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
const artifacts = [exe, path.join(release, 'edith-backend.exe'), ...['msi', 'nsis'].flatMap((kind) => {
  const dir = path.join(release, 'bundle', kind); return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => path.join(dir, name)).filter((file) => fs.statSync(file).isFile()) : [];
})];
for (const file of artifacts) {
  if (!fs.existsSync(file)) { blocker('artifact.present', 'Release artifact missing.', { file }); continue; }
  pass('artifact.present', 'Release artifact found.', { file, bytes: fs.statSync(file).size, sha256: sha256(file) });
  const status = ps('$s=Get-AuthenticodeSignature -LiteralPath $env:EDITH_FILE; [string]$s.Status', { ...process.env, EDITH_FILE: file });
  status === 'Valid' ? pass('artifact.authenticode', 'Authenticode signature is valid.', { file }) : blocker('artifact.authenticode', 'Production signature is not valid.', { file, status });
}
if (fs.existsSync(exe)) await runtime(exe);
else blocker('runtime.launch', 'Packaged executable is absent.');
const summary = { status: results.some((item) => item.status === 'FAIL') ? 'FAIL' : results.some((item) => item.status === 'EXTERNAL_BLOCKER') ? 'EXTERNAL_BLOCKER' : 'PASS', counts: Object.fromEntries(['PASS', 'FAIL', 'EXTERNAL_BLOCKER'].map((status) => [status, results.filter((item) => item.status === status).length])), results };
console.log(`EDITH_DESKTOP_RELEASE_SMOKE_RESULT=${JSON.stringify(summary)}`);
process.exitCode = summary.status === 'FAIL' ? 1 : summary.status === 'EXTERNAL_BLOCKER' ? 2 : 0;
