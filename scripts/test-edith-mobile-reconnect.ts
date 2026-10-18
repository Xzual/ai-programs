import {getMobileOwnerSessionFixture} from './helpers/mobile-owner-session-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import express from 'express';
import { WebSocket } from 'ws';
import { MobileCryptoService, deriveMobileKey, sha256 } from '../server/mobile/crypto';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileTransferService } from '../server/mobile/transferService';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import { createMobilePairingRouter } from '../server/routes/mobilePairing';
import { installReconnectParsers, initiationTranscript, reconnectTranscript, parseReconnectOffer, P256_SUITE, RECONNECT_SCHEMA, type ReconnectInitiation, type ReconnectOffer } from '../server/mobile/reconnectContract';
import { TASK_CONTRACT_VERSION, EDITH_CONTRACT_AMENDMENT, EDITH_MOBILE_PROTOCOL_VERSION, parseRealtimeEnvelopeV2_1, type MobilePublicKeyV2 } from '../src/edith/contracts';

const mobileOwnerFixture=await getMobileOwnerSessionFixture();
await mobileOwnerFixture.close(); // Owner session remains active; only the fixture listener closes.
assert.equal(process.env.EDITH_TEST_MODE, 'true');
const base = path.join(process.env.EDITH_TEST_DATA_DIR!, 'reconnect-fixtures');
const versions = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION };
function descriptor(pair: ReturnType<typeof generateKeyPairSync>, algorithm: MobilePublicKeyV2['algorithm']): MobilePublicKeyV2 {
  const bytes = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, algorithm, encoding: 'spki_der_base64', value: bytes.toString('base64'), fingerprint: sha256(bytes) };
}
const ec = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const proof = (key: ReturnType<typeof ec>, text: string) => sign('sha256', Buffer.from(text), key.privateKey).toString('base64url');
let checks = 0;
function ok(value: unknown, message: string) { assert.ok(value, message); checks++; }
function fixture(name: string, failInitial = false) {
  const store = new MobileRegistryStore(path.join(base, name)); store.initialize();
  const crypto = new MobileCryptoService(), pairing = new MobilePairingService(store, crypto), signing = ec(), agreement = ec();
  const signingKey = descriptor(signing, 'ECDSA-P256-SHA256');
  const offer = pairing.request({ ...versions, device: { deviceId: `device-${name}`, displayName: 'Isolated fixture', platform: 'android', capabilities: { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, realtime: true, fileTransfer: false, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } }, supportedSuites: [P256_SUITE], signingKey, agreementKey: descriptor(agreement, 'ECDH-P256'), requestedCommands: ['task.list', 'task.detail'] } as any);
  pairing.submitProof(offer.pairing.pairingId, proof(signing, offer.proofPayload));
  pairing.approve(offer.pairing.pairingId, offer.code, undefined, mobileOwnerFixture.pairingOwnerFor(600_000));
  if (failInitial) {
    const write = (store as any).write.bind(store), before = fs.readFileSync(store.filePath, 'utf8');
    (store as any).write = () => { throw Error('INITIAL_PUBLICATION_FAULT'); };
    assert.throws(() => pairing.consume(offer.pairing.pairingId, proof(signing, `${offer.proofPayload}\nconsume`)), /INITIAL_PUBLICATION_FAULT/);
    assert.equal(fs.readFileSync(store.filePath, 'utf8'), before); assert.equal((crypto as any).sessions.size, 0); checks += 3;
    (store as any).write = write;
  }
  const consumed = pairing.consume(offer.pairing.pairingId, proof(signing, `${offer.proofPayload}\nconsume`));
  return { store, crypto, pairing, signing, signingKey, consumed };
}
function initiate(f: ReturnType<typeof fixture>) {
  const client = ec();
  const device = f.store.getDevice(f.consumed.credential.deviceId)!;
  const request: ReconnectInitiation = { schema: RECONNECT_SCHEMA, ...versions, serverId: f.store.serverId(), workspaceId: device.trust.workspaceId!, deviceId: device.device.deviceId, signingKeyFingerprint: f.signingKey.fingerprint, cryptoSuite: P256_SUITE, clientNonce: randomBytes(32).toString('base64url'), clientAgreementKey: descriptor(client, 'ECDH-P256'), issuedAt: new Date().toISOString(), assertionBase64url: '' };
  request.assertionBase64url = proof(f.signing, initiationTranscript(request));
  return { request, client };
}
function consumeBody(f: ReturnType<typeof fixture>, offer: ReconnectOffer) {
  return { schema: RECONNECT_SCHEMA, ...versions, reconnectId: offer.reconnectId, challengeId: offer.challengeId, transcriptFingerprint: offer.transcriptFingerprint, assertionBase64url: proof(f.signing, `${reconnectTranscript(offer)}\nconsume`) };
}
function keys(client: ReturnType<typeof ec>, offer: ReconnectOffer) {
  const root = deriveMobileKey(client.privateKey, offer.serverAgreementKey, Buffer.from(offer.challengeBase64url, 'base64url'), `edith.mobile.reconnect.session.v1|${sha256(reconnectTranscript(offer))}`);
  return { c2s: Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('edith.mobile.c2s.v1'), 32)), s2c: Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('edith.mobile.s2c.v1'), 32)) };
}
function canonical(value: Record<string, unknown>) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))); }
function decrypt(envelope: any, key: Buffer) {
  const { nonceBase64url, ciphertextBase64url, authTagBase64url, ...header } = envelope;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceBase64url, 'base64url')); decipher.setAAD(Buffer.from(canonical(header))); decipher.setAuthTag(Buffer.from(authTagBase64url, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextBase64url, 'base64url')), decipher.final()]).toString());
}
function resumeEnvelope(session: any, key: Buffer, afterCursor: number, sequence = 1) {
  const header = { ...versions, aadVersion: 'edith-mobile-aad-v1', encryption: 'AES-256-GCM', cryptoSuite: P256_SUITE, sessionId: session.sessionId, serverId: session.serverId, deviceId: session.deviceId, workspaceId: session.workspaceId, sequence, direction: 'client_to_server', channel: 'realtime', purpose: 'realtime.command' };
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(canonical(header)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ type: 'resume', afterCursor })), cipher.final()]);
  return { ...header, nonceBase64url: nonce.toString('base64url'), ciphertextBase64url: ciphertext.toString('base64url'), authTagBase64url: cipher.getAuthTag().toString('base64url') };
}
function cold(f: ReturnType<typeof fixture>) {
  const store = new MobileRegistryStore(path.dirname(f.store.filePath)); store.initialize();
  const crypto = new MobileCryptoService(), pairing = new MobilePairingService(store, crypto);
  return { ...f, store, crypto, pairing };
}

// Actual cold issuer, mounted HTTP and WebSocket. Loopback is a debug transport fixture.
const original = fixture('mounted'), f = cold(original);
assert.throws(() => f.pairing.authenticate(original.consumed.credential.token), /DEVICE_REPAIR_REQUIRED/); checks++;
const realtime = new MobileRealtimeService(f.pairing, f.crypto, f.store.serverId());
const runtime = { store: f.store, crypto: f.crypto, pairing: f.pairing, realtime, transfers: new MobileTransferService(f.store, path.dirname(f.store.filePath)), crossDevice: new CrossDeviceService(f.store.serverId()) };
const app = express(); installReconnectParsers(app); app.use(express.json()); app.use(createMobilePairingRouter({ runtime }));
const server = createServer(app); realtime.handleUpgrade(server);
let socket: WebSocket | undefined;
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const { request, client } = initiate(f);
  const response = await post('/api/mobile/session/reconnect/challenge', request); assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  const offer = await response.json() as ReconnectOffer; ok(parseReconnectOffer(offer).success, 'Actual offer satisfies frozen transcript schema');
  const duplicate = await post('/api/mobile/session/reconnect/challenge', request); assert.deepEqual(await duplicate.json(), offer); checks++;
  const unsupported = await post('/api/mobile/session/reconnect/challenge', { ...request, cryptoSuite: 'ED25519_X25519_HKDF_SHA256_AES256_GCM' }); assert.equal(unsupported.status, 428); checks++;
  const body = consumeBody(f, offer), route = `/api/mobile/session/reconnect/${offer.reconnectId}/consume`;
  const race = await Promise.all([post(route, body), post(route, body)]); assert.deepEqual(race.map(row => row.status).sort(), [200, 409]); checks++;
  const result = await race.find(row => row.status === 200)!.json() as any, derived = keys(client, offer), plain = decrypt(result.credentialEnvelope, derived.s2c);
  assert.equal(result.credentialEnvelope.sequence, 1); assert.equal(result.credentialEnvelope.purpose, 'session.reconnected'); assert.equal(plain.reset.realtimeAfterCursor, 0);
  assert.equal(result.session.keyFingerprint, sha256(Buffer.concat([derived.c2s, derived.s2c])));
  assert.equal(plain.trust.expiresAt, original.store.getDevice(request.deviceId)!.trust.expiresAt); assert.deepEqual(plain.allowedCommands, ['task.list', 'task.detail']); checks += 5;
  assert.throws(() => f.pairing.authenticate(original.consumed.credential.token), /DEVICE_CREDENTIAL_INVALID/); checks++;
  f.pairing.authenticate(plain.credential.token);
  const replay = await post('/api/mobile/session/reconnect/challenge', request); assert.equal(replay.status, 409); checks++;
  const malformed = await post('/api/mobile/session/reconnect/challenge', '{"schema":"x","sch\\u0065ma":"x"}'); assert.equal(malformed.status, 400); checks++;
  const tooLarge = await post('/api/mobile/session/reconnect/challenge', JSON.stringify({ padding: 'x'.repeat(17000) })); assert.equal(tooLarge.status, 413); checks++;
  socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/mobile/realtime', { headers: { authorization: `Device ${plain.credential.token}` } });
  await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
  const eventPromise = new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(Error('IDLE_EVENT_TIMEOUT')), 3000); socket!.once('message', bytes => { clearTimeout(timer); resolve(JSON.parse(bytes.toString())); }); });
  socket.send(JSON.stringify(resumeEnvelope(result.session, derived.c2s, 0)));
  const wire = await eventPromise, event = decrypt(wire, derived.s2c);
  ok(parseRealtimeEnvelopeV2_1(event).success, 'Idle fresh session emits actual canonical realtime event'); assert.equal(wire.sequence, 1); assert.equal(event.cursor, 1); ok(event.streamId.endsWith(`:${result.session.sessionId}`), 'Event stream bound to new session');
  // Lost ACK: no claim retry, a fresh nonce/ephemeral pair repairs by current persisted approval.
  const second = initiate(f), secondOffer = f.pairing.beginReconnect(second.request);
  const closed = new Promise<number>(resolve => socket!.once('close', code => resolve(code)));
  const next = f.pairing.consumeReconnect(secondOffer.reconnectId, consumeBody(f, secondOffer));
  assert.equal(await closed, 4003); checks++;
  assert.equal(realtime.status().retainedEvents, 0); assert.equal(f.crypto.hasSession(result.session.sessionId), false); checks += 2;
  assert.throws(() => f.crypto.decrypt(result.session.sessionId, resumeEnvelope(result.session, derived.c2s, 0, 2) as any, 'realtime.command', 'client_to_server', 'realtime'), /SESSION_CRYPTO_CONFIGURATION_REQUIRED/); checks++;
  assert.throws(() => f.pairing.consumeReconnect(secondOffer.reconnectId, consumeBody(f, secondOffer)), /ALREADY_CONSUMED/); checks++;
  ok(decrypt(next.credentialEnvelope, keys(second.client, secondOffer).s2c).credential.token, 'Fresh nonce recovers after lost acknowledgement');
  ok(!fs.readFileSync(f.store.filePath, 'utf8').includes(plain.credential.secret), 'Registry has no plaintext credential secret');
} finally { socket?.terminate(); realtime.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); }

// Real issuer/store fault injection within owned fresh temporary directories.
for (const fault of ['before', 'after', 'activate'] as const) {
  const x = fixture(`fault-${fault}`), fresh = cold(x), initiation = initiate(fresh), offer = fresh.pairing.beginReconnect(initiation.request);
  const before = fs.readFileSync(x.store.filePath, 'utf8'), write = (fresh.store as any).write.bind(fresh.store), activate = fresh.crypto.activateReconnect.bind(fresh.crypto);
  if (fault !== 'activate') (fresh.store as any).write = (doc: unknown) => { if (fault === 'after') write(doc); throw Error('OWNED_COMMIT_FAULT'); };
  else fresh.crypto.activateReconnect = () => { throw Error('OWNED_ACTIVATION_FAULT'); };
  assert.throws(() => fresh.pairing.consumeReconnect(offer.reconnectId, consumeBody(fresh, offer)), /OWNED_/); checks++;
  assert.equal(fresh.crypto.hasSession(offer.nextSessionId), false); checks++;
  if (fault === 'before') { assert.equal(fs.readFileSync(x.store.filePath, 'utf8'), before); checks++; }
  else { assert.ok(fresh.store.getCredential(offer.priorCredentialId)!.revokedAt); checks++; }
  (fresh.store as any).write = write; fresh.crypto.activateReconnect = activate;
  const repair = initiate(fresh), retry = fresh.pairing.beginReconnect(repair.request); const repaired = fresh.pairing.consumeReconnect(retry.reconnectId, consumeBody(fresh, retry));
  ok(decrypt(repaired.credentialEnvelope, keys(repair.client, retry).s2c).credential, 'Fresh cold handshake repairs faulted publication');
}
for (const mode of ['late-revoke', 'expired-owner', 'expired-trust', 'workspace', 'signing', 'scope-change'] as const) {
  const x = fixture(mode), fresh = cold(x), initial = initiate(fresh), offer = fresh.pairing.beginReconnect(initial.request), device = fresh.store.getDevice(initial.request.deviceId)!;
  if (mode === 'late-revoke') fresh.pairing.revokeDevice(device.device.deviceId);
  else { if (mode === 'expired-owner') device.ownerBinding.expiresAt = new Date(Date.now() - 1).toISOString(); if (mode === 'expired-trust') device.trust.expiresAt = new Date(Date.now() - 1).toISOString(); if (mode === 'workspace') device.ownerBinding.workspaceId = 'wrong-workspace'; if (mode === 'signing') device.signingKey = descriptor(ec(), 'ECDSA-P256-SHA256'); if (mode === 'scope-change') device.allowedCommands = ['task.list']; fresh.store.saveDevice(device); }
  assert.throws(() => fresh.pairing.consumeReconnect(offer.reconnectId, consumeBody(fresh, offer)), mode === 'late-revoke' ? /RECONNECT_ALREADY_CONSUMED/ : /TRUST_INVALID|AUTHORITY_CHANGED/); checks++;
  assert.equal(fresh.crypto.hasSession(offer.nextSessionId), false); checks++;
}
const expired = fixture('expired-access'), expiryRecord = expired.store.getCredential(expired.consumed.credential.credentialId)!;
expiryRecord.expiresAt = new Date(Date.now() - 1).toISOString(); expired.store.saveCredential(expiryRecord);
const recovered = cold(expired), request = initiate(recovered), offer = recovered.pairing.beginReconnect(request.request), result = recovered.pairing.consumeReconnect(offer.reconnectId, consumeBody(recovered, offer));
ok(decrypt(result.credentialEnvelope, keys(request.client, offer).s2c).credential, 'Expired access cannot erase original live owner approval');
fixture('initial-atomic-fault', true);
const rotated = fixture('rotation-atomic-fault'), rotateContext = rotated.pairing.authenticate(rotated.consumed.credential.token);
const beforeRotation = fs.readFileSync(rotated.store.filePath, 'utf8'), rotateWrite = (rotated.store as any).write.bind(rotated.store);
(rotated.store as any).write = () => { throw Error('ROTATION_PUBLICATION_FAULT'); };
assert.throws(() => rotated.pairing.rotate(rotateContext), /ROTATION_PUBLICATION_FAULT/); assert.equal(fs.readFileSync(rotated.store.filePath, 'utf8'), beforeRotation); checks += 2;
(rotated.store as any).write = rotateWrite;
rotated.pairing.authenticate(rotated.consumed.credential.token);
const newToken = rotated.pairing.rotate(rotateContext); rotated.pairing.authenticate(newToken.token);
assert.throws(() => rotated.pairing.authenticate(rotated.consumed.credential.token), /DEVICE_CREDENTIAL_INVALID/); checks++;
const signatureFixture = cold(fixture('signature-failures')), signed = initiate(signatureFixture), pending = signatureFixture.pairing.beginReconnect(signed.request);
const wrongKey = ec(), invalidBody = { ...consumeBody(signatureFixture, pending), assertionBase64url: proof(wrongKey, `${reconnectTranscript(pending)}\nconsume`) };
assert.throws(() => signatureFixture.pairing.beginReconnect({ ...signed.request, workspaceId: 'wrong' }), /TRUST_INVALID/); checks++;
assert.throws(() => signatureFixture.pairing.consumeReconnect(pending.reconnectId, { ...invalidBody, challengeId: 'wrong-challenge' }), /BINDING_INVALID/); checks++;
for (let i = 0; i < 3; i++) { assert.throws(() => signatureFixture.pairing.consumeReconnect(pending.reconnectId, invalidBody), /PROOF_INVALID/); checks++; }
assert.throws(() => signatureFixture.pairing.consumeReconnect(pending.reconnectId, consumeBody(signatureFixture, pending)), /ALREADY_CONSUMED/); checks++;
assert.equal(signatureFixture.crypto.hasSession(pending.nextSessionId), false); checks++;
const reentrant = fixture('delivery-revoke'), delivery = initiate(reentrant), deliveryOffer = reentrant.pairing.beginReconnect(delivery.request);
reentrant.pairing.onSessionReplaced(deviceId => { reentrant.pairing.revokeDevice(deviceId); });
assert.throws(() => reentrant.pairing.consumeReconnect(deliveryOffer.reconnectId, consumeBody(reentrant, deliveryOffer)), /DEVICE_CREDENTIAL_INVALID|DEVICE_TRUST_INVALID/); checks++;
assert.equal(reentrant.crypto.hasSession(deliveryOffer.nextSessionId), false); assert.equal(reentrant.crypto.hasSession(deliveryOffer.priorSessionId), false); checks += 2;
// R6 actual-owned-filesystem authority regressions. No modelled issuer or native claim.
const authorityRegressionGroups: string[] = [];
const expectedRenameAttempts = process.platform === 'win32' ? 4 : 1;
function scopedRegistryRename(store: MobileRegistryStore, fault: (attempt: number, rename: () => void) => void, work: () => void) {
  const originalRename = fs.renameSync;
  const registryPath = path.resolve(store.filePath);
  const sources: string[] = [];
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    if (path.resolve(String(to)) !== registryPath) return originalRename(from, to);
    const source = path.resolve(String(from));
    assert.equal(path.dirname(source), path.dirname(registryPath));
    assert.ok(source.startsWith(registryPath + '.'));
    sources.push(source);
    fault(sources.length, () => originalRename(from, to));
  }) as typeof fs.renameSync;
  try { work(); } finally { fs.renameSync = originalRename; }
  return sources;
}
function renameError(label: string) { return Object.assign(new Error(label), { code: 'EPERM' }); }
function prepareInitialRename(name: string) {
  const store = new MobileRegistryStore(path.join(base, name)); store.initialize();
  const crypto = new MobileCryptoService(), pairing = new MobilePairingService(store, crypto), signing = ec(), agreement = ec();
  const signingKey = descriptor(signing, 'ECDSA-P256-SHA256');
  const offer = pairing.request({ ...versions, device: { deviceId: `device-${name}`, displayName: 'Owned initial rename fixture', platform: 'android', capabilities: { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, realtime: true, fileTransfer: false, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } }, supportedSuites: [P256_SUITE], signingKey, agreementKey: descriptor(agreement, 'ECDH-P256'), requestedCommands: ['task.list', 'task.detail'] } as any);
  pairing.submitProof(offer.pairing.pairingId, proof(signing, offer.proofPayload));
  pairing.approve(offer.pairing.pairingId, offer.code, undefined, mobileOwnerFixture.pairingOwnerFor(600_000));
  return { store, crypto, pairing, signing, offer };
}
{
  const initial = prepareInitialRename('initial-real-rename-permanent');
  const before = fs.readFileSync(initial.store.filePath), failure = renameError('OWNED_INITIAL_RENAME_EPERM');
  let delivered = false;
  const attempts = scopedRegistryRename(initial.store, () => { throw failure; }, () => {
    assert.throws(() => { initial.pairing.consume(initial.offer.pairing.pairingId, proof(initial.signing, `${initial.offer.proofPayload}\nconsume`)); delivered = true; }, error => error === failure);
  });
  assert.equal(attempts.length, expectedRenameAttempts); assert.equal(new Set(attempts).size, 1);
  assert.equal(delivered, false); assert.deepEqual(fs.readFileSync(initial.store.filePath), before);
  assert.equal((initial.crypto as any).sessions.size, 0); assert.equal((initial.crypto as any).stagedBySource.size, 0);
  assert.equal(initial.store.getPairing(initial.offer.pairing.pairingId)!.challenge.status, 'verified');
  assert.equal(fs.existsSync(attempts[0]), false); checks += 9;
  authorityRegressionGroups.push('initial actual rename failure no activation or credential delivery');
}
{
  const x = fixture('reconnect-real-rename-permanent'), pending = initiate(x), offer = x.pairing.beginReconnect(pending.request);
  const before = fs.readFileSync(x.store.filePath), failure = renameError('OWNED_RECONNECT_RENAME_EPERM');
  let delivered = false;
  const attempts = scopedRegistryRename(x.store, () => { throw failure; }, () => {
    assert.throws(() => { x.pairing.consumeReconnect(offer.reconnectId, consumeBody(x, offer)); delivered = true; }, error => error === failure);
  });
  assert.equal(attempts.length, expectedRenameAttempts); assert.equal(new Set(attempts).size, 1);
  assert.equal(delivered, false); assert.deepEqual(fs.readFileSync(x.store.filePath), before);
  assert.equal(x.crypto.hasSession(offer.nextSessionId), false); assert.equal(x.crypto.hasSession(offer.priorSessionId), true);
  assert.equal((x.crypto as any).stagedBySource.size, 0); assert.equal(fs.existsSync(attempts[0]), false);
  assert.throws(() => x.pairing.consumeReconnect(offer.reconnectId, consumeBody(x, offer)), /ALREADY_CONSUMED/); checks += 10;
  authorityRegressionGroups.push('reconnect actual rename failure terminal offer preserves prior authority');
}
for (const mode of ['initial', 'reconnect'] as const) {
  const failure = renameError('OWNED_TRANSIENT_' + mode);
  const initial = mode === 'initial' ? prepareInitialRename('initial-real-rename-recovery') : undefined;
  const x = mode === 'reconnect' ? fixture('reconnect-real-rename-recovery') : undefined;
  const pending = x ? initiate(x) : undefined, offer = pending ? x!.pairing.beginReconnect(pending.request) : undefined;
  const store = initial?.store ?? x!.store, before = fs.readFileSync(store.filePath);
  let issued: ReturnType<MobilePairingService['consume']> | ReturnType<MobilePairingService['consumeReconnect']> | undefined;
  const consume = () => { issued = initial ? initial.pairing.consume(initial.offer.pairing.pairingId, proof(initial.signing, `${initial.offer.proofPayload}\nconsume`)) : x!.pairing.consumeReconnect(offer!.reconnectId, consumeBody(x!, offer!)); };
  const attempts = scopedRegistryRename(store, (attempt, rename) => { if (attempt < 3) throw failure; rename(); }, () => {
    if (process.platform === 'win32') consume(); else assert.throws(consume, error => error === failure);
  });
  assert.equal(attempts.length, process.platform === 'win32' ? 3 : 1); assert.equal(new Set(attempts).size, 1);
  assert.equal(fs.existsSync(attempts[0]), false);
  if (process.platform === 'win32') {
    assert.ok(issued); assert.notDeepEqual(fs.readFileSync(store.filePath), before);
    if (initial) { assert.ok(initial.crypto.hasSession(issued.session.sessionId)); initial.pairing.authenticate((issued as ReturnType<MobilePairingService['consume']>).credential.token); }
    else {
      const recoveredCredential = decrypt((issued as ReturnType<MobilePairingService['consumeReconnect']>).credentialEnvelope, keys(pending!.client, offer!).s2c).credential;
      x!.pairing.authenticate(recoveredCredential.token); assert.equal(x!.crypto.hasSession(offer!.priorSessionId), false);
    }
  } else { assert.equal(issued, undefined); assert.deepEqual(fs.readFileSync(store.filePath), before); }
  checks += 6; authorityRegressionGroups.push(mode + ' actual transient rename platform policy');
}
for (const boundary of ['authenticate', 'rotate', 'acceptCommand'] as const) {
  for (const expiry of ['owner', 'trust'] as const) {
    const x = fixture(`late-write-${boundary}-${expiry}`), context = x.pairing.authenticate(x.consumed.credential.token);
    const realNow = Date.now, initialTime = realNow(), originalDeadline = new Date(initialTime + 50).toISOString();
    const device = x.store.getDevice(context.credential.deviceId)!;
    if (expiry === 'owner') device.ownerBinding.expiresAt = originalDeadline; else device.trust.expiresAt = originalDeadline;
    x.store.saveDevice(device);
    let clock = initialTime, admitted = false, returnedCredential: unknown;
    try {
      Date.now = () => clock;
      const attempts = scopedRegistryRename(x.store, (_attempt, rename) => { rename(); clock += 70; }, () => {
        assert.throws(() => {
          if (boundary === 'authenticate') x.pairing.authenticate(x.consumed.credential.token);
          else if (boundary === 'rotate') returnedCredential = x.pairing.rotate(context);
          else x.pairing.acceptCommand(context, 'task.list', 1);
          admitted = true;
        }, /DEVICE_TRUST_INVALID|DEVICE_CREDENTIAL_INVALID/);
      });
      assert.equal(attempts.length, 1); assert.equal(admitted, false); assert.equal(returnedCredential, undefined);
      const persisted = x.store.getDevice(context.credential.deviceId)!;
      assert.equal(expiry === 'owner' ? persisted.ownerBinding.expiresAt : persisted.trust.expiresAt, originalDeadline);
      if (boundary === 'acceptCommand') assert.equal(x.store.getCredential(context.credential.credentialId)!.lastCommandSequence, 1);
      if (boundary === 'rotate') {
        assert.ok(x.store.getCredential(context.credential.credentialId)!.revokedAt);
        const next = x.store.getCredential(persisted.trust.reconnectCredentialId!)!;
        assert.ok(Date.parse(next.expiresAt) <= Date.parse(originalDeadline));
      }
      checks += 5; authorityRegressionGroups.push(boundary + ' denies ' + expiry + ' expiry during actual rename');
    } finally { Date.now = realNow; }
  }
}
{
  const x = fixture('revoke-real-rename-permanent'), before = fs.readFileSync(x.store.filePath);
  const failure = renameError('OWNED_REVOKE_RENAME_EPERM'), originalAudit = (x.pairing as any).audit;
  let successAuditCalls = 0, returned = false;
  // Pass-through observation only: any unexpected audit still invokes the actual audit writer.
  (x.pairing as any).audit = function(...args: unknown[]) { if (args[0] === 'mobile.device.revoked') successAuditCalls++; return originalAudit.apply(this, args); };
  let attempts: string[];
  try {
    attempts = scopedRegistryRename(x.store, () => { throw failure; }, () => {
      assert.throws(() => { x.pairing.revokeDevice(x.consumed.credential.deviceId); returned = true; }, error => error === failure);
    });
  } finally { (x.pairing as any).audit = originalAudit; }
  assert.equal(attempts!.length, expectedRenameAttempts); assert.equal(returned, false); assert.equal(successAuditCalls, 0);
  assert.deepEqual(fs.readFileSync(x.store.filePath), before); assert.equal(x.crypto.hasSession(x.consumed.credential.sessionId), false);
  assert.throws(() => x.pairing.authenticate(x.consumed.credential.token), /DEVICE_REPAIR_REQUIRED|DEVICE_TRUST_INVALID/);
  assert.equal(x.store.getDevice(x.consumed.credential.deviceId)!.trust.status, 'trusted');
  // Failed durable revoke remains fenced across same-process issuers until protected fresh pairing.
  const fresh = cold(x), pending = initiate(fresh);
  assert.throws(() => fresh.pairing.beginReconnect(pending.request), /DEVICE_TRUST_INVALID/);
  assert.throws(() => fresh.pairing.authenticate(x.consumed.credential.token), /DEVICE_TRUST_INVALID/);
  assert.equal((fresh.crypto as any).sessions.size, 0);
  checks += 10; authorityRegressionGroups.push('failed durable revoke shared-process fence denies cold issuer until protected fresh pairing');
}
console.log(JSON.stringify({suite:'reconnect-authority-atomic-regressions',groups:authorityRegressionGroups,groupCount:authorityRegressionGroups.length,platform:process.platform,actualRegistryAndIssuer:true,clockCrossing:'controlled70ms during actual owned rename',durableRevocationOnFailure:false,physicalDeviceAcceptance:false}));
const report = { pass: true, checks, realP256ECDHHKDFAEAD: true, mountedHTTP: true, mountedWebSocketIdleEvent: true, freshColdIssuer: true, oneUseRace: true, lostAckFreshRecovery: true, originalApprovalExpiryPreserved: true, commitFaults: ['before', 'after', 'activation'], lateAuthorityInvalidations: true, debugLoopbackOnly: true, productionPinnedTLS: 'NOT_RUN', physicalDeviceAcceptance: false };
const out = process.env.W6_HTTP_REPORT_DIR;
if (out) fs.writeFileSync(path.join(out, 'reconnect-runtime.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

