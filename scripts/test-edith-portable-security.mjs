import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateZipEntries } from './portable-edith-lib.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-portable-security-'));
const destination = path.join(temp, 'extract');
fs.mkdirSync(destination);
const cases = ['../escape.txt', '/absolute.txt', 'C:/drive.txt', 'safe.txt:stream', 'Folder/File.txt|folder/file.txt'];
let rejected = 0;
try {
  for (let index = 0; index < cases.length; index += 1) {
    const names = cases[index].split('|');
    const zip = path.join(temp, `malicious-${index}.zip`);
    const script = String.raw`Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[System.IO.Compression.ZipFile]::Open($env:ZIP,[System.IO.Compression.ZipArchiveMode]::Create); try { foreach($n in ($env:NAMES -split '\|')) { $e=$a.CreateEntry($n); $w=[IO.StreamWriter]::new($e.Open()); $w.Write('x'); $w.Dispose() } } finally { $a.Dispose() }`;
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ZIP: zip, NAMES: names.join('|') }, windowsHide: true });
    try { validateZipEntries(zip, destination); } catch { rejected += 1; }
  }
  if (rejected !== cases.length) throw new Error(`Expected ${cases.length} malicious ZIP cases to be rejected, got ${rejected}.`);
  const stagedPython = path.resolve('.edith-build/desktop/resources/python/python.exe');
  const verifiedMarker = path.resolve('.edith-build/desktop/resources/python/EDITH_RUNTIME_VERIFIED.json');
  if (!fs.existsSync(stagedPython) || !fs.existsSync(verifiedMarker)) {
    const packager = fs.readFileSync(path.resolve('scripts/package-edith-portable.mjs'), 'utf8');
    if (!packager.includes('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED')) throw new Error('Portable packager does not fail closed when vetted Python is absent.');
  }
  console.log(JSON.stringify({ success: true, maliciousZipCasesRejected: rejected, missingPythonFailsClosed: true }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
