import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const resources = path.join(root, '.edith-build', 'desktop', 'resources');
const cryptoRoot = path.join(resources, 'crypto');
const python = path.join(resources, 'python', 'python.exe');
assert.ok(fs.statSync(path.join(cryptoRoot, 'run_agent.py')).isFile());
assert.ok(fs.statSync(python).isFile(), 'staged package must contain python/python.exe');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-staged-crypto-'));
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const logPath = path.join(temp, 'service.log');
const log = fs.openSync(logPath, 'w');
const token = `staged-runtime-${process.pid}-${Date.now()}`;
const service = spawn(python, [path.join(cryptoRoot, 'run_agent.py')], {
  cwd: cryptoRoot,
  windowsHide: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    EDITH_PACKAGED: 'true',
    EDITH_CRYPTO_RESOURCE_DIR: cryptoRoot,
    EDITH_CRYPTO_RUNTIME_DATA_DIR: temp,
    EDITH_CRYPTO_INTERNAL_TOKEN: token,
    CRYPTO_DB_PATH: path.join(temp, 'data', 'agent_memory.db'),
    CRYPTO_DATA_DIR: path.join(temp, 'data'),
    CRYPTO_LOG_DIR: path.join(temp, 'logs'),
    CRYPTO_PORT: String(port),
    CRYPTO_STARTING_BALANCE: '10000',
    JEV_API_KEY: '',
  },
});

try {
  let health;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (service.exitCode !== null) throw new Error(`staged runtime exited with ${service.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(health?.healthy, fs.readFileSync(logPath, 'utf8'));
  const statusResponse = await fetch(`http://127.0.0.1:${port}/api/crypto/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  const statusData = status.data ?? status;
  assert.equal(statusData.realOrderEndpointsAvailable, false);
  assert.equal(statusData.liveExecutionEnabled, false);
  const portfolioResponse = await fetch(`http://127.0.0.1:${port}/api/crypto/portfolio`);
  assert.equal(portfolioResponse.status, 200);
  const portfolioBody = await portfolioResponse.json();
  const portfolio = portfolioBody.data?.portfolio ?? portfolioBody.portfolio;
  assert.equal(portfolio.initialBalance, 10000);
  assert.equal(portfolio.currentCash, 10000);

  const evidence = {
    result: 'PASS',
    packagedPython: path.relative(root, python).replaceAll('\\', '/'),
    packagedEntrypoint: path.relative(root, path.join(cryptoRoot, 'run_agent.py')).replaceAll('\\', '/'),
    healthStatus: 200,
    cryptoStatus: 200,
    startingCredits: 10000,
    realOrderEndpointsAvailable: false,
    liveExecutionEnabled: false,
    jevCurrentHealth: statusData.jev?.health?.state ?? null,
    historicalDecisionIncludedInHealth: false,
  };
  const evidencePath = path.join(root, 'artifacts', 'crypto-terminal', 'packaged-staged-runtime.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
} finally {
  if (service.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(service.pid), '/T', '/F'], { stdio: 'ignore' });
    else service.kill('SIGTERM');
  }
  fs.closeSync(log);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
