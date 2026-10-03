import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import WebSocket from 'ws';
import { EDITH_CONTRACT_AMENDMENT, TASK_CONTRACT_VERSION } from '../src/edith/contracts';
import { MobileCryptoService, sha256 } from '../server/mobile/crypto';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import { MobileTransferService } from '../server/mobile/transferService';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import type { MobileRuntime } from '../server/mobile/runtime';
import type { MobileEncryptedEnvelope, MobilePairingRequest, MobileSessionContext } from '../server/mobile/types';
import { createMobileTasksRouter } from '../server/routes/mobileTasks';
import { createMobileTransfersRouter } from '../server/routes/mobileTransfers';
import { createMobileCrossDeviceRouter } from '../server/routes/mobileCrossDevice';

function signature(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
}

function expectError(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof Error && error.message === code, code);
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return address.port;
}

async function websocketReplay(runtime: MobileRuntime, token: string, port: number, sessionId: string): Promise<void> {
  runtime.realtime.publishTaskCreated('mobile-replay-task', 'QUEUED', 1, 'corr-mobile-replay');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/mobile/realtime`, { headers: { authorization: `Device ${token}` } });
  const received = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('REALTIME_TEST_TIMEOUT')), 5_000);
    socket.once('error', reject);
    socket.once('open', () => {
      socket.send(JSON.stringify(runtime.crypto.encrypt(sessionId, 'realtime.command', { type: 'resume', afterCursor: 0 }, 'client_to_server', 'realtime')));
    });
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      try {
        resolve(runtime.crypto.decrypt(sessionId, JSON.parse(raw.toString()) as MobileEncryptedEnvelope, 'realtime.event', 'server_to_client', 'realtime'));
      } catch (error) { reject(error); }
    });
  });
  const event = received as { replayed?: boolean; cursor?: number; streamId?: string };
  assert.equal(event.replayed, true);
  assert.equal(event.cursor, 1);
  assert.match(String(event.streamId), /^mobile-stream-/);
  socket.close();
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-mobile-backend-'));
let server: ReturnType<typeof createServer> | undefined;

try {
  const store = new MobileRegistryStore(tempRoot);
  store.initialize();
  const crypto = new MobileCryptoService();
  const pairing = new MobilePairingService(store, crypto);
  const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
  const runtime: MobileRuntime = { store, crypto, pairing, realtime, transfers: new MobileTransferService(store, tempRoot), crossDevice: new CrossDeviceService(store.serverId()) };

  const signingKeys = generateKeyPairSync('ed25519');
  const agreementKeys = generateKeyPairSync('x25519');
  const request: MobilePairingRequest = {
    device: {
      deviceId: 'android-test-device',
      displayName: 'Android Test Device',
      platform: 'android',
      capabilities: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        realtime: true,
        fileTransfer: true,
        fileTransferEncryption: true,
        notifications: false,
        camera: false,
        microphone: false,
        computerControl: true,
        browserControl: true,
      },
    },
    signingPublicKeyJwk: signingKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    agreementPublicKeyJwk: agreementKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    requestedCommands: ['task.list', 'task.detail', 'task.activity', 'task.create_low_risk', 'task.pause', 'task.resume', 'task.cancel', 'emergency_stop', 'file.upload', 'clipboard.publish', 'clipboard.consume', 'file.download', 'live_view.start', 'wake.request'],
  };

  const requested = pairing.request(request);
  const ownerSession = { bindingId: 'owner-session-test', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() };
  assert.equal(requested.pairing.status, 'requested');
  const normalizedCommands = store.getPairing(requested.pairing.pairingId)!.requestedCommands;
  assert.equal(normalizedCommands.includes('live_view.start'), false);
  assert.equal(normalizedCommands.includes('wake.request'), false);
  assert.equal(normalizedCommands.includes('file.download'), false);
  assert.equal(requested.server.capabilities.crossDevice?.liveView, 'configuration_required');
  assert.equal(requested.pairing.device.capabilities?.computerControl, false);
  assert.equal(requested.pairing.device.capabilities?.browserControl, false);
  expectError(() => pairing.submitProof(requested.pairing.pairingId, 'invalid'), 'PAIRING_PROOF_INVALID');
  pairing.submitProof(requested.pairing.pairingId, signature(signingKeys.privateKey, requested.proofPayload));
  expectError(() => pairing.approve(requested.pairing.pairingId, '000000', undefined, ownerSession), 'PAIRING_CODE_INVALID');
  pairing.approve(requested.pairing.pairingId, requested.code, undefined, ownerSession);
  const consumed = pairing.consume(requested.pairing.pairingId, signature(signingKeys.privateKey, `${requested.proofPayload}\nconsume`));
  const context = pairing.authenticate(consumed.credential.token);
  assert.equal(context.device.trust.status, 'trusted');
  expectError(() => pairing.consume(requested.pairing.pairingId, signature(signingKeys.privateKey, `${requested.proofPayload}\nconsume`)), 'PAIRING_ALREADY_CONSUMED');

  const persisted = fs.readFileSync(store.filePath, 'utf8');
  for (const secret of [requested.code, requested.challenge, consumed.credential.secret, consumed.credential.token]) {
    assert.equal(persisted.includes(secret), false, 'Raw pairing/session secret reached persistence.');
  }
  assert.equal(persisted.includes('privateKey'), false);

  const envelope = crypto.encrypt(consumed.credential.sessionId, 'test.payload', { value: 'bound' }, 'client_to_server');
  assert.deepEqual(crypto.decrypt(consumed.credential.sessionId, envelope, 'test.payload'), { value: 'bound' });
  expectError(() => crypto.decrypt(consumed.credential.sessionId, envelope, 'test.payload'), 'ENVELOPE_SEQUENCE_REPLAYED');
  const workspaceEnvelope = crypto.encrypt(consumed.credential.sessionId, 'test.workspace', { value: 1 }, 'client_to_server');
  const wrongWorkspace = { ...workspaceEnvelope, workspaceId: 'other-workspace' };
  expectError(() => crypto.decrypt(consumed.credential.sessionId, wrongWorkspace, 'test.workspace'), 'ENVELOPE_BINDING_INVALID');
  assert.deepEqual(crypto.decrypt(consumed.credential.sessionId, workspaceEnvelope, 'test.workspace'), { value: 1 });
  const authenticEnvelope = crypto.encrypt(consumed.credential.sessionId, 'test.tamper', { value: 1 }, 'client_to_server');
  const tampered = { ...authenticEnvelope };
  tampered.ciphertextBase64url = `${tampered.ciphertextBase64url.startsWith('A') ? 'B' : 'A'}${tampered.ciphertextBase64url.slice(1)}`;
  expectError(() => crypto.decrypt(consumed.credential.sessionId, tampered, 'test.tamper'), 'ENVELOPE_AUTHENTICATION_FAILED');
  assert.deepEqual(crypto.decrypt(consumed.credential.sessionId, authenticEnvelope, 'test.tamper'), { value: 1 });

  const content = Buffer.from('mobile transfer test', 'utf8');
  const digest = sha256(content);
  const descriptor = runtime.transfers.create(context, {
    fileName: 'report.txt',
    mediaType: 'text/plain',
    sizeBytes: content.length,
    sha256: digest,
    keyFingerprint: consumed.keyFingerprint,
    manifest: {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      sizeBytes: content.length,
      chunkSizeBytes: content.length,
      totalChunks: 1,
      fileSha256: digest,
      chunks: [{ index: 0, offsetBytes: 0, sizeBytes: content.length, sha256: digest }],
      createdAt: new Date().toISOString(),
    },
  });
  const completed = runtime.transfers.acceptChunk(context, descriptor.transferId, 0, content.toString('base64'));
  assert.equal(completed.status, 'completed');
  const completedCrossDevice = runtime.crossDevice.syncMobileTransfer(context, completed);
  assert.equal(completedCrossDevice.progress.bytesTransferred, content.length);
  assert.equal(completedCrossDevice.progress.percent, 100);
  assert.equal(completedCrossDevice.progress.integrity, 'verified');
  assert.equal(JSON.stringify(completed).includes(tempRoot), false);
  const transferRegistry = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(transferRegistry.includes(tempRoot), false);
  assert.equal(transferRegistry.includes('internalDirectory'), false);
  expectError(() => runtime.transfers.acceptChunk(context, descriptor.transferId, 0, content.toString('base64')), 'TRANSFER_ALREADY_COMPLETED');
  expectError(() => runtime.transfers.create(context, { fileName: '../escape.txt', mediaType: 'text/plain', sizeBytes: 1, sha256: sha256('x'), keyFingerprint: consumed.keyFingerprint, manifest: { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, sizeBytes: 1, chunkSizeBytes: 1, totalChunks: 1, fileSha256: sha256('x'), chunks: [{ index: 0, offsetBytes: 0, sizeBytes: 1, sha256: sha256('x') }] } }), 'TRANSFER_FILENAME_INVALID');
  const checksumDescriptor = runtime.transfers.create(context, { fileName: 'checksum.txt', mediaType: 'text/plain', sizeBytes: 1, sha256: sha256('x'), keyFingerprint: consumed.keyFingerprint, manifest: { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, sizeBytes: 1, chunkSizeBytes: 1, totalChunks: 1, fileSha256: sha256('x'), chunks: [{ index: 0, offsetBytes: 0, sizeBytes: 1, sha256: sha256('x') }] } });
  expectError(() => runtime.transfers.acceptChunk(context, checksumDescriptor.transferId, 0, Buffer.from('y').toString('base64')), 'TRANSFER_CHUNK_CHECKSUM_MISMATCH');

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  let emergencyActor = '';
  app.use(createMobileTasksRouter({
    runtime,
    killSwitchActive: () => true,
    ownerPolicyAllows: () => true,
    activateEmergencyStop: (_reason, actor) => { emergencyActor = actor; return { active: true }; },
  }));
  app.use(createMobileTransfersRouter({ runtime, killSwitchActive: () => false }));
  app.use(createMobileCrossDeviceRouter({ runtime, killSwitchActive: () => false }));
  server = createServer(app);
  runtime.realtime.handleUpgrade(server);
  const port = await listen(server);
  await websocketReplay(runtime, consumed.credential.token, port, consumed.credential.sessionId);

  let response = await fetch(`http://127.0.0.1:${port}/api/mobile/tasks`, {
    method: 'POST',
    headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: crypto.encrypt(consumed.credential.sessionId, 'task.create', { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, commandId: 'command-task-1', command: 'task.create_low_risk', deviceId: consumed.credential.deviceId, workspaceId: consumed.credential.workspaceId, sessionId: consumed.credential.sessionId, sequence: 1, idempotencyKey: 'mobile-task-0001', riskLevel: 0, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { title: 'Safe task', objective: 'Verify the mobile gate.' } }, 'client_to_server') }),
  });
  assert.equal(response.status, 423);
  assert.equal((await response.json() as { errorCode?: string }).errorCode, 'KILL_SWITCH_ACTIVE');

  response = await fetch(`http://127.0.0.1:${port}/api/mobile/emergency-stop`, {
    method: 'POST',
    headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: crypto.encrypt(consumed.credential.sessionId, 'emergency_stop.activate', { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, commandId: 'command-stop-1', command: 'emergency_stop', deviceId: consumed.credential.deviceId, workspaceId: consumed.credential.workspaceId, sessionId: consumed.credential.sessionId, sequence: 2, idempotencyKey: 'mobile-stop-0001', riskLevel: 0, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { reason: 'test' } }, 'client_to_server') }),
  });
  assert.equal(response.status, 200);
  const emergencyEnvelope = (await response.json() as { envelope: MobileEncryptedEnvelope }).envelope;
  const emergencyResult = crypto.decrypt<{ state: { active: boolean }; commandResult: { status: string } }>(consumed.credential.sessionId, emergencyEnvelope, 'emergency_stop.result', 'server_to_client');
  assert.equal(emergencyResult.state.active, true);
  assert.equal(emergencyResult.commandResult.status, 'completed');
  assert.equal(emergencyActor, 'mobile:android-test-device');

  const routeContent = Buffer.from('route transfer', 'utf8');
  const routeDigest = sha256(routeContent);
  const transferPayload = {
    fileName: 'route.txt',
    mediaType: 'text/plain',
    sizeBytes: routeContent.length,
    sha256: routeDigest,
    manifest: { contractVersion: 2 as const, amendment: EDITH_CONTRACT_AMENDMENT, sizeBytes: routeContent.length, chunkSizeBytes: routeContent.length, totalChunks: 1, fileSha256: routeDigest, chunks: [{ index: 0, offsetBytes: 0, sizeBytes: routeContent.length, sha256: routeDigest }] },
  };
  response = await fetch(`http://127.0.0.1:${port}/api/mobile/transfers`, {
    method: 'POST',
    headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: crypto.encrypt(consumed.credential.sessionId, 'file.transfer.create', { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, commandId: 'command-transfer-1', command: 'file.upload', deviceId: consumed.credential.deviceId, workspaceId: consumed.credential.workspaceId, sessionId: consumed.credential.sessionId, sequence: 3, idempotencyKey: 'mobile-transfer-0001', riskLevel: 0, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: transferPayload }, 'client_to_server', 'transfer') }),
  });
  assert.equal(response.status, 201);
  crypto.decrypt(consumed.credential.sessionId, (await response.json() as { envelope: MobileEncryptedEnvelope }).envelope, 'file.transfer.created', 'server_to_client', 'transfer');
  response = await fetch(`http://127.0.0.1:${port}/api/mobile/transfers`, {
    method: 'POST',
    headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: crypto.encrypt(consumed.credential.sessionId, 'file.transfer.create', { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, commandId: 'command-transfer-2', command: 'file.upload', deviceId: consumed.credential.deviceId, workspaceId: consumed.credential.workspaceId, sessionId: consumed.credential.sessionId, sequence: 4, idempotencyKey: 'mobile-transfer-0001', riskLevel: 0, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { ...transferPayload, fileName: 'different.txt' } }, 'client_to_server', 'transfer') }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { errorCode?: string }).errorCode, 'DEVICE_IDEMPOTENCY_CONFLICT');

  const clipboardRequest = {
    contractVersion: 2 as const,
    amendment: EDITH_CONTRACT_AMENDMENT,
    ownerSessionBindingId: ownerSession.bindingId,
    workspaceId: consumed.credential.workspaceId,
    sessionId: consumed.credential.sessionId,
    sourceDeviceId: consumed.credential.deviceId,
    targetDeviceId: store.serverId(),
    clipboardId: 'route-clipboard-phase6',
    direction: 'mobile_to_pc' as const,
    mimeType: 'text/plain' as const,
    content: 'encrypted route clipboard',
    explicitConsent: true as const,
    persistHistory: false as const,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  response = await fetch(`http://127.0.0.1:${port}/api/mobile/cross-device/clipboard`, {
    method: 'POST',
    headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: crypto.encrypt(consumed.credential.sessionId, 'cross_device.clipboard.publish', { contractVersion: 2, amendment: EDITH_CONTRACT_AMENDMENT, commandId: 'command-clipboard-1', command: 'clipboard.publish', deviceId: consumed.credential.deviceId, workspaceId: consumed.credential.workspaceId, sessionId: consumed.credential.sessionId, sequence: 5, idempotencyKey: 'mobile-clipboard-0001', riskLevel: 0, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { request: clipboardRequest } }, 'client_to_server') }),
  });
  assert.equal(response.status, 201);
  const clipboardWire = await response.text();
  assert.equal(clipboardWire.includes(clipboardRequest.content), false);
  const clipboardResult = crypto.decrypt<{ metadata: { clipboardId: string } }>(consumed.credential.sessionId, (JSON.parse(clipboardWire) as { envelope: MobileEncryptedEnvelope }).envelope, 'cross_device.clipboard.published', 'server_to_client');
  assert.equal(clipboardResult.metadata.clipboardId, clipboardRequest.clipboardId);

  response = await fetch(`http://127.0.0.1:${port}/api/mobile/tasks`);
  assert.equal(response.status, 401);

  const rotated = pairing.rotate(pairing.authenticate(consumed.credential.token));
  expectError(() => pairing.authenticate(consumed.credential.token), 'DEVICE_CREDENTIAL_INVALID');
  assert.equal(pairing.authenticate(rotated.token).credential.rotatedFromId, consumed.credential.credentialId);
  assert.deepEqual(pairing.revokeOwnerBinding(ownerSession.bindingId), [request.device.deviceId]);
  expectError(() => pairing.authenticate(rotated.token), 'DEVICE_CREDENTIAL_INVALID');

  const expiring = pairing.request({ ...request, device: { ...request.device, deviceId: 'expiring-device' } });
  const expiringRecord = store.getPairing(expiring.pairing.pairingId)!;
  expiringRecord.expiresAt = new Date(Date.now() - 1_000).toISOString();
  store.savePairing(expiringRecord);
  expectError(() => pairing.submitProof(expiring.pairing.pairingId, signature(signingKeys.privateKey, expiring.proofPayload)), 'PAIRING_EXPIRED');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'one_time_pairing_proof', 'owner_approval_code', 'secret_free_registry',
      'credential_rotation_and_revocation', 'pairing_expiry', 'x25519_hkdf_aes_gcm',
      'workspace_device_session_aad_binding', 'tamper_and_replay_rejection',
      'encrypted_resumable_transfer', 'byte_backed_cross_device_progress', 'filename_and_checksum_boundary', 'transfer_idempotency_conflict', 'authenticated_realtime_replay',
      'kill_switch_blocks_remote_task', 'emergency_stop_bypasses_kill_switch', 'cross_device_encrypted_endpoint', 'owner_binding_revokes_device_authority', 'unauthenticated_device_denied',
    ],
  }, null, 2));
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
