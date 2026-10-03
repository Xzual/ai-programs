import assert from 'node:assert/strict';
import { build } from 'esbuild';
let now = 0, nextId = 0;
const timers = new Map();
globalThis.window = {
  setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
  clearTimeout: id => timers.delete(id),
};
function advance(ms) {
  const until = now + ms;
  while (true) {
    const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at; timers.delete(due[0]); due[1].fn();
  }
  now = until;
}
const result = await build({ stdin: { contents: 'export { IslandStateMachine } from "./src/island/fsm";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { IslandStateMachine } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const fsm = new IslandStateMachine();
fsm.launch(); fsm.greetComplete(); advance(600); assert.equal(fsm.state, 'petit');
fsm.mouseLeft(); advance(5 * 60 * 1000); assert.equal(fsm.state, 'petit', 'Inactivity must leave the compact bot visible');
fsm.click(); assert.equal(fsm.state, 'home', 'Compact bot opens without the tray');
fsm.mouseLeft(); advance(15000); assert.equal(fsm.state, 'petit', 'Expanded panel still collapses normally');
fsm.mouseLeft(); advance(120000); assert.equal(fsm.state, 'petit');
fsm.forceHidden(); assert.equal(fsm.state, 'hidden', 'Explicit pause can still hide');
fsm.reveal(); fsm.mouseLeft(); advance(120000); assert.equal(fsm.state, 'petit');
fsm.forceHome(); fsm.pinned = true; fsm.mouseLeft(); advance(120000); assert.equal(fsm.state, 'home', 'Approval pin remains respected');
fsm.forcePetit(); fsm.mouseLeft(); advance(120000); assert.equal(fsm.state, 'petit');
console.log('PASS: persistent compact visibility, direct reopening, expanded auto-collapse, explicit hide, reveal, pinned approval');
