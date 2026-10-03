import { randomBytes, randomInt, randomUUID, scryptSync } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  EDITH_MOBILE_PROTOCOL_VERSION,
  MOBILE_CRYPTO_SUITES,
  TASK_CONTRACT_VERSION,
  parseDeviceCapabilitiesV2,
  parseDeviceTrustV2,
  parseOwnerSessionBindingV2,
  parsePairingChallengeV2,
  parseMobileDeviceSessionV2,
  parseMobileCredentialMetadataV2,
  parseMobilePairingRequestV2,
  parseMobilePairingOfferV2,
  parseMobileServerIdentityV2,
  type MobileCryptoSuiteV2,
  type MobileDeviceSessionV2,
  type MobileCredentialMetadataV2,
  type MobilePairingRequestV2,
  type MobilePublicKeyV2,
  type MobileServerIdentityV2,
  type PairingSessionV2,
} from '../../src/edith/contracts';
import { appendAuditEvent, createAuditEvent } from '../../src/edith/audit';
import { workspaceManager } from '../../src/edith/workspaceManager';
import { MobileCryptoService, isMobilePublicKeyCompatible, mobilePublicKeyFingerprint, publicKeyFingerprint, safeEqualHash, sha256 } from './crypto';
import { MobileRegistryStore } from './registryStore';
import type { MobileAccessCredential, MobileCommand, MobileDeviceRecord, MobilePairingPublicResult, MobilePairingRecord, MobilePairingRequest, MobileSessionContext } from './types';
import { safeDeviceCapabilities } from './types';

const ALL_COMMANDS: MobileCommand[] = [
  'task.list', 'task.detail', 'task.activity', 'task.create_low_risk', 'task.pause', 'task.resume', 'task.cancel', 'emergency_stop',
  'file.upload', 'clipboard.publish', 'clipboard.consume', 'offline_queue.manage', 'handoff.manage', 'result_card.read', 'audio_handoff.manage',
];
const DEFAULT_COMMANDS: MobileCommand[] = ['task.list', 'task.detail', 'task.activity', 'task.create_low_risk', 'task.pause', 'task.resume', 'task.cancel', 'emergency_stop', 'file.upload'];
const PAIRING_TTL_MS = 5 * 60_000;
const CREDENTIAL_TTL_MS = 15 * 60_000;
const SERVER_SUITES: MobileCryptoSuiteV2[] = [...MOBILE_CRYPTO_SUITES];

function codeHash(code: string, pairingId: string): string {
  return scryptSync(code, pairingId, 32).toString('hex');
}

function safeCommands(value: unknown, fallback: MobileCommand[] = DEFAULT_COMMANDS): MobileCommand[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((item): item is MobileCommand => typeof item === 'string' && ALL_COMMANDS.includes(item as MobileCommand)))];
}

interface NormalizedPairingRequest {
  device: MobilePairingRequestV2['device'];
  signingKey: MobilePublicKeyV2;
  agreementKey: MobilePublicKeyV2;
  cryptoSuite: MobileCryptoSuiteV2;
  requestedCommands: MobileCommand[];
}

function legacyKey(value: JsonWebKey, algorithm: MobilePublicKeyV2['algorithm']): MobilePublicKeyV2 {
  return { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, algorithm, encoding: 'jwk', value: value as Record<string, unknown>, fingerprint: publicKeyFingerprint(value) };
}

function suiteMatches(suite: MobileCryptoSuiteV2, signing: MobilePublicKeyV2, agreement: MobilePublicKeyV2): boolean {
  return suite.startsWith('P256_')
    ? signing.algorithm === 'ECDSA-P256-SHA256' && agreement.algorithm === 'ECDH-P256'
    : signing.algorithm === 'Ed25519' && agreement.algorithm === 'X25519';
}

export class MobilePairingService {
  constructor(readonly store: MobileRegistryStore, readonly crypto: MobileCryptoService) {}

  request(input: MobilePairingRequest): MobilePairingPublicResult {
    const normalized = this.normalizeRequest(input);
    const capabilities = safeDeviceCapabilities(normalized.device.capabilities as any);
    const parsedCapabilities = parseDeviceCapabilitiesV2(capabilities);
    if (parsedCapabilities.success === false) throw new Error(parsedCapabilities.errorCode);
    if (!isMobilePublicKeyCompatible(normalized.signingKey) || !isMobilePublicKeyCompatible(normalized.agreementKey)) throw new Error('PAIRING_PUBLIC_KEY_INVALID');
    const fingerprint = mobilePublicKeyFingerprint(normalized.signingKey);
    if (fingerprint !== normalized.signingKey.fingerprint || mobilePublicKeyFingerprint(normalized.agreementKey) !== normalized.agreementKey.fingerprint) throw new Error('PAIRING_PUBLIC_KEY_FINGERPRINT_MISMATCH');
    const existing = this.store.getDevice(normalized.device.deviceId);
    if (existing && existing.trust.status === 'trusted' && existing.trust.fingerprint !== fingerprint) throw new Error('DEVICE_ID_ALREADY_TRUSTED');
    const workspaceId = workspaceManager.getCloudMetadata()?.workspaceId ?? 'workspace-unconfigured';
    const pairingId = `pair-${randomUUID()}`;
    const challengeId = `challenge-${randomUUID()}`;
    const code = String(randomInt(100000, 1000000));
    const now = Date.now();
    const requestedCommandsFingerprint = sha256([...normalized.requestedCommands].sort().join('\n'));
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + PAIRING_TTL_MS).toISOString();
    const cryptoState = this.crypto.beginPairing(pairingId, this.store.serverId(), normalized.device.deviceId, workspaceId, normalized.cryptoSuite, {
      challengeId,
      expiresAt,
      signingKeyFingerprint: normalized.signingKey.fingerprint,
      agreementKeyFingerprint: normalized.agreementKey.fingerprint,
      requestedCommandsFingerprint,
    });
    const challenge = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
      cryptoSuite: normalized.cryptoSuite,
      requestedCommandsFingerprint,
      challengeId,
      pairingId,
      deviceId: normalized.device.deviceId,
      workspaceId,
      algorithm: normalized.cryptoSuite.startsWith('P256_') ? 'ECDSA-P256-SHA256' as const : 'Ed25519' as const,
      challengeFingerprint: cryptoState.challengeFingerprint,
      issuedAt,
      expiresAt,
      oneTime: true as const,
      status: 'issued' as const,
      attempt: 0,
      maxAttempts: 3,
    };
    const parsedChallenge = parsePairingChallengeV2(challenge);
    if (parsedChallenge.success === false) throw new Error(parsedChallenge.errorCode);
    const device = { ...normalized.device, capabilities: parsedCapabilities.value, publicKey: undefined, fingerprint };
    const record: MobilePairingRecord = {
      pairingId,
      device,
      cryptoSuite: normalized.cryptoSuite,
      signingKey: normalized.signingKey,
      agreementKey: normalized.agreementKey,
      challenge: parsedChallenge.value,
      codeHash: codeHash(code, pairingId),
      requestedCommands: normalized.requestedCommands,
      approvedCommands: [],
      createdAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    };
    this.store.savePairing(record);
    this.audit('mobile.pairing.requested', normalized.device.deviceId, 'allowed', 'Pairing request created.');
    const pairing = this.publicPairing(record);
    const negotiation = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION, offeredSuites: [normalized.cryptoSuite], selectedSuite: normalized.cryptoSuite, status: 'selected' as const };
    const server = this.serverIdentity(workspaceId);
    const offer = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
      pairing,
      server,
      negotiation,
      challengeBase64url: cryptoState.challenge,
      serverAgreementKey: cryptoState.serverAgreementKey,
      signingKeyFingerprint: normalized.signingKey.fingerprint,
      agreementKeyFingerprint: normalized.agreementKey.fingerprint,
      requestedCommandsFingerprint,
      transcriptBase64url: Buffer.from(cryptoState.proofPayload, 'utf8').toString('base64url'),
      transcriptFingerprint: sha256(cryptoState.proofPayload),
      ownerVerificationCode: code,
      expiresAt: record.expiresAt,
    };
    const parsedOffer = parseMobilePairingOfferV2(offer);
    if (parsedOffer.success === false) throw new Error(parsedOffer.errorCode);
    return {
      pairing,
      code,
      challenge: cryptoState.challenge,
      serverAgreementPublicKeyJwk: cryptoState.serverAgreementPublicKeyJwk,
      serverAgreementKey: cryptoState.serverAgreementKey,
      proofPayload: cryptoState.proofPayload,
      negotiation,
      server,
      offer: parsedOffer.value,
    };
  }

  submitProof(pairingId: string, signature: string): PairingSessionV2 {
    const record = this.requirePairing(pairingId);
    this.assertPairingLive(record);
    if (['verified', 'consumed'].includes(String(record.challenge.status))) throw new Error('PAIRING_PROOF_ALREADY_USED');
    const payload = this.crypto.proofPayloadForPairing(pairingId);
    if (!payload) throw new Error('PAIRING_CRYPTO_STATE_EXPIRED');
    const attempt = (record.challenge.attempt ?? 0) + 1;
    if (attempt > (record.challenge.maxAttempts ?? 3)) throw new Error('PAIRING_ATTEMPTS_EXHAUSTED');
    if (!this.crypto.verifyProof(this.signingKey(record), payload, signature)) {
      record.challenge = { ...record.challenge, attempt, status: 'proof_submitted' };
      this.store.savePairing(record);
      throw new Error('PAIRING_PROOF_INVALID');
    }
    const now = new Date().toISOString();
    record.challenge = { ...record.challenge, attempt, status: 'verified', proofFingerprint: sha256(signature), verifiedAt: now };
    this.store.savePairing(record);
    this.audit('mobile.pairing.proof_verified', record.device.deviceId, 'allowed', 'Pairing proof of possession verified.');
    return this.publicPairing(record);
  }

  approve(pairingId: string, code: string, approvedCommands: MobileCommand[] | undefined, ownerSession: { bindingId: string; expiresAt: string }): PairingSessionV2 {
    const record = this.requirePairing(pairingId);
    this.assertPairingLive(record);
    if (!safeEqualHash(record.codeHash, codeHash(code, pairingId))) throw new Error('PAIRING_CODE_INVALID');
    const requested = new Set(record.requestedCommands);
    const approved = safeCommands(approvedCommands, record.requestedCommands).filter((command) => requested.has(command));
    record.ownerApprovedAt = new Date().toISOString();
    if (!ownerSession.bindingId || Date.parse(ownerSession.expiresAt) <= Date.now()) throw new Error('OWNER_SESSION_BINDING_INVALID');
    record.ownerSessionBindingId = ownerSession.bindingId;
    record.ownerSessionExpiresAt = ownerSession.expiresAt;
    record.approvedCommands = approved;
    this.store.savePairing(record);
    this.audit('mobile.pairing.approved', record.device.deviceId, 'allowed', 'Owner approved pairing request.');
    return this.publicPairing(record);
  }

  reject(pairingId: string): PairingSessionV2 {
    const record = this.requirePairing(pairingId);
    if (record.challenge.status === 'consumed') throw new Error('PAIRING_ALREADY_CONSUMED');
    record.ownerRejectedAt = new Date().toISOString();
    record.challenge = { ...record.challenge, status: 'rejected' };
    this.store.savePairing(record);
    this.crypto.discardPairing(pairingId);
    this.audit('mobile.pairing.rejected', record.device.deviceId, 'denied', 'Owner rejected pairing request.');
    return this.publicPairing(record);
  }

  consume(pairingId: string, signature: string): { pairing: PairingSessionV2; credential: MobileAccessCredential; keyFingerprint: string; session: MobileDeviceSessionV2 } {
    const record = this.requirePairing(pairingId);
    this.assertPairingLive(record);
    if (!record.ownerApprovedAt) throw new Error('PAIRING_OWNER_APPROVAL_REQUIRED');
    if (record.challenge.status !== 'verified') throw new Error(record.challenge.status === 'consumed' ? 'PAIRING_ALREADY_CONSUMED' : 'PAIRING_PROOF_REQUIRED');
    const proofPayload = this.crypto.proofPayloadForPairing(pairingId);
    if (!proofPayload) throw new Error('PAIRING_CRYPTO_STATE_EXPIRED');
    const payload = `${proofPayload}\nconsume`;
    if (!this.crypto.verifyProof(this.signingKey(record), payload, signature)) throw new Error('PAIRING_CONSUME_PROOF_INVALID');
    const now = new Date().toISOString();
    const sessionId = `mobile-session-${randomUUID()}`;
    const cryptoResult = this.crypto.establishSession(pairingId, sessionId, this.agreementKey(record));
    const credential = this.issueCredential(record.device.deviceId, sessionId, record.challenge.workspaceId!);
    const trust = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      deviceId: record.device.deviceId,
      workspaceId: record.challenge.workspaceId,
      fingerprint: record.device.fingerprint!,
      status: 'trusted' as const,
      trustedAt: now,
      expiresAt: record.ownerSessionExpiresAt!,
      reconnectCredentialId: credential.credentialId,
      reconnectCredentialFingerprint: sha256(credential.token),
    };
    const parsedTrust = parseDeviceTrustV2(trust);
    if (parsedTrust.success === false) throw new Error(parsedTrust.errorCode);
    const binding = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      bindingId: `binding-${randomUUID()}`,
      ownerSessionId: record.ownerSessionBindingId!,
      deviceId: record.device.deviceId,
      workspaceId: record.challenge.workspaceId!,
      deviceFingerprint: record.device.fingerprint!,
      createdAt: now,
      expiresAt: record.ownerSessionExpiresAt!,
      status: 'active' as const,
    };
    const parsedBinding = parseOwnerSessionBindingV2(binding);
    if (parsedBinding.success === false) throw new Error(parsedBinding.errorCode);
    const deviceRecord: MobileDeviceRecord = {
      device: record.device,
      trust: parsedTrust.value,
      ownerBinding: parsedBinding.value,
      cryptoSuite: cryptoResult.cryptoSuite,
      signingKey: this.signingKey(record),
      agreementKey: this.agreementKey(record),
      allowedCommands: record.approvedCommands,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.store.saveDevice(deviceRecord);
    record.challenge = { ...record.challenge, status: 'consumed', consumedAt: now };
    this.store.savePairing(record);
    this.audit('mobile.pairing.consumed', record.device.deviceId, 'allowed', 'One-time pairing challenge consumed.');
    const session: MobileDeviceSessionV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
      sessionId,
      serverId: this.store.serverId(),
      deviceId: record.device.deviceId,
      workspaceId: record.challenge.workspaceId!,
      cryptoSuite: cryptoResult.cryptoSuite,
      keyFingerprint: cryptoResult.keyFingerprint,
      status: 'active',
      establishedAt: now,
      expiresAt: credential.expiresAt,
    };
    const parsedSession = parseMobileDeviceSessionV2(session);
    if (parsedSession.success === false) throw new Error(parsedSession.errorCode);
    return { pairing: this.publicPairing(record, deviceRecord), credential, keyFingerprint: cryptoResult.keyFingerprint, session: parsedSession.value };
  }

  authenticate(token: string): MobileSessionContext {
    const [credentialId, secret] = token.split('.', 2);
    if (!credentialId || !secret) throw new Error('DEVICE_AUTH_REQUIRED');
    const credential = this.store.getCredential(credentialId);
    if (!credential || credential.revokedAt || Date.parse(credential.expiresAt) <= Date.now() || !safeEqualHash(credential.credentialHash, sha256(secret))) throw new Error('DEVICE_CREDENTIAL_INVALID');
    const device = this.store.getDevice(credential.deviceId);
    if (!device || device.trust.status !== 'trusted' || (device.trust.expiresAt && Date.parse(device.trust.expiresAt) <= Date.now()) || device.ownerBinding.status !== 'active' || Date.parse(device.ownerBinding.expiresAt) <= Date.now()) throw new Error('DEVICE_TRUST_INVALID');
    if (!this.crypto.hasSession(credential.sessionId)) throw new Error('DEVICE_REPAIR_REQUIRED');
    device.lastSeenAt = new Date().toISOString();
    device.updatedAt = device.lastSeenAt;
    this.store.saveDevice(device);
    return { credential, device };
  }

  revalidateContext(context: MobileSessionContext): MobileSessionContext {
    const credential = this.store.getCredential(context.credential.credentialId);
    const device = this.store.getDevice(context.device.device.deviceId);
    if (!credential || credential.deviceId !== context.credential.deviceId || credential.sessionId !== context.credential.sessionId || credential.revokedAt || Date.parse(credential.expiresAt) <= Date.now()) throw new Error('DEVICE_CREDENTIAL_INVALID');
    if (!device || device.trust.status !== 'trusted' || device.ownerBinding.status !== 'active' || Date.parse(device.ownerBinding.expiresAt) <= Date.now() || !this.crypto.hasSession(credential.sessionId)) throw new Error('DEVICE_TRUST_INVALID');
    return { credential, device };
  }

  rotate(context: MobileSessionContext): MobileAccessCredential {
    const current = this.store.getCredential(context.credential.credentialId)!;
    current.revokedAt = new Date().toISOString();
    this.store.saveCredential(current);
    return this.issueCredential(current.deviceId, current.sessionId, current.workspaceId, current.credentialId);
  }

  revokeDevice(deviceId: string): MobileDeviceRecord {
    const device = this.store.getDevice(deviceId);
    if (!device) throw new Error('DEVICE_NOT_FOUND');
    const now = new Date().toISOString();
    device.trust = { ...device.trust, status: 'revoked', revokedAt: now };
    device.ownerBinding = { ...device.ownerBinding, status: 'revoked', revokedAt: now };
    device.updatedAt = now;
    this.store.saveDevice(device);
    for (const credential of this.store.listCredentials().filter((item) => item.deviceId === deviceId && !item.revokedAt)) {
      credential.revokedAt = now;
      this.crypto.revokeSession(credential.sessionId);
      this.store.saveCredential(credential);
    }
    this.audit('mobile.device.revoked', deviceId, 'denied', 'Owner revoked trusted mobile device.');
    return device;
  }

  revokeOwnerBinding(bindingId: string): string[] {
    const revoked: string[] = [];
    for (const device of this.store.listDevices()) {
      if (device.ownerBinding.ownerSessionId !== bindingId || device.ownerBinding.status !== 'active') continue;
      this.revokeDevice(device.device.deviceId);
      revoked.push(device.device.deviceId);
    }
    return revoked;
  }

  acceptCommand(context: MobileSessionContext, command: MobileCommand, sequence: number): void {
    if (!context.device.allowedCommands.includes(command)) throw new Error('DEVICE_COMMAND_NOT_ALLOWED');
    if (!Number.isSafeInteger(sequence) || sequence <= context.credential.lastCommandSequence) throw new Error('DEVICE_SEQUENCE_REPLAYED');
    if (sequence !== context.credential.lastCommandSequence + 1) throw new Error('DEVICE_SEQUENCE_GAP');
    context.credential.lastCommandSequence = sequence;
    this.store.saveCredential(context.credential);
  }

  sessionStatus(context: MobileSessionContext): MobileDeviceSessionV2 {
    const session: MobileDeviceSessionV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
      sessionId: context.credential.sessionId,
      serverId: this.store.serverId(),
      deviceId: context.credential.deviceId,
      workspaceId: context.credential.workspaceId,
      cryptoSuite: this.crypto.sessionSuite(context.credential.sessionId) ?? context.device.cryptoSuite ?? 'ED25519_X25519_HKDF_SHA256_AES256_GCM',
      keyFingerprint: this.crypto.sessionKeyFingerprint(context.credential.sessionId) ?? context.device.trust.fingerprint,
      status: this.crypto.hasSession(context.credential.sessionId) ? 'active' : 'repair_required',
      establishedAt: context.credential.issuedAt,
      expiresAt: context.credential.expiresAt,
      errorCode: this.crypto.hasSession(context.credential.sessionId) ? undefined : 'DEVICE_REPAIR_REQUIRED',
    };
    const parsed = parseMobileDeviceSessionV2(session);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    return parsed.value;
  }

  credentialMetadata(credential: MobileSessionContext['credential']): MobileCredentialMetadataV2 {
    const metadata: MobileCredentialMetadataV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      credentialId: credential.credentialId,
      credentialFingerprint: credential.credentialFingerprint,
      deviceId: credential.deviceId,
      sessionId: credential.sessionId,
      workspaceId: credential.workspaceId,
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
      rotatedFromId: credential.rotatedFromId,
      revokedAt: credential.revokedAt,
    };
    const parsed = parseMobileCredentialMetadataV2(metadata);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    return parsed.value;
  }

  serverStatus(workspaceId: string): MobileServerIdentityV2 { return this.serverIdentity(workspaceId); }

  private issueCredential(deviceId: string, sessionId: string, workspaceId: string, rotatedFromId?: string): MobileAccessCredential {
    const credentialId = `mobile-cred-${randomUUID()}`;
    const secret = randomBytes(32).toString('base64url');
    const now = Date.now();
    const record = {
      credentialId,
      credentialHash: sha256(secret),
      credentialFingerprint: sha256(`${credentialId}.${secret}`),
      deviceId,
      sessionId,
      workspaceId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CREDENTIAL_TTL_MS).toISOString(),
      rotatedFromId,
      lastCommandSequence: 0,
    };
    this.store.saveCredential(record);
    return { credentialId, secret, token: `${credentialId}.${secret}`, sessionId, deviceId, workspaceId, expiresAt: record.expiresAt };
  }

  private requirePairing(pairingId: string): MobilePairingRecord {
    const record = this.store.getPairing(pairingId);
    if (!record) throw new Error('PAIRING_NOT_FOUND');
    return record;
  }

  private assertPairingLive(record: MobilePairingRecord): void {
    if (Date.parse(record.expiresAt) <= Date.now()) {
      record.challenge = { ...record.challenge, status: 'expired' };
      this.store.savePairing(record);
      this.crypto.discardPairing(record.pairingId);
      throw new Error('PAIRING_EXPIRED');
    }
    if (['rejected', 'revoked', 'expired'].includes(String(record.challenge.status))) throw new Error('PAIRING_NOT_ACTIVE');
  }

  private normalizeRequest(input: MobilePairingRequest): NormalizedPairingRequest {
    if ('contractVersion' in input) {
      const parsed = parseMobilePairingRequestV2(input);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const selected = SERVER_SUITES.find((suite) => parsed.value.supportedSuites.includes(suite) && suiteMatches(suite, parsed.value.signingKey, parsed.value.agreementKey));
      if (!selected) throw new Error('MOBILE_CRYPTO_SUITE_UNSUPPORTED');
      return { device: parsed.value.device, signingKey: parsed.value.signingKey, agreementKey: parsed.value.agreementKey, cryptoSuite: selected, requestedCommands: safeCommands(parsed.value.requestedCommands) };
    }
    if (input.signingPublicKeyJwk.kty !== 'OKP' || input.signingPublicKeyJwk.crv !== 'Ed25519' || input.agreementPublicKeyJwk.kty !== 'OKP' || input.agreementPublicKeyJwk.crv !== 'X25519') throw new Error('PAIRING_PUBLIC_KEY_INVALID');
    return {
      device: input.device as MobilePairingRequestV2['device'],
      signingKey: legacyKey(input.signingPublicKeyJwk, 'Ed25519'),
      agreementKey: legacyKey(input.agreementPublicKeyJwk, 'X25519'),
      cryptoSuite: 'ED25519_X25519_HKDF_SHA256_AES256_GCM',
      requestedCommands: safeCommands(input.requestedCommands),
    };
  }

  private signingKey(record: MobilePairingRecord): MobilePublicKeyV2 {
    if (record.signingKey) return record.signingKey;
    if (record.signingPublicKeyJwk) return legacyKey(record.signingPublicKeyJwk, 'Ed25519');
    throw new Error('PAIRING_SIGNING_KEY_MISSING');
  }

  private agreementKey(record: MobilePairingRecord): MobilePublicKeyV2 {
    if (record.agreementKey) return record.agreementKey;
    if (record.agreementPublicKeyJwk) return legacyKey(record.agreementPublicKeyJwk, 'X25519');
    throw new Error('PAIRING_AGREEMENT_KEY_MISSING');
  }

  private serverIdentity(workspaceId: string): MobileServerIdentityV2 {
    const identity: MobileServerIdentityV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION,
      serverId: this.store.serverId(),
      workspaceId,
      supportedSuites: [...SERVER_SUITES],
      capabilities: {
        realtime: true,
        encryptedEnvelope: true,
        resumableFileTransfer: true,
        remoteTaskControl: 'low_risk_allowlist',
        remoteView: 'disabled',
        wakeOnLan: 'configuration_required',
        pushNotifications: 'configuration_required',
        destructiveDeviceControl: 'disabled',
        tlsRequiredForRemoteTransport: true,
        crossDevice: { clipboard: 'available', offlineQueue: 'available', smartHandoff: 'available', resultCards: 'available', audioHandoff: 'available', mobileToPcTransfer: 'available', pcToMobileTransfer: 'configuration_required', liveView: 'configuration_required', wakeOnLan: 'configuration_required', pcStatus: 'configuration_required' },
      },
    };
    const parsed = parseMobileServerIdentityV2(identity);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    return parsed.value;
  }

  private publicPairing(record: MobilePairingRecord, device?: MobileDeviceRecord): PairingSessionV2 {
    const status: PairingSessionV2['status'] = record.ownerRejectedAt ? 'rejected' : record.challenge.status === 'expired' ? 'expired' : record.ownerApprovedAt ? 'approved' : 'requested';
    const cryptoSuite = record.cryptoSuite ?? 'ED25519_X25519_HKDF_SHA256_AES256_GCM';
    return {
      pairingId: record.pairingId,
      device: record.device,
      status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      challenge: record.challenge,
      trust: device?.trust,
      ownerBinding: device?.ownerBinding,
      negotiation: { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, protocolVersion: EDITH_MOBILE_PROTOCOL_VERSION, offeredSuites: [cryptoSuite], selectedSuite: cryptoSuite, status: 'selected' },
      server: this.serverIdentity(record.challenge.workspaceId ?? 'workspace-unconfigured'),
    };
  }

  private audit(action: string, deviceId: string, authorization: 'allowed' | 'denied', message: string): void {
    appendAuditEvent(createAuditEvent({ actor: `mobile:${deviceId}`, action, toolId: 'mobile_pairing_service', target: deviceId, authorization, riskLevel: 4, result: authorization === 'allowed' ? 'success' : 'denied', message }));
  }
}
