import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ stdin: { contents: 'export { launchSummary } from "./src/views/shortcuts"; export { mediaTime } from "./src/views/utilities";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { launchSummary, mediaTime } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
assert.equal(mediaTime(125.5),'2:05'); assert.equal(mediaTime(-1),'0:00'); assert.equal(mediaTime(NaN),'0:00');
assert.equal(launchSummary([{ name: 'Notepad', opened: true, error: null }, { name: 'Calculator', opened: true, error: null }]), '2/2 uygulamaya açma isteği gönderildi');
assert.equal(launchSummary([{ name: 'Notepad', opened: true, error: null }, { name: 'Taşınmış uygulama', opened: false, error: 'Bulunamadı' }]), '1/2 uygulamaya açma isteği gönderildi · Taşınmış uygulama: Bulunamadı');
assert.equal(launchSummary([{ name: 'Eksik', opened: false, error: 'Bulunamadı' }]), '0/1 uygulamaya açma isteği gönderildi · Eksik: Bulunamadı');
console.log('PASS: shortcut launch feedback reports shell acceptance and partial/all failures honestly');
