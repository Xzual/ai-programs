import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function existingFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existingFile(candidate));
}

function splitPathEntries(value) {
  return String(value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveCargoPath() {
  if (process.platform !== 'win32') {
    const result = spawnSync('command', ['-v', 'cargo'], {
      encoding: 'utf8',
      shell: true,
    });
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : undefined;
  }

  const whereResult = spawnSync('where.exe', ['cargo'], {
    encoding: 'utf8',
    shell: false,
  });
  const whereCandidates = whereResult.status === 0
    ? whereResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];

  const pathCandidates = [
    ...splitPathEntries(process.env.Path),
    ...splitPathEntries(process.env.PATH),
  ].flatMap((entry) => [
    path.join(entry, 'cargo.exe'),
    path.join(entry, 'cargo.cmd'),
    path.join(entry, 'cargo.bat'),
  ]);

  const userProfile = process.env.USERPROFILE;
  const fallbackCandidates = userProfile
    ? [
        path.join(userProfile, '.cargo', 'bin', 'cargo.exe'),
        path.join(`${userProfile}.cargo`, 'bin', 'cargo.exe'),
      ]
    : [];

  return firstExisting([
    ...whereCandidates,
    ...pathCandidates,
    ...fallbackCandidates,
  ]);
}

function printCargoHelp() {
  console.error('');
  console.error('E.D.I.T.H. Tauri dev cannot start because Rust/Cargo is not available in PATH.');
  console.error('');
  console.error('Install Rust from:');
  console.error('  https://www.rust-lang.org/tools/install');
  console.error('');
  console.error('Then open a new terminal and verify:');
  console.error('  cargo --version');
  console.error('');
  console.error('After that, run again:');
  console.error('  npm run tauri:dev');
  console.error('');
  console.error('Browser-only development still works with:');
  console.error('  npm run dev');
  console.error('');
}

const cargoPath = resolveCargoPath();

if (!cargoPath) {
  printCargoHelp();
  process.exit(1);
}

console.log(`E.D.I.T.H. Tauri dev detected Cargo at: ${cargoPath}`);

const cargoBin = path.dirname(cargoPath);
const env = { ...process.env };
env.Path = [cargoBin, process.env.Path].filter(Boolean).join(path.delimiter);
env.PATH = [cargoBin, process.env.PATH].filter(Boolean).join(path.delimiter);

const tauriCommand = 'tauri';
const child = spawn(tauriCommand, ['dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(`Failed to start Tauri CLI: ${error.message}`);
  console.error('Try running: npm install');
  process.exit(1);
});
