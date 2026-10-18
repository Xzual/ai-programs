import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(projectRoot, 'server.ts'), 'utf8');
const beginMarker = '// EDITH_API_TERMINAL_GUARD_BEGIN';
const endMarker = '// EDITH_API_TERMINAL_GUARD_END';
const begin = source.indexOf(beginMarker), end = source.indexOf(endMarker);
assert.equal(begin >= 0 && end > begin, true, 'actual server must define the terminal API guard extraction boundary');
assert.equal(source.indexOf(beginMarker, begin + beginMarker.length), -1, 'one source guard boundary');
assert.equal(source.indexOf(endMarker, end + endMarker.length), -1, 'one source guard end');
const start = source.indexOf('async function startServer()');
const devStart = source.indexOf('if (process.env.NODE_ENV !== "production")', start);
const viteStart = source.indexOf('const { createServer: createViteServer }', start);
assert.equal(start >= 0 && devStart > start && begin > devStart && end < viteStart, true, 'guard executes within the development branch before Vite creation');
// Source anchoring only: verify that every genuine top-level API/router registration
// precedes the extracted callback. Behavior is tested through actual middleware below.
const registrations = [...source.matchAll(/^app\.(?:use|get|post|put|patch|delete|head|options|all)\(/gm)];
assert.equal(registrations.length > 0 && registrations.every(match => match.index < begin), true, 'all top-level routes precede terminal guard');
const callbacks = [];
vm.runInNewContext(source.slice(begin + beginMarker.length, end), {
  app: { use(callback) { callbacks.push(callback); } },
}, { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } });
assert.equal(callbacks.length === 1 && typeof callbacks[0] === 'function', true, 'extract only the actual app.use callback');
const terminalGuard = callbacks[0];
const fixtureBase = path.join(projectRoot, 'artifacts/build-repair-20261018/chat4/api-terminal-guard/tests');
const equal = (actual, expected, message = 'fixture behavior matches contract') => assert.equal(isDeepStrictEqual(actual, expected), true, message);

async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('FIXTURE_DEADLINE')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function rejectLinks(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error('FIXTURE_LINK_DENIED'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
function confinedRoot(root) {
  const relative = path.relative(fixtureBase, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(root) !== fixtureBase
    || !path.basename(root).startsWith('runtime-')) throw Error('FIXTURE_PATH_DENIED');
}
async function inventory(root) {
  let files = 0, bytes = 0, entries = 0;
  async function walk(directory, depth) {
    if (depth > 8) throw Error('FIXTURE_FILE_LIMIT');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++entries > 64 || entry.isSymbolicLink()) throw Error('FIXTURE_FILE_LIMIT');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile()) {
        const size = (await fs.lstat(file)).size; files++; bytes += size;
        if (files > 32 || bytes > 262144) throw Error('FIXTURE_FILE_LIMIT');
      } else throw Error('FIXTURE_FILE_LIMIT');
    }
  }
  await walk(root, 0); return { files, bytes };
}

test('actual terminal guard preserves known auth and terminates raw API prefixes before installed Vite self-proxy', { timeout: 14500 }, async () => {
  const originalCwd = process.cwd(), sockets = new Set(), agents = [];
  let root, server, vite, incoming = 0, proxyDials = 0, cleanupComplete = false;
  const cases = [];
  function own(socket) { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); }
  async function cleanup() {
    for (const socket of sockets) socket.destroy();
    for (const agent of agents) agent.destroy();
    const closedServer = server?.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
    await bounded(Promise.all([closedServer, vite?.close()]), 2000);
    process.chdir(originalCwd);
    if (root) {
      confinedRoot(root); await rejectLinks(root); await inventory(root);
      const actualBase = await fs.realpath(fixtureBase), actualRoot = await fs.realpath(root);
      const relative = path.relative(actualBase, actualRoot);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('FIXTURE_CLEANUP_ESCAPE');
      await fs.rm(root, { recursive: true, force: true });
    }
    await bounded(new Promise(resolve => {
      const poll = () => sockets.size ? setTimeout(poll, 5) : resolve(); poll();
    }), 300);
    cleanupComplete = true;
  }
  async function requestCase(name, target, authorized, wantStatus, wantApiError = false) {
    incoming = 0; proxyDials = 0;
    const response = await bounded(new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: target, agent: false,
        headers: { Host: 'localhost', Connection: 'close', Accept: 'text/html', ...(authorized ? { 'X-Fixture-Authorized': 'yes' } : {}) } }, res => {
        const chunks = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) res.destroy(Error('FIXTURE_RESPONSE_LIMIT')); else chunks.push(chunk); });
        res.once('error', () => reject(Error('FIXTURE_RESPONSE_FAILED')));
        res.once('aborted', () => reject(Error('FIXTURE_RESPONSE_ABORTED')));
        res.once('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('socket', own); req.once('error', () => reject(Error('FIXTURE_REQUEST_FAILED')));
      req.setTimeout(4000, () => req.destroy(Error('FIXTURE_REQUEST_DEADLINE')));
    }), 4500);
    equal(response.status, wantStatus, name + ' status');
    equal(incoming, 1, name + ' must enter fixture only once');
    equal(proxyDials, 0, name + ' must not dial Vite API proxy');
    if (wantApiError) {
      let parsed; try { parsed = JSON.parse(response.text); } catch { throw Error('FIXTURE_JSON_INVALID'); }
      equal(parsed, { success: false, errorCode: 'API_ROUTE_NOT_FOUND' }, name + ' finite terminal response');
    }
    cases.push({ name, status: response.status, incoming, proxyDials });
  }
  try {
    await bounded((async () => {
      await rejectLinks(fixtureBase); await fs.mkdir(fixtureBase, { recursive: true });
      root = await fs.mkdtemp(path.join(fixtureBase, 'runtime-')); confinedRoot(root);
      await fs.mkdir(path.join(root, 'public'));
      await fs.writeFile(path.join(root, 'package.json'), '{"name":"owned-api-terminal-fixture","private":true,"type":"module"}');
      await fs.writeFile(path.join(root, 'public', 'fixture.html'), '<!doctype html><title>Owned fixture</title><p>Public fixture only</p>');
      // Vite root/package/config discovery remains inside this fresh owned fixture.
      process.chdir(root);
      const [{ createServer }, { default: express }] = await bounded(Promise.all([import('vite'), import('express')]), 3000);
      const app = express();
      app.use((_req, res, next) => { incoming++; if (incoming > 3) return res.status(508).end('bounded-loop'); next(); });
      app.get('/api/fixture-known', (req, res) => req.get('x-fixture-authorized') === 'yes'
        ? res.status(200).end('known') : res.status(401).end('known-auth-required'));
      app.use(terminalGuard);
      server = http.createServer(app); server.on('connection', own);
      server.headersTimeout = 1500; server.requestTimeout = 4000; server.setTimeout(4500, socket => socket.destroy());
      await bounded(new Promise((resolve, reject) => { server.once('error', () => reject(Error('FIXTURE_LISTEN_FAILED'))); server.listen(0, '127.0.0.1', resolve); }), 1000);
      const port = server.address().port;
      const agent = new http.Agent({ keepAlive: false, maxSockets: 4, lookup(hostname, options, callback) {
        if (hostname !== 'localhost') { callback(Error('FIXTURE_LOOKUP_DENIED')); return; }
        proxyDials++;
        if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]); else callback(null, '127.0.0.1', 4);
      } }); agents.push(agent);
      const logger = { hasWarned: false, info() {}, warn() {}, warnOnce() {}, error() {}, clearScreen() {}, hasErrorLogged() { return false; } };
      vite = await bounded(createServer({ root, configFile: false, envFile: false, plugins: [],
        cacheDir: path.join(root, 'cache'), publicDir: path.join(root, 'public'), logLevel: 'silent', customLogger: logger,
        clearScreen: false, appType: 'spa', optimizeDeps: { noDiscovery: true, entries: [], include: [] },
        css: { postcss: { plugins: [] } }, esbuild: { tsconfigRaw: {} },
        server: { middlewareMode: true, hmr: false, ws: false, watch: null, cors: false, fs: { strict: true, allow: [root] },
          proxy: { '/api': { target: `http://localhost:${port}`, changeOrigin: true, ws: false, agent,
            timeout: 4000, proxyTimeout: 4000, headers: { connection: 'close' } } } },
      }), 3000);
      app.use(vite.middlewares);
      await requestCase('known_api_authorized', '/api/fixture-known', true, 200);
      await requestCase('known_api_unauthorized', '/api/fixture-known', false, 401);
      for (const target of ['/api/missing', '/apiWhatever', '/api', '/api?x=1']) await requestCase('terminal_' + target, target, false, 404, true);
      await requestCase('public_html', '/fixture.html', false, 200);
      await inventory(root);
    })(), 11500);
  } finally {
    await cleanup();
    // Finite counters only: never print source, headers or response bodies.
    process.stdout.write(JSON.stringify({ fixture: 'actual_api_terminal_guard', cases, cleanupComplete,
      resolution: 'scoped-localhost-agent-to-owned-loopback', actualLocalhostDns: 'UNRUN', actualMainRuntime: 'UNRUN' }) + '\n');
  }
});
