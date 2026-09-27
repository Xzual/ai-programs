import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageCryptoResources } from './stage-edith-crypto-resources.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-crypto-stage-'));
const source = path.join(temp, 'source');
const stagingRoot = path.join(temp, 'staging');
const destination = path.join(stagingRoot, 'crypto');

function write(relative, content = '') {
  const target = path.join(source, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

try {
  write('run_agent.py', 'print("safe runtime")\n');
  write('requirements.txt', 'flask==3.1.2\n');
  write('src/service.py', 'SAFE_DEFAULT = True\n');
  write('src/test_fixture.py', 'raise RuntimeError("must not ship")\n');
  write('templates/dashboard.html', '<!doctype html><title>Crypto</title>\n');
  write('config/coin_permissions.json', '{}\n');
  write('config/demo_asset_modes.json', '{}\n');
  write('config/observer_config.json', '{}\n');

  write('.env', 'JEV_API_KEY=must-not-ship\n');
  write('data/agent_memory.db', 'runtime data');
  write('logs/agent.log', 'runtime log');
  write('.venv/Scripts/python.exe', 'runtime binary');
  write('__pycache__/service.pyc', 'cache');
  write('README.md', 'developer documentation');
  write('secret_token.txt', 'must-not-ship');

  const result = stageCryptoResources({ source, destination, allowedDestinationRoot: stagingRoot });
  assert.deepEqual(result.files, [
    'config/coin_permissions.json',
    'config/demo_asset_modes.json',
    'config/observer_config.json',
    'requirements.txt',
    'run_agent.py',
    'src/service.py',
    'templates/dashboard.html',
  ]);
  assert.equal(fs.existsSync(path.join(destination, '.env')), false);
  assert.equal(fs.existsSync(path.join(destination, 'data')), false);
  assert.equal(fs.existsSync(path.join(destination, 'logs')), false);
  assert.equal(fs.existsSync(path.join(destination, '.venv')), false);
  assert.equal(fs.existsSync(path.join(destination, '__pycache__')), false);

  const unsafeSource = path.join(temp, 'unsafe-source');
  fs.cpSync(source, unsafeSource, { recursive: true });
  fs.writeFileSync(path.join(unsafeSource, 'src', 'unsafe.py'), 'api_key = "embedded-secret-value"\n', 'utf8');
  assert.throws(
    () => stageCryptoResources({
      source: unsafeSource,
      destination: path.join(stagingRoot, 'unsafe-crypto'),
      allowedDestinationRoot: stagingRoot,
    }),
    /Embedded secret-like assignment rejected/,
  );
  assert.throws(
    () => stageCryptoResources({
      source,
      destination: path.join(temp, 'outside-staging'),
      allowedDestinationRoot: stagingRoot,
    }),
    /escapes its allowed root/,
  );

  console.log(JSON.stringify({
    pass: true,
    stagedFiles: result.files,
    excludedRuntimeState: true,
    embeddedSecretRejected: true,
    destinationContainmentEnforced: true,
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
