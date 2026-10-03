// Read-only query of the installed Codex runtime. No sessions, model calls or
// security bypass flags. Trust hashes come from Codex, not a guessed algorithm.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn('codex', ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let seq = 0;
const waiting = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const pending = waiting.get(message.id);
  if (!pending) return;
  waiting.delete(message.id);
  if (message.error) pending.reject(new Error(`Codex RPC ${message.error.code}: ${message.error.message}`));
  else pending.resolve(message.result);
});
child.stderr.resume();
function call(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const timeout = setTimeout(() => { child.kill(); console.error('Codex hook status query timed out'); process.exitCode = 1; }, 30000);
try {
  await call('initialize', { clientInfo: { name: 'coucou_hook_verifier', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const result = await call('hooks/list', { cwds: [process.cwd()] });
  const own = result.data.flatMap(row => row.hooks).filter(h => h.handlerType === 'command' && h.command.includes('coucou-hook.exe') && h.command.includes('--agent codex'));
  console.log(JSON.stringify({ hooks: own.map(h => ({ key: h.key, event: h.eventName, currentHash: h.currentHash, trust: h.trustStatus, enabled: h.enabled, command: h.command })), errorCount: result.data.reduce((n, row) => n + row.errors.length, 0) }, null, 2));
  // Optional acceptance check: attach an existing chat without sending a prompt
  // or starting any model/tool turn. This triggers Codex's real SessionStart.
  const existing = process.env.COUCOU_VERIFY_EXISTING_THREAD;
  if (existing) {
    if (!/^[a-f0-9-]+$/.test(existing)) throw new Error('Invalid existing thread id');
    const resumed = await call('thread/resume', { threadId: existing });
    console.log(JSON.stringify({ existingThreadAttached: resumed.thread?.id === existing }));
  }
} finally {
  clearTimeout(timeout);
  lines.close();
  child.kill();
}
