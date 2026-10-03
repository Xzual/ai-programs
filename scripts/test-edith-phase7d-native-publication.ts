import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { AdvancedExperienceRuntime } from '../server/advanced/runtime';
import { MobileCryptoService } from '../server/mobile/crypto';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import { DesktopProducerService } from '../server/mobile/desktopProducerService';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import type { MobileRuntime } from '../server/mobile/runtime';
import { MobileTransferService } from '../server/mobile/transferService';
import type { MobilePairingRequest } from '../server/mobile/types';
import { createDesktopProducerRouter } from '../server/routes/desktopProducer';
import { createAdvancedExperienceRouter } from '../server/routes/advancedExperience';
import { createOwnerSessionRouter, getOwnerSession, requireOwnerSession } from '../server/security/ownerSession';
import type { EdithTask } from '../src/edith/core';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase7d-native-'));
const oldOwner = process.env.EDITH_OWNER_TOKEN;
const oldBridge = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
process.env.EDITH_OWNER_TOKEN = 'phase7d-owner-token';
process.env.EDITH_DESKTOP_BRIDGE_TOKEN = 'phase7d-bridge-token';

const store = new MobileRegistryStore(root);
store.initialize();
const crypto = new MobileCryptoService();
const pairing = new MobilePairingService(store, crypto);
const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
const mobileRuntime: MobileRuntime = { store, crypto, pairing, realtime, transfers: new MobileTransferService(store, root), crossDevice: new CrossDeviceService(store.serverId()) };
const desktopProducer = new DesktopProducerService();
const task = { id: 'native-task', status: 'RUNNING' } as EdithTask;
const advancedRuntime = new AdvancedExperienceRuntime((id) => id === task.id ? task : undefined);
let killed = false;

const app = express();
app.use(express.json());
app.use(createOwnerSessionRouter());
app.get('/test-owner', requireOwnerSession, (req, res) => res.json({ bindingId: getOwnerSession(req)!.bindingId }));
app.use(createAdvancedExperienceRouter({ advancedRuntime, mobileRuntime }));
app.use(createDesktopProducerRouter({
  runtime: mobileRuntime,
  service: desktopProducer,
  advancedRuntime,
  killSwitchActive: () => killed,
  bootstrapLoopback: (req) => req.get('x-test-non-loopback') !== 'true',
  producerLoopback: (req) => req.get('x-test-non-loopback') !== 'true',
}));
const server = createServer(app);

function signature(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
}

try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  const origin = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${origin}/api/security/session`, { method: 'POST', headers: { origin, authorization: 'Bearer phase7d-owner-token' } });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const loginBody = await login.json() as { session: { csrfToken: string } };
  const ownerHeaders = { origin, cookie, 'x-edith-csrf-token': loginBody.session.csrfToken, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const ownerBindingId = ((await (await fetch(`${origin}/test-owner`, { headers: { cookie } })).json()) as { bindingId: string }).bindingId;

  const signing = generateKeyPairSync('ed25519');
  const agreement = generateKeyPairSync('x25519');
  const deviceId = 'phase7d-native-device';
  const v21 = { contractVersion: 2 as const, amendment: '2.1' as const };
  const request: MobilePairingRequest = {
    device: { deviceId, displayName: 'Phase 7D Native', platform: 'android', capabilities: { ...v21, realtime: true, fileTransfer: true, fileTransferEncryption: true, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } },
    signingPublicKeyJwk: signing.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    agreementPublicKeyJwk: agreement.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    requestedCommands: ['pc_status.read'],
  };
  const pairingRequest = pairing.request(request);
  pairing.submitProof(pairingRequest.pairing.pairingId, signature(signing.privateKey, pairingRequest.proofPayload));
  pairing.approve(pairingRequest.pairing.pairingId, pairingRequest.code, undefined, { bindingId: ownerBindingId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const access = pairing.consume(pairingRequest.pairing.pairingId, signature(signing.privateKey, `${pairingRequest.proofPayload}\nconsume`));
  const context = pairing.authenticate(access.credential.token);
  const bootstrap = `${origin}/api/edith/mobile/desktop-producer/session/${deviceId}`;

  let response = await fetch(bootstrap, { method: 'POST', headers: ownerHeaders, body: '{}' });
  assert.equal(response.status, 403);
  response = await fetch(bootstrap, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer wrong' }, body: '{}' });
  assert.equal(response.status, 403);
  response = await fetch(bootstrap, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase7d-bridge-token', 'x-test-non-loopback': 'true' }, body: '{}' });
  assert.equal(response.status, 403);
  response = await fetch(bootstrap, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase7d-bridge-token' }, body: '{}' });
  assert.equal(response.status, 201);
  const issued = await response.json() as { data: { producerSessionToken: string } };
  const headers = (sequence: number, overrides: Record<string, string> = {}) => ({
    authorization: 'Bearer phase7d-bridge-token', 'x-edith-producer-session': issued.data.producerSessionToken,
    'x-edith-producer-sequence': String(sequence), 'content-type': 'application/json', ...overrides,
  });
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const base = { ...v21, ownerSessionBindingId: ownerBindingId, workspaceId: context.credential.workspaceId, revision: 1, createdAt, updatedAt: createdAt };
  const power = { ...base, expiresAt, snapshotId: 'power-1', source: 'trusted_native', powerSource: 'battery', batteryPercent: 75, lowPower: false, userPresence: 'active', cameraUsed: false, observedAt: createdAt };

  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(1, { authorization: 'Bearer wrong' }), body: JSON.stringify(power) });
  assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(1, { 'x-edith-producer-session': 'wrong' }), body: JSON.stringify(power) });
  assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(1, { 'x-test-non-loopback': 'true' }), body: JSON.stringify(power) });
  assert.equal(response.status, 401);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(1), body: JSON.stringify({ ...power, ownerSessionBindingId: 'other-owner' }) });
  assert.equal(response.status, 400);

  for (const unsafe of [{ ...power, apiKey: 'secret' }, { ...power, pixels: 'raw' }, { ...power, audio: 'bytes' }, { ...power, path: 'C:\\Users\\owner\\secret' }]) {
    response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(2), body: JSON.stringify(unsafe) });
    assert.equal(response.status, 400);
  }

  const requests: Array<[string, AdvancedResourceKindName, Record<string, unknown>]> = [
    ['power-presence', 'power-presence', power],
    ['downloads', 'downloads', { ...base, downloadId: 'download-1', source: 'browser', displayName: 'Report.pdf', bytesTransferred: 50, bytesTotal: 100, remainingBytes: 50, etaTrustworthy: false, status: 'downloading', observedAt: createdAt }],
    ['bookmarks', 'bookmarks', { ...base, bookmarkId: 'bookmark-1', capturedAt: createdAt, appId: 'editor', userNote: 'Safe bookmark', screenshotPolicy: 'metadata_only', sensitiveAppBlocked: false }],
    ['snapshots', 'snapshots', { ...base, snapshotId: 'snapshot-1', label: 'Workspace', items: [{ kind: 'task', refId: task.id, displayLabel: 'Native task' }], forbiddenStateExcluded: true, dangerousTransactionsExcluded: true, captureStatus: 'metadata_only' }],
    ['scenes', 'scenes', { ...base, sceneId: 'scene-1', profile: 'FOCUS', changes: [{ setting: 'notifications', from: 'normal', to: 'focus', reversible: true }], securityNotificationsImmutable: true, status: 'active' }],
    ['watchers', 'watchers', { ...base, expiresAt, watcherId: 'watcher-1', kind: 'file', sourceRef: 'note-1', trigger: 'changed', delivery: 'desktop', observationPolicy: 'event_based', status: 'configuration_required' }],
    ['shadow', 'shadow', { ...base, enabled: true, consent: 'explicit', observationLevel: 'metadata_only', capturedFields: ['app_identity', 'timestamps'], rawScreenArchive: false, secretCapture: false, suggestionOnly: true }],
    ['retries', 'retries', { ...base, retryId: 'retry-1', taskId: task.id, failureClass: 'stale_target', strategy: 'reobserve', attempts: 1, maxAttempts: 2, staleTargetReobserve: true, permissionDeniedStop: false, status: 'retrying' }],
  ];
  let sequence = 2;
  for (const [route, kind, payload] of requests) {
    response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/${route}`, { method: 'POST', headers: headers(sequence), body: JSON.stringify(payload) });
    assert.equal(response.status, 202, `${route} must accept canonical trusted-native evidence.`);
    const body = await response.json() as { data: { resource: string; persistence: string; restartRecovery: string } };
    assert.equal(body.data.resource, kind);
    assert.equal(body.data.persistence, 'memory_only');
    assert.equal(body.data.restartRecovery, 'partial');
    sequence += 1;
  }
  assert.equal(advancedRuntime.list('power-presence', ownerBindingId, context.credential.workspaceId).length, 1);
  assert.equal(advancedRuntime.list('scenes', ownerBindingId, context.credential.workspaceId)[0]?.status, 'active');
  assert.equal(advancedRuntime.list('watchers', ownerBindingId, context.credential.workspaceId)[0]?.status, 'configuration_required');
  response = await fetch(`${origin}/api/edith/advanced/state?workspaceId=${encodeURIComponent(context.credential.workspaceId)}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const ownerState = await response.json() as { state: { downloads: unknown[]; scenes: unknown[] } };
  assert.equal(ownerState.state.downloads.length, 1);
  assert.equal(ownerState.state.scenes.length, 1);
  response = await fetch(`${origin}/api/mobile/advanced/state`, { headers: { authorization: `Device ${access.credential.token}` } });
  assert.equal(response.status, 200);
  const mobileWire = await response.json() as { envelope: unknown };
  const mobileState = crypto.decrypt<{ state: { downloads: unknown[]; watchers: unknown[] }; mutationAvailable: boolean; deviceScoped: boolean }>(context.credential.sessionId, mobileWire.envelope as any, 'advanced.state.read', 'server_to_client');
  assert.equal(mobileState.state.downloads.length, 1);
  assert.equal(mobileState.state.watchers.length, 1);
  assert.equal(mobileState.mutationAvailable, false);
  assert.equal(mobileState.deviceScoped, true);

  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/retries`, { method: 'POST', headers: headers(sequence - 1), body: JSON.stringify(requests.at(-1)![2]) });
  assert.equal(response.status, 409);
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: { authorization: `Device ${access.credential.token}`, 'content-type': 'application/json' }, body: JSON.stringify(power) });
  assert.equal(response.status, 401);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 20 * 60_000;
    response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, { method: 'POST', headers: headers(sequence), body: JSON.stringify({ ...power, snapshotId: 'power-stale' }) });
  } finally {
    Date.now = realNow;
  }
  assert.equal(response.status, 401);
  response = await fetch(bootstrap, { method: 'POST', headers: { ...ownerHeaders, authorization: 'Bearer phase7d-bridge-token' }, body: '{}' });
  assert.equal(response.status, 201);
  const killIssued = await response.json() as { data: { producerSessionToken: string } };
  killed = true;
  response = await fetch(`${origin}/api/edith/mobile/desktop-producer/advanced/power-presence`, {
    method: 'POST',
    headers: { authorization: 'Bearer phase7d-bridge-token', 'x-edith-producer-session': killIssued.data.producerSessionToken, 'x-edith-producer-sequence': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ ...power, snapshotId: 'power-2' }),
  });
  assert.equal(response.status, 423);
  assert.equal(desktopProducer.status(ownerBindingId).activeSessions, 0);
  assert.equal(advancedRuntime.list('scenes', ownerBindingId, context.credential.workspaceId)[0]?.status, 'reverted');

  console.log(JSON.stringify({ success: true, checks: ['missing_wrong_bridge_denied', 'non_loopback_denied', 'wrong_session_denied', 'stale_session_denied', 'other_owner_lineage_denied', 'mobile_credential_denied', 'sequence_replay_denied', 'strict_secret_path_pixel_audio_rejection', 'eight_fixed_kind_routes_202_only', 'native_scene_allowed', 'watcher_delivery_configuration_required', 'owner_state_projection', 'encrypted_device_scoped_mobile_projection', 'memory_only_restart_partial_truth', 'kill_switch_revokes_session'] }, null, 2));
} finally {
  realtime.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  if (oldOwner === undefined) delete process.env.EDITH_OWNER_TOKEN; else process.env.EDITH_OWNER_TOKEN = oldOwner;
  if (oldBridge === undefined) delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN; else process.env.EDITH_DESKTOP_BRIDGE_TOKEN = oldBridge;
}

type AdvancedResourceKindName = 'power-presence' | 'downloads' | 'bookmarks' | 'snapshots' | 'scenes' | 'watchers' | 'shadow' | 'retries';
