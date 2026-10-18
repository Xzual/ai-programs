// Imports only the self-contained transport and Node builtins; no EDITH runtime.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'artifacts/rea-integration-20261017/chat5/adapter-core/transport');
const target = new URL('../src/edith/reaMcpClient.ts', import.meta.url);
let module: typeof import('../src/edith/reaMcpClient') | undefined;
try { module = await import(target.href); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
assert.equal(typeof module?.ReaMcpClient, 'function', 'REA stdio transport must expose a real client before it can communicate');
const { ReaMcpClient } = module!;
const launch = (mode: string, extra: Record<string, unknown> = {}) => ({
  command: process.execPath, args: [path.join(evidence, 'fixture.mjs'), mode], cwd: evidence,
  env: {}, expectedServerName: 'rea', expectedServerVersion: '6.5.0', protocolVersion: '2025-11-25',
  timeoutMs: 700, maxFrameBytes: 32768, maxTotalBytes: 262144, ...extra,
});
const cases: string[] = [];
async function run(name: string, work: () => Promise<void>) { await work(); cases.push(name); }
await run('initialize catalog call progress close use actual client', async () => {
  const client = new ReaMcpClient(launch('ok'));
  try {
    const info = await client.connect();
    assert.deepEqual(info.serverInfo, { name: 'rea', version: '6.5.0' });
    assert.deepEqual(info.tools.map(tool => tool.name), ['inspect']);
    const progress: unknown[] = [];
    assert.deepEqual(await client.callTool('inspect', {}, { onProgress: event => progress.push(event) }), { content: [{ type: 'text', text: 'synthetic-result' }], isError: false });
    assert.deepEqual(progress, [{ sequence: 1, message: 'Reading synthetic bytes' }, { sequence: 2 }]);
    await assert.rejects(client.callTool('not-in-catalog', {}), /TOOL_NOT_LISTED/);
  } finally { assert.deepEqual(await client.close(), { closed: true, unknownEffect: false }); }
});
await run('constructor snapshots caller owned launch args and identity', async () => {
  const source = launch('ok');
  const client = new ReaMcpClient(source);
  source.args[1] = 'version'; source.expectedServerName = 'mutated';
  try { assert.equal((await client.connect()).serverInfo.name, 'rea'); }
  finally { assert.equal((await client.close()).closed, true); }
});
for (const mode of ['version', 'protocol', 'capabilities', 'catalog', 'catalog-limit', 'init-timeout', 'list-timeout']) {
  await run(mode + ' fails closed during admission', async () => {
    const client = new ReaMcpClient(launch(mode));
    try { await assert.rejects(client.connect(), /REA_MCP_/); }
    finally { assert.equal((await client.close()).closed, true); }
  });
}
for (const mode of ['malformed', 'oversize', 'unknown-id', 'progress-backward', 'foreign-token', 'timeout']) {
  await run(mode + ' rejects pending call and closes peer', async () => {
    const client = new ReaMcpClient(launch(mode));
    try {
      await client.connect();
      await assert.rejects(client.callTool('inspect', {}), /REA_MCP_/);
    } finally { assert.equal((await client.close()).closed, true); }
  });
}
for (const mode of ['duplicate', 'late-progress']) await run(mode + ' poisons connection', async () => {
  const client = new ReaMcpClient(launch(mode));
  try {
    await client.connect();
    await client.callTool('inspect', {}).catch(() => undefined);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(client.callTool('inspect', {}), /REA_MCP_/);
  } finally { assert.equal((await client.close()).closed, true); }
});
await run('abort rejects only after owned close receipt', async () => {
  const client = new ReaMcpClient(launch('cancel'));
  try {
    await client.connect();
    const controller = new AbortController();
    const pending = client.callTool('inspect', {}, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: Error & { closed?: boolean; unknownEffect?: boolean }) => error.message.includes('REA_MCP_CANCELLED') && error.closed === true && error.unknownEffect === true);
  } finally { assert.equal((await client.close()).closed, true); }
});
console.log(JSON.stringify({ passed: true, cases, scope: 'synthetic stdio peer; actual transport import; no real REA/runtime/target/network' }));
