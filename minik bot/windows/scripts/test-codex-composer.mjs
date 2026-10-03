import assert from 'node:assert/strict';
import { build } from 'esbuild';
globalThis.window = {};
const result = await build({ stdin: {
  contents: 'export { codexDraft, sendCodexDraft } from "./src/views/codex-composer"; export { Bridge } from "./src/core/bridge";',
  resolveDir: process.cwd(), loader: 'ts',
}, bundle: true, write: false, platform: 'node', format: 'esm' });
const { codexDraft, sendCodexDraft, Bridge } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const draft = codexDraft('session-one'); draft.text = 'Türkçe test mesajı';
assert.equal(codexDraft('session-one'), draft, 'Draft survives redraw');
assert.equal(codexDraft('session-two').text, '', 'Draft must not leak to a different chat');
const calls = []; let complete;
Bridge.codexSendMessage = (session, text) => { calls.push({ session, text }); return new Promise(resolve => { complete = resolve; }); };
const pending = sendCodexDraft('session-one', draft);
assert.equal(draft.busy, true);
assert.equal(await sendCodexDraft('session-one', draft), false, 'No double send');
complete({ status: 'queued' }); assert.equal(await pending, true);
assert.deepEqual(calls, [{ session: 'session-one', text: 'Türkçe test mesajı' }]);
assert.equal(draft.text, ''); assert.equal(draft.busy, false);
assert.equal(draft.status, 'Codex kuyruğuna eklendi', 'Queue acceptance must not claim completed delivery');
draft.text = 'Preserve this'; Bridge.codexSendMessage = async () => { throw new Error('Not connected'); };
assert.equal(await sendCodexDraft('session-one', draft), false);
assert.equal(draft.text, 'Preserve this'); assert.equal(draft.status, 'Not connected'); assert.equal(draft.busy, false);
Bridge.codexSendMessage = async () => ({ status: 'unknown' });
assert.equal(await sendCodexDraft('session-one', draft), false); assert.equal(draft.text, 'Preserve this');
assert.equal(await sendCodexDraft('', draft), false);
console.log('PASS: existing-chat routing, Turkish text, per-session draft persistence, double-send protection, honest queue receipt, failure preservation');
