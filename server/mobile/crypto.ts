import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, verify,
  type KeyObject,
} from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT, EDITH_MOBILE_PROTOCOL_VERSION, TASK_CONTRACT_VERSION,
  parseMobileApplicationEnvelopeV2,
  type MobileCryptoSuiteV2, type MobilePublicKeyV2,
} from '../../src/edith/contracts';
import type { MobileEncryptedEnvelope } from './types';

type EnvelopeDirection = MobileEncryptedEnvelope['direction'];
type EnvelopeChannel = MobileEncryptedEnvelope['channel'];
const MAX_PENDING_PAIRINGS = 1_000;

interface PendingKeyAgreement {
  pairingId: string;
  privateKey: KeyObject;
  challenge: Buffer;
  serverId: string;
  deviceId: string;
  workspaceId: string;
  cryptoSuite: MobileCryptoSuiteV2;
  challengeId: string;
  expiresAt: string;
  signingKeyFingerprint: string;
  agreementKeyFingerprint: string;
  serverAgreementKeyFingerprint: string;
  requestedCommandsFingerprint: string;
}

interface SessionCryptoState {
  clientToServerKey: Buffer;
  serverToClientKey: Buffer;
  serverId: string;
  deviceId: string;
  workspaceId: string;
  cryptoSuite: MobileCryptoSuiteV2;
  sendSequences: Record<EnvelopeDirection, Record<EnvelopeChannel, number>>;
  receiveSequences: Record<EnvelopeDirection, Record<EnvelopeChannel, number>>;
  receivedNonces: Set<string>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function base64url(value: Buffer): string { return value.toString('base64url'); }
function sequences(): Record<EnvelopeChannel, number> { return { http: 0, realtime: 0, transfer: 0 }; }
function directionalSequences(): Record<EnvelopeDirection, Record<EnvelopeChannel, number>> { return { client_to_server: sequences(), server_to_client: sequences() }; }

export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function publicKeyFingerprint(jwk: JsonWebKey): string { return sha256(canonical(jwk)); }
export function safeEqualHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function keyObject(descriptor: MobilePublicKeyV2): KeyObject {
  if (descriptor.encoding === 'jwk') return createPublicKey({ key: descriptor.value as any, format: 'jwk' });
  return createPublicKey({ key: Buffer.from(String(descriptor.value), 'base64'), format: 'der', type: 'spki' });
}

export function mobilePublicKeyFingerprint(descriptor: MobilePublicKeyV2): string {
  return descriptor.encoding === 'jwk'
    ? publicKeyFingerprint(descriptor.value as JsonWebKey)
    : sha256(Buffer.from(String(descriptor.value), 'base64'));
}

export function isMobilePublicKeyCompatible(descriptor: MobilePublicKeyV2): boolean {
  try {
    const key = keyObject(descriptor);
    if (descriptor.algorithm === 'ECDSA-P256-SHA256' || descriptor.algorithm === 'ECDH-P256') return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    return key.asymmetricKeyType === descriptor.algorithm.toLowerCase();
  } catch { return false; }
}

function descriptor(publicKey: KeyObject, algorithm: MobilePublicKeyV2['algorithm']): MobilePublicKeyV2 {
  const value = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  return { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, algorithm, encoding: 'jwk', value: value as Record<string, unknown>, fingerprint: publicKeyFingerprint(value) };
}

export function deriveMobileKey(privateKey: KeyObject, peerPublicKey: MobilePublicKeyV2 | JsonWebKey, salt: Buffer, info: string): Buffer {
  const peer = 'algorithm' in peerPublicKey ? keyObject(peerPublicKey) : createPublicKey({ key: peerPublicKey as any, format: 'jwk' });
  return Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey, publicKey: peer }), salt, Buffer.from(info, 'utf8'), 32));
}

export class MobileCryptoService {
  private readonly pending = new Map<string, PendingKeyAgreement>();
  private readonly sessions = new Map<string, SessionCryptoState>();

  beginPairing(pairingId: string, serverId: string, deviceId: string, workspaceId: string, cryptoSuite: MobileCryptoSuiteV2, binding: { challengeId: string; expiresAt: string; signingKeyFingerprint: string; agreementKeyFingerprint: string; requestedCommandsFingerprint: string }): { challenge: string; challengeFingerprint: string; serverAgreementPublicKeyJwk: JsonWebKey; serverAgreementKey: MobilePublicKeyV2; proofPayload: string } {
    this.sweepExpiredPairings();
    if (this.pending.size >= MAX_PENDING_PAIRINGS) throw new Error('PAIRING_CAPACITY_REACHED');
    const pair = cryptoSuite === 'P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : generateKeyPairSync('x25519');
    const challenge = randomBytes(32);
    const challengeText = base64url(challenge);
    const serverAgreementKey = descriptor(pair.publicKey, cryptoSuite.startsWith('P256_') ? 'ECDH-P256' : 'X25519');
    const pending: PendingKeyAgreement = { pairingId, privateKey: pair.privateKey, challenge, serverId, deviceId, workspaceId, cryptoSuite, ...binding, serverAgreementKeyFingerprint: serverAgreementKey.fingerprint };
    this.pending.set(pairingId, pending);
    return {
      challenge: challengeText,
      challengeFingerprint: sha256(challenge),
      serverAgreementPublicKeyJwk: serverAgreementKey.value as JsonWebKey,
      serverAgreementKey,
      proofPayload: this.proofPayload(pending, challengeText),
    };
  }

  private proofPayload(pending: PendingKeyAgreement, challenge: string): string {
    return [
      'edith.mobile.pair.v1',
      pending.serverId,
      pending.workspaceId,
      pending.pairingId,
      pending.challengeId,
      pending.deviceId,
      pending.cryptoSuite,
      pending.signingKeyFingerprint,
      pending.agreementKeyFingerprint,
      pending.serverAgreementKeyFingerprint,
      pending.requestedCommandsFingerprint,
      pending.expiresAt,
      challenge,
    ].join('\n');
  }

  proofPayloadForPairing(pairingId: string): string | undefined {
    const pending = this.pending.get(pairingId);
    return pending ? this.proofPayload(pending, base64url(pending.challenge)) : undefined;
  }

  verifyProof(signingKey: MobilePublicKeyV2, payload: string, assertionBase64url: string): boolean {
    try {
      return verify(signingKey.algorithm === 'ECDSA-P256-SHA256' ? 'sha256' : null, Buffer.from(payload, 'utf8'), keyObject(signingKey), Buffer.from(assertionBase64url, 'base64url'));
    } catch { return false; }
  }

  establishSession(pairingId: string, sessionId: string, agreementKey: MobilePublicKeyV2): { keyFingerprint: string; cryptoSuite: MobileCryptoSuiteV2 } {
    const pending = this.pending.get(pairingId);
    if (!pending) throw new Error('PAIRING_CRYPTO_STATE_EXPIRED');
    const root = deriveMobileKey(pending.privateKey, agreementKey, pending.challenge, `edith.mobile.session.v1|${sha256(this.proofPayloadForPairing(pairingId)!)}`);
    const clientToServerKey = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('edith.mobile.c2s.v1'), 32));
    const serverToClientKey = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('edith.mobile.s2c.v1'), 32));
    this.sessions.set(sessionId, { clientToServerKey, serverToClientKey, serverId: pending.serverId, deviceId: pending.deviceId, workspaceId: pending.workspaceId, cryptoSuite: pending.cryptoSuite, sendSequences: directionalSequences(), receiveSequences: directionalSequences(), receivedNonces: new Set() });
    this.pending.delete(pairingId);
    root.fill(0);
    return { keyFingerprint: sha256(Buffer.concat([clientToServerKey, serverToClientKey])), cryptoSuite: pending.cryptoSuite };
  }

  hasSession(sessionId: string): boolean { return this.sessions.has(sessionId); }
  discardPairing(pairingId: string): void { this.pending.delete(pairingId); }
  sessionKeyFingerprint(sessionId: string): string | undefined {
    const state = this.sessions.get(sessionId);
    return state ? sha256(Buffer.concat([state.clientToServerKey, state.serverToClientKey])) : undefined;
  }
  sessionSuite(sessionId: string): MobileCryptoSuiteV2 | undefined { return this.sessions.get(sessionId)?.cryptoSuite; }
  revokeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    state?.clientToServerKey.fill(0);
    state?.serverToClientKey.fill(0);
    this.sessions.delete(sessionId);
  }

  private sweepExpiredPairings(): void {
    const now = Date.now();
    for (const [pairingId, pending] of this.pending) if (Date.parse(pending.expiresAt) <= now) this.pending.delete(pairingId);
  }

  encrypt(sessionId: string, purpose: string, value: unknown, direction: EnvelopeDirection = 'server_to_client', channel: EnvelopeChannel = 'http'): MobileEncryptedEnvelope {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED');
    const sequence = ++session.sendSequences[direction][channel];
    const nonce = randomBytes(12);
    const header = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION, aadVersion: 'edith-mobile-aad-v1' as const, encryption: 'AES-256-GCM' as const, cryptoSuite: session.cryptoSuite, sessionId, serverId: session.serverId, deviceId: session.deviceId, workspaceId: session.workspaceId, sequence, direction, channel, purpose };
    const key = direction === 'client_to_server' ? session.clientToServerKey : session.serverToClientKey;
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(canonical(header), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
    const envelope = { ...header, nonceBase64url: base64url(nonce), ciphertextBase64url: base64url(ciphertext), authTagBase64url: base64url(cipher.getAuthTag()) };
    const parsed = parseMobileApplicationEnvelopeV2(envelope);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    return parsed.value;
  }

  decrypt<T>(sessionId: string, envelope: MobileEncryptedEnvelope, expectedPurpose: string, expectedDirection: EnvelopeDirection = 'client_to_server', expectedChannel: EnvelopeChannel = 'http'): T {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED');
    const parsed = parseMobileApplicationEnvelopeV2(envelope);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    if (envelope.sessionId !== sessionId || envelope.serverId !== session.serverId || envelope.deviceId !== session.deviceId || envelope.workspaceId !== session.workspaceId || envelope.cryptoSuite !== session.cryptoSuite || envelope.direction !== expectedDirection || envelope.channel !== expectedChannel || envelope.purpose !== expectedPurpose) throw new Error('ENVELOPE_BINDING_INVALID');
    const previousSequence = session.receiveSequences[expectedDirection][expectedChannel];
    if (envelope.sequence <= previousSequence) throw new Error('ENVELOPE_SEQUENCE_REPLAYED');
    if (envelope.sequence !== previousSequence + 1) throw new Error('ENVELOPE_SEQUENCE_GAP');
    if (session.receivedNonces.has(`${expectedDirection}:${envelope.nonceBase64url}`)) throw new Error('ENVELOPE_NONCE_REPLAYED');
    const nonce = Buffer.from(envelope.nonceBase64url, 'base64url');
    if (nonce.length !== 12) throw new Error('ENVELOPE_NONCE_INVALID');
    const header = { contractVersion: envelope.contractVersion, amendment: envelope.amendment, protocolVersion: envelope.protocolVersion, aadVersion: envelope.aadVersion, encryption: envelope.encryption, cryptoSuite: envelope.cryptoSuite, sessionId: envelope.sessionId, serverId: envelope.serverId, deviceId: envelope.deviceId, workspaceId: envelope.workspaceId, sequence: envelope.sequence, direction: envelope.direction, channel: envelope.channel, purpose: envelope.purpose };
    const key = expectedDirection === 'client_to_server' ? session.clientToServerKey : session.serverToClientKey;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(canonical(header), 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.authTagBase64url, 'base64url'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertextBase64url, 'base64url')), decipher.final()]);
      const value = JSON.parse(plaintext.toString('utf8')) as T;
      session.receiveSequences[expectedDirection][expectedChannel] = envelope.sequence;
      session.receivedNonces.add(`${expectedDirection}:${envelope.nonceBase64url}`);
      if (session.receivedNonces.size > 2_000) session.receivedNonces.delete(session.receivedNonces.values().next().value!);
      return value;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('ENVELOPE_PAYLOAD_INVALID');
      throw new Error('ENVELOPE_AUTHENTICATION_FAILED');
    }
  }
}

export function importX25519PrivateJwk(jwk: JsonWebKey): KeyObject { return createPrivateKey({ key: jwk as any, format: 'jwk' }); }
