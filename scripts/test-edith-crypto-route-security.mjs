import assert from "node:assert/strict";
import { build } from "esbuild";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "edith-crypto-route-security-"));
const bundle = path.join(temp, "routers.cjs");
const entry = path.join(temp, "routers.ts");
const ownerToken = "owner-test-token-with-sufficient-entropy";
let forwardedInternalToken;

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

try {
  const dashboard = express();
  dashboard.use(express.json());
  dashboard.post("/api/crypto/demo/hold", (req, res) => {
    forwardedInternalToken = req.get("x-edith-internal-token");
    res.json({ success: true, ok: true, data: { action: "HOLD" } });
  });
  const dashboardServer = await listen(dashboard);
  const dashboardAddress = dashboardServer.address();
  assert(dashboardAddress && typeof dashboardAddress === "object");

  process.env.EDITH_CRYPTO_SERVICE_URL = `http://127.0.0.1:${dashboardAddress.port}`;
  process.env.EDITH_OWNER_TOKEN = ownerToken;
  process.env.EDITH_SECURE_COOKIES = "false";

  await writeFile(entry, [
    `export { createCryptoRouter } from ${JSON.stringify(path.join(root, "server/routes/crypto.ts"))};`,
    `export { createVoiceRouter } from ${JSON.stringify(path.join(root, "server/routes/voice.ts"))};`,
    `export { createOwnerSessionRouter } from ${JSON.stringify(path.join(root, "server/security/ownerSession.ts"))};`,
  ].join("\n"));
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
  });
  const modules = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
  const app = express();
  app.use(express.json());
  app.use(modules.createOwnerSessionRouter());
  app.use(modules.createCryptoRouter());
  app.use(modules.createVoiceRouter());
  const apiServer = await listen(app);
  const apiAddress = apiServer.address();
  assert(apiAddress && typeof apiAddress === "object");
  const base = `http://127.0.0.1:${apiAddress.port}`;
  const origin = base;

  const mutation = (headers = {}) => fetch(`${base}/api/crypto/demo/hold`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ clientRequestId: "route-security-0001", symbol: "BTCUSDT" }),
  });
  const binanceKillSwitch = (headers = {}) => fetch(`${base}/api/crypto/binance/kill-switch`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ active: true }),
  });
  const voiceCryptoCommand = (headers = {}) => fetch(`${base}/api/voice/crypto/command`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ transcript: "yarın hava nasıl" }),
  });

  let response = await mutation();
  assert.equal(response.status, 401, "missing owner session must be rejected");
  response = await mutation({ cookie: "edith_owner_session=wrong" });
  assert.equal(response.status, 401, "wrong owner session must be rejected");

  response = await fetch(`${base}/api/security/session`, {
    method: "POST",
    headers: { origin, authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 201);
  const session = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie);
  assert.equal(typeof session.session.csrfToken, "string");

  response = await mutation({ cookie, origin: "http://attacker.invalid", "x-edith-csrf-token": session.session.csrfToken });
  assert.equal(response.status, 403, "cross-origin mutation must be rejected");
  response = await mutation({ cookie });
  assert.equal(response.status, 403, "missing CSRF token must be rejected");
  response = await mutation({ cookie, "x-edith-csrf-token": "wrong" });
  assert.equal(response.status, 403, "wrong CSRF token must be rejected");
  response = await binanceKillSwitch();
  assert.equal(response.status, 401, "Binance mutation must reject a missing owner session");
  response = await binanceKillSwitch({ cookie });
  assert.equal(response.status, 403, "Binance mutation must reject a missing CSRF token");
  response = await voiceCryptoCommand();
  assert.equal(response.status, 401, "voice crypto command must reject a missing owner session");
  response = await voiceCryptoCommand({ cookie });
  assert.equal(response.status, 403, "voice crypto command must reject a missing CSRF token");
  response = await voiceCryptoCommand({ cookie, origin: "http://attacker.invalid", "x-edith-csrf-token": session.session.csrfToken });
  assert.equal(response.status, 403, "voice crypto command must reject a cross-origin request");

  forwardedInternalToken = undefined;
  response = await mutation({
    cookie,
    "x-edith-csrf-token": session.session.csrfToken,
    "x-edith-internal-token": "browser-spoof",
  });
  assert.equal(response.status, 200, "authenticated same-origin owner mutation must succeed");
  assert.notEqual(forwardedInternalToken, "browser-spoof", "browser internal-token spoof must not be forwarded");
  response = await binanceKillSwitch({ cookie, "x-edith-csrf-token": session.session.csrfToken });
  assert.equal(response.status, 200, "authenticated owner may operate the Binance kill switch");
  response = await voiceCryptoCommand({ cookie, "x-edith-csrf-token": session.session.csrfToken });
  assert.equal(response.status, 200, "authenticated same-origin owner may use the voice crypto router");
  const voicePayload = await response.json();
  assert.equal(voicePayload.matched, false, "non-crypto transcript must remain unmatched");

  await close(apiServer);
  await close(dashboardServer);
  console.log("PASS crypto and voice-crypto route owner-session, origin, CSRF, and token-spoof controls");
} finally {
  delete process.env.EDITH_CRYPTO_SERVICE_URL;
  delete process.env.EDITH_OWNER_TOKEN;
  delete process.env.EDITH_SECURE_COOKIES;
  await rm(temp, { recursive: true, force: true });
}
