import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { EDITH_CONTRACT_AMENDMENT, TASK_CONTRACT_VERSION, type CrossDevicePcStatusV2, type CrossDeviceTransferV2 } from '../src/edith/contracts';
import { MobileCryptoService, sha256 } from '../server/mobile/crypto';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import { DesktopProducerService } from '../server/mobile/desktopProducerService';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import type { MobileRuntime } from '../server/mobile/runtime';
import { MobileTransferService } from '../server/mobile/transferService';
import type { MobilePairingRequest } from '../server/mobile/types';
import { createDesktopProducerRouter } from '../server/routes/desktopProducer';
import { createOwnerSessionRouter, getOwnerSession, requireOwnerSession } from '../server/security/ownerSession';

const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase6e-'));
const previousOwnerToken = process.env.EDITH_OWNER_TOKEN;
const previousBridgeToken = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
process.env.EDITH_OWNER_TOKEN = 'phase6e-owner-secret';
process.env.EDITH_DESKTOP_BRIDGE_TOKEN = 'phase6e-desktop-bridge-secret';

const store = new MobileRegistryStore(tempRoot);
store.initialize();
const crypto = new MobileCryptoService();
const pairing = new MobilePairingService(store, crypto);
const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
const runtime: MobileRuntime = { store, crypto, pairing, realtime, transfers: new MobileTransferService(store, tempRoot), crossDevice: new CrossDeviceService(store.serverId()) };
const desktopProducer = new DesktopProducerService();

const app = express();
app.use(express.json());
app.use(createOwnerSessionRouter());
app.get('/test-owner-binding', requireOwnerSession, (req, res) => res.json({ bindingId: getOwnerSession(req)!.bindingId }));
app.use(createDesktopProducerRouter({
  runtime,
  service: desktopProducer,
  killSwitchActive: () => false,
  bootstrapLoopback: (req) => req.get('x-test-non-loopback') !== 'true',
}));
const server = createServer(app);

function signature(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
}

async function listen(): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return address.port;
}

try {
  const port = await listen();
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/security/session`, { method: 'POST', headers: { origin, authorization: 'Bearer phase6e-owner-secret' } });
  assert.equal(login.status, 201);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const loginBody = await login.json() as { session: { csrfToken: string } };
  const ownerHeaders = { origin, cookie, 'x-edith-csrf-token': loginBody.session.csrfToken, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const bindingResponse = await fetch(`${origin}/test-owner-binding`, { headers: { cookie } });
  const ownerBindingId = ((await bindingResponse.json()) as { bindingId: string }).bindingId;

  const signingKeys = generateKeyPairSync('ed25519');
  const agreementKeys = generateKeyPairSync('x25519');
  const deviceId = 'phase6e-android';
  const pairingRequest: MobilePairingRequest = {
    device: { deviceId, displayName: 'Phase 6E Android', platform: 'android', capabilities: { ...v21, realtime: true, fileTransfer: true, fileTransferEncryption: true, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } },
    signingPublicKeyJwk: signingKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    agreementPublicKeyJwk: agreementKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    requestedCommands: ['file.upload', 'result_card.read', 'pc_status.read', 'live_view.start', 'audio_handoff.manage'],
  };
  const requested = pairing.request(pairingRequest);
  pairing.submitProof(requested.pairing.pairingId, signature(signingKeys.privateKey, requested.proofPayload));
  pairing.approve(requested.pairing.pairingId, requested.code, undefined, { bindingId: ownerBindingId, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  const consumed = pairing.consume(requested.pairing.pairingId, signature(signingKeys.privateKey, `${requested.proofPayload}\nconsume`));
  const context = pairing.authenticate(consumed.credential.token);

  const bootstrapUrl = `${origin}/api/edith/mobile/desktop-producer/session/${deviceId}`;
  const deniedBodies: string[] = [];
  let response = await fetch(bootstrapUrl, { method: 'POST', headers: ownerHeaders, body: '{}' });
  assert.equal(response.status, 403);
  deniedBodies.push(await response.text());
  response = await fetch(bootstrapUrl, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer wrong-phase6e-bridge-secret' }, body: '{}' });
  assert.equal(response.status, 403);
  deniedBodies.push(await response.text());
  response = await fetch(bootstrapUrl, { method: 'POST', headers: { ...ownerHeaders, authorization: `Device ${consumed.credential.token}` }, body: '{}' });
  assert.equal(response.status, 403);
  deniedBodies.push(await response.text());
  response = await fetch(bootstrapUrl, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase6e-desktop-bridge-secret', 'x-test-non-loopback': 'true' }, body: '{}' });
  assert.equal(response.status, 403);
  deniedBodies.push(await response.text());
  assert.equal(deniedBodies.some((body) => body.includes('phase6e-desktop-bridge-secret') || body.includes(consumed.credential.token)), false);

  response = await fetch(bootstrapUrl, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase6e-desktop-bridge-secret' }, body: '{}' });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  const firstIssued = await response.json() as { data: { producerSessionToken: string } };
  assert.notEqual(firstIssued.data.producerSessionToken, 'phase6e-desktop-bridge-secret');
  response = await fetch(bootstrapUrl, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase6e-desktop-bridge-secret' }, body: '{}' });
  assert.equal(response.status, 201);
  const issued = await response.json() as { data: { producerSessionToken: string } };
  assert.notEqual(issued.data.producerSessionToken, firstIssued.data.producerSessionToken);
  const producerHeaders = (sequence: number, authorization = 'Bearer phase6e-desktop-bridge-secret') => ({
    authorization,
    'x-edith-producer-session': issued.data.producerSessionToken,
    'x-edith-producer-sequence': String(sequence),
    'content-type': 'application/json',
  });
  const lineage = { ...v21, ownerSessionBindingId: ownerBindingId, workspaceId: context.credential.workspaceId, sessionId: context.credential.sessionId, sourceDeviceId: store.serverId(), targetDeviceId: deviceId };
  const now = Date.now();
  const pcStatus: CrossDevicePcStatusV2 = {
    ...lineage, snapshotId: 'phase6e-status', runtime: 'ready', observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(),
    metrics: { cpuPercent: 10, ramPercent: 20, networkState: 'online' }, source: 'native_adapter',
  };
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/pc-status`, {
    method: 'POST',
    headers: { ...producerHeaders(1), 'x-edith-producer-session': firstIssued.data.producerSessionToken },
    body: JSON.stringify(pcStatus),
  });
  assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/pc-status`, { method: 'POST', headers: producerHeaders(1), body: JSON.stringify(pcStatus) });
  assert.equal(response.status, 202);
  assert.equal(runtime.crossDevice.getPcStatus(context).snapshotId, pcStatus.snapshotId);

  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/pc-status`, { method: 'POST', headers: producerHeaders(1), body: JSON.stringify(pcStatus) });
  assert.equal(response.status, 409);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/pc-status`, { method: 'POST', headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' }, body: JSON.stringify(pcStatus) });
  assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/live-view/frame-metadata`, { method: 'POST', headers: producerHeaders(2), body: JSON.stringify({ ...lineage, liveViewId: 'none', frameId: 'frame', sequence: 1, observedAt: new Date().toISOString(), width: 100, height: 100, operatorState: 'observing', containsPixels: false, pixels: 'forbidden' }) });
  assert.equal(response.status, 400);

  const transfer: CrossDeviceTransferV2 = {
    ...lineage, sourceDeviceId: deviceId, targetDeviceId: store.serverId(), transferId: 'phase6e-transfer', direction: 'mobile_to_pc', category: 'document', fileName: 'phase6e.txt', mediaType: 'text/plain', sizeBytes: 4, sha256: sha256('test'), status: 'completed',
    progress: { bytesTransferred: 4, totalBytes: 4, percent: 100, integrity: 'verified' }, destination: { kind: 'approved_folder', opaqueHandle: 'phase6e-handle', displaySummary: 'Approved folder', conflictPolicy: 'reject', collisionDetected: false },
    resume: { ...v21, resumable: true, nextChunkIndex: 1, completedChunkIndexes: [0], retryCount: 0, maxRetries: 3, acknowledgedBytes: 4 }, capabilities: { open: true, export: false, share: false, openLocation: false },
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now + 1).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
  };
  runtime.crossDevice.putTransfer(context, transfer);
  response = await fetch(`${origin}/api/edith/mobile/cross-device/result-cards/${deviceId}`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ cardId: 'phase6e-card', source: { type: 'transfer', id: transfer.transferId } }) });
  assert.equal(response.status, 201);
  const cardBody = await response.json() as { data: { card: { provenance: { sourceId: string }; revision: number; ownerSessionBindingId: string } } };
  assert.equal(cardBody.data.card.provenance.sourceId, transfer.transferId);
  assert.equal(cardBody.data.card.revision, 1);
  assert.equal(cardBody.data.card.ownerSessionBindingId, ownerBindingId);
  assert.equal(runtime.crossDevice.listResultCards(context).length, 1);

  response = await fetch(`${origin}/api/edith/mobile/cross-device/result-cards/${deviceId}`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify(cardBody.data.card) });
  assert.equal(response.status, 400);
  const logout = await fetch(`${origin}/api/security/session`, { method: 'DELETE', headers: ownerHeaders });
  assert.equal(logout.status, 200);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/pc-status`, { method: 'POST', headers: producerHeaders(2), body: JSON.stringify(pcStatus) });
  assert.equal(response.status, 401);

  console.log(JSON.stringify({ success: true, checks: ['owner_csrf_without_bridge_denied', 'wrong_bridge_secret_denied', 'mobile_credential_bootstrap_denied', 'non_loopback_bootstrap_denied', 'native_bridge_bootstrap_no_store', 'bootstrap_rotates_prior_token', 'bridge_and_producer_dual_auth', 'denial_bodies_secret_free', 'exact_sequence_replay_denied', 'strict_pixels_free_metadata', 'server_resolved_result_card', 'raw_card_forgery_denied', 'logout_revokes_producer'] }, null, 2));
} finally {
  realtime.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (previousOwnerToken === undefined) delete process.env.EDITH_OWNER_TOKEN; else process.env.EDITH_OWNER_TOKEN = previousOwnerToken;
  if (previousBridgeToken === undefined) delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN; else process.env.EDITH_DESKTOP_BRIDGE_TOKEN = previousBridgeToken;
}
