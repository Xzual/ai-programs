import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      resolve(error?.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });
}

function isPortReachable(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: 'localhost', port });
    socket.setTimeout(600);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function spawnDevProcess(name, args, extraEnv = {}) {
  const child = spawn(npmCommand, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[E.D.I.T.H. Tauri Dev] ${name} exited with code ${code}.`);
      stopChildren();
      process.exit(code);
    }
  });
  child.on('error', (error) => {
    console.error(`[E.D.I.T.H. Tauri Dev] Failed to start ${name}: ${error.message}`);
    stopChildren();
    process.exit(1);
  });
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

if (await isPortInUse(3000) || await isPortReachable(3000)) {
  console.log('[E.D.I.T.H. Tauri Dev] Express API already reachable on http://localhost:3000');
} else {
  console.log('[E.D.I.T.H. Tauri Dev] Starting Express API on http://localhost:3000');
  spawnDevProcess('Express API', ['run', 'dev'], {
    PORT: '3000',
    EDITH_CRYPTO_AUTOSTART: 'false',
  });
}

if (await isPortInUse(5173) || await isPortReachable(5173)) {
  console.log('[E.D.I.T.H. Tauri Dev] Vite frontend already reachable on http://localhost:5173');
} else {
  console.log('[E.D.I.T.H. Tauri Dev] Starting Vite frontend on http://localhost:5173');
  spawnDevProcess('Vite frontend', ['run', 'vite:dev']);
}

setInterval(() => {}, 60_000);
