import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, sign } from 'node:crypto';
import express from 'express';
import {
  EDITH_CONTRACT_AMENDMENT,
  EDITH_MOBILE_PROTOCOL_VERSION,
  TASK_CONTRACT_VERSION,
  isSafeTransferFileNameV2,
  parseEncryptedFileChunkV2,
  parseMobileApplicationEnvelopeV2,
  parseMobileCryptoNegotiationV2,
  parseMobilePairingConsumeResultV2,
  parseMobilePairingOfferV2,
  parseMobilePairingRequestV2,
  parseMobilePublicKeyV2,
  parseMobileRemoteCommandV2,
  parseMobileServerIdentityV2,
  type MobilePairingRequestV2,
  type MobilePublicKeyV2,
} from '../src/edith/contracts';
import { MobileCryptoService, sha256 } from '../server/mobile/crypto';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import { MobileTransferService } from '../server/mobile/transferService';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import type { MobileRuntime } from '../server/mobile/runtime';
import { createMobilePairingRouter } from '../server/routes/mobilePairing';

const suite = 'P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM' as const;
const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT };

function publicDescriptor(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'], algorithm: MobilePublicKeyV2['algorithm']): MobilePublicKeyV2 {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { ...v21, algorithm, encoding: 'spki_der_base64', value: der.toString('base64'), fingerprint: sha256(der) };
}

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof Error && error.message === code, code);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function decryptServerEnvelope(envelope: any, agreementPrivateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], serverAgreementKey: MobilePublicKeyV2, challenge: string, transcript: string): any {
  const serverPublic = serverAgreementKey.encoding === 'jwk'
    ? createPublicKey({ key: serverAgreementKey.value as any, format: 'jwk' })
    : createPublicKey({ key: Buffer.from(String(serverAgreementKey.value), 'base64'), format: 'der', type: 'spki' });
  const shared = diffieHellman({ privateKey: agreementPrivateKey, publicKey: serverPublic });
  const root = Buffer.from(hkdfSync('sha256', shared, Buffer.from(challenge, 'base64url'), Buffer.from(`edith.mobile.session.v1|${sha256(transcript)}`), 32));
  const key = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('edith.mobile.s2c.v1'), 32));
  const { nonceBase64url, ciphertextBase64url, authTagBase64url, ...header } = envelope;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceBase64url, 'base64url'));
  decipher.setAAD(Buffer.from(canonical(header), 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagBase64url, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextBase64url, 'base64url')), decipher.final()]);
  root.fill(0);
  key.fill(0);
  return JSON.parse(plaintext.toString('utf8'));
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return address.port;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-mobile-contract-'));
let server: ReturnType<typeof createServer> | undefined;

try {
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const agreement = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signingKey = publicDescriptor(signing.publicKey, 'ECDSA-P256-SHA256');
  const agreementKey = publicDescriptor(agreement.publicKey, 'ECDH-P256');
  const capabilities = { ...v21, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION, realtime: true, fileTransfer: true, fileTransferEncryption: true, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false };
  const request: MobilePairingRequestV2 = {
    ...v21,
    protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
    device: { deviceId: 'android-p256-device', displayName: 'Android P-256', platform: 'android', capabilities },
    supportedSuites: [suite],
    signingKey,
    agreementKey,
    requestedCommands: ['task.list', 'task.create_low_risk', 'emergency_stop', 'file.upload'],
  };

  assert.equal(parseMobilePairingRequestV2(request).success, true);
  assert.equal(parseMobilePublicKeyV2({ ...signingKey, value: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def', d: 'private' } }).success, false);
  assert.equal(parseMobilePairingRequestV2({ ...request, supportedSuites: ['unsupported-suite'] }).success, false);
  assert.equal(parseMobilePairingRequestV2({ ...request, supportedSuites: ['ED25519_X25519_HKDF_SHA256_AES256_GCM'] }).success, false);

  const store = new MobileRegistryStore(tempRoot);
  store.initialize();
  const crypto = new MobileCryptoService();
  const pairing = new MobilePairingService(store, crypto);
  const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
  const runtime: MobileRuntime = { store, crypto, pairing, realtime, transfers: new MobileTransferService(store, tempRoot), crossDevice: new CrossDeviceService(store.serverId()) };
  const offered = pairing.request(request);
  assert.equal(offered.negotiation.selectedSuite, suite);
  assert.equal(offered.pairing.challenge?.algorithm, 'ECDSA-P256-SHA256');
  assert.equal(parseMobileServerIdentityV2(offered.server).success, true);
  assert.equal(parseMobileCryptoNegotiationV2(offered.negotiation).success, true);
  assert.equal(parseMobilePairingOfferV2(offered.offer).success, true);
  assert.equal(parseMobilePairingOfferV2({ ...offered.offer, requestedCommandsFingerprint: '0'.repeat(64) }).success, false);
  assert.equal(parseMobilePairingOfferV2({ ...offered.offer, transcriptBase64url: Buffer.from(`${offered.proofPayload}\ntampered`, 'utf8').toString('base64url') }).success, false);

  const proof = sign('sha256', Buffer.from(offered.proofPayload), signing.privateKey).toString('base64url');
  pairing.submitProof(offered.pairing.pairingId, proof);
  pairing.approve(offered.pairing.pairingId, offered.code, request.requestedCommands, { bindingId: 'owner-session-reconciliation', expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(createMobilePairingRouter({ runtime }));
  server = createServer(app);
  const port = await listen(server);
  const consumePayload = `${offered.proofPayload}\nconsume`;
  const consumeAssertion = sign('sha256', Buffer.from(consumePayload), signing.privateKey).toString('base64url');
  const response = await fetch(`http://127.0.0.1:${port}/api/mobile/pairing/${encodeURIComponent(offered.pairing.pairingId)}/consume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...v21, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION, pairingId: offered.pairing.pairingId, assertionType: 'consume', assertionBase64url: consumeAssertion, payloadFingerprint: sha256(consumePayload), submittedAt: new Date().toISOString() }),
  });
  assert.equal(response.status, 200);
  const responseText = await response.text();
  const wire = JSON.parse(responseText) as { data: any };
  assert.equal(parseMobilePairingConsumeResultV2(wire.data).success, true);
  const independent = decryptServerEnvelope(wire.data.credentialEnvelope, agreement.privateKey, offered.serverAgreementKey, offered.challenge, offered.proofPayload) as { credential: { token: string; secret: string } };
  const decrypted = crypto.decrypt<{ credential: { token: string; secret: string } }>(wire.data.session.sessionId, wire.data.credentialEnvelope, 'pairing.credential', 'server_to_client', 'http');
  assert.equal(independent.credential.token, decrypted.credential.token);
  assert.match(decrypted.credential.token, /^mobile-cred-/);
  assert.equal(responseText.includes(decrypted.credential.token), false);
  assert.equal(responseText.includes(decrypted.credential.secret), false);

  const reflected = { ...wire.data.credentialEnvelope, direction: 'client_to_server' };
  expectCode(() => crypto.decrypt(wire.data.session.sessionId, reflected, 'pairing.credential', 'server_to_client', 'http'), 'ENVELOPE_BINDING_INVALID');
  const gapEnvelope = { ...crypto.encrypt(wire.data.session.sessionId, 'gap.test', { value: 1 }, 'client_to_server', 'http'), sequence: 3 };
  expectCode(() => crypto.decrypt(wire.data.session.sessionId, gapEnvelope, 'gap.test', 'client_to_server', 'http'), 'ENVELOPE_SEQUENCE_GAP');
  assert.equal(parseMobileApplicationEnvelopeV2({ ...wire.data.credentialEnvelope, channel: 'invalid' }).success, false);
  assert.equal(parseMobileApplicationEnvelopeV2({ ...wire.data.credentialEnvelope, privateKey: 'forbidden' }).success, false);

  const now = Date.now();
  const command = { ...v21, commandId: 'command-1', command: 'task.list', deviceId: 'android-p256-device', workspaceId: wire.data.session.workspaceId, sessionId: wire.data.session.sessionId, sequence: 1, idempotencyKey: 'mobile-command-0001', riskLevel: 0, issuedAt: new Date(now - 10_000).toISOString(), expiresAt: new Date(now + 10_000).toISOString(), payload: {} };
  assert.equal(parseMobileRemoteCommandV2(command).success, true);
  assert.equal(parseMobileRemoteCommandV2({ ...command, expiresAt: new Date(now - 1_000).toISOString() }).success, false);
  assert.equal(parseMobileRemoteCommandV2({ ...command, payload: { apiKey: 'forbidden' } }).success, false);

  const encryptedChunk = {
    ...v21,
    transferId: 'transfer-1',
    deviceId: request.device.deviceId,
    sessionId: wire.data.session.sessionId,
    index: 0,
    plaintextSizeBytes: 4,
    plaintextSha256: sha256('test'),
    encryption: 'application_envelope_aes_256_gcm' as const,
    aadPurpose: 'file.transfer.chunk:transfer-1:0',
  };
  assert.equal(parseEncryptedFileChunkV2(encryptedChunk).success, true);
  assert.equal(parseEncryptedFileChunkV2({ ...encryptedChunk, aadPurpose: 'file.transfer.chunk:transfer-1:1' }).success, false);

  for (const blocked of ['../secret.txt', 'C:\\secret.txt', 'folder/file.txt', 'folder%2fsecret.txt', 'CON', 'LPT1.log']) assert.equal(isSafeTransferFileNameV2(blocked), false, blocked);
  assert.equal(isSafeTransferFileNameV2('safe-report.json'), true);

  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const p384Descriptor = publicDescriptor(p384.publicKey, 'ECDSA-P256-SHA256');
  assert.equal(parseMobilePublicKeyV2(p384Descriptor).success, false);
  const p384Request = { ...request, device: { ...request.device, deviceId: 'android-p384-device' }, signingKey: p384Descriptor };
  expectCode(() => pairing.request(p384Request), 'MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH');

  const persisted = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(persisted.includes(decrypted.credential.secret), false);
  assert.equal(persisted.includes(consumeAssertion), false);
  assert.equal(persisted.includes('privateKey'), false);

  console.log(JSON.stringify({ success: true, suite, checks: [
    'android_p256_ecdsa_ecdh_negotiation', 'spki_der_public_key_validation', 'explicit_legacy_suite_no_substitution',
    'canonical_server_identity_and_capabilities', 'pairing_transcript_tamper_rejected', 'independent_p256_envelope_vector', 'encrypted_credential_bootstrap', 'direction_channel_reflection_rejected', 'sequence_gap_rejected',
    'expired_remote_command_rejected', 'secret_payload_rejected', 'encrypted_chunk_aad_binding', 'safe_filename_rules', 'p384_rejected', 'registry_secret_free',
  ] }, null, 2));
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
