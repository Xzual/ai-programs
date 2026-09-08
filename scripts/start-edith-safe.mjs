import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function childEnv(extraEnv = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extraEnv })
      .filter(([key, value]) => key && !key.startsWith('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

console.log('');
console.log('E.D.I.T.H. Safe Dev Startup');
console.log('===========================');
console.log('Crypto autostart: disabled');
console.log('');

const child = spawn(npmCommand, ['run', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  env: childEnv({
    EDITH_CRYPTO_AUTOSTART: 'false',
  }),
});

function stop(signal) {
  if (!child.killed) child.kill();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) process.exit(signal === 'SIGINT' ? 130 : 143);
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`Failed to start EDITH dev server: ${error.message}`);
  process.exit(1);
});
