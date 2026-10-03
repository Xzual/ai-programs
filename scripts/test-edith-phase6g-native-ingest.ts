import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const native = await readFile(new URL('../src-tauri/src/cross_device.rs', import.meta.url), 'utf8');
const tauri = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../src/edith/crossDeviceDesktopBridge.ts', import.meta.url), 'utf8');

assert.match(tauri, /cross_device::cross_device_producer_ingest/);
assert.match(native, /window\.label\(\) != "main"/);
assert.match(native, /http:\/\/127\.0\.0\.1:/);
assert.match(native, /EDITH_DESKTOP_BRIDGE_TOKEN/);
const bootstrapHttp = native.slice(native.indexOf('fn request_producer_bootstrap('), native.indexOf('fn bootstrap_producer('));
assert.match(bootstrapHttp, /\.bearer_auth\(&bridge\.token\)/);
assert.match(bootstrapHttp, /http:\/\/127\.0\.0\.1:/);
const bootstrapResult = native.slice(native.indexOf('Ok(ProducerCommandResult', native.indexOf('fn bootstrap_producer(')), native.indexOf('fn ingest_producer('));
assert.doesNotMatch(bootstrapResult, /producerSessionToken|bridge\.token|Authorization|authorization/);
assert.match(native, /X-Edith-Producer-Sequence/);
assert.match(native, /status != 202/);
assert.match(native, /DESKTOP_PRODUCER_PRIVATE_DATA_FORBIDDEN/);
assert.match(native, /inner\.producer\.take\(\)/);
assert.match(tauri, /state::<cross_device::CrossDeviceState>\(\)[\s\S]{0,100}\.clear_bridge\(\)/);
assert.doesNotMatch(native, /\b(?:println|eprintln|dbg)!/);

const frontendRequest = bridge.slice(bridge.indexOf("request: { operation: 'ingest'"), bridge.indexOf("request: { operation: 'ingest'") + 220);
assert.match(frontendRequest, /kind, payload/);
assert.doesNotMatch(frontendRequest, /producerSessionToken|sequence|authorization|endpoint/);
assert.doesNotMatch(bridge, /interface LocalProducerSession[\s\S]{0,160}\btoken:/);
assert.doesNotMatch(bridge, /interface LocalProducerSession[\s\S]{0,160}\bnextSequence:/);

console.log(JSON.stringify({
  success: true,
  checks: [
    'command_registered',
    'main_webview_only',
    'fixed_loopback_backend',
    'native_bridge_secret',
    'bootstrap_exact_native_bearer',
    'bootstrap_result_secret_free',
    'native_exact_next_sequence',
    'backend_202_only',
    'private_data_rejected',
    'lifecycle_revocation',
    'no_native_debug_logs',
    'no_frontend_producer_token_or_sequence',
  ],
}, null, 2));
