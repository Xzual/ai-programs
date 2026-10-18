import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const MAX_BYTES = 32768;
const fail = () => { throw new Error('INVALID_DEMO_SNAPSHOT'); };
const reasonCodes = new Set(['none', 'scenario_complete', 'risk_rejected', 'stale_market_data',
  'global_kill_switch_active', 'crypto_kill_switch_active', 'invalid_decision_output', 'jev_unavailable',
  'budget_limit', 'deadline', 'test_failed', 'real_execution_claim', 'reset_not_allowed',
  'insufficient_balance', 'max_position_size_exceeded', 'duplicate_symbol_position', 'unsupported_quote_unit']);
const fields = ['schemaVersion', 'observedAt', 'sessionId', 'currency', 'initialBalance', 'decisionSource',
  'marketSource', 'state', 'currentCash', 'currentEquity', 'fees', 'realizedPnl', 'decisions', 'trades', 'stop',
  'realMoneyUsed', 'realOrderSent', 'liveExecutionEnabled', 'actualJevObservation'];
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || actual.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail();
}
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const bool = value => typeof value === 'boolean';

// A closed producer contract; no provider strings or arbitrary nested data can reach the viewer.
export function parseDemoSnapshot(value, { now = Date.now() } = {}) {
  exactKeys(value, fields);
  if (value.schemaVersion !== 1 || value.currency !== 'VIRTUAL_USD' || value.initialBalance !== 1
    || !identifier(value.sessionId) || !finite(now)) fail();
  if (typeof value.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt)) fail();
  const captured = Date.parse(value.observedAt);
  if (!finite(captured) || new Date(captured).toISOString() !== value.observedAt || captured > now) fail();
  if (!['scripted_fixture', 'actual_decision'].includes(value.decisionSource)
    || !['synthetic_fixture', 'public_market'].includes(value.marketSource)
    || !['ready', 'running', 'stopped', 'blocked', 'failed'].includes(value.state)
    || !['UNRUN', 'OBSERVED'].includes(value.actualJevObservation)
    || (value.decisionSource === 'scripted_fixture' && value.actualJevObservation !== 'UNRUN')
    || value.realMoneyUsed !== false || value.realOrderSent !== false || value.liveExecutionEnabled !== false
    || !nonnegative(value.currentCash) || !(value.currentEquity === null || nonnegative(value.currentEquity))
    || !nonnegative(value.fees) || !finite(value.realizedPnl)) fail();
  if (!Array.isArray(value.decisions) || value.decisions.length > 16 || !Array.isArray(value.trades) || value.trades.length > 8) fail();
  for (const row of value.decisions) {
    exactKeys(row, ['id', 'action', 'executed', 'reason']);
    if (!identifier(row.id) || !['BUY', 'SELL', 'HOLD', 'REJECTED'].includes(row.action)
      || !bool(row.executed) || !reasonCodes.has(row.reason)) fail();
  }
  for (const row of value.trades) {
    exactKeys(row, ['id', 'side', 'quoteAmount', 'quantity', 'price', 'fee', 'pnl']);
    if (!identifier(row.id) || !['BUY', 'SELL'].includes(row.side)
      || !['quoteAmount', 'quantity', 'price', 'fee', 'pnl'].every(key => finite(row[key]))) fail();
  }
  exactKeys(value.stop, ['requested', 'reason', 'loopStopped', 'ownedProcessClosed']);
  if (!bool(value.stop.requested) || !reasonCodes.has(value.stop.reason)
    || !bool(value.stop.loopStopped) || !bool(value.stop.ownedProcessClosed)) fail();
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) fail();
  return JSON.parse(encoded);
}

async function noLinks(target) {
  const absolute = path.resolve(target);
  const parts = path.parse(absolute);
  let current = parts.root;
  for (const part of absolute.slice(parts.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail();
  }
  return absolute;
}

export async function readDemoSnapshot(snapshotPath, { now = Date.now() } = {}) {
  const absolute = await noLinks(snapshotPath);
  const handle = await fs.open(absolute, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_BYTES) fail();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await handle.stat();
    await noLinks(absolute);
    const current = await fs.lstat(absolute);
    if (used > MAX_BYTES || used !== before.size || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || before.ino !== current.ino || before.dev !== current.dev || after.size !== current.size
      || after.mtimeMs !== current.mtimeMs || !current.isFile()) fail();
    return parseDemoSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used))), { now });
  } finally { await handle.close(); }
}

const pageScript = `const output=document.getElementById('result');const note=document.getElementById('note');
const amount=v=>v===null?'Unavailable':v.toFixed(8)+' VIRTUAL_USD';
function line(label,value,parent){const row=document.createElement('div');const term=document.createElement('dt');const detail=document.createElement('dd');term.textContent=label;detail.textContent=String(value);row.append(term,detail);parent.append(row);}
async function refresh(){const button=document.getElementById('refresh');button.disabled=true;note.textContent='Reading recorded demo snapshot…';try{const response=await fetch('/api/demo/status',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();const s=data.snapshot;output.replaceChildren();const facts=document.createElement('dl');line('Capture',data.display.mode,facts);line('Original observation',s.observedAt,facts);line('State',s.state,facts);line('Decision source',s.decisionSource,facts);line('Market source',s.marketSource,facts);line('Actual JeV observation',s.actualJevObservation,facts);line('Initial virtual balance',amount(s.initialBalance),facts);line('Cash',amount(s.currentCash),facts);line('Equity',amount(s.currentEquity),facts);line('Fees',amount(s.fees),facts);line('Realized profit / loss',amount(s.realizedPnl),facts);line('Stop',s.stop.reason,facts);line('Loop stopped',s.stop.loopStopped,facts);output.append(facts);for(const [title,rows,keys]of[['Decisions',s.decisions,['id','action','executed','reason']],['Trades',s.trades,['id','side','quoteAmount','quantity','price','fee','pnl']]]){const h=document.createElement('h2');h.textContent=title;output.append(h);if(!rows.length){const p=document.createElement('p');p.textContent='No recorded entries.';output.append(p);continue;}const wrap=document.createElement('div');wrap.className='table-scroll';const table=document.createElement('table');const caption=document.createElement('caption');caption.textContent=title+' from this capture';table.append(caption);const head=document.createElement('thead');const tr=document.createElement('tr');for(const k of keys){const th=document.createElement('th');th.scope='col';th.textContent=k;tr.append(th);}head.append(tr);table.append(head);const body=document.createElement('tbody');for(const r of rows){const row=document.createElement('tr');for(const k of keys){const td=document.createElement('td');td.textContent=typeof r[k]==='number'?r[k].toFixed(8):String(r[k]);row.append(td);}body.append(row);}table.append(body);wrap.append(table);output.append(wrap);}note.textContent='Read-only capture · no real funds or orders · polling does not update the observation time.';}catch{output.replaceChildren();note.textContent='Demo snapshot unavailable. No balance can be confirmed.';}finally{button.disabled=false;}}
document.getElementById('refresh').addEventListener('click',refresh);refresh();`;
const scriptHash = createHash('sha256').update(pageScript).digest('base64');
const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EDITH · Virtual demo capture</title><style>
:root{color-scheme:light;font-family:Segoe UI,system-ui,sans-serif;color:#263633;background:#f6f3eb;font-size:16px}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:clamp(24px,5vw,64px)}header{border-top:3px solid #215b54;padding-top:24px;margin-bottom:36px}.eyebrow{font-size:.75rem;letter-spacing:.13em;text-transform:uppercase;color:#215b54;font-weight:700}h1{font:500 clamp(2rem,5vw,3.4rem)/1.1 Georgia,serif;letter-spacing:-.025em;margin:16px 0}p{line-height:1.6;max-width:65ch}.notice{border-left:3px solid #9b793b;padding-left:16px}button{background:#215b54;color:white;border:0;padding:12px 20px;font:600 1rem Segoe UI,system-ui;cursor:pointer}button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #9b793b;outline-offset:4px}#note{min-height:3.2em;color:#425d57;font-size:.9rem}dl{border-top:1px solid #c9cec4}dl>div{display:grid;grid-template-columns:1fr 1.5fr;gap:20px;padding:14px 0;border-bottom:1px solid #d9ddd3}dt{color:#4e655e}dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}h2{font:500 1.6rem Georgia,serif;margin:36px 0 16px}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.82rem;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #d9ddd3;white-space:nowrap}th{color:#215b54}caption{text-align:left;color:#4e655e;padding-bottom:8px}footer{margin-top:48px;border-top:1px solid #c9cec4;padding-top:16px;font-size:.8rem;color:#4e655e}@media(max-width:560px){dl>div{grid-template-columns:1fr;gap:4px}main{padding:24px}}
</style><main><header><div class="eyebrow">EDITH / isolated test viewer</div><h1>One virtual dollar.<br>A recorded experiment.</h1><p class="notice">Dedicated test-only viewer. This is not the full EDITH interface. VIRTUAL_USD is simulated: no real funds, exchange account or real orders.</p></header><button id="refresh" type="button">Refresh capture</button><p id="note" role="status" aria-live="polite">Waiting for the demo capture.</p><section id="result" aria-label="Demo snapshot"></section><footer>Scripted fixtures are labeled explicitly. Actual JeV observation remains UNRUN unless the producer records an actual observation. Original capture time is preserved.</footer></main><script>${pageScript}</script></html>`;

const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
};

export function createDemoGateway({ credential, snapshotPath, port = 3107, host = '127.0.0.1',
  allowedHosts = ['127.0.0.1:3107', 'localhost:3107'], now = () => Date.now(), readSnapshot } = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535
    || credential?.username !== 'demo' || !/^[A-Za-z0-9_-]{43}$/.test(credential?.password ?? '')
    || !Array.isArray(allowedHosts) || !allowedHosts.length
    || allowedHosts.some(item => typeof item !== 'string' || !/^[a-zA-Z0-9.:-]{1,253}$/.test(item))) throw Error('INVALID_GATEWAY_CONFIGURATION');
  const expected = Buffer.from(`${credential.username}:${credential.password}`, 'utf8');
  const hosts = new Set(allowedHosts);
  const origins = new Set(allowedHosts.map(item => `http://${item}`));
  function authenticated(req) {
    // Reject duplicate credentials and noncanonical Base64 before comparing raw bytes.
    if (req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'authorization').length !== 1) return false;
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(header) || header.length > 256) return false;
    const encoded = header.slice(6);
    const candidate = Buffer.from(encoded, 'base64');
    const valid = candidate.toString('base64') === encoded && candidate.length === expected.length;
    const comparison = candidate.length === expected.length ? candidate : Buffer.alloc(expected.length);
    return timingSafeEqual(comparison, expected) && valid;
  }
  function send(req, res, status, data, type = 'application/json; charset=utf-8') {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    res.writeHead(status, { ...securityHeaders, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
      'Connection': 'close', ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="EDITH virtual demo", charset="UTF-8"' } : {}),
      ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    if (!authenticated(req)) return send(req, res, 401, { error: 'AUTHENTICATION_REQUIRED' });
    const hostCount = req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'host').length;
    if (hostCount !== 1 || !hosts.has(req.headers.host) || (req.headers.origin !== undefined && !origins.has(req.headers.origin))) return send(req, res, 403, { error: 'ORIGIN_DENIED' });
    if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, { error: 'METHOD_DENIED' });
    if (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) return send(req, res, 400, { error: 'BODY_DENIED' });
    if (req.url === '/') return send(req, res, 200, PAGE, 'text/html; charset=utf-8');
    if (req.url === '/healthz') return send(req, res, 200, { schemaVersion: 1, gatewayReady: true, readOnly: true, fullEdithUi: false });
    if (req.url !== '/api/demo/status') return send(req, res, 404, { error: 'ROUTE_DENIED' });
    try {
      const time = now();
      const snapshot = parseDemoSnapshot(await (readSnapshot ? readSnapshot() : readDemoSnapshot(snapshotPath, { now: time })), { now: time });
      const ageMs = time - Date.parse(snapshot.observedAt);
      const recorded = snapshot.state !== 'running' || snapshot.stop.requested || snapshot.stop.loopStopped || snapshot.stop.ownedProcessClosed;
      const mode = recorded ? 'recorded' : ageMs > 30000 ? 'stale' : snapshot.decisionSource === 'scripted_fixture' ? 'live_fixture' : 'live_observation';
      return send(req, res, 200, { schemaVersion: 1, view: 'isolated_crypto_demo', fullEdithUi: false, readOnly: true,
        snapshot, display: { mode, ageMs, actualJevObservation: snapshot.actualJevObservation } });
    } catch { return send(req, res, 503, { error: 'DEMO_SNAPSHOT_UNAVAILABLE' }); }
  });
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 1;
  server.setTimeout(5000, socket => socket.destroy());
  function denySocket(req, socket) {
    const status = authenticated(req) ? 405 : 401;
    const headers = Object.entries({ ...securityHeaders, 'Content-Length': 0, Connection: 'close',
      ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="EDITH virtual demo"' } : {}) }).map(([key, value]) => `${key}: ${value}`).join('\r\n');
    socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Method Not Allowed'}\r\n${headers}\r\n\r\n`);
  }
  server.on('upgrade', denySocket);
  server.on('connect', denySocket);
  server.on('checkContinue', (req, res) => send(req, res, authenticated(req) ? 400 : 401, { error: 'REQUEST_DENIED' }));
  server.on('checkExpectation', (req, res) => send(req, res, authenticated(req) ? 400 : 401, { error: 'REQUEST_DENIED' }));
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  return server;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--credential-file' || !path.isAbsolute(args[1]))) throw Error('INVALID_GATEWAY_ARGUMENTS');
  const credentialPath = args[1] ?? path.join(os.homedir(), 'AppData/Local/EDITH-TestDemo/ngrok-demo-20261018/gateway-credential.json');
  const snapshotPath = path.join(root, 'artifacts/ngrok-demo-20261018/chat7/one-virtual-usd-test/public/demo-snapshot.json');
  const file = await fs.open(await noLinks(credentialPath), 'r');
  let credential;
  try {
    const buffer = Buffer.alloc(1025);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024) throw Error('CREDENTIAL_UNAVAILABLE');
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size || bytesRead > 1024) throw Error('CREDENTIAL_UNAVAILABLE');
    credential = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    exactKeys(credential, ['username', 'password']);
  } finally { await file.close(); }
  const server = createDemoGateway({ credential, snapshotPath });
  server.on('error', () => { process.stdout.write('{"status":"GATEWAY_START_FAILED"}\n'); process.exitCode = 1; });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    server.close(() => { process.exitCode = 0; });
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  server.listen(3107, '127.0.0.1', () => process.stdout.write('{"status":"GATEWAY_READY","host":"127.0.0.1","port":3107}\n'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stdout.write('{"status":"GATEWAY_START_FAILED"}\n'); process.exitCode = 1; });
}
