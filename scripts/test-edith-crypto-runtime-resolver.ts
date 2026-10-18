import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { build } from 'esbuild';
import { stageCryptoResources } from './stage-edith-crypto-resources.mjs';
import { BinanceSpotService } from '../server/crypto/binanceSpotService';
import { killSwitchService } from '../src/edith/killSwitch';

assert.equal(process.env.EDITH_TEST_MODE, 'true');
assert.ok(process.env.EDITH_TEST_DATA_DIR);
const root = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-managed-crypto-repair-'));
const resource = path.join(fixture, 'resources', 'crypto');
const runtime = path.join(fixture, 'custom-runtime-not-under-persistence');
const cache = path.join(fixture, 'numba-cache');
fs.mkdirSync(runtime, { recursive: true });
const staged = stageCryptoResources({ source: path.join(root, 'crypto'), destination: resource, allowedDestinationRoot: path.join(fixture, 'resources') });
assert.ok(staged.files.includes('src/demo_safety.py'));
const entry = path.join(resource, 'run_agent.py');
const originalEntry = fs.readFileSync(entry, 'utf8');
// Only the temporary test copy is prefixed. It runs the actual Python service
// with no mocked health/portfolio implementation and blocks all external I/O.
const guard = String.raw`
import sys, os, pathlib, json
_fixture = pathlib.Path(os.environ['REPAIR_FIXTURE_ROOT']).resolve()
def _audit(event, args):
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        p = pathlib.Path(os.fsdecode(args[0])).resolve()
        writing = bool(args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
        if writing and p != _fixture and _fixture not in p.parents:
            raise PermissionError('REPAIR_WRITE_OUTSIDE_FIXTURE')
        if p.name == '.env' or str(p).casefold().startswith('d:'):
            raise PermissionError('REPAIR_ENV_VAULT_READ_FORBIDDEN')
    if event in ('socket.connect', 'socket.getaddrinfo'):
        target = args[1][0] if event == 'socket.connect' else args[0]
        if target not in ('127.0.0.1', '::1', 'localhost', None):
            with (_fixture / 'external-attempts.json').open('w') as f: json.dump({'attempted':True}, f)
            raise PermissionError('REPAIR_EXTERNAL_NETWORK_FORBIDDEN')
sys.addaudithook(_audit)
`;
fs.writeFileSync(entry, guard + '\n' + originalEntry);
const portProbe = net.createServer();
await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const address = portProbe.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
process.env.EDITH_CRYPTO_RESOURCE_DIR = resource;
process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR = runtime;
process.env.EDITH_CRYPTO_SERVICE_URL = `http://127.0.0.1:${port}`;
process.env.EDITH_CRYPTO_LOG_PATH = path.join(fixture, 'backend-launch.log');
process.env.CRYPTO_PORT = String(port);
process.env.NUMBA_CACHE_DIR = cache;
process.env.PYTHON_DOTENV_DISABLED = '1';
process.env.REPAIR_FIXTURE_ROOT = fixture;
process.env.JEV_API_KEY = '';
for (const k of ['EDITH_CRYPTO_PYTHON_PATH', 'EDITH_PACKAGED', 'EDITH_APP_RESOURCE_DIR', 'EDITH_CRYPTO_GLOBAL_KILL_SWITCH_PATH', 'EDITH_CRYPTO_LOCAL_KILL_SWITCH_PATH']) delete process.env[k];
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Node external network forbidden');
  return originalFetch(input, init);
}) as typeof fetch;
const { CryptoService } = await import('../src/edith/cryptoService');
const service = new CryptoService();
const binance = new BinanceSpotService(async () => { throw Error('Private/public provider network forbidden in managed smoke'); });
const get = async (endpoint: string) => {
  const response = await fetch(process.env.EDITH_CRYPTO_SERVICE_URL! + endpoint);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data ?? body;
};
let child: any;
try {
  const expected = path.join(root, '.edith-build', 'desktop', 'resources', 'python', 'python.exe');
  const before = await service.status();
  assert.equal(before.pythonPath, expected, 'actual backend default uses authoritative vetted runtime');
  assert.equal(before.healthy, false);
  const started = await service.start('isolated repair backend launch');
  child = (service as any).child;
  assert.ok(child?.pid);
  assert.equal(started.healthy, true, started.error);
  assert.equal(started.pythonPath, expected);
  const status = await get('/api/crypto/status');
  assert.equal(status.realOrderEndpointsAvailable, false);
  assert.equal(status.liveExecutionEnabled, false);
  assert.equal(status.demoInitialBalance, 10000);
  assert.equal(status.killSwitch, false);
  const portfolio = await get('/api/crypto/portfolio');
  assert.equal(portfolio.portfolio.currentCash, 10000);
  binance.setKillSwitch(true);
  assert.equal((await get('/api/crypto/status')).killSwitch, true, 'custom runtime local path is passed explicitly');
  binance.setKillSwitch(false);
  killSwitchService.activate('isolated backend global coupling', 'test');
  assert.equal((await get('/api/crypto/status')).killSwitch, true, 'global persistence path must not be inferred from custom runtime parent');
  const stopped = await fetch(process.env.EDITH_CRYPTO_SERVICE_URL! + '/api/crypto/jev/loop/start', {
    method: 'POST', headers: { 'content-type': 'application/json', ...service.internalRequestHeaders() }, body: '{}',
  });
  assert.equal(stopped.status, 423);
  killSwitchService.deactivate('test');
  assert.equal((await get('/api/crypto/status')).killSwitch, false);
  const safety = path.join(resource, 'src', 'demo_safety.py');
  const withheld = path.join(resource, 'src', 'demo_safety.withheld');
  fs.renameSync(safety, withheld);
  try {
    const stale = await service.status();
    assert.equal(stale.healthy, false, 'running old/partial resource health cannot mask missing safety module');
    assert.equal(stale.errorCode, 'resource_missing');
  } finally { fs.renameSync(withheld, safety); }
  process.env.EDITH_CRYPTO_PYTHON_PATH = 'relative-python.exe';
  assert.equal((await service.status()).errorCode, 'runtime_missing');
  delete process.env.EDITH_CRYPTO_PYTHON_PATH;
  const bundled = await build({ entryPoints: [path.join(root, 'src', 'edith', 'cryptoService.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' });
  assert.ok(bundled.outputFiles?.[0].text.includes('resolveEdithCryptoPython'));
  assert.equal(fs.existsSync(path.join(fixture, 'external-attempts.json')), false);
  const launchLog = fs.readFileSync(process.env.EDITH_CRYPTO_LOG_PATH!, 'utf8');
  assert.equal(launchLog.includes('REPAIR_EXTERNAL_NETWORK_FORBIDDEN'), false);
  service.stop('isolated successful launch cleanup');
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => child.once('close', () => resolve()));
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  const savedEntry = fs.readFileSync(entry, 'utf8');
  fs.writeFileSync(entry, 'import sys; sys.exit(23)\n');
  try {
    const failed = await service.start('isolated early-exit lifecycle regression');
    assert.equal(failed.healthy, false);
    assert.equal(failed.managedProcessRunning, false, 'failed child must not report running');
    assert.equal(failed.lastExit?.code, 23);
  } finally { fs.writeFileSync(entry, savedEntry); }
  console.log(JSON.stringify({ pass: true, mode: 'actual-managed-backend-dev-resolver-start', fixture, selectedPython: started.pythonPath, childPid: child.pid, initialCredits: 10000, customRuntimeKillPathParity: true, staleSafetyModuleRejected: true, explicitOverrideRejected: true, earlyExitHonestState: true, logCloseLifecycle: true, externalNetworkAttempts: 0, realOrders: 0, mjsTsxCjsBundleCompatible: true }));
} finally {
  delete process.env.EDITH_CRYPTO_PYTHON_PATH;
  service.stop('isolated repair cleanup');
  if (child && child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>((_, reject) => setTimeout(() => reject(Error('Child cleanup timeout')), 10000))]);
  }
  globalThis.fetch = originalFetch;
}
