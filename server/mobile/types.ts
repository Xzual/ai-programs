import type {
  DeviceCapabilitiesV2,
  DeviceIdentityV2,
  DeviceTrustV2,
  FileTransferDescriptorV2,
  MobileApplicationEnvelopeV2,
  MobileCryptoNegotiationV2,
  MobileCryptoSuiteV2,
  MobilePairingRequestV2,
  MobilePairingOfferV2,
  MobilePublicKeyV2,
  MobileRemoteCommandNameV2,
  MobileServerCapabilitiesV2,
  MobileServerIdentityV2,
  OwnerSessionBindingV2,
  PairingChallengeV2,
  PairingSessionV2,
} from '../../src/edith/contracts';

export type MobileCommand = MobileRemoteCommandNameV2;

export interface MobilePairingRecord {
  pairingId: string;
  device: DeviceIdentityV2;
  cryptoSuite?: MobileCryptoSuiteV2;
  signingKey?: MobilePublicKeyV2;
  agreementKey?: MobilePublicKeyV2;
  signingPublicKeyJwk?: JsonWebKey;
  agreementPublicKeyJwk?: JsonWebKey;
  challenge: PairingChallengeV2;
  codeHash: string;
  ownerApprovedAt?: string;
  ownerSessionBindingId?: string;
  ownerSessionExpiresAt?: string;
  ownerRejectedAt?: string;
  requestedCommands: MobileCommand[];
  approvedCommands: MobileCommand[];
  createdAt: string;
  expiresAt: string;
}

export interface MobileDeviceRecord {
  device: DeviceIdentityV2;
  trust: DeviceTrustV2;
  ownerBinding: OwnerSessionBindingV2;
  cryptoSuite?: MobileCryptoSuiteV2;
  signingKey?: MobilePublicKeyV2;
  agreementKey?: MobilePublicKeyV2;
  signingPublicKeyJwk?: JsonWebKey;
  agreementPublicKeyJwk?: JsonWebKey;
  allowedCommands: MobileCommand[];
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MobileCredentialRecord {
  credentialId: string;
  credentialHash: string;
  credentialFingerprint: string;
  deviceId: string;
  sessionId: string;
  workspaceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  rotatedFromId?: string;
  lastCommandSequence: number;
}

export interface MobileTransferRecord {
  descriptor: FileTransferDescriptorV2;
  deviceId: string;
  sessionId: string;
  destinationHandle: string;
  completedChunkIndexes: number[];
  createdAt: string;
  updatedAt: string;
}

export interface MobileRegistryDocument {
  schemaVersion: 1;
  serverId: string;
  pairings: MobilePairingRecord[];
  devices: MobileDeviceRecord[];
  credentials: MobileCredentialRecord[];
  transfers: MobileTransferRecord[];
}

export interface LegacyMobilePairingRequest {
  device: Omit<DeviceIdentityV2, 'publicKey' | 'fingerprint'>;
  signingPublicKeyJwk: JsonWebKey;
  agreementPublicKeyJwk: JsonWebKey;
  requestedCommands?: MobileCommand[];
}

export type MobilePairingRequest = MobilePairingRequestV2 | LegacyMobilePairingRequest;

export interface MobilePairingPublicResult {
  pairing: PairingSessionV2;
  code: string;
  challenge: string;
  serverAgreementPublicKeyJwk: JsonWebKey;
  serverAgreementKey: MobilePublicKeyV2;
  proofPayload: string;
  negotiation: MobileCryptoNegotiationV2;
  server: MobileServerIdentityV2;
  offer: MobilePairingOfferV2;
}

export interface MobileAccessCredential {
  credentialId: string;
  secret: string;
  token: string;
  sessionId: string;
  deviceId: string;
  workspaceId: string;
  expiresAt: string;
}

export interface MobileSessionContext {
  credential: MobileCredentialRecord;
  device: MobileDeviceRecord;
}

export type MobileEncryptedEnvelope = MobileApplicationEnvelopeV2;

export type MobileCapabilitiesStatus = MobileServerCapabilitiesV2 & { pairing: true };

export function safeDeviceCapabilities(value: DeviceCapabilitiesV2): DeviceCapabilitiesV2 {
  return {
    ...value,
    computerControl: false,
    browserControl: false,
    camera: false,
    microphone: false,
  };
}
