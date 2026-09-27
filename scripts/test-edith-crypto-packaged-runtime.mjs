import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';
import { stageCryptoResources } from './stage-edith-crypto-resources.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'crypto');
const pythonPath = resolveEdithCryptoPython(root);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-crypto-packaged-'));
const resourceRoot = path.join(temp, 'app resources', 'crypto');
const runtimeRoot = path.join(temp, 'user state');
const unrelatedCwd = path.join(temp, 'unrelated cwd');
fs.mkdirSync(resourceRoot, { recursive: true });
fs.mkdirSync(unrelatedCwd, { recursive: true });
const stagedResources = stageCryptoResources({
  source,
  destination: resourceRoot,
  allowedDestinationRoot: path.dirname(resourceRoot),
});
assert.ok(stagedResources.files.includes('run_agent.py'));
assert.ok(stagedResources.files.includes('requirements.txt'));
assert.equal(stagedResources.files.some((file) => /^(?:data|logs|\.venv|__pycache__)(?:\/|$)/i.test(file)), false);
assert.equal(stagedResources.files.some((file) => /(?:^|\/)\.env(?:\.|$)/i.test(file)), false);
const packagedAssetModesPath = path.join(resourceRoot, 'config', 'demo_asset_modes.json');
const packagedAssetModesBefore = fs.readFileSync(packagedAssetModesPath);

function dependencyRequire() {
  const roots = [root, path.resolve(root, '..', '..', '..', '..', 'Desktop', 'ai programs')];
  const dependencyRoot = roots.find((candidate) => fs.existsSync(path.join(candidate, 'node_modules', 'esbuild')));
  assert.ok(dependencyRoot, 'Node dependencies are required for the Express packaged integration smoke');
  return createRequire(path.join(dependencyRoot, 'package.json'));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

const port = await freePort();
const cryptoToken = `packaged-smoke-${process.pid}-${Date.now()}`;

const logPath = path.join(temp, 'launcher.log');
const log = fs.openSync(logPath, 'w');
const launcher = spawn(process.execPath, [path.join(root, 'scripts', 'start-crypto-observer.mjs')], {
  cwd: unrelatedCwd,
  windowsHide: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    EDITH_PACKAGED: 'true',
    EDITH_CRYPTO_RESOURCE_DIR: resourceRoot,
    EDITH_CRYPTO_RUNTIME_DATA_DIR: runtimeRoot,
    EDITH_CRYPTO_PYTHON_PATH: pythonPath,
    CRYPTO_PORT: String(port),
    EDITH_CRYPTO_INTERNAL_TOKEN: cryptoToken,
    JEV_API_KEY: '',
  },
});

async function waitForJson(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) {
      const output = fs.readFileSync(logPath, 'utf8');
      throw new Error(`Packaged runtime exited early: ${launcher.exitCode}\n${output}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function expressManagedPathSmoke() {
  const requireFromDependencies = dependencyRequire();
  const { build } = requireFromDependencies('esbuild');
  const express = requireFromDependencies('express');
  const proxyPort = await freePort();
  const managedCryptoPort = await freePort();
  const expressRuntimeRoot = path.join(temp, 'express managed state');
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['server/routes/crypto.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    plugins: [{
      name: 'packaged-runtime-isolation',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/audit$/ }, () => ({ path: 'audit', namespace: 'qa-fixture' }));
        builder.onResolve({ filter: /^\.\/workspaceManager$/ }, () => ({ path: 'workspace', namespace: 'qa-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'qa-fixture' }, (args) => ({
          contents: args.path === 'audit'
            ? 'export const createAuditEvent = (event) => event; export const appendAuditEvent = () => undefined;'
            : `export const workspaceManager = { getResolvedPaths: () => (${JSON.stringify({
              dataPath: expressRuntimeRoot,
              logsPath: path.join(expressRuntimeRoot, 'logs'),
              obsidianVaultPath: '',
            })}) };`,
        }));
      },
    }],
  });
  const module = { exports: {} };
  const isolatedEnv = {
    ...process.env,
    EDITH_PACKAGED: 'true',
    EDITH_CRYPTO_RESOURCE_DIR: resourceRoot,
    EDITH_CRYPTO_PROJECT_PATH: resourceRoot,
    EDITH_CRYPTO_RUNTIME_DATA_DIR: expressRuntimeRoot,
    EDITH_CRYPTO_PYTHON_PATH: pythonPath,
    EDITH_CRYPTO_SERVICE_URL: `http://127.0.0.1:${managedCryptoPort}`,
    CRYPTO_PORT: String(managedCryptoPort),
    JEV_API_KEY: '',
  };
  const isolatedProcess = {
    env: isolatedEnv,
    platform: process.platform,
    cwd: () => unrelatedCwd,
    once: () => undefined,
  };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: requireFromDependencies,
    process: isolatedProcess,
    console,
    Buffer,
    URL,
    AbortController,
    DOMException,
    fetch,
    Headers,
    setTimeout,
    clearTimeout,
  });

  const app = express();
  app.use(express.json());
  app.use(module.exports.createCryptoRouter());
  const server = await new Promise((resolve) => {
    const listening = app.listen(proxyPort, '127.0.0.1', () => resolve(listening));
  });
  try {
    const startedResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/crypto/start-service`, {
      method: 'POST',
    });
    assert.equal(startedResponse.status, 200, 'managed service start must not return missing-script 503');
    const started = await startedResponse.json();
    assert.equal(started.success, true);
    assert.equal(started.status.healthy, true, started.status.error);
    assert.equal(path.resolve(started.status.scriptPath), path.join(resourceRoot, 'run_agent.py'));

    const statusResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/crypto/status`);
    assert.equal(statusResponse.status, 200, 'Express packaged status must not return 503');
    const status = await statusResponse.json();
    assert.equal(status.ok, true);
    assert.equal(status.data?.running ?? status.running, true);
    assert.equal(status.data?.realOrderEndpointsAvailable ?? status.realOrderEndpointsAvailable, false);

    const managedStatusResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/edith/crypto/status`);
    assert.equal(managedStatusResponse.status, 200);
    const managedStatus = await managedStatusResponse.json();
    assert.equal(managedStatus.status?.runtime?.resourceLayout?.ready, true);
    assert.deepEqual(managedStatus.status?.runtime?.resourceLayout?.missing, []);
    return { expressManagedStart: true, expressStatusNo503: true };
  } finally {
    await fetch(`http://127.0.0.1:${proxyPort}/api/crypto/stop-service`, { method: 'POST' }).catch(() => undefined);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await fetch(`http://127.0.0.1:${managedCryptoPort}/api/health`, { signal: AbortSignal.timeout(150) });
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        break;
      }
    }
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
  }
}

try {
  const health = await waitForJson(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.healthy, true);
  assert.equal(health.runtime.resourceLayout.ready, true);
  assert.deepEqual(health.runtime.resourceLayout.missing, []);
  assert.equal(health.runtime.resourceLayout.stateSeparatedFromResources, true);
  assert.equal(health.tradingEnabled, false);
  assert.equal(health.liveTradingEnabled, false);
  assert.equal(health.binanceCredentialsUsed, false);

  const portfolioResponse = await fetch(`http://127.0.0.1:${port}/api/crypto/portfolio`);
  assert.equal(portfolioResponse.ok, true);
  const portfolioBody = await portfolioResponse.json();
  const portfolio = portfolioBody.portfolio || portfolioBody.data?.portfolio;
  assert.equal(portfolio.currentCash, 10000);
  const assetModeResponse = await fetch(`http://127.0.0.1:${port}/api/crypto/watchlist/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Internal-Token': cryptoToken },
    body: JSON.stringify({ symbol: 'BTC/USDT', mode: 'WATCH_ONLY' }),
  });
  assert.equal(assetModeResponse.status, 200);
  assert.equal((await assetModeResponse.json()).ok, true);
  assert.deepEqual(
    fs.readFileSync(packagedAssetModesPath),
    packagedAssetModesBefore,
    'asset mode update must not mutate packaged resources',
  );
  assert.equal(
    fs.existsSync(path.join(runtimeRoot, 'config', 'demo_asset_modes.json')),
    true,
    'asset mode override must be runtime state',
  );
  assert.equal(fs.existsSync(path.join(resourceRoot, 'data')), false, 'resource tree must remain state-free');
  assert.equal(fs.existsSync(path.join(resourceRoot, 'logs')), false, 'resource tree must remain log-free');
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'data', 'agent_memory.db')), true);
  const managedPath = await expressManagedPathSmoke();

  console.log(JSON.stringify({
    pass: true,
    packagedResourceDiscovery: true,
    cwdIndependent: true,
    resourceLayout: health.runtime.resourceLayout,
    startingCredits: portfolio.currentCash,
    assetModeStateSeparatedFromResources: true,
    realOrdersAvailable: false,
    ...managedPath,
  }, null, 2));
} finally {
  if (process.platform === 'win32' && launcher.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore' });
  } else if (launcher.exitCode === null) {
    launcher.kill('SIGTERM');
  }
  fs.closeSync(log);
  const logText = fs.readFileSync(logPath, 'utf8');
  assert.doesNotMatch(logText, /JEV_API_KEY\s*=/i);
  fs.rmSync(temp, { recursive: true, force: true });
}
