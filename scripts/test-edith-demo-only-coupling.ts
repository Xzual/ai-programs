import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BinanceSpotService } from '../server/crypto/binanceSpotService';
import { killSwitchService } from '../src/edith/killSwitch';

assert.equal(process.env.EDITH_TEST_MODE, 'true');
const data = process.env.EDITH_TEST_DATA_DIR!;
process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR = path.join(data, 'crypto');
delete process.env.EDITH_CRYPTO_GLOBAL_KILL_SWITCH_PATH;
delete process.env.EDITH_CRYPTO_LOCAL_KILL_SWITCH_PATH;
const service = new BinanceSpotService(async () => { throw new Error('Network forbidden'); });
const root = process.cwd();
const python = path.join(root, '.edith-build', 'desktop', 'resources', 'python', 'python.exe');
const reason = () => {
  const code = 'import sys; sys.path.insert(0,sys.argv[1]); from demo_safety import kill_reason; print(kill_reason() or "inactive")';
  const result = spawnSync(python, ['-I', '-B', '-c', code, path.join(root, 'crypto', 'src')], {
    env: { ...process.env, CRYPTO_OBSIDIAN_ENABLED: 'false' }, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
assert.equal(reason(), 'inactive');
service.setKillSwitch(true);
assert.equal(reason(), 'crypto_kill_switch_active', 'Node local stop file is consumed by Python without explicit path overrides');
killSwitchService.activate('fixture coupling stop', 'test');
service.setKillSwitch(false);
assert.equal(reason(), 'global_kill_switch_active', 'Python observes canonical EDITH global stop');
assert.equal(service.status().killSwitch, true);
killSwitchService.deactivate('test');
assert.equal(reason(), 'inactive');
console.log('PASS Node/Python canonical global/local kill path coupling; no network/private orders');
