export const EDITH_CONTRACT_SCHEMA = 'edith.shared' as const;
export const EDITH_CONTRACT_VERSION = 2 as const;
export const TASK_CONTRACT_VERSION = 2 as const;
export const EDITH_CONTRACT_AMENDMENT = '2.1' as const;
export const EDITH_MOBILE_PROTOCOL_VERSION = 'edith.mobile/1' as const;

export const MOBILE_CRYPTO_SUITES = [
  'P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM',
  'ED25519_X25519_HKDF_SHA256_AES256_GCM',
] as const;

export type MobileCryptoSuiteV2 = typeof MOBILE_CRYPTO_SUITES[number];

export const EDITH_TASK_STATUSES = [
  'CREATED',
  'ANALYZING',
  'QUEUED',
  'PLANNING',
  'WAITING_DEPENDENCY',
  'RUNNING',
  'PAUSED',
  'RETRYING',
  'VERIFYING',
  'WAITING_PERMISSION',
  'WAITING_FOR_APPROVAL',
  'BLOCKED',
  'RECOVERING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLING_BACK',
  'ROLLED_BACK',
] as const;

export type CanonicalTaskStatus = typeof EDITH_TASK_STATUSES[number];

export interface ContractDescriptor {
  schema: typeof EDITH_CONTRACT_SCHEMA;
  version: typeof EDITH_CONTRACT_VERSION;
}

export const EDITH_CONTRACT: ContractDescriptor = Object.freeze({
  schema: EDITH_CONTRACT_SCHEMA,
  version: EDITH_CONTRACT_VERSION,
});

export interface VersionedContractEnvelope<T> {
  contract: ContractDescriptor;
  data: T;
}

export interface TaskV2Metadata {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  revision: number;
  eventSequence: number;
}

export interface TaskEventV2<TPayload = Record<string, unknown>> {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  taskId: string;
  eventId: string;
  sequence: number;
  revision: number;
  type: string;
  occurredAt: string;
  payload: TPayload;
  context?: TaskEventContextV2;
}

export interface TaskEventContextV2 {
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  fromStatus?: CanonicalTaskStatus;
  toStatus?: CanonicalTaskStatus;
  workspaceId?: string;
  deviceId?: string;
  streamId?: string;
  cursor?: number;
  replay?: RealtimeReplayMetadataV2;
}

export interface TaskEventPayloadMapV2 {
  'task.created': { title?: string; status: CanonicalTaskStatus };
  'task.status_changed': { fromStatus: CanonicalTaskStatus; toStatus: CanonicalTaskStatus; reasonCode?: string };
  'task.step_updated': { stepId: string; status: string; attempt?: number };
  'task.tool_started': { toolId: string; runId: string; riskLevel?: number };
  'task.tool_completed': { toolId: string; runId: string; outcome: 'success' | 'failure' | 'cancelled'; errorCode?: string };
  'task.verification_completed': { verificationId: string; status: 'PASS' | 'FAIL' | 'PARTIAL' | 'RETRYABLE' };
  'task.recovery_started': { recoveryId: string; attempt: number; classification: string };
  'task.completed': { resultArtifactIds?: string[] };
  'task.failed': { errorCode: string; retryable: boolean };
  'task.cancelled': { reasonCode?: string };
}

export type TaskEventTypeV2 = keyof TaskEventPayloadMapV2;
export type TypedTaskEventV2<K extends TaskEventTypeV2 = TaskEventTypeV2> =
  { [P in K]: TaskEventV2<TaskEventPayloadMapV2[P]> & { type: P; context: TaskEventContextV2 } }[K];

export interface TaskProgressSnapshot {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  taskId: string;
  revision: number;
  status: CanonicalTaskStatus;
  percent: number;
  completedSteps: number;
  totalSteps: number;
  failedSteps: number;
  recoveryAttempts: number;
  verificationStatus?: 'PASS' | 'FAIL' | 'PARTIAL' | 'RETRYABLE';
  terminal: boolean;
  sources: Array<'task_status' | 'plan_steps' | 'verification' | 'recovery'>;
}

export interface SkillRef {
  id: string;
  version: string;
  source: 'builtin' | 'workspace' | 'plugin' | 'remote';
  namespace?: string;
  canonicalId?: string;
  aliases?: string[];
}

export const OBSIDIAN_PROVIDER_CONFIG_VERSION = 1 as const;

export type ObsidianProviderStateV1 = 'FIRST_RUN_REQUIRED' | 'READY' | 'DEGRADED';

export interface TrustedNativeVaultSelectionV1 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  selectionId: string;
  deviceId: string;
  source: 'trusted_native_picker';
  selectedPath: string;
  userConfirmed: true;
  selectedAt: string;
  expiresAt: string;
}

export interface ObsidianProviderLocalConfigV1 {
  schemaVersion: typeof OBSIDIAN_PROVIDER_CONFIG_VERSION;
  revision: number;
  provider: 'user_vault' | 'revoked';
  selectedPath?: string;
  deviceId?: string;
  selectionId?: string;
  approvedAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface ObsidianProviderPublicStatusV1 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  state: ObsidianProviderStateV1;
  reasonCode: 'VAULT_SELECTION_REQUIRED' | 'VAULT_SELECTION_REVOKED' | 'VAULT_UNAVAILABLE' | 'VAULT_READY' | 'TEST_SANDBOX_REQUIRED' | 'TEST_SANDBOX_READY' | 'CONFIG_INVALID';
  provider: 'none' | 'user_vault' | 'sandbox_vault';
  configured: boolean;
  available: boolean;
  readable: boolean;
  writable: boolean;
  selectionAction: 'show_first_run' | 'none';
  promptPolicy: 'user_initiated_only';
  configRevision: number;
  executionAuthority: false;
  knowledgeOnly: true;
  checkedAt: string;
}

export interface DeviceIdentityV2 {
  deviceId: string;
  displayName: string;
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web' | 'unknown';
  publicKey?: string;
  fingerprint?: string;
  capabilities?: DeviceCapabilitiesV2;
}

export interface DeviceCapabilitiesV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion?: string;
  realtime: boolean;
  taskUpdates?: boolean;
  capsulePresentation?: boolean;
  missionPresentation?: boolean;
  fileTransfer: boolean;
  fileTransferEncryption?: boolean;
  maxChunkSizeBytes?: number;
  notifications: boolean;
  camera: boolean;
  microphone: boolean;
  computerControl: boolean;
  browserControl: boolean;
}

export interface DeviceTrustV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  deviceId: string;
  workspaceId?: string;
  fingerprint: string;
  status: 'pending' | 'trusted' | 'revoked' | 'expired';
  trustedAt?: string;
  revokedAt?: string;
  expiresAt?: string;
  reconnectCredentialId?: string;
  reconnectCredentialFingerprint?: string;
}

export interface OwnerAuthContextV2 {
  actor: 'owner';
  sessionId?: string;
  authenticatedAt: string;
  expiresAt: string;
}

export interface OwnerSessionBindingV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  bindingId: string;
  ownerSessionId: string;
  deviceId: string;
  workspaceId: string;
  deviceFingerprint: string;
  createdAt: string;
  expiresAt: string;
  status?: 'active' | 'revoked' | 'expired';
  revokedAt?: string;
}

export interface PairingChallengeV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  challengeId: string;
  pairingId: string;
  deviceId: string;
  workspaceId?: string;
  algorithm: 'SHA-256' | 'HMAC-SHA-256' | 'Ed25519' | 'ECDSA-P256-SHA256';
  protocolVersion?: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  cryptoSuite?: MobileCryptoSuiteV2;
  requestedCommandsFingerprint?: string;
  challengeFingerprint: string;
  proofFingerprint?: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
  oneTime: true;
  status?: 'issued' | 'proof_submitted' | 'verified' | 'consumed' | 'rejected' | 'expired' | 'revoked';
  attempt?: number;
  maxAttempts?: number;
  verifiedAt?: string;
}

export interface PairingSessionV2 {
  pairingId: string;
  device: DeviceIdentityV2;
  status: 'requested' | 'approved' | 'rejected' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  challenge?: PairingChallengeV2;
  trust?: DeviceTrustV2;
  ownerBinding?: OwnerSessionBindingV2;
  negotiation?: MobileCryptoNegotiationV2;
  server?: MobileServerIdentityV2;
}

export interface MobilePublicKeyV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  algorithm: 'ECDSA-P256-SHA256' | 'ECDH-P256' | 'Ed25519' | 'X25519';
  encoding: 'jwk' | 'spki_der_base64';
  value: string | Record<string, unknown>;
  fingerprint: string;
}

export interface MobileCryptoNegotiationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  offeredSuites: MobileCryptoSuiteV2[];
  selectedSuite?: MobileCryptoSuiteV2;
  status: 'selected' | 'configuration_required' | 'unsupported';
  reasonCode?: string;
}

export interface MobileServerCapabilitiesV2 {
  realtime: true;
  encryptedEnvelope: true;
  resumableFileTransfer: true;
  remoteTaskControl: 'low_risk_allowlist';
  remoteView: 'disabled';
  wakeOnLan: 'configuration_required';
  pushNotifications: 'configuration_required';
  destructiveDeviceControl: 'disabled';
  tlsRequiredForRemoteTransport: true;
  crossDevice?: {
    clipboard: 'available';
    offlineQueue: 'available';
    smartHandoff: 'available';
    resultCards: 'available';
    audioHandoff: 'available';
    mobileToPcTransfer: 'available';
    pcToMobileTransfer: 'configuration_required';
    liveView: 'configuration_required';
    wakeOnLan: 'configuration_required';
    pcStatus: 'configuration_required';
  };
}

export interface MobileServerIdentityV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  serverId: string;
  workspaceId: string;
  supportedSuites: MobileCryptoSuiteV2[];
  capabilities: MobileServerCapabilitiesV2;
}

export interface MobilePairingRequestV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  device: DeviceIdentityV2;
  supportedSuites: MobileCryptoSuiteV2[];
  signingKey: MobilePublicKeyV2;
  agreementKey: MobilePublicKeyV2;
  requestedCommands: MobileRemoteCommandNameV2[];
}

export interface MobilePairingOfferV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  pairing: PairingSessionV2;
  server: MobileServerIdentityV2;
  negotiation: MobileCryptoNegotiationV2;
  challengeBase64url: string;
  serverAgreementKey: MobilePublicKeyV2;
  signingKeyFingerprint: string;
  agreementKeyFingerprint: string;
  requestedCommandsFingerprint: string;
  transcriptBase64url: string;
  transcriptFingerprint: string;
  ownerVerificationCode: string;
  expiresAt: string;
}

export interface MobilePairingProofSubmissionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  pairingId: string;
  assertionType: 'challenge' | 'consume';
  assertionBase64url: string;
  payloadFingerprint: string;
  submittedAt: string;
}

export interface MobilePairingOwnerDecisionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  pairingId: string;
  decision: 'approved' | 'rejected';
  approvedCommands: MobileRemoteCommandNameV2[];
  decidedAt: string;
}

export interface MobileCredentialMetadataV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  credentialId: string;
  credentialFingerprint: string;
  deviceId: string;
  sessionId: string;
  workspaceId: string;
  issuedAt: string;
  expiresAt: string;
  rotatedFromId?: string;
  revokedAt?: string;
}

export interface MobileDeviceSessionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  sessionId: string;
  serverId: string;
  deviceId: string;
  workspaceId: string;
  cryptoSuite: MobileCryptoSuiteV2;
  keyFingerprint: string;
  status: 'active' | 'rotating' | 'revoked' | 'expired' | 'repair_required' | 'configuration_required';
  establishedAt: string;
  expiresAt: string;
  errorCode?: string;
}

export interface MobileApplicationEnvelopeV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION;
  aadVersion: 'edith-mobile-aad-v1';
  encryption: 'AES-256-GCM';
  cryptoSuite: MobileCryptoSuiteV2;
  sessionId: string;
  serverId: string;
  deviceId: string;
  workspaceId: string;
  sequence: number;
  direction: 'client_to_server' | 'server_to_client';
  channel: 'http' | 'realtime' | 'transfer';
  purpose: string;
  nonceBase64url: string;
  ciphertextBase64url: string;
  authTagBase64url: string;
}

export interface MobilePairingConsumeResultV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  pairing: PairingSessionV2;
  session: MobileDeviceSessionV2;
  credentialEnvelope: MobileApplicationEnvelopeV2;
}

export type MobileRemoteCommandNameV2 =
  | 'task.list' | 'task.detail' | 'task.activity' | 'task.create_low_risk'
  | 'task.pause' | 'task.resume' | 'task.cancel' | 'emergency_stop' | 'file.upload' | 'file.download'
  | 'clipboard.publish' | 'clipboard.consume' | 'live_view.start' | 'live_view.stop'
  | 'wake.request' | 'offline_queue.manage' | 'handoff.manage' | 'result_card.read'
  | 'audio_handoff.manage' | 'pc_status.read';

export interface MobileRemoteCommandV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  commandId: string;
  command: MobileRemoteCommandNameV2;
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  sequence: number;
  idempotencyKey: string;
  riskLevel: 0 | 1;
  issuedAt: string;
  expiresAt: string;
  payload?: Record<string, unknown>;
}

export interface MobileRemoteCommandResultV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  commandId: string;
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  status: 'completed' | 'rejected' | 'failed';
  completedAt: string;
  errorCode?: string;
  result?: Record<string, unknown>;
}

export interface MobileEmergencyStopEventV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  eventId: string;
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  activatedAt: string;
  reasonCode: string;
  killSwitchActive: true;
}

export interface FileChunkV2 {
  index: number;
  offsetBytes: number;
  sizeBytes: number;
  sha256: string;
}

export interface EncryptedFileChunkV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  transferId: string;
  deviceId: string;
  sessionId: string;
  index: number;
  plaintextSizeBytes: number;
  plaintextSha256: string;
  encryption: 'application_envelope_aes_256_gcm';
  aadPurpose: string;
}

export interface FileChunkManifestV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  transferId?: string;
  sizeBytes?: number;
  chunkSizeBytes: number;
  totalChunks: number;
  fileSha256: string;
  chunks: FileChunkV2[];
  createdAt?: string;
}

export interface TransferEncryptionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  algorithm: 'AES-256-GCM' | 'XCHACHA20-POLY1305';
  keyId: string;
  keyFingerprint: string;
  nonceStrategy: 'per_chunk_derived' | 'per_chunk_random';
  authenticated: true;
  aadContext?: string;
}

export interface TransferResumeV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  resumable: boolean;
  nextChunkIndex: number;
  completedChunkIndexes: number[];
  retryCount: number;
  maxRetries: number;
  lastAttemptAt?: string;
  acknowledgedBytes?: number;
  resumeCheckpointId?: string;
  retryAt?: string;
  errorCode?: string;
}

export interface SafeDestinationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  handle: string;
  scope: 'workspace' | 'downloads' | 'vault_inbox' | 'temporary';
  displayName?: string;
  overwritePolicy?: 'reject' | 'rename' | 'replace_with_approval';
  createdAt?: string;
  expiresAt?: string;
}

export interface FileTransferDescriptorV2 {
  transferId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  direction: 'upload' | 'download';
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  sourceDeviceId?: string;
  targetDeviceId?: string;
  chunkManifest?: FileChunkManifestV2;
  encryption?: TransferEncryptionV2;
  resume?: TransferResumeV2;
  destination?: SafeDestinationV2;
  createdAt?: string;
  updatedAt?: string;
  contractVersion?: typeof TASK_CONTRACT_VERSION;
  amendment?: typeof EDITH_CONTRACT_AMENDMENT;
}

export interface CrossDeviceLineageV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  ownerSessionBindingId: string;
  workspaceId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
}

export interface CrossDeviceTransferV2 extends CrossDeviceLineageV2 {
  transferId: string;
  direction: 'mobile_to_pc' | 'pc_to_mobile';
  category: 'pdf' | 'image' | 'document' | 'other';
  fileName: string;
  mediaType: string;
  sourceComputerLabel?: string;
  sizeBytes: number;
  sha256: string;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled' | 'configuration_required';
  progress: {
    bytesTransferred: number;
    totalBytes: number;
    percent: number;
    integrity: 'pending' | 'verified' | 'failed';
  };
  destination: {
    kind: 'desktop' | 'downloads' | 'approved_folder' | 'mobile_inbox';
    opaqueHandle: string;
    displaySummary: string;
    conflictPolicy: 'reject' | 'collision_safe_rename' | 'approval_required';
    collisionDetected: boolean;
  };
  resume: TransferResumeV2;
  capabilities: {
    open: boolean;
    export: boolean;
    share: boolean;
    openLocation: boolean;
  };
  candidateEvidence?: {
    candidateId: string;
    source: 'explicit_selection' | 'semantic_fetch' | 'drop_request';
    verified: boolean;
    evidenceSummary: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string;
}

export interface CrossDeviceClipboardRequestV2 extends CrossDeviceLineageV2 {
  clipboardId: string;
  direction: 'mobile_to_pc' | 'pc_to_mobile';
  mimeType: 'text/plain' | 'text/uri-list';
  content: string;
  explicitConsent: true;
  persistHistory: false;
  issuedAt: string;
  expiresAt: string;
}

export interface CrossDeviceClipboardMetadataV2 extends Omit<CrossDeviceClipboardRequestV2, 'content'> {
  contentBytes: number;
  contentFingerprint: string;
  status: 'available' | 'consumed' | 'expired' | 'rejected';
  sensitive: false;
}

export interface CrossDeviceLiveViewSessionV2 extends CrossDeviceLineageV2 {
  liveViewId: string;
  status: 'requested' | 'approved' | 'configuration_required' | 'streaming' | 'stopped' | 'expired';
  ownerApproved: boolean;
  continuousAutoStream: false;
  controlAuthority: false;
  framePolicy: { maxFramesPerSecond: number; maxWidth: number; maxHeight: number };
  overlayCapabilities: { cursor: boolean; click: boolean; target: boolean; operatorState: boolean };
  startedAt?: string;
  stoppedAt?: string;
  expiresAt: string;
  errorCode?: string;
}

export interface CrossDeviceLiveViewFrameMetadataV2 extends CrossDeviceLineageV2 {
  liveViewId: string;
  frameId: string;
  sequence: number;
  observedAt: string;
  width: number;
  height: number;
  cursor?: { x: number; y: number };
  click?: { x: number; y: number; button: 'left' | 'right' | 'middle' };
  target?: { targetId: string; label: string; x: number; y: number; width: number; height: number };
  operatorState: DesktopOperatorStateV2;
  containsPixels: false;
}

export interface CrossDeviceWakeReadyV2 extends CrossDeviceLineageV2 {
  requestId: string;
  capability: 'wake_on_lan';
  capabilityStatus: 'available' | 'unsupported' | 'configuration_required';
  status: 'requested' | 'attempted' | 'ready' | 'failed' | 'unsupported' | 'configuration_required';
  attempted: boolean;
  runtimeReady: boolean;
  requestedAt: string;
  completedAt?: string;
  errorCode?: string;
}

export interface CrossDeviceOfflineQueueItemV2 extends CrossDeviceLineageV2 {
  queueItemId: string;
  command: {
    commandId: string;
    command: Exclude<MobileRemoteCommandNameV2, 'emergency_stop'>;
    deviceId: string;
    workspaceId: string;
    sessionId: string;
    idempotencyKey: string;
    riskLevel: 0 | 1;
    issuedAt: string;
    expiresAt: string;
    payloadFingerprint: string;
  };
  status: 'pending' | 'cancelled' | 'dispatching' | 'completed' | 'failed' | 'expired';
  encryptedAtRest: true;
  queuedAt: string;
  expiresAt: string;
  cancelledAt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  result?: MobileRemoteCommandResultV2;
  errorCode?: string;
}

export interface CrossDeviceHandoffIntentV2 extends CrossDeviceLineageV2 {
  handoffId: string;
  direction: 'desktop_to_mobile' | 'mobile_to_desktop';
  intent: 'open' | 'continue';
  taskId?: string;
  resultId?: string;
  artifactIds: string[];
  status: 'requested' | 'acknowledged' | 'rejected' | 'expired';
  requestedAt: string;
  expiresAt: string;
  acknowledgedAt?: string;
}

export type SharedResultCardKindV2 = 'research' | 'file' | 'screenshot' | 'download' | 'task' | 'error_attention';

export interface SharedArtifactRefV2 {
  artifactId: string;
  mediaType: string;
  checksumSha256?: string;
  checksumStatus: 'verified' | 'failed' | 'unavailable';
  provenance: { sourceType: string; sourceId: string; observedAt: string; verified: boolean };
  retention: 'session' | 'temporary' | 'workspace';
  ownerSessionBindingId: string;
  downloadHandle?: string;
}

export interface SharedResultCardV2 extends CrossDeviceLineageV2 {
  cardId: string;
  kind: SharedResultCardKindV2;
  title: string;
  summary: string;
  outcome: ResultCardV2['outcome'];
  provenance: { sourceType: string; sourceId: string; observedAt: string; verified: boolean };
  preview: { safeText?: string; mediaType?: string; artifactRef?: string; redacted: boolean };
  artifactRefs: SharedArtifactRefV2[];
  actions: Array<{ action: 'open' | 'export' | 'share' | 'open_location' | 'retry' | 'dismiss'; available: boolean; requiresApproval: boolean }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CrossDeviceAudioHandoffV2 extends CrossDeviceLineageV2 {
  handoffId: string;
  leaseId: string;
  epoch: number;
  sourceCaptureDeviceId: string;
  targetCaptureDeviceId: string;
  status: 'requested' | 'acknowledged' | 'active' | 'released' | 'expired' | 'rejected';
  simultaneousCaptureAllowed: false;
  quietHoursRevision?: number;
  requestedAt: string;
  acknowledgedAt?: string;
  expiresAt: string;
}

export interface CrossDevicePcStatusV2 extends CrossDeviceLineageV2 {
  snapshotId: string;
  runtime: 'ready' | 'busy' | 'offline' | 'unknown';
  observedAt: string;
  expiresAt: string;
  metrics: {
    cpuPercent?: number;
    gpuPercent?: number;
    ramPercent?: number;
    networkState?: 'online' | 'offline' | 'unknown';
    activeDownloads?: number;
    voiceActive?: boolean;
    computerUseActive?: boolean;
  };
  source: 'native_adapter' | 'backend_runtime';
}

export interface CrossDeviceQuietHoursV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  workspaceId: string;
  ownerSessionBindingId: string;
  revision: number;
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezone: string;
  suppressAudio: boolean;
  suppressNotifications: boolean;
  updatedAt: string;
}

export type TaskPriorityV2 = 'LOW' | 'NORMAL' | 'HIGH';
export type AdvancedExperienceStatusV2 = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'expired' | 'configuration_required';

export interface AdvancedExperienceLineageV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  ownerSessionBindingId: string;
  workspaceId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface PriorityTaskPolicyV2 extends AdvancedExperienceLineageV2 {
  taskId: string;
  priority: TaskPriorityV2;
  dependencyTaskIds: string[];
  atomicOperation: boolean;
  securityCritical: boolean;
  derivedFromUrgentLanguage: false;
  blockedByDependencies: boolean;
}

export interface ShadowModeV2 extends AdvancedExperienceLineageV2 {
  enabled: boolean;
  consent: 'explicit';
  observationLevel: 'metadata_only';
  capturedFields: Array<'app_identity' | 'task_identity' | 'workflow_structure' | 'timestamps'>;
  rawScreenArchive: false;
  secretCapture: false;
  suggestionOnly: true;
  disabledAt?: string;
}

export interface GhostTaskV2 extends AdvancedExperienceLineageV2 {
  ghostTaskId: string;
  taskId: string;
  background: true;
  focusPolicy: 'never_steal' | 'visible_gui_only_when_explicit';
  status: AdvancedExperienceStatusV2;
  progressPercent: number;
  completionNotification: 'meaningful_only';
  nativeExecution: 'not_connected';
  reasonCode?: string;
}

export interface MissionMemoryV2 extends AdvancedExperienceLineageV2 {
  memoryId: string;
  sourceTaskId: string;
  sourcePlaybookRunId?: string;
  sourceResearchRunId?: string;
  verificationStatus: 'verified';
  routeSummary: string;
  avoidRouteCodes: string[];
  currentStateReverificationRequired: true;
}

export interface VisualBookmarkV2 extends AdvancedExperienceLineageV2 {
  bookmarkId: string;
  capturedAt: string;
  appId: string;
  windowTitlePreview?: string;
  fileRef?: string;
  tabRef?: string;
  taskId?: string;
  userNote?: string;
  screenshotArtifactHandle?: string;
  screenshotPolicy: 'metadata_only' | 'opaque_handle' | 'blocked_sensitive_app';
  sensitiveAppBlocked: boolean;
}

export interface RecentContextEventV2 extends AdvancedExperienceLineageV2 {
  eventId: string;
  kind: 'task' | 'app' | 'window' | 'bookmark' | 'research' | 'download';
  sourceId: string;
  safeSummary: string;
  occurredAt: string;
}

export interface WorkspaceSnapshotV2 extends AdvancedExperienceLineageV2 {
  snapshotId: string;
  label: string;
  items: Array<{ kind: 'app' | 'project' | 'document' | 'tab' | 'task'; refId: string; displayLabel: string }>;
  forbiddenStateExcluded: true;
  dangerousTransactionsExcluded: true;
  captureStatus: 'metadata_only';
}

export interface WorkspaceRestorePlanV2 extends AdvancedExperienceLineageV2 {
  planId: string;
  snapshotId: string;
  steps: Array<{ stepId: string; kind: 'app' | 'project' | 'document' | 'tab' | 'task'; refId: string; status: 'planned' | 'configuration_required' }>;
  requiresVerification: true;
  secretsExcluded: true;
  dangerousTransactionsExcluded: true;
  status: 'planned' | 'configuration_required';
}

export type SceneProfileNameV2 = 'WORK' | 'RESEARCH' | 'GAMING' | 'FOCUS' | 'PRESENTATION' | 'TRAVEL' | 'QUIET';
export interface SceneProfileV2 extends AdvancedExperienceLineageV2 {
  sceneId: string;
  profile: SceneProfileNameV2;
  changes: Array<{ setting: 'notifications' | 'preferred_apps' | 'media' | 'capsule' | 'audio_routing' | 'task_priority'; from: string; to: string; reversible: true }>;
  securityNotificationsImmutable: true;
  status: 'planned' | 'active' | 'reverted' | 'configuration_required';
}

export interface WatcherV2 extends AdvancedExperienceLineageV2 {
  watcherId: string;
  kind: 'download' | 'file' | 'folder' | 'task';
  sourceRef: string;
  trigger: 'completed' | 'changed' | 'created';
  delivery: 'desktop' | 'mobile' | 'both';
  observationPolicy: 'event_based';
  status: 'active' | 'cancelled' | 'expired' | 'triggered' | 'configuration_required';
  cancelledAt?: string;
  triggeredAt?: string;
}

export interface CompareChangeV2 extends AdvancedExperienceLineageV2 {
  comparisonId: string;
  sourceType: 'file' | 'page' | 'research';
  previousRef: string;
  currentRef: string;
  provenance: { sourceId: string; previousObservedAt: string; currentObservedAt: string; verified: boolean };
  added: string[];
  removed: string[];
  changed: string[];
}

export interface CommunicationPolicyV2 extends AdvancedExperienceLineageV2 {
  autoBrief: { enabled: boolean; maxSentences: 1 | 2 | 3 };
  smartSilence: { routine: 'capsule'; milestone: 'concise_notification'; completion: 'short_brief'; actionRequired: 'clear_alert' };
  voicePresence: { enabled: boolean; response: 'short_acknowledgement' };
  voiceSummary: { mode: 'on_demand'; actualStateOnly: true };
  securityNotificationsImmutable: true;
}

export interface OrchestrationPlanV2 extends AdvancedExperienceLineageV2 {
  planId: string;
  kind: 'one_command_workspace' | 'outcome_mode';
  objective: string;
  references: Array<{ kind: 'task' | 'skill' | 'research' | 'artifact' | 'transfer'; id: string }>;
  steps: Array<{ stepId: string; referenceId: string; status: 'planned' | 'configuration_required' | 'verified' }>;
  arbitraryShell: false;
  status: 'planned' | 'running' | 'configuration_required' | 'completed' | 'failed';
  verifiedDownstreamResultIds: string[];
}

export interface SmartRetryPlanV2 extends AdvancedExperienceLineageV2 {
  retryId: string;
  taskId: string;
  failureClass: 'network' | 'page_changed' | 'app_closed' | 'stale_target' | 'permission_denied' | 'other';
  strategy: 'reconnect_backoff' | 'reobserve' | 'reopen_if_allowed' | 'stop_report';
  attempts: number;
  maxAttempts: number;
  staleTargetReobserve: boolean;
  permissionDeniedStop: boolean;
  status: 'planned' | 'retrying' | 'verified' | 'exhausted' | 'stopped';
}

export interface DownloadButlerStatusV2 extends AdvancedExperienceLineageV2 {
  downloadId: string;
  source: 'steam' | 'browser' | 'file_transfer' | 'supported_app';
  displayName: string;
  bytesTransferred: number;
  bytesTotal: number;
  speedBytesPerSecond?: number;
  remainingBytes: number;
  etaSeconds?: number;
  etaTrustworthy: boolean;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  observedAt: string;
}

export interface PowerPresenceSnapshotV2 extends AdvancedExperienceLineageV2 {
  snapshotId: string;
  source: 'trusted_native';
  powerSource: 'ac' | 'battery' | 'unknown';
  batteryPercent?: number;
  lowPower: boolean;
  userPresence: 'active' | 'away' | 'unknown';
  cameraUsed: false;
  observedAt: string;
}

export interface HistoryRetentionPolicyV2 extends AdvancedExperienceLineageV2 {
  policyId: string;
  retentionDays: number;
  includePrivate: false;
  purgedBefore?: string;
  searchableKinds: Array<RecentContextEventV2['kind']>;
}

export interface CapsuleContextCandidateV2 {
  candidateId: string;
  kind: 'attention_required' | 'critical_milestone' | 'progress' | 'media' | 'idle_voice';
  sourceId: string;
  safeLabel: string;
  observedAt: string;
  expiresAt: string;
}

export interface CapsuleContextSelectionV2 extends AdvancedExperienceLineageV2 {
  selectionId: string;
  selected: CapsuleContextCandidateV2;
  consideredCandidateIds: string[];
  deterministicRank: 1 | 2 | 3 | 4 | 5;
}

export type DesktopOperatorStateV2 =
  | 'observing'
  | 'planning'
  | 'moving'
  | 'clicking'
  | 'typing'
  | 'scrolling'
  | 'verifying'
  | 'success'
  | 'error'
  | 'stopped';

export interface DesktopPointV2 {
  x: number;
  y: number;
}

export interface DesktopBoundsV2 extends DesktopPointV2 {
  width: number;
  height: number;
  coordinateSpace: 'logical' | 'physical_virtual_desktop' | 'window_relative';
}

export interface DesktopObservationCapabilitiesV2 {
  screenshot: boolean;
  uia: boolean;
  accessibility: boolean;
  ocr: boolean;
  multiMonitor: boolean;
}

export interface DesktopForegroundIdentityV2 {
  hwndFingerprint: string;
  processId: number;
  processName?: string;
  titleFingerprint?: string;
  titlePreview?: string;
  logicalBounds: DesktopBoundsV2;
  physicalBounds: DesktopBoundsV2;
}

export interface DesktopMonitorV2 {
  monitorId: string;
  origin: DesktopPointV2;
  logicalBounds: DesktopBoundsV2;
  physicalBounds: DesktopBoundsV2;
  dpiScale: number;
}

export interface DesktopOperatorSessionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  sessionId: string;
  workspaceId?: string;
  deviceId?: string;
  runtime: 'tauri' | 'unbound';
  state: DesktopOperatorStateV2;
  mode: 'read_only' | 'owner_command' | 'disabled' | 'error';
  killSwitch: 'active' | 'inactive' | 'unknown';
  currentObservationId?: string;
  currentGeneration: number;
  capabilities: DesktopObservationCapabilitiesV2;
  startedAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface DesktopObservationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  observationId: string;
  sessionId: string;
  generation: number;
  capturedAt: string;
  expiresAt: string;
  foreground: DesktopForegroundIdentityV2;
  virtualDesktop: {
    origin: DesktopPointV2;
    logicalBounds: DesktopBoundsV2;
    physicalBounds: DesktopBoundsV2;
  };
  monitor: DesktopMonitorV2;
  source: 'windows_gdi_virtual_desktop' | 'screen_capture' | 'uia' | 'accessibility' | 'ocr' | 'composite';
  confidence: number;
  capabilities: DesktopObservationCapabilitiesV2;
}

export type SemanticTargetProvenanceV2 = 'uia' | 'accessibility' | 'window_relative' | 'ocr' | 'screenshot_coordinate';

export interface SemanticTargetV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  targetId: string;
  observationId: string;
  observationGeneration: number;
  provenance: SemanticTargetProvenanceV2;
  confidence: number;
  role?: string;
  automationIdFingerprint?: string;
  runtimeIdFingerprint?: string;
  nameFingerprint?: string;
  textFingerprint?: string;
  windowRelativePoint?: DesktopPointV2;
  screenshotPoint?: DesktopPointV2;
  logicalBounds?: DesktopBoundsV2;
  physicalBounds?: DesktopBoundsV2;
}

export type DesktopActionKindV2 = 'moveMouse' | 'clickMouse' | 'typeText' | 'pressKey' | 'hotkey' | 'scroll' | 'launchApp';

export interface ScopedApprovalV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  approvalId: string;
  sessionId: string;
  observationId: string;
  observationGeneration: number;
  scope: {
    actions: DesktopActionKindV2[];
    targetIds?: string[];
    physicalBounds?: DesktopBoundsV2;
    maxActions: number;
  };
  grantedBy: 'owner';
  grantedAt: string;
  expiresAt: string;
  consumedActionIds: string[];
  status: 'active' | 'consumed' | 'revoked' | 'expired';
}

export type DesktopExpectedEffectV2 =
  | 'cursor_moved'
  | 'visual_change'
  | 'foreground_window_changed'
  | 'input_injected'
  | 'process_started'
  | 'none';

export interface DesktopActionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  actionId: string;
  idempotencyKey: string;
  sessionId: string;
  approvalId: string;
  observationId: string;
  observationGeneration: number;
  kind: DesktopActionKindV2;
  target?: SemanticTargetV2;
  coordinates?: DesktopPointV2;
  button?: 'left' | 'right' | 'middle';
  key?: string;
  keys?: string[];
  textLength?: number;
  textFingerprint?: string;
  scrollDelta?: number;
  applicationId?: string;
  expectedEffect: DesktopExpectedEffectV2;
  deadlineAt: string;
  retryBudget: {
    maxAttempts: 1 | 2;
    attempt: number;
    backoffMs: number;
  };
}

export interface ActionDispatchV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  dispatchId: string;
  actionId: string;
  idempotencyKey: string;
  sessionId: string;
  approvalId: string;
  observationId: string;
  observationGeneration: number;
  status: 'accepted' | 'dispatched' | 'rejected' | 'failed';
  attempt: number;
  dispatchedAt: string;
  nativeCommandId?: string;
  errorCode?: string;
}

export interface ActionVerificationEvidenceV2 {
  kind: 'cursor_position' | 'foreground_window_changed' | 'visual_change' | 'input_injected' | 'process_started';
  matched: boolean;
  observationId?: string;
  confidence?: number;
}

export interface ActionVerificationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  verificationId: string;
  actionId: string;
  dispatchId: string;
  expectedEffect: DesktopExpectedEffectV2;
  preObservationId: string;
  preObservationGeneration: number;
  postObservationId?: string;
  postObservationGeneration?: number;
  status: 'verified' | 'partial' | 'failed' | 'pending_post_observation';
  evidence: ActionVerificationEvidenceV2[];
  confidence: number;
  verifiedAt: string;
  errorCode?: string;
}

export interface RetryDecisionV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  decisionId: string;
  actionId: string;
  verificationId?: string;
  decision: 'retry' | 'stop' | 'succeed' | 'require_approval' | 'reobserve';
  attempt: number;
  maxAttempts: 1 | 2;
  reasonCode: string;
  requiresFreshObservation: boolean;
  nextAttemptAt?: string;
  decidedAt: string;
}

export const REALTIME_EVENT_NAMES = {
  TASK_EVENT: 'task.event.v2',
  TASK_PROGRESS: 'task.progress.v2',
  TASK_CREATED: 'task.created.v2',
  TASK_STATUS_CHANGED: 'task.status_changed.v2',
  TASK_STEP_UPDATED: 'task.step_updated.v2',
  TASK_TOOL_STARTED: 'task.tool_started.v2',
  TASK_TOOL_COMPLETED: 'task.tool_completed.v2',
  TASK_VERIFICATION_COMPLETED: 'task.verification_completed.v2',
  TASK_RECOVERY_STARTED: 'task.recovery_started.v2',
  TASK_COMPLETED: 'task.completed.v2',
  TASK_FAILED: 'task.failed.v2',
  TASK_CANCELLED: 'task.cancelled.v2',
  PAIRING_STATUS: 'pairing.status.v2',
  DEVICE_STATUS: 'device.status.v2',
  FILE_TRANSFER_STATUS: 'file_transfer.status.v2',
  EMERGENCY_STOP_ACTIVATED: 'emergency_stop.activated.v2',
  CROSS_DEVICE_TRANSFER_STATUS: 'cross_device.transfer.status.v2',
  CROSS_DEVICE_CLIPBOARD_STATUS: 'cross_device.clipboard.status.v2',
  CROSS_DEVICE_LIVE_VIEW_STATUS: 'cross_device.live_view.status.v2',
  CROSS_DEVICE_LIVE_VIEW_FRAME_METADATA: 'cross_device.live_view.frame_metadata.v2',
  CROSS_DEVICE_WAKE_READY_STATUS: 'cross_device.wake_ready.status.v2',
  CROSS_DEVICE_OFFLINE_QUEUE_STATUS: 'cross_device.offline_queue.status.v2',
  CROSS_DEVICE_HANDOFF_STATUS: 'cross_device.handoff.status.v2',
  CROSS_DEVICE_RESULT_CARD_UPDATED: 'cross_device.result_card.updated.v2',
  CROSS_DEVICE_AUDIO_HANDOFF_STATUS: 'cross_device.audio_handoff.status.v2',
  CROSS_DEVICE_PC_STATUS_UPDATED: 'cross_device.pc_status.updated.v2',
  CAPSULE_UPDATED: 'capsule.updated.v2',
  MISSION_UPDATED: 'mission.updated.v2',
  DESKTOP_OBSERVATION: 'desktop.observation.v2',
  DESKTOP_ACTION_REQUESTED: 'desktop.action.requested.v2',
  DESKTOP_ACTION_DISPATCH: 'desktop.action.dispatch.v2',
  DESKTOP_ACTION_VERIFICATION: 'desktop.action.verification.v2',
  DESKTOP_RETRY_DECISION: 'desktop.retry.decision.v2',
} as const;

export type RealtimeEventName = typeof REALTIME_EVENT_NAMES[keyof typeof REALTIME_EVENT_NAMES];

export interface RealtimeEnvelopeV2<TPayload = unknown> {
  schema: typeof EDITH_CONTRACT_SCHEMA;
  version: typeof EDITH_CONTRACT_VERSION;
  event: RealtimeEventName;
  eventId: string;
  occurredAt: string;
  sequence: number;
  payload: TPayload;
  streamId?: string;
  cursor?: number;
  correlationId?: string;
  causationId?: string;
  replayed?: boolean;
  replay?: RealtimeReplayMetadataV2;
}

export interface RealtimeReplayMetadataV2 {
  requestedAfterCursor?: number;
  windowStartCursor: number;
  windowEndCursor: number;
  truncated: boolean;
}

export interface RealtimeEnvelopeV2_1<TPayload = unknown> extends RealtimeEnvelopeV2<TPayload> {
  streamId: string;
  cursor: number;
  correlationId: string;
  replayed: boolean;
}

export interface RealtimePayloadMapV2 {
  'task.event.v2': TypedTaskEventV2;
  'task.progress.v2': TaskProgressSnapshot;
  'task.created.v2': TaskEventPayloadMapV2['task.created'];
  'task.status_changed.v2': TaskEventPayloadMapV2['task.status_changed'];
  'task.step_updated.v2': TaskEventPayloadMapV2['task.step_updated'];
  'task.tool_started.v2': TaskEventPayloadMapV2['task.tool_started'];
  'task.tool_completed.v2': TaskEventPayloadMapV2['task.tool_completed'];
  'task.verification_completed.v2': TaskEventPayloadMapV2['task.verification_completed'];
  'task.recovery_started.v2': TaskEventPayloadMapV2['task.recovery_started'];
  'task.completed.v2': TaskEventPayloadMapV2['task.completed'];
  'task.failed.v2': TaskEventPayloadMapV2['task.failed'];
  'task.cancelled.v2': TaskEventPayloadMapV2['task.cancelled'];
  'pairing.status.v2': { pairingId: string; status: PairingSessionV2['status'] };
  'device.status.v2': { deviceId: string; status: DeviceTrustV2['status'] };
  'file_transfer.status.v2': { transferId: string; status: FileTransferDescriptorV2['status'] };
  'emergency_stop.activated.v2': MobileEmergencyStopEventV2;
  'cross_device.transfer.status.v2': CrossDeviceTransferV2;
  'cross_device.clipboard.status.v2': CrossDeviceClipboardMetadataV2;
  'cross_device.live_view.status.v2': CrossDeviceLiveViewSessionV2;
  'cross_device.live_view.frame_metadata.v2': CrossDeviceLiveViewFrameMetadataV2;
  'cross_device.wake_ready.status.v2': CrossDeviceWakeReadyV2;
  'cross_device.offline_queue.status.v2': CrossDeviceOfflineQueueItemV2;
  'cross_device.handoff.status.v2': CrossDeviceHandoffIntentV2;
  'cross_device.result_card.updated.v2': SharedResultCardV2;
  'cross_device.audio_handoff.status.v2': CrossDeviceAudioHandoffV2;
  'cross_device.pc_status.updated.v2': CrossDevicePcStatusV2;
  'capsule.updated.v2': CapsulePresentationV2;
  'mission.updated.v2': MissionPresentationV2;
  'desktop.observation.v2': DesktopObservationV2;
  'desktop.action.requested.v2': DesktopActionV2;
  'desktop.action.dispatch.v2': ActionDispatchV2;
  'desktop.action.verification.v2': ActionVerificationV2;
  'desktop.retry.decision.v2': RetryDecisionV2;
}

export type TypedRealtimeEnvelopeV2<K extends RealtimeEventName = RealtimeEventName> = {
  [P in K]: RealtimeEnvelopeV2_1<RealtimePayloadMapV2[P]> & { event: P }
}[K];

export interface CapsuleV2 {
  id: string;
  kind: 'task' | 'research' | 'playbook' | 'device' | 'transfer';
  title: string;
  status: string;
  revision: number;
  updatedAt: string;
  skill?: SkillRef;
}

export interface CapsuleQuickActionV2 {
  actionId: string;
  label: string;
  kind: 'open' | 'pause' | 'resume' | 'cancel' | 'retry' | 'approve' | 'dismiss';
  requiresApproval: boolean;
  enabled: boolean;
}

export interface ResultCardV2 {
  title: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failure' | 'cancelled';
  artifactIds: string[];
  completedAt?: string;
}

export interface CapsulePresentationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  capsuleId: string;
  mode: 'compact' | 'expanded' | 'mission';
  visibility: 'visible' | 'hidden' | 'minimized';
  fullscreen: boolean;
  quickActions: CapsuleQuickActionV2[];
  queuePosition?: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  resultCard?: ResultCardV2;
}

export interface MissionViewV2 {
  missionId: string;
  title: string;
  status: CanonicalTaskStatus;
  progress: TaskProgressSnapshot;
  capsules: CapsuleV2[];
  updatedAt: string;
}

export interface MissionPresentationV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  missionId: string;
  mode: 'compact' | 'expanded' | 'mission';
  visibility: 'visible' | 'hidden' | 'minimized';
  fullscreen: boolean;
  focusedCapsuleId?: string;
  queueOrder: string[];
  quickActions: CapsuleQuickActionV2[];
  resultCard?: ResultCardV2;
}

export type ResearchModeV2 = 'FAST' | 'DEEP' | 'BROWSER';

export interface ResearchSourceSafetyV2 {
  schemeValidated: boolean;
  redirectsValidated: boolean;
  resolvedTargetClass: 'public' | 'private' | 'loopback' | 'link_local' | 'local' | 'unknown';
  retrievedByBackend: boolean;
  ssrfPolicyVersion: string;
  decision?: 'allowed' | 'blocked';
  reasonCodes?: string[];
  validatedAt?: string;
  validatorId?: string;
  redirectCount?: number;
}

export interface ResearchSourceV2 {
  sourceId: string;
  url: string;
  title?: string;
  publisher?: string;
  retrievedAt: string;
  publishedAt?: string;
  contentSha256?: string;
  safety: ResearchSourceSafetyV2;
  canonicalUrl?: string;
  acquisition?: 'search_api' | 'browser' | 'direct_fetch' | 'owner_provided';
  retriever?: SkillRef;
  provenanceId?: string;
}

export interface ResearchCitationV2 {
  citationId: string;
  sourceId: string;
  locator?: string;
  excerptSha256?: string;
}

export interface ResearchClaimV2 {
  claimId: string;
  statement: string;
  citationIds: string[];
  confidence: number;
  uncertainty?: string;
  status?: 'supported' | 'contradicted' | 'uncertain';
  freshnessStatus?: ResearchFreshnessV2['status'];
}

export interface ResearchProvenanceV2 {
  generatedBy: string;
  generatedAt: string;
  sourceIds: string[];
  methodology: string;
}

export interface ResearchFreshnessV2 {
  checkedAt: string;
  oldestSourceAt?: string;
  newestSourceAt?: string;
  staleAfter?: string;
  status: 'fresh' | 'mixed' | 'stale' | 'unknown';
}

export interface ResearchRunDeltaV2 {
  previousRunId: string;
  addedClaimIds: string[];
  changedClaimIds: string[];
  removedClaimIds: string[];
  summary: string;
}

export interface ResearchRunV2 {
  runId: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  sourceIds: string[];
  artifactIds: string[];
  startedAt?: string;
  completedAt?: string;
  mode?: ResearchModeV2;
  sources?: ResearchSourceV2[];
  citations?: ResearchCitationV2[];
  claims?: ResearchClaimV2[];
  provenance?: ResearchProvenanceV2;
  freshness?: ResearchFreshnessV2;
  confidence?: number;
  uncertainty?: string;
  priorRunDelta?: ResearchRunDeltaV2;
  contractVersion?: typeof TASK_CONTRACT_VERSION;
  amendment?: typeof EDITH_CONTRACT_AMENDMENT;
}

export interface ContractSchemaFieldV2 {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  enum?: Array<string | number | boolean>;
  properties?: Record<string, ContractSchemaFieldV2>;
  items?: ContractSchemaFieldV2;
}

export interface PlaybookRetryPolicyV2 {
  maxAttempts: number;
  backoffMs: number;
  retryableErrorCodes: string[];
}

export interface PlaybookVerificationV2 {
  required: boolean;
  criteria: string[];
  verifierId?: string;
}

export interface PlaybookUndoV2 {
  supported: boolean;
  toolId?: string;
  instructions?: string;
}

export interface PlaybookStepV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  stepId: string;
  title: string;
  objective?: string;
  dependsOn: string[];
  inputSchema: Record<string, ContractSchemaFieldV2>;
  outputSchema: Record<string, ContractSchemaFieldV2>;
  skills: SkillRef[];
  tools: string[];
  permissions: string[];
  riskLevel: 0 | 1 | 2 | 3 | 4 | 5;
  approval: 'none' | 'owner' | 'policy';
  approvalReason?: string;
  timeoutMs: number;
  retry: PlaybookRetryPolicyV2;
  verification: PlaybookVerificationV2;
  undo: PlaybookUndoV2;
}

export interface PlaybookDefinitionV2 {
  playbookId: string;
  version: string;
  title: string;
  skills: SkillRef[];
  stepIds: string[];
  steps?: PlaybookStepV2[];
  contractVersion?: typeof TASK_CONTRACT_VERSION;
  amendment?: typeof EDITH_CONTRACT_AMENDMENT;
}

export interface PlaybookRunV2 {
  runId: string;
  playbook: Pick<PlaybookDefinitionV2, 'playbookId' | 'version'>;
  taskId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepId?: string;
  startedAt?: string;
  completedAt?: string;
  stepRuns?: Array<{
    stepId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
    attempt: number;
    startedAt?: string;
    completedAt?: string;
    errorCode?: string;
    inputArtifactIds?: string[];
    outputArtifactIds?: string[];
    verificationStatus?: 'PASS' | 'FAIL' | 'PARTIAL' | 'RETRYABLE';
    undoStatus?: 'not_required' | 'available' | 'completed' | 'failed';
  }>;
  contractVersion?: typeof TASK_CONTRACT_VERSION;
  amendment?: typeof EDITH_CONTRACT_AMENDMENT;
}

type TimelineLike = {
  id?: unknown;
  type?: unknown;
  createdAt?: unknown;
  sequence?: unknown;
  revision?: unknown;
  contractVersion?: unknown;
};

type TaskLike = {
  id?: unknown;
  status?: unknown;
  contractVersion?: unknown;
  revision?: unknown;
  eventSequence?: unknown;
  timeline?: unknown;
  plan?: unknown;
  verification?: unknown;
  recoveryEvents?: unknown;
};

export type ParseResult<T> =
  | { success: true; value: T }
  | { success: false; errorCode: string; message: string };

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTaskStatus(value: unknown): ParseResult<CanonicalTaskStatus> {
  if (typeof value === 'string' && (EDITH_TASK_STATUSES as readonly string[]).includes(value)) {
    return { success: true, value: value as CanonicalTaskStatus };
  }
  return {
    success: false,
    errorCode: 'INVALID_TASK_STATUS',
    message: `status must be one of: ${EDITH_TASK_STATUSES.join(', ')}`,
  };
}

export function parseRealtimeEnvelope(value: unknown): ParseResult<RealtimeEnvelopeV2> {
  if (!isRecord(value)) {
    return { success: false, errorCode: 'INVALID_REALTIME_ENVELOPE', message: 'Realtime envelope must be an object.' };
  }
  const allowedEvents = Object.values(REALTIME_EVENT_NAMES) as string[];
  if (value.schema !== EDITH_CONTRACT_SCHEMA || value.version !== EDITH_CONTRACT_VERSION) {
    return { success: false, errorCode: 'UNSUPPORTED_CONTRACT_VERSION', message: 'Unsupported realtime contract version.' };
  }
  if (typeof value.event !== 'string' || !allowedEvents.includes(value.event)) {
    return { success: false, errorCode: 'INVALID_REALTIME_EVENT', message: 'Unknown realtime event name.' };
  }
  if (typeof value.eventId !== 'string' || !value.eventId || typeof value.occurredAt !== 'string') {
    return { success: false, errorCode: 'INVALID_REALTIME_ENVELOPE', message: 'eventId and occurredAt are required.' };
  }
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) {
    return { success: false, errorCode: 'INVALID_REALTIME_SEQUENCE', message: 'sequence must be a non-negative integer.' };
  }
  return { success: true, value: value as unknown as RealtimeEnvelopeV2 };
}

const FORBIDDEN_CONTRACT_KEYS = new Set([
  'secret', 'token', 'accesstoken', 'refreshtoken', 'sessiontoken', 'apikey', 'password',
  'privatekey', 'plaintextkey', 'encryptionkey', 'rawkey', 'keymaterial', 'rawproof',
  'proof', 'signature', 'credentialsecret', 'clientsecret', 'sharedsecret', 'sessionkey',
  'authorization', 'cookie', 'setcookie', 'bearer', '__proto__', 'prototype', 'constructor',
]);

function invalid<T>(errorCode: string, message: string): ParseResult<T> {
  return { success: false, errorCode, message };
}

function safeId(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f]/.test(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function containsSensitiveText(value: unknown): boolean {
  return typeof value === 'string' && [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]/i,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ].some((pattern) => pattern.test(value));
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

function finiteInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isV21(value: Record<string, unknown>): boolean {
  return value.contractVersion === TASK_CONTRACT_VERSION && value.amendment === EDITH_CONTRACT_AMENDMENT;
}

function findUnsafeContractField(value: unknown, path = '$', depth = 0): string | undefined {
  if (depth > 12) return `${path} exceeds maximum contract depth`;
  if (typeof value === 'string' && value.length > 100_000) return `${path} exceeds maximum string length`;
  if (Array.isArray(value)) {
    if (value.length > 10_000) return `${path} exceeds maximum array length`;
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = findUnsafeContractField(value[index], `${path}[${index}]`, depth + 1);
      if (unsafe) return unsafe;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 1_000) return `${path} exceeds maximum key count`;
  for (const [key, item] of entries) {
    if (FORBIDDEN_CONTRACT_KEYS.has(key.replace(/[_-]/g, '').toLocaleLowerCase('en-US'))) {
      return `${path}.${key} is forbidden in public contract metadata`;
    }
    const unsafe = findUnsafeContractField(item, `${path}.${key}`, depth + 1);
    if (unsafe) return unsafe;
  }
  return undefined;
}

function requireSafeRecord<T>(value: unknown, family: string): ParseResult<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return invalid(`${family}_INVALID`, `${family} must be an object.`);
  const unsafe = findUnsafeContractField(value);
  return unsafe ? invalid('FORBIDDEN_CONTRACT_FIELD', unsafe) : undefined;
}

export function validateNoSecretMaterial(value: unknown): ParseResult<true> {
  const unsafe = findUnsafeContractField(value);
  return unsafe ? invalid('FORBIDDEN_CONTRACT_FIELD', unsafe) : { success: true, value: true };
}

const DESKTOP_OPERATOR_STATES: DesktopOperatorStateV2[] = [
  'observing', 'planning', 'moving', 'clicking', 'typing', 'scrolling', 'verifying', 'success', 'error', 'stopped',
];
const DESKTOP_ACTION_KINDS: DesktopActionKindV2[] = ['moveMouse', 'clickMouse', 'typeText', 'pressKey', 'hotkey', 'scroll', 'launchApp'];
const DESKTOP_EFFECTS: DesktopExpectedEffectV2[] = ['cursor_moved', 'visual_change', 'foreground_window_changed', 'input_injected', 'process_started', 'none'];

function confidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function desktopPoint(value: unknown): value is DesktopPointV2 {
  return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);
}

function desktopBounds(value: unknown, expectedSpace?: DesktopBoundsV2['coordinateSpace']): value is DesktopBoundsV2 {
  return isRecord(value)
    && typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y)
    && Number.isSafeInteger(value.width) && Number(value.width) > 0 && Number(value.width) <= 65_536
    && Number.isSafeInteger(value.height) && Number(value.height) > 0 && Number(value.height) <= 65_536
    && ['logical', 'physical_virtual_desktop', 'window_relative'].includes(String(value.coordinateSpace))
    && (expectedSpace === undefined || value.coordinateSpace === expectedSpace);
}

function boundsContainPoint(bounds: DesktopBoundsV2, point: DesktopPointV2): boolean {
  return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
}

function boundsContainBounds(outer: DesktopBoundsV2, inner: DesktopBoundsV2): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function scaledBoundsMatch(logical: DesktopBoundsV2, physical: DesktopBoundsV2, dpiScale: number): boolean {
  const tolerance = 2;
  return Math.abs(physical.width - logical.width * dpiScale) <= tolerance
    && Math.abs(physical.height - logical.height * dpiScale) <= tolerance;
}

function desktopCapabilities(value: unknown): value is DesktopObservationCapabilitiesV2 {
  return isRecord(value) && ['screenshot', 'uia', 'accessibility', 'ocr', 'multiMonitor'].every((key) => typeof value[key] === 'boolean');
}

function timestampExpired(expiresAt: string, now?: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now ?? new Date().toISOString());
}

export function parseDesktopOperatorSessionV2(value: unknown, options: { now?: string } = {}): ParseResult<DesktopOperatorSessionV2> {
  const unsafe = requireSafeRecord(value, 'DESKTOP_SESSION');
  if (unsafe) return unsafe as ParseResult<DesktopOperatorSessionV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.sessionId) || !['tauri', 'unbound'].includes(String(row.runtime)) || !DESKTOP_OPERATOR_STATES.includes(row.state as DesktopOperatorStateV2)
    || !['read_only', 'owner_command', 'disabled', 'error'].includes(String(row.mode)) || !['active', 'inactive', 'unknown'].includes(String(row.killSwitch)) || !finiteInteger(row.currentGeneration)
    || !desktopCapabilities(row.capabilities) || !isoTimestamp(row.startedAt) || !isoTimestamp(row.updatedAt) || !isoTimestamp(row.expiresAt)) {
    return invalid('DESKTOP_SESSION_INVALID', 'Desktop session identity, state, capability, generation, or timestamp metadata is invalid.');
  }
  if (Date.parse(row.startedAt as string) >= Date.parse(row.expiresAt as string) || Date.parse(row.updatedAt as string) < Date.parse(row.startedAt as string)) {
    return invalid('DESKTOP_SESSION_TIME_INVALID', 'Desktop session timestamps are out of order.');
  }
  if (row.state !== 'stopped' && timestampExpired(row.expiresAt as string, options.now)) return invalid('DESKTOP_SESSION_EXPIRED', 'Desktop session has expired.');
  return { success: true, value: value as DesktopOperatorSessionV2 };
}

export function parseDesktopObservationV2(
  value: unknown,
  options: { now?: string; latestGeneration?: number; session?: DesktopOperatorSessionV2 } = {},
): ParseResult<DesktopObservationV2> {
  const unsafe = requireSafeRecord(value, 'DESKTOP_OBSERVATION');
  if (unsafe) return unsafe as ParseResult<DesktopObservationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.observationId) || !safeId(row.sessionId) || !finiteInteger(row.generation, 1)
    || !isoTimestamp(row.capturedAt) || !isoTimestamp(row.expiresAt) || !confidence(row.confidence)
    || !['windows_gdi_virtual_desktop', 'screen_capture', 'uia', 'accessibility', 'ocr', 'composite'].includes(String(row.source))
    || !desktopCapabilities(row.capabilities) || !isRecord(row.foreground) || !isRecord(row.virtualDesktop) || !isRecord(row.monitor)) {
    return invalid('DESKTOP_OBSERVATION_INVALID', 'Desktop observation identity, source, confidence, capability, or timestamp metadata is invalid.');
  }
  const foreground = row.foreground;
  const virtualDesktop = row.virtualDesktop;
  const monitor = row.monitor;
  if (!safeId(foreground.hwndFingerprint) || !finiteInteger(foreground.processId, 1)
    || !desktopBounds(foreground.logicalBounds, 'logical') || !desktopBounds(foreground.physicalBounds, 'physical_virtual_desktop')
    || !desktopPoint(virtualDesktop.origin) || !desktopBounds(virtualDesktop.logicalBounds, 'logical') || !desktopBounds(virtualDesktop.physicalBounds, 'physical_virtual_desktop')
    || !safeId(monitor.monitorId) || !desktopPoint(monitor.origin) || !desktopBounds(monitor.logicalBounds, 'logical') || !desktopBounds(monitor.physicalBounds, 'physical_virtual_desktop')
    || typeof monitor.dpiScale !== 'number' || !Number.isFinite(monitor.dpiScale) || monitor.dpiScale < 0.5 || monitor.dpiScale > 8) {
    return invalid('DESKTOP_OBSERVATION_BOUNDS_INVALID', 'Desktop observation window, monitor, virtual desktop, or DPI metadata is invalid.');
  }
  if (Date.parse(row.capturedAt as string) >= Date.parse(row.expiresAt as string) || timestampExpired(row.expiresAt as string, options.now)) {
    return invalid('STALE_DESKTOP_OBSERVATION', 'Desktop observation is stale or expired.');
  }
  if (options.latestGeneration !== undefined && row.generation !== options.latestGeneration) return invalid('STALE_DESKTOP_OBSERVATION', 'Desktop observation is not the latest generation.');
  if (options.session && (row.sessionId !== options.session.sessionId || row.generation !== options.session.currentGeneration || Date.parse(row.expiresAt as string) > Date.parse(options.session.expiresAt))) {
    return invalid('DESKTOP_OBSERVATION_SESSION_MISMATCH', 'Desktop observation is not bound to the active session generation.');
  }
  if (virtualDesktop.origin.x !== virtualDesktop.physicalBounds.x || virtualDesktop.origin.y !== virtualDesktop.physicalBounds.y
    || monitor.origin.x !== monitor.physicalBounds.x || monitor.origin.y !== monitor.physicalBounds.y
    || !boundsContainBounds(virtualDesktop.physicalBounds, foreground.physicalBounds)
    || !boundsContainBounds(virtualDesktop.physicalBounds, monitor.physicalBounds)
    || !scaledBoundsMatch(foreground.logicalBounds, foreground.physicalBounds, monitor.dpiScale)
    || !scaledBoundsMatch(monitor.logicalBounds, monitor.physicalBounds, monitor.dpiScale)) {
    return invalid('DESKTOP_COORDINATE_MISMATCH', 'Logical and physical desktop coordinates do not describe the same bounded target.');
  }
  return { success: true, value: value as DesktopObservationV2 };
}

export function parseSemanticTargetV2(value: unknown, observation?: DesktopObservationV2): ParseResult<SemanticTargetV2> {
  const unsafe = requireSafeRecord(value, 'SEMANTIC_TARGET');
  if (unsafe) return unsafe as ParseResult<SemanticTargetV2>;
  const row = value as Record<string, unknown>;
  const provenances: SemanticTargetProvenanceV2[] = ['uia', 'accessibility', 'window_relative', 'ocr', 'screenshot_coordinate'];
  if (!isV21(row) || !safeId(row.targetId) || !safeId(row.observationId) || !finiteInteger(row.observationGeneration, 1)
    || !provenances.includes(row.provenance as SemanticTargetProvenanceV2) || !confidence(row.confidence)) {
    return invalid('SEMANTIC_TARGET_INVALID', 'Semantic target identity, observation binding, provenance, or confidence is invalid.');
  }
  if (row.logicalBounds !== undefined && !desktopBounds(row.logicalBounds, 'logical')) return invalid('SEMANTIC_TARGET_BOUNDS_INVALID', 'Semantic target logical bounds are invalid.');
  if (row.physicalBounds !== undefined && !desktopBounds(row.physicalBounds, 'physical_virtual_desktop')) return invalid('SEMANTIC_TARGET_BOUNDS_INVALID', 'Semantic target physical bounds are invalid.');
  if (row.provenance === 'uia' && !safeId(row.automationIdFingerprint) && !safeId(row.runtimeIdFingerprint)) return invalid('SEMANTIC_TARGET_PROVENANCE_INVALID', 'UIA target requires a safe element fingerprint.');
  if (row.provenance === 'accessibility' && !safeId(row.role)) return invalid('SEMANTIC_TARGET_PROVENANCE_INVALID', 'Accessibility target requires a role.');
  if (row.provenance === 'window_relative' && (!desktopPoint(row.windowRelativePoint) || row.windowRelativePoint.x < 0 || row.windowRelativePoint.x > 1 || row.windowRelativePoint.y < 0 || row.windowRelativePoint.y > 1)) return invalid('SEMANTIC_TARGET_PROVENANCE_INVALID', 'Window-relative target requires normalized coordinates.');
  if (row.provenance === 'ocr' && (!safeId(row.textFingerprint) || !desktopBounds(row.physicalBounds, 'physical_virtual_desktop'))) return invalid('SEMANTIC_TARGET_PROVENANCE_INVALID', 'OCR target requires a text fingerprint and physical bounds.');
  if (row.provenance === 'screenshot_coordinate' && !desktopPoint(row.screenshotPoint)) return invalid('SEMANTIC_TARGET_PROVENANCE_INVALID', 'Screenshot target requires a physical point.');
  if (observation) {
    if (row.observationId !== observation.observationId || row.observationGeneration !== observation.generation) return invalid('SEMANTIC_TARGET_OBSERVATION_MISMATCH', 'Semantic target is bound to another observation generation.');
    if (desktopPoint(row.screenshotPoint) && !boundsContainPoint(observation.foreground.physicalBounds, row.screenshotPoint)) return invalid('DESKTOP_COORDINATE_MISMATCH', 'Screenshot target is outside the observed foreground window.');
    if (desktopBounds(row.physicalBounds, 'physical_virtual_desktop') && !boundsContainBounds(observation.foreground.physicalBounds, row.physicalBounds)) return invalid('DESKTOP_COORDINATE_MISMATCH', 'Semantic target bounds are outside the observed foreground window.');
  }
  return { success: true, value: value as SemanticTargetV2 };
}

export function parseScopedApprovalV2(
  value: unknown,
  options: { now?: string; observation?: DesktopObservationV2 } = {},
): ParseResult<ScopedApprovalV2> {
  const unsafe = requireSafeRecord(value, 'SCOPED_APPROVAL');
  if (unsafe) return unsafe as ParseResult<ScopedApprovalV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.approvalId) || !safeId(row.sessionId) || !safeId(row.observationId) || !finiteInteger(row.observationGeneration, 1)
    || row.grantedBy !== 'owner' || !isoTimestamp(row.grantedAt) || !isoTimestamp(row.expiresAt)
    || !['active', 'consumed', 'revoked', 'expired'].includes(String(row.status)) || !Array.isArray(row.consumedActionIds) || !row.consumedActionIds.every((id) => safeId(id)) || !isRecord(row.scope)) {
    return invalid('SCOPED_APPROVAL_INVALID', 'Scoped approval identity, lifecycle, or observation binding is invalid.');
  }
  const scope = row.scope;
  if (!Array.isArray(scope.actions) || scope.actions.length === 0 || !scope.actions.every((action) => DESKTOP_ACTION_KINDS.includes(action as DesktopActionKindV2))
    || new Set(scope.actions).size !== scope.actions.length || !finiteInteger(scope.maxActions, 1) || Number(scope.maxActions) > 100
    || (scope.targetIds !== undefined && (!Array.isArray(scope.targetIds) || scope.targetIds.length === 0 || !scope.targetIds.every((id) => safeId(id))))
    || (scope.physicalBounds !== undefined && !desktopBounds(scope.physicalBounds, 'physical_virtual_desktop'))) {
    return invalid('SCOPED_APPROVAL_SCOPE_INVALID', 'Scoped approval must name bounded actions, targets, coordinates, and use count.');
  }
  if (Date.parse(row.grantedAt as string) >= Date.parse(row.expiresAt as string) || row.status !== 'active' || timestampExpired(row.expiresAt as string, options.now)) return invalid('SCOPED_APPROVAL_EXPIRED', 'Scoped approval is not active or has expired.');
  if (row.consumedActionIds.length >= Number(scope.maxActions)) return invalid('SCOPED_APPROVAL_CONSUMED', 'Scoped approval action budget is consumed.');
  if (options.observation && (row.sessionId !== options.observation.sessionId || row.observationId !== options.observation.observationId || row.observationGeneration !== options.observation.generation)) return invalid('SCOPED_APPROVAL_OBSERVATION_MISMATCH', 'Scoped approval is bound to another observation generation.');
  return { success: true, value: value as ScopedApprovalV2 };
}

export function parseDesktopActionV2(
  value: unknown,
  options: { now?: string; observation?: DesktopObservationV2; approval?: ScopedApprovalV2 } = {},
): ParseResult<DesktopActionV2> {
  const unsafe = requireSafeRecord(value, 'DESKTOP_ACTION');
  if (unsafe) return unsafe as ParseResult<DesktopActionV2>;
  const row = value as Record<string, unknown>;
  if ('text' in row) return invalid('DESKTOP_ACTION_RAW_TEXT_FORBIDDEN', 'Desktop action contracts may carry only typed-text length and fingerprint metadata.');
  if (!isV21(row) || !safeId(row.actionId) || !safeId(row.idempotencyKey) || !safeId(row.sessionId) || !safeId(row.approvalId)
    || !safeId(row.observationId) || !finiteInteger(row.observationGeneration, 1) || !DESKTOP_ACTION_KINDS.includes(row.kind as DesktopActionKindV2)
    || !DESKTOP_EFFECTS.includes(row.expectedEffect as DesktopExpectedEffectV2) || !isoTimestamp(row.deadlineAt) || !isRecord(row.retryBudget)) {
    return invalid('DESKTOP_ACTION_INVALID', 'Desktop action identity, generation binding, expected effect, or deadline is invalid.');
  }
  const retry = row.retryBudget;
  if (![1, 2].includes(Number(retry.maxAttempts)) || !finiteInteger(retry.attempt, 1) || Number(retry.attempt) > Number(retry.maxAttempts)
    || !finiteInteger(retry.backoffMs) || Number(retry.backoffMs) > 30_000) return invalid('DESKTOP_RETRY_BUDGET_INVALID', 'Desktop action retry budget must be bounded to one or two attempts.');
  if (timestampExpired(row.deadlineAt as string, options.now)) return invalid('DESKTOP_ACTION_DEADLINE_EXPIRED', 'Desktop action deadline has expired.');
  if (row.target !== undefined) {
    const target = parseSemanticTargetV2(row.target, options.observation);
    if (!target.success) return target as ParseResult<DesktopActionV2>;
    if (target.value.observationId !== row.observationId || target.value.observationGeneration !== row.observationGeneration) return invalid('DESKTOP_ACTION_GENERATION_UNBOUND', 'Desktop action and target must bind the same observation generation.');
  }
  if (row.coordinates !== undefined && !desktopPoint(row.coordinates)) return invalid('DESKTOP_ACTION_COORDINATES_INVALID', 'Desktop action coordinates are invalid.');
  if (['moveMouse', 'clickMouse'].includes(String(row.kind)) && !desktopPoint(row.coordinates) && row.target === undefined) return invalid('DESKTOP_ACTION_COORDINATES_INVALID', 'Pointer actions require coordinates or a semantic target.');
  if (row.kind === 'clickMouse' && row.button !== undefined && !['left', 'right', 'middle'].includes(String(row.button))) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Mouse button is invalid.');
  if (row.kind === 'typeText' && (!finiteInteger(row.textLength, 1) || !safeId(row.textFingerprint))) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Typed text requires length and a safe fingerprint, never raw text.');
  if (row.kind === 'pressKey' && !safeId(row.key, 64)) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Key action requires a bounded key name.');
  if (row.kind === 'hotkey' && (!Array.isArray(row.keys) || row.keys.length < 2 || row.keys.length > 5 || !row.keys.every((key) => safeId(key, 64)))) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Hotkey action requires two to five bounded key names.');
  if (row.kind === 'scroll' && (typeof row.scrollDelta !== 'number' || !Number.isSafeInteger(row.scrollDelta) || row.scrollDelta === 0 || Math.abs(row.scrollDelta) > 10_000)) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Scroll action requires a bounded non-zero delta.');
  if (row.kind === 'launchApp' && !safeId(row.applicationId)) return invalid('DESKTOP_ACTION_PARAMETERS_INVALID', 'Launch action requires an approved application ID.');
  if (options.observation) {
    if (row.sessionId !== options.observation.sessionId || row.observationId !== options.observation.observationId || row.observationGeneration !== options.observation.generation) return invalid('DESKTOP_ACTION_GENERATION_UNBOUND', 'Desktop action is not bound to the supplied observation generation.');
    if (desktopPoint(row.coordinates) && !boundsContainPoint(options.observation.foreground.physicalBounds, row.coordinates)) return invalid('DESKTOP_COORDINATE_MISMATCH', 'Desktop action coordinates are outside the observed foreground window.');
    if (Date.parse(row.deadlineAt as string) > Date.parse(options.observation.expiresAt)) return invalid('DESKTOP_ACTION_DEADLINE_INVALID', 'Desktop action deadline exceeds observation expiry.');
  }
  if (options.approval) {
    if (row.approvalId !== options.approval.approvalId || row.sessionId !== options.approval.sessionId || row.observationId !== options.approval.observationId || row.observationGeneration !== options.approval.observationGeneration) return invalid('DESKTOP_ACTION_APPROVAL_MISMATCH', 'Desktop action is outside the approval observation scope.');
    if (!options.approval.scope.actions.includes(row.kind as DesktopActionKindV2)) return invalid('DESKTOP_ACTION_NOT_APPROVED', 'Desktop action kind is outside the approval scope.');
    const targetId = isRecord(row.target) ? row.target.targetId : undefined;
    if (options.approval.scope.targetIds && (!safeId(targetId) || !options.approval.scope.targetIds.includes(targetId))) return invalid('DESKTOP_ACTION_NOT_APPROVED', 'Desktop target is outside the approval scope.');
    if (options.approval.scope.physicalBounds && desktopPoint(row.coordinates) && !boundsContainPoint(options.approval.scope.physicalBounds, row.coordinates)) return invalid('DESKTOP_COORDINATE_MISMATCH', 'Desktop coordinates are outside the approval scope.');
    if (Date.parse(row.deadlineAt as string) > Date.parse(options.approval.expiresAt)) return invalid('DESKTOP_ACTION_DEADLINE_INVALID', 'Desktop action deadline exceeds approval expiry.');
  }
  return { success: true, value: value as DesktopActionV2 };
}

export function parseActionDispatchV2(value: unknown): ParseResult<ActionDispatchV2> {
  const unsafe = requireSafeRecord(value, 'ACTION_DISPATCH');
  if (unsafe) return unsafe as ParseResult<ActionDispatchV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.dispatchId) || !safeId(row.actionId) || !safeId(row.idempotencyKey) || !safeId(row.sessionId) || !safeId(row.approvalId)
    || !safeId(row.observationId) || !finiteInteger(row.observationGeneration, 1) || !['accepted', 'dispatched', 'rejected', 'failed'].includes(String(row.status))
    || !finiteInteger(row.attempt, 1) || Number(row.attempt) > 2 || !isoTimestamp(row.dispatchedAt)) return invalid('ACTION_DISPATCH_INVALID', 'Action dispatch identity, status, attempt, or observation binding is invalid.');
  if (['rejected', 'failed'].includes(String(row.status)) && !safeId(row.errorCode)) return invalid('ACTION_DISPATCH_ERROR_REQUIRED', 'Rejected or failed dispatch requires an error code.');
  return { success: true, value: value as ActionDispatchV2 };
}

export function parseActionVerificationV2(value: unknown): ParseResult<ActionVerificationV2> {
  const unsafe = requireSafeRecord(value, 'ACTION_VERIFICATION');
  if (unsafe) return unsafe as ParseResult<ActionVerificationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.verificationId) || !safeId(row.actionId) || !safeId(row.dispatchId) || !DESKTOP_EFFECTS.includes(row.expectedEffect as DesktopExpectedEffectV2)
    || !safeId(row.preObservationId) || !finiteInteger(row.preObservationGeneration, 1) || !['verified', 'partial', 'failed', 'pending_post_observation'].includes(String(row.status))
    || !Array.isArray(row.evidence) || row.evidence.length > 16 || !confidence(row.confidence) || !isoTimestamp(row.verifiedAt)) return invalid('ACTION_VERIFICATION_INVALID', 'Action verification identity, status, evidence, confidence, or timestamp is invalid.');
  if (row.evidence.some((item) => !isRecord(item) || !['cursor_position', 'foreground_window_changed', 'visual_change', 'input_injected', 'process_started'].includes(String(item.kind)) || typeof item.matched !== 'boolean' || (item.confidence !== undefined && !confidence(item.confidence)))) return invalid('ACTION_VERIFICATION_EVIDENCE_INVALID', 'Action verification evidence is invalid.');
  const hasPostId = row.postObservationId !== undefined;
  const hasPostGeneration = row.postObservationGeneration !== undefined;
  if (hasPostId !== hasPostGeneration || (hasPostId && (!safeId(row.postObservationId) || !finiteInteger(row.postObservationGeneration, 1) || Number(row.postObservationGeneration) <= Number(row.preObservationGeneration)))) return invalid('ACTION_VERIFICATION_GENERATION_INVALID', 'Post-observation identity and a newer generation must be supplied together.');
  if (row.status !== 'pending_post_observation' && row.expectedEffect !== 'input_injected' && row.expectedEffect !== 'process_started' && !hasPostId) return invalid('ACTION_VERIFICATION_POST_OBSERVATION_REQUIRED', 'Observed effects require a newer post-observation.');
  return { success: true, value: value as ActionVerificationV2 };
}

export function parseRetryDecisionV2(value: unknown): ParseResult<RetryDecisionV2> {
  const unsafe = requireSafeRecord(value, 'RETRY_DECISION');
  if (unsafe) return unsafe as ParseResult<RetryDecisionV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.decisionId) || !safeId(row.actionId) || !['retry', 'stop', 'succeed', 'require_approval', 'reobserve'].includes(String(row.decision))
    || !finiteInteger(row.attempt, 1) || ![1, 2].includes(Number(row.maxAttempts)) || Number(row.attempt) > Number(row.maxAttempts)
    || !safeId(row.reasonCode) || typeof row.requiresFreshObservation !== 'boolean' || !isoTimestamp(row.decidedAt)
    || (row.nextAttemptAt !== undefined && !isoTimestamp(row.nextAttemptAt))) return invalid('RETRY_DECISION_INVALID', 'Retry decision identity, bounded attempts, reason, or timestamp is invalid.');
  if (row.decision === 'retry' && (Number(row.attempt) >= Number(row.maxAttempts) || row.requiresFreshObservation || !isoTimestamp(row.nextAttemptAt))) return invalid('RETRY_BUDGET_EXHAUSTED', 'Retry requires remaining budget, no stale observation, and a next-attempt timestamp.');
  if (row.decision === 'reobserve' && row.requiresFreshObservation !== true) return invalid('RETRY_DECISION_INVALID', 'Reobserve decisions must require a fresh observation.');
  return { success: true, value: value as RetryDecisionV2 };
}

function validStatus(value: unknown): value is CanonicalTaskStatus {
  return parseTaskStatus(value).success;
}

function parseTaskEventPayload(type: TaskEventTypeV2, payload: unknown): ParseResult<TaskEventPayloadMapV2[TaskEventTypeV2]> {
  if (!isRecord(payload)) return invalid('INVALID_TASK_EVENT_PAYLOAD', `${type} payload must be an object.`);
  switch (type) {
    case 'task.created':
      if (!validStatus(payload.status)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'task.created requires a valid status.');
      break;
    case 'task.status_changed':
      if (!validStatus(payload.fromStatus) || !validStatus(payload.toStatus)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Status transition requires valid fromStatus and toStatus.');
      break;
    case 'task.step_updated':
      if (!safeId(payload.stepId) || !safeId(payload.status)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Step update requires stepId and status.');
      break;
    case 'task.tool_started':
      if (!safeId(payload.toolId) || !safeId(payload.runId)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Tool start requires toolId and runId.');
      break;
    case 'task.tool_completed':
      if (!safeId(payload.toolId) || !safeId(payload.runId) || !['success', 'failure', 'cancelled'].includes(String(payload.outcome))) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Tool completion metadata is invalid.');
      break;
    case 'task.verification_completed':
      if (!safeId(payload.verificationId) || !['PASS', 'FAIL', 'PARTIAL', 'RETRYABLE'].includes(String(payload.status))) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Verification payload is invalid.');
      break;
    case 'task.recovery_started':
      if (!safeId(payload.recoveryId) || !finiteInteger(payload.attempt, 1) || !safeId(payload.classification)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Recovery payload is invalid.');
      break;
    case 'task.failed':
      if (!safeId(payload.errorCode) || typeof payload.retryable !== 'boolean') return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Failure payload requires errorCode and retryable.');
      break;
    case 'task.completed':
      if (payload.resultArtifactIds !== undefined && (!Array.isArray(payload.resultArtifactIds) || !payload.resultArtifactIds.every((item) => safeId(item)))) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Completed artifact IDs are invalid.');
      break;
    case 'task.cancelled':
      if (payload.reasonCode !== undefined && !safeId(payload.reasonCode)) return invalid('INVALID_TASK_EVENT_PAYLOAD', 'Cancellation reasonCode is invalid.');
      break;
  }
  return { success: true, value: payload as unknown as TaskEventPayloadMapV2[TaskEventTypeV2] };
}

export function parseTaskEventV2(value: unknown): ParseResult<TypedTaskEventV2> {
  const unsafe = requireSafeRecord(value, 'TASK_EVENT');
  if (unsafe) return unsafe as ParseResult<TypedTaskEventV2>;
  const event = value as Record<string, unknown>;
  if (!safeId(event.taskId) || !safeId(event.eventId) || !finiteInteger(event.sequence, 1) || !finiteInteger(event.revision, 1) || !isoTimestamp(event.occurredAt)) {
    return invalid('INVALID_TASK_EVENT', 'Task event identity, sequence, revision, or timestamp is invalid.');
  }
  if (!safeId(event.type) || !(event.type in TASK_EVENT_PAYLOAD_VALIDATORS)) return invalid('UNKNOWN_TASK_EVENT_TYPE', 'Unknown task event type.');
  if (!isRecord(event.context) || !safeId(event.context.correlationId) || !safeId(event.context.idempotencyKey)) return invalid('INVALID_TASK_EVENT_CONTEXT', 'Task event context requires correlationId and idempotencyKey.');
  if (event.context.causationId === event.eventId) return invalid('INVALID_CAUSATION', 'An event cannot cause itself.');
  if (event.context.fromStatus !== undefined && !validStatus(event.context.fromStatus) || event.context.toStatus !== undefined && !validStatus(event.context.toStatus)) return invalid('INVALID_TASK_EVENT_CONTEXT', 'Task event context statuses are invalid.');
  if (event.context.streamId !== undefined && !safeId(event.context.streamId) || event.context.cursor !== undefined && !finiteInteger(event.context.cursor)) return invalid('INVALID_TASK_EVENT_CONTEXT', 'Task event stream context is invalid.');
  const payload = parseTaskEventPayload(event.type as TaskEventTypeV2, event.payload);
  if (!payload.success) return payload as ParseResult<TypedTaskEventV2>;
  if (event.type === 'task.status_changed') {
    const body = event.payload as Record<string, unknown>;
    if (event.context.fromStatus !== body.fromStatus || event.context.toStatus !== body.toStatus) return invalid('STATUS_CONTEXT_MISMATCH', 'Status context must match status payload.');
  }
  return { success: true, value: value as TypedTaskEventV2 };
}

export const TASK_EVENT_PAYLOAD_VALIDATORS: Record<TaskEventTypeV2, (value: unknown) => boolean> = {
  'task.created': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.created', value).success,
  'task.status_changed': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.status_changed', value).success,
  'task.step_updated': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.step_updated', value).success,
  'task.tool_started': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.tool_started', value).success,
  'task.tool_completed': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.tool_completed', value).success,
  'task.verification_completed': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.verification_completed', value).success,
  'task.recovery_started': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.recovery_started', value).success,
  'task.completed': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.completed', value).success,
  'task.failed': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.failed', value).success,
  'task.cancelled': (value) => validateNoSecretMaterial(value).success && parseTaskEventPayload('task.cancelled', value).success,
};

export function parseDeviceCapabilitiesV2(value: unknown): ParseResult<DeviceCapabilitiesV2> {
  const unsafe = requireSafeRecord(value, 'DEVICE_CAPABILITIES');
  if (unsafe) return unsafe as ParseResult<DeviceCapabilitiesV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('DEVICE_CAPABILITIES_VERSION_REQUIRED', 'Device capabilities require V2.1 metadata.');
  const requiredBooleans = ['realtime', 'fileTransfer', 'notifications', 'camera', 'microphone', 'computerControl', 'browserControl'];
  if (!requiredBooleans.every((key) => typeof row[key] === 'boolean')) return invalid('DEVICE_CAPABILITIES_INVALID', 'Required device capability flags must be boolean.');
  if (row.maxChunkSizeBytes !== undefined && !finiteInteger(row.maxChunkSizeBytes, 1)) return invalid('DEVICE_CAPABILITIES_INVALID', 'maxChunkSizeBytes must be a positive integer.');
  return { success: true, value: value as DeviceCapabilitiesV2 };
}

const MOBILE_REMOTE_COMMAND_NAMES: MobileRemoteCommandNameV2[] = [
  'task.list', 'task.detail', 'task.activity', 'task.create_low_risk', 'task.pause', 'task.resume', 'task.cancel', 'emergency_stop',
  'file.upload', 'file.download', 'clipboard.publish', 'clipboard.consume', 'live_view.start', 'live_view.stop', 'wake.request',
  'offline_queue.manage', 'handoff.manage', 'result_card.read', 'audio_handoff.manage', 'pc_status.read',
];

function base64urlText(value: unknown, maximum = 100_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value);
}

function base64Text(value: unknown, maximum = 16_384): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function decodeBase64Bytes(value: string): number[] | undefined {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) return undefined;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  return bytes;
}

function decodeBase64urlText(value: string): string | undefined {
  if (!base64urlText(value, 16_384)) return undefined;
  const standard = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = decodeBase64Bytes(standard);
  if (!bytes) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return undefined; }
}

function containsBytes(value: number[], expected: number[]): boolean {
  return value.some((_, start) => expected.every((byte, offset) => value[start + offset] === byte));
}

function spkiMatchesAlgorithm(value: string, algorithm: MobilePublicKeyV2['algorithm']): boolean {
  const bytes = decodeBase64Bytes(value);
  if (!bytes || bytes[0] !== 0x30) return false;
  const ecPublicKey = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
  const prime256v1 = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  if (algorithm === 'ECDSA-P256-SHA256' || algorithm === 'ECDH-P256') return containsBytes(bytes, ecPublicKey) && containsBytes(bytes, prime256v1);
  const oid = algorithm === 'Ed25519' ? [0x06, 0x03, 0x2b, 0x65, 0x70] : [0x06, 0x03, 0x2b, 0x65, 0x6e];
  return containsBytes(bytes, oid);
}

function mobileSuite(value: unknown): value is MobileCryptoSuiteV2 {
  return MOBILE_CRYPTO_SUITES.includes(value as MobileCryptoSuiteV2);
}

export function isSafeTransferFileNameV2(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value) return false;
  if (/[\\/:*?"<>|]/.test(value) || /%2f|%5c/i.test(value) || value === '.' || value === '..' || value.includes('..')) return false;
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

export function parseMobilePublicKeyV2(value: unknown): ParseResult<MobilePublicKeyV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_PUBLIC_KEY');
  if (unsafe) return unsafe as ParseResult<MobilePublicKeyV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !['ECDSA-P256-SHA256', 'ECDH-P256', 'Ed25519', 'X25519'].includes(String(row.algorithm)) || !['jwk', 'spki_der_base64'].includes(String(row.encoding)) || !sha256(row.fingerprint)) {
    return invalid('MOBILE_PUBLIC_KEY_INVALID', 'Mobile public key metadata is invalid.');
  }
  if (row.encoding === 'spki_der_base64') {
    if (!base64Text(row.value) || !spkiMatchesAlgorithm(row.value, row.algorithm as MobilePublicKeyV2['algorithm'])) return invalid('MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH', 'SPKI public key algorithm or curve does not match its declaration.');
  } else {
    if (!isRecord(row.value) || Object.prototype.hasOwnProperty.call(row.value, 'd')) return invalid('MOBILE_PUBLIC_KEY_PRIVATE_MATERIAL_FORBIDDEN', 'JWK public keys must not contain private key material.');
    const key = row.value;
    const p256 = row.algorithm === 'ECDSA-P256-SHA256' || row.algorithm === 'ECDH-P256';
    if (p256 && (key.kty !== 'EC' || key.crv !== 'P-256' || !base64urlText(key.x, 256) || !base64urlText(key.y, 256))) return invalid('MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH', 'P-256 keys require an EC P-256 public JWK.');
    if (!p256 && (key.kty !== 'OKP' || key.crv !== row.algorithm || !base64urlText(key.x, 256))) return invalid('MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH', 'OKP key metadata does not match the declared algorithm.');
  }
  return { success: true, value: value as MobilePublicKeyV2 };
}

function suiteMatchesKeys(suite: MobileCryptoSuiteV2, signing: MobilePublicKeyV2, agreement: MobilePublicKeyV2): boolean {
  return suite === 'P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM'
    ? signing.algorithm === 'ECDSA-P256-SHA256' && agreement.algorithm === 'ECDH-P256'
    : signing.algorithm === 'Ed25519' && agreement.algorithm === 'X25519';
}

export function parseMobileCryptoNegotiationV2(value: unknown): ParseResult<MobileCryptoNegotiationV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_CRYPTO_NEGOTIATION');
  if (unsafe) return unsafe as ParseResult<MobileCryptoNegotiationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || !Array.isArray(row.offeredSuites) || row.offeredSuites.length < 1 || !row.offeredSuites.every(mobileSuite) || new Set(row.offeredSuites).size !== row.offeredSuites.length) return invalid('MOBILE_CRYPTO_NEGOTIATION_INVALID', 'Mobile crypto suite offer is invalid.');
  if (!['selected', 'configuration_required', 'unsupported'].includes(String(row.status))) return invalid('MOBILE_CRYPTO_NEGOTIATION_INVALID', 'Mobile crypto negotiation status is invalid.');
  if (row.status === 'selected' && (!mobileSuite(row.selectedSuite) || !row.offeredSuites.includes(row.selectedSuite))) return invalid('MOBILE_CRYPTO_SUITE_UNSUPPORTED', 'Selected suite must be one of the offered suites.');
  if (row.status !== 'selected' && (!safeId(row.reasonCode) || row.selectedSuite !== undefined)) return invalid('MOBILE_CRYPTO_NEGOTIATION_REASON_REQUIRED', 'Unavailable crypto negotiation requires a reason code and no selected suite.');
  return { success: true, value: value as MobileCryptoNegotiationV2 };
}

export function parseMobileServerIdentityV2(value: unknown): ParseResult<MobileServerIdentityV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_SERVER_IDENTITY');
  if (unsafe) return unsafe as ParseResult<MobileServerIdentityV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || !safeId(row.serverId) || !safeId(row.workspaceId) || !Array.isArray(row.supportedSuites) || row.supportedSuites.length < 1 || !row.supportedSuites.every(mobileSuite)) return invalid('MOBILE_SERVER_IDENTITY_INVALID', 'Mobile server identity or supported suites are invalid.');
  if (!isRecord(row.capabilities)) return invalid('MOBILE_SERVER_CAPABILITIES_INVALID', 'Mobile server capabilities are required.');
  const capabilities = row.capabilities;
  if (capabilities.realtime !== true || capabilities.encryptedEnvelope !== true || capabilities.resumableFileTransfer !== true || capabilities.remoteTaskControl !== 'low_risk_allowlist' || capabilities.remoteView !== 'disabled' || capabilities.wakeOnLan !== 'configuration_required' || capabilities.pushNotifications !== 'configuration_required' || capabilities.destructiveDeviceControl !== 'disabled' || capabilities.tlsRequiredForRemoteTransport !== true) return invalid('MOBILE_SERVER_CAPABILITIES_INVALID', 'Mobile server capabilities must report safe operational states honestly.');
  if (capabilities.crossDevice !== undefined && (!isRecord(capabilities.crossDevice) || capabilities.crossDevice.clipboard !== 'available' || capabilities.crossDevice.offlineQueue !== 'available' || capabilities.crossDevice.smartHandoff !== 'available' || capabilities.crossDevice.resultCards !== 'available' || capabilities.crossDevice.audioHandoff !== 'available' || capabilities.crossDevice.mobileToPcTransfer !== 'available' || capabilities.crossDevice.pcToMobileTransfer !== 'configuration_required' || capabilities.crossDevice.liveView !== 'configuration_required' || capabilities.crossDevice.wakeOnLan !== 'configuration_required' || capabilities.crossDevice.pcStatus !== 'configuration_required')) return invalid('MOBILE_SERVER_CAPABILITIES_INVALID', 'Cross-device capabilities must distinguish available backend orchestration from missing native adapters.');
  return { success: true, value: value as MobileServerIdentityV2 };
}

export function parseMobilePairingRequestV2(value: unknown): ParseResult<MobilePairingRequestV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_PAIRING_REQUEST');
  if (unsafe) return unsafe as ParseResult<MobilePairingRequestV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || !isRecord(row.device) || !safeId(row.device.deviceId) || !safeId(row.device.displayName) || !['android', 'ios'].includes(String(row.device.platform))) return invalid('MOBILE_PAIRING_REQUEST_INVALID', 'Mobile pairing device identity is invalid.');
  if (!Array.isArray(row.supportedSuites) || row.supportedSuites.length < 1 || !row.supportedSuites.every(mobileSuite) || new Set(row.supportedSuites).size !== row.supportedSuites.length) return invalid('MOBILE_CRYPTO_SUITE_UNSUPPORTED', 'At least one supported mobile crypto suite is required.');
  const signing = parseMobilePublicKeyV2(row.signingKey);
  const agreement = parseMobilePublicKeyV2(row.agreementKey);
  if (!signing.success) return signing as ParseResult<MobilePairingRequestV2>;
  if (!agreement.success) return agreement as ParseResult<MobilePairingRequestV2>;
  if (!row.supportedSuites.some((suite) => suiteMatchesKeys(suite, signing.value, agreement.value))) return invalid('MOBILE_CRYPTO_SUITE_KEY_MISMATCH', 'Offered suites do not match the supplied public keys.');
  if (!Array.isArray(row.requestedCommands) || !row.requestedCommands.every((command) => MOBILE_REMOTE_COMMAND_NAMES.includes(command as MobileRemoteCommandNameV2))) return invalid('MOBILE_COMMAND_ALLOWLIST_INVALID', 'Requested commands are outside the mobile allowlist.');
  if (row.device.capabilities !== undefined && !parseDeviceCapabilitiesV2(row.device.capabilities).success) return invalid('MOBILE_DEVICE_CAPABILITIES_INVALID', 'Mobile device capabilities are invalid.');
  return { success: true, value: value as MobilePairingRequestV2 };
}

export function parseMobilePairingOfferV2(value: unknown): ParseResult<MobilePairingOfferV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_PAIRING_OFFER');
  if (unsafe) return unsafe as ParseResult<MobilePairingOfferV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || !isRecord(row.pairing) || !isRecord(row.server) || !isRecord(row.negotiation) || !isRecord(row.serverAgreementKey)) return invalid('MOBILE_PAIRING_OFFER_INVALID', 'Mobile pairing offer metadata is incomplete.');
  const pairing = parsePairingSessionV2(row.pairing);
  const server = parseMobileServerIdentityV2(row.server);
  const negotiation = parseMobileCryptoNegotiationV2(row.negotiation);
  const agreement = parseMobilePublicKeyV2(row.serverAgreementKey);
  if (!pairing.success || !server.success || !negotiation.success || !agreement.success) return invalid('MOBILE_PAIRING_OFFER_INVALID', 'Mobile pairing offer nested metadata is invalid.');
  if (negotiation.value.status !== 'selected' || !negotiation.value.selectedSuite || agreement.value.algorithm !== (negotiation.value.selectedSuite.startsWith('P256_') ? 'ECDH-P256' : 'X25519')) return invalid('MOBILE_PAIRING_OFFER_SUITE_MISMATCH', 'Server agreement key does not match the selected suite.');
  if (!base64urlText(row.challengeBase64url, 64) || String(row.challengeBase64url).length !== 43 || !base64urlText(row.transcriptBase64url, 16_384) || !sha256(row.transcriptFingerprint) || !sha256(row.signingKeyFingerprint) || !sha256(row.agreementKeyFingerprint) || !sha256(row.requestedCommandsFingerprint) || !/^\d{6}$/.test(String(row.ownerVerificationCode)) || !isoTimestamp(row.expiresAt) || row.expiresAt !== pairing.value.expiresAt) return invalid('MOBILE_PAIRING_OFFER_INVALID', 'Pairing challenge, transcript, verification code, or expiry is invalid.');
  const challenge = pairing.value.challenge;
  const expectedTranscript = challenge && negotiation.value.selectedSuite ? [
    'edith.mobile.pair.v1', server.value.serverId, server.value.workspaceId, pairing.value.pairingId,
    challenge.challengeId, pairing.value.device.deviceId, negotiation.value.selectedSuite,
    row.signingKeyFingerprint, row.agreementKeyFingerprint, agreement.value.fingerprint,
    row.requestedCommandsFingerprint, pairing.value.expiresAt, row.challengeBase64url,
  ].join('\n') : undefined;
  if (!expectedTranscript || decodeBase64urlText(String(row.transcriptBase64url)) !== expectedTranscript || challenge?.requestedCommandsFingerprint !== row.requestedCommandsFingerprint || pairing.value.device.fingerprint !== row.signingKeyFingerprint) return invalid('MOBILE_PAIRING_TRANSCRIPT_BINDING_INVALID', 'Pairing transcript does not match the canonical offer identities and keys.');
  return { success: true, value: value as MobilePairingOfferV2 };
}

export function parseMobilePairingProofSubmissionV2(value: unknown): ParseResult<MobilePairingProofSubmissionV2> {
  if (!isRecord(value)) return invalid('MOBILE_PAIRING_PROOF_INVALID', 'Pairing proof submission must be an object.');
  const metadata = { ...value };
  delete metadata.assertionBase64url;
  const unsafe = findUnsafeContractField(metadata);
  if (unsafe) return invalid('FORBIDDEN_CONTRACT_FIELD', unsafe);
  if (!isV21(value) || value.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || !safeId(value.pairingId) || !['challenge', 'consume'].includes(String(value.assertionType)) || !base64urlText(value.assertionBase64url, 2_048) || !sha256(value.payloadFingerprint) || !isoTimestamp(value.submittedAt)) return invalid('MOBILE_PAIRING_PROOF_INVALID', 'Pairing proof metadata or assertion encoding is invalid.');
  return { success: true, value: value as unknown as MobilePairingProofSubmissionV2 };
}

export function parseMobilePairingOwnerDecisionV2(value: unknown): ParseResult<MobilePairingOwnerDecisionV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_PAIRING_OWNER_DECISION');
  if (unsafe) return unsafe as ParseResult<MobilePairingOwnerDecisionV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !safeId(row.pairingId) || !['approved', 'rejected'].includes(String(row.decision)) || !Array.isArray(row.approvedCommands) || !row.approvedCommands.every((command) => MOBILE_REMOTE_COMMAND_NAMES.includes(command as MobileRemoteCommandNameV2)) || !isoTimestamp(row.decidedAt)) return invalid('MOBILE_PAIRING_OWNER_DECISION_INVALID', 'Pairing owner decision is invalid.');
  if (row.decision === 'rejected' && row.approvedCommands.length !== 0) return invalid('MOBILE_PAIRING_OWNER_DECISION_INVALID', 'Rejected pairing cannot approve commands.');
  return { success: true, value: value as MobilePairingOwnerDecisionV2 };
}

export function parseMobileCredentialMetadataV2(value: unknown): ParseResult<MobileCredentialMetadataV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_CREDENTIAL_METADATA');
  if (unsafe) return unsafe as ParseResult<MobileCredentialMetadataV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || ![row.credentialId, row.deviceId, row.sessionId, row.workspaceId].every((item) => safeId(item)) || !sha256(row.credentialFingerprint) || !isoTimestamp(row.issuedAt) || !isoTimestamp(row.expiresAt) || Date.parse(row.expiresAt as string) <= Date.parse(row.issuedAt as string)) return invalid('MOBILE_CREDENTIAL_METADATA_INVALID', 'Credential metadata is invalid.');
  if (row.rotatedFromId !== undefined && !safeId(row.rotatedFromId) || row.revokedAt !== undefined && !isoTimestamp(row.revokedAt)) return invalid('MOBILE_CREDENTIAL_METADATA_INVALID', 'Credential lifecycle metadata is invalid.');
  return { success: true, value: value as MobileCredentialMetadataV2 };
}

export function parseMobileDeviceSessionV2(value: unknown): ParseResult<MobileDeviceSessionV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_DEVICE_SESSION');
  if (unsafe) return unsafe as ParseResult<MobileDeviceSessionV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || ![row.sessionId, row.serverId, row.deviceId, row.workspaceId].every((item) => safeId(item)) || !mobileSuite(row.cryptoSuite) || !sha256(row.keyFingerprint) || !['active', 'rotating', 'revoked', 'expired', 'repair_required', 'configuration_required'].includes(String(row.status)) || !isoTimestamp(row.establishedAt) || !isoTimestamp(row.expiresAt)) return invalid('MOBILE_DEVICE_SESSION_INVALID', 'Mobile device session is invalid.');
  if (Date.parse(row.expiresAt as string) <= Date.parse(row.establishedAt as string)) return invalid('MOBILE_DEVICE_SESSION_INVALID', 'Mobile session expiry must follow establishment.');
  if (['repair_required', 'configuration_required'].includes(String(row.status)) && !safeId(row.errorCode)) return invalid('MOBILE_DEVICE_SESSION_ERROR_REQUIRED', 'Unavailable mobile sessions require an error code.');
  return { success: true, value: value as MobileDeviceSessionV2 };
}

export function parseMobileApplicationEnvelopeV2(value: unknown): ParseResult<MobileApplicationEnvelopeV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_APPLICATION_ENVELOPE');
  if (unsafe) return unsafe as ParseResult<MobileApplicationEnvelopeV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || row.aadVersion !== 'edith-mobile-aad-v1' || row.encryption !== 'AES-256-GCM' || !mobileSuite(row.cryptoSuite) || ![row.sessionId, row.serverId, row.deviceId, row.workspaceId, row.purpose].every((item) => safeId(item)) || !finiteInteger(row.sequence, 1) || !['client_to_server', 'server_to_client'].includes(String(row.direction)) || !['http', 'realtime', 'transfer'].includes(String(row.channel)) || !base64urlText(row.nonceBase64url, 32) || String(row.nonceBase64url).length !== 16 || !base64urlText(row.ciphertextBase64url) || !base64urlText(row.authTagBase64url, 64) || String(row.authTagBase64url).length !== 22) return invalid('MOBILE_APPLICATION_ENVELOPE_INVALID', 'Authenticated mobile envelope metadata is invalid.');
  return { success: true, value: value as MobileApplicationEnvelopeV2 };
}

export function parseMobilePairingConsumeResultV2(value: unknown): ParseResult<MobilePairingConsumeResultV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_PAIRING_CONSUME_RESULT');
  if (unsafe) return unsafe as ParseResult<MobilePairingConsumeResultV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || !isRecord(row.pairing) || !isRecord(row.session) || !isRecord(row.credentialEnvelope)) return invalid('MOBILE_PAIRING_CONSUME_RESULT_INVALID', 'Pairing consume result is incomplete.');
  const session = parseMobileDeviceSessionV2(row.session);
  const envelope = parseMobileApplicationEnvelopeV2(row.credentialEnvelope);
  const pairing = parsePairingSessionV2(row.pairing);
  if (!pairing.success) return pairing as ParseResult<MobilePairingConsumeResultV2>;
  if (!session.success) return session as ParseResult<MobilePairingConsumeResultV2>;
  if (!envelope.success) return envelope as ParseResult<MobilePairingConsumeResultV2>;
  if (envelope.value.sessionId !== session.value.sessionId || envelope.value.serverId !== session.value.serverId || envelope.value.deviceId !== session.value.deviceId || envelope.value.workspaceId !== session.value.workspaceId || envelope.value.cryptoSuite !== session.value.cryptoSuite || envelope.value.direction !== 'server_to_client' || envelope.value.purpose !== 'pairing.credential') return invalid('MOBILE_PAIRING_CONSUME_BINDING_INVALID', 'Credential envelope must be bound to the established session.');
  return { success: true, value: value as MobilePairingConsumeResultV2 };
}

export function parseMobileRemoteCommandV2(value: unknown): ParseResult<MobileRemoteCommandV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_REMOTE_COMMAND');
  if (unsafe) return unsafe as ParseResult<MobileRemoteCommandV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || ![row.commandId, row.deviceId, row.workspaceId, row.sessionId, row.idempotencyKey].every((item) => safeId(item)) || !MOBILE_REMOTE_COMMAND_NAMES.includes(row.command as MobileRemoteCommandNameV2) || !finiteInteger(row.sequence, 1) || ![0, 1].includes(Number(row.riskLevel)) || !isoTimestamp(row.issuedAt) || !isoTimestamp(row.expiresAt) || Date.parse(row.expiresAt as string) <= Date.parse(row.issuedAt as string)) return invalid('MOBILE_REMOTE_COMMAND_INVALID', 'Remote command identity, sequence, risk, or expiry is invalid.');
  if (Date.parse(row.expiresAt as string) <= Date.now()) return invalid('MOBILE_REMOTE_COMMAND_EXPIRED', 'Remote command has expired.');
  return { success: true, value: value as MobileRemoteCommandV2 };
}

export function parseMobileRemoteCommandResultV2(value: unknown): ParseResult<MobileRemoteCommandResultV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_REMOTE_COMMAND_RESULT');
  if (unsafe) return unsafe as ParseResult<MobileRemoteCommandResultV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || ![row.commandId, row.deviceId, row.workspaceId, row.sessionId].every((item) => safeId(item)) || !['completed', 'rejected', 'failed'].includes(String(row.status)) || !isoTimestamp(row.completedAt)) return invalid('MOBILE_REMOTE_COMMAND_RESULT_INVALID', 'Remote command result is invalid.');
  if (row.status !== 'completed' && !safeId(row.errorCode)) return invalid('MOBILE_REMOTE_COMMAND_RESULT_ERROR_REQUIRED', 'Rejected or failed command results require an error code.');
  return { success: true, value: value as MobileRemoteCommandResultV2 };
}

export function parseMobileEmergencyStopEventV2(value: unknown): ParseResult<MobileEmergencyStopEventV2> {
  const unsafe = requireSafeRecord(value, 'MOBILE_EMERGENCY_STOP_EVENT');
  if (unsafe) return unsafe as ParseResult<MobileEmergencyStopEventV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || ![row.eventId, row.deviceId, row.workspaceId, row.sessionId, row.reasonCode].every((item) => safeId(item)) || !isoTimestamp(row.activatedAt) || row.killSwitchActive !== true) return invalid('MOBILE_EMERGENCY_STOP_EVENT_INVALID', 'Emergency-stop event must prove an active kill switch and bound identities.');
  return { success: true, value: value as MobileEmergencyStopEventV2 };
}

export function parseEncryptedFileChunkV2(value: unknown): ParseResult<EncryptedFileChunkV2> {
  const unsafe = requireSafeRecord(value, 'ENCRYPTED_FILE_CHUNK');
  if (unsafe) return unsafe as ParseResult<EncryptedFileChunkV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row) || ![row.transferId, row.deviceId, row.sessionId, row.aadPurpose].every((item) => safeId(item)) || !finiteInteger(row.index) || !finiteInteger(row.plaintextSizeBytes, 1) || !sha256(row.plaintextSha256) || row.encryption !== 'application_envelope_aes_256_gcm' || row.aadPurpose !== `file.transfer.chunk:${String(row.transferId)}:${String(row.index)}`) return invalid('ENCRYPTED_FILE_CHUNK_INVALID', 'Encrypted file chunk metadata or application-envelope AAD binding is invalid.');
  return { success: true, value: value as EncryptedFileChunkV2 };
}

export function parseDeviceIdentityV2(value: unknown): ParseResult<DeviceIdentityV2> {
  const unsafe = requireSafeRecord(value, 'DEVICE_IDENTITY');
  if (unsafe) return unsafe as ParseResult<DeviceIdentityV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.deviceId) || !safeId(row.displayName) || !['windows', 'macos', 'linux', 'ios', 'android', 'web', 'unknown'].includes(String(row.platform))) return invalid('DEVICE_IDENTITY_INVALID', 'Device identity is invalid.');
  if (row.publicKey !== undefined && !safeId(row.publicKey, 16_384) || row.fingerprint !== undefined && !sha256(row.fingerprint) || row.capabilities !== undefined && !parseDeviceCapabilitiesV2(row.capabilities).success) return invalid('DEVICE_IDENTITY_INVALID', 'Device public metadata or capabilities are invalid.');
  return { success: true, value: value as DeviceIdentityV2 };
}

export function parsePairingSessionV2(value: unknown): ParseResult<PairingSessionV2> {
  const unsafe = requireSafeRecord(value, 'PAIRING_SESSION');
  if (unsafe) return unsafe as ParseResult<PairingSessionV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.pairingId) || !['requested', 'approved', 'rejected', 'expired', 'revoked'].includes(String(row.status)) || !isoTimestamp(row.createdAt) || !isoTimestamp(row.expiresAt) || Date.parse(row.expiresAt as string) <= Date.parse(row.createdAt as string)) return invalid('PAIRING_SESSION_INVALID', 'Pairing session identity, status, or expiry is invalid.');
  if (!parseDeviceIdentityV2(row.device).success || row.challenge !== undefined && !parsePairingChallengeV2(row.challenge).success || row.trust !== undefined && !parseDeviceTrustV2(row.trust).success || row.ownerBinding !== undefined && !parseOwnerSessionBindingV2(row.ownerBinding).success || row.negotiation !== undefined && !parseMobileCryptoNegotiationV2(row.negotiation).success || row.server !== undefined && !parseMobileServerIdentityV2(row.server).success) return invalid('PAIRING_SESSION_INVALID', 'Pairing session nested metadata is invalid.');
  return { success: true, value: value as PairingSessionV2 };
}

export function parsePairingChallengeV2(value: unknown): ParseResult<PairingChallengeV2> {
  const unsafe = requireSafeRecord(value, 'PAIRING_CHALLENGE');
  if (unsafe) return unsafe as ParseResult<PairingChallengeV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('PAIRING_CHALLENGE_VERSION_REQUIRED', 'Pairing challenge requires V2.1 metadata.');
  if (!safeId(row.challengeId) || !safeId(row.pairingId) || !safeId(row.deviceId) || !sha256(row.challengeFingerprint)) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing challenge identity or fingerprint is invalid.');
  if (!['SHA-256', 'HMAC-SHA-256', 'Ed25519', 'ECDSA-P256-SHA256'].includes(String(row.algorithm)) || row.oneTime !== true) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing challenge algorithm and oneTime metadata are required.');
  if (row.protocolVersion !== undefined && row.protocolVersion !== EDITH_MOBILE_PROTOCOL_VERSION || row.cryptoSuite !== undefined && !mobileSuite(row.cryptoSuite)) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing protocol or crypto suite is invalid.');
  if (row.requestedCommandsFingerprint !== undefined && !sha256(row.requestedCommandsFingerprint)) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing command allowlist fingerprint is invalid.');
  if (!isoTimestamp(row.issuedAt) || !isoTimestamp(row.expiresAt) || Date.parse(row.expiresAt) <= Date.parse(row.issuedAt)) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing challenge expiry must follow issue time.');
  if (row.proofFingerprint !== undefined && !sha256(row.proofFingerprint)) return invalid('PAIRING_CHALLENGE_INVALID', 'Proof fingerprint must be SHA-256.');
  if (row.status !== undefined && !['issued', 'proof_submitted', 'verified', 'consumed', 'rejected', 'expired', 'revoked'].includes(String(row.status))) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing challenge status is invalid.');
  if ((row.status === 'verified' || row.status === 'consumed') && (!sha256(row.proofFingerprint) || !isoTimestamp(row.verifiedAt))) return invalid('PAIRING_CHALLENGE_INVALID', 'Verified challenges require proof fingerprint and verifiedAt.');
  if (row.attempt !== undefined && (!finiteInteger(row.attempt) || !finiteInteger(row.maxAttempts, 1) || row.attempt > Number(row.maxAttempts))) return invalid('PAIRING_CHALLENGE_INVALID', 'Pairing attempt metadata is invalid.');
  if (row.status === 'consumed' && (!isoTimestamp(row.verifiedAt) || !isoTimestamp(row.consumedAt))) return invalid('PAIRING_CHALLENGE_INVALID', 'Consumed challenges require verification and consumption timestamps.');
  return { success: true, value: value as PairingChallengeV2 };
}

export function parseDeviceTrustV2(value: unknown): ParseResult<DeviceTrustV2> {
  const unsafe = requireSafeRecord(value, 'DEVICE_TRUST');
  if (unsafe) return unsafe as ParseResult<DeviceTrustV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('DEVICE_TRUST_VERSION_REQUIRED', 'Device trust requires V2.1 metadata.');
  if (!safeId(row.deviceId) || !sha256(row.fingerprint) || !['pending', 'trusted', 'revoked', 'expired'].includes(String(row.status))) return invalid('DEVICE_TRUST_INVALID', 'Device trust identity, fingerprint, or status is invalid.');
  if (row.status === 'trusted' && !isoTimestamp(row.trustedAt)) return invalid('DEVICE_TRUST_INVALID', 'Trusted devices require trustedAt.');
  if (row.status === 'revoked' && !isoTimestamp(row.revokedAt)) return invalid('DEVICE_TRUST_INVALID', 'Revoked devices require revokedAt.');
  if (row.status === 'expired' && !isoTimestamp(row.expiresAt)) return invalid('DEVICE_TRUST_INVALID', 'Expired devices require expiresAt.');
  if (row.reconnectCredentialFingerprint !== undefined && !sha256(row.reconnectCredentialFingerprint)) return invalid('DEVICE_TRUST_INVALID', 'Reconnect credential fingerprint must be SHA-256.');
  if ((row.reconnectCredentialId === undefined) !== (row.reconnectCredentialFingerprint === undefined)) return invalid('DEVICE_TRUST_INVALID', 'Reconnect credential ID and fingerprint must be provided together.');
  if (row.capabilities !== undefined && !parseDeviceCapabilitiesV2(row.capabilities).success) return invalid('DEVICE_TRUST_INVALID', 'Device trust capabilities are invalid.');
  return { success: true, value: value as DeviceTrustV2 };
}

export function parseOwnerSessionBindingV2(value: unknown): ParseResult<OwnerSessionBindingV2> {
  const unsafe = requireSafeRecord(value, 'OWNER_SESSION_BINDING');
  if (unsafe) return unsafe as ParseResult<OwnerSessionBindingV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('OWNER_SESSION_BINDING_VERSION_REQUIRED', 'Owner session binding requires V2.1 metadata.');
  if (![row.bindingId, row.ownerSessionId, row.deviceId, row.workspaceId].every((item) => safeId(item)) || !sha256(row.deviceFingerprint)) return invalid('OWNER_SESSION_BINDING_INVALID', 'Owner session binding identity is invalid.');
  if (!isoTimestamp(row.createdAt) || !isoTimestamp(row.expiresAt) || Date.parse(row.expiresAt) <= Date.parse(row.createdAt)) return invalid('OWNER_SESSION_BINDING_INVALID', 'Owner session binding timestamps are invalid.');
  if (row.status !== undefined && !['active', 'revoked', 'expired'].includes(String(row.status))) return invalid('OWNER_SESSION_BINDING_INVALID', 'Owner session binding status is invalid.');
  if (row.status === 'revoked' && !isoTimestamp(row.revokedAt)) return invalid('OWNER_SESSION_BINDING_INVALID', 'Revoked bindings require revokedAt.');
  return { success: true, value: value as OwnerSessionBindingV2 };
}

export function parseFileChunkManifestV2(value: unknown): ParseResult<FileChunkManifestV2> {
  const unsafe = requireSafeRecord(value, 'FILE_CHUNK_MANIFEST');
  if (unsafe) return unsafe as ParseResult<FileChunkManifestV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('FILE_CHUNK_MANIFEST_VERSION_REQUIRED', 'Chunk manifest requires V2.1 metadata.');
  if (!finiteInteger(row.chunkSizeBytes, 1) || !finiteInteger(row.totalChunks) || !sha256(row.fileSha256) || !Array.isArray(row.chunks) || row.chunks.length !== row.totalChunks) return invalid('FILE_CHUNK_MANIFEST_INVALID', 'Chunk manifest header is invalid.');
  let expectedOffset = 0;
  for (let index = 0; index < row.chunks.length; index += 1) {
    const chunk = row.chunks[index];
    if (!isRecord(chunk) || chunk.index !== index || chunk.offsetBytes !== expectedOffset || !finiteInteger(chunk.sizeBytes, 1) || !sha256(chunk.sha256)) return invalid('FILE_CHUNK_MANIFEST_INVALID', 'Chunks must be contiguous, ordered, and checksummed.');
    if (index < row.chunks.length - 1 && chunk.sizeBytes > row.chunkSizeBytes) return invalid('FILE_CHUNK_MANIFEST_INVALID', 'Chunk size exceeds chunkSizeBytes.');
    expectedOffset += chunk.sizeBytes;
  }
  if (row.sizeBytes !== undefined && row.sizeBytes !== expectedOffset) return invalid('FILE_CHUNK_MANIFEST_INVALID', 'Chunk sizes must sum to sizeBytes.');
  return { success: true, value: value as FileChunkManifestV2 };
}

export function parseTransferEncryptionV2(value: unknown): ParseResult<TransferEncryptionV2> {
  const unsafe = requireSafeRecord(value, 'TRANSFER_ENCRYPTION');
  if (unsafe) return unsafe as ParseResult<TransferEncryptionV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('TRANSFER_ENCRYPTION_VERSION_REQUIRED', 'Transfer encryption requires V2.1 metadata.');
  if (!['AES-256-GCM', 'XCHACHA20-POLY1305'].includes(String(row.algorithm)) || !safeId(row.keyId) || !sha256(row.keyFingerprint) || !['per_chunk_derived', 'per_chunk_random'].includes(String(row.nonceStrategy)) || row.authenticated !== true || !safeId(row.aadContext)) return invalid('TRANSFER_ENCRYPTION_INVALID', 'Authenticated encryption metadata is invalid.');
  return { success: true, value: value as TransferEncryptionV2 };
}

export function parseTransferResumeV2(value: unknown, limits: { chunkCount?: number; sizeBytes?: number } = {}): ParseResult<TransferResumeV2> {
  const unsafe = requireSafeRecord(value, 'TRANSFER_RESUME');
  if (unsafe) return unsafe as ParseResult<TransferResumeV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('TRANSFER_RESUME_VERSION_REQUIRED', 'Transfer resume requires V2.1 metadata.');
  if (typeof row.resumable !== 'boolean' || !finiteInteger(row.nextChunkIndex) || !Array.isArray(row.completedChunkIndexes) || !row.completedChunkIndexes.every((item) => finiteInteger(item)) || new Set(row.completedChunkIndexes).size !== row.completedChunkIndexes.length) return invalid('TRANSFER_RESUME_INVALID', 'Resume chunk metadata is invalid.');
  if (!finiteInteger(row.retryCount) || !finiteInteger(row.maxRetries) || row.retryCount > row.maxRetries) return invalid('TRANSFER_RESUME_INVALID', 'Retry metadata is invalid.');
  if (row.completedChunkIndexes.includes(row.nextChunkIndex)) return invalid('TRANSFER_RESUME_INVALID', 'nextChunkIndex cannot already be completed.');
  if (limits.chunkCount !== undefined && (row.nextChunkIndex > limits.chunkCount || row.completedChunkIndexes.some((item) => item >= limits.chunkCount!))) return invalid('TRANSFER_RESUME_INVALID', 'Resume chunk index exceeds the manifest.');
  if (row.acknowledgedBytes !== undefined && (!finiteInteger(row.acknowledgedBytes) || (limits.sizeBytes !== undefined && row.acknowledgedBytes > limits.sizeBytes))) return invalid('TRANSFER_RESUME_INVALID', 'Acknowledged bytes exceed the transfer size.');
  return { success: true, value: value as TransferResumeV2 };
}

export function parseSafeDestinationV2(value: unknown): ParseResult<SafeDestinationV2> {
  const unsafe = requireSafeRecord(value, 'SAFE_DESTINATION');
  if (unsafe) return unsafe as ParseResult<SafeDestinationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('SAFE_DESTINATION_VERSION_REQUIRED', 'Safe destination requires V2.1 metadata.');
  if (!safeId(row.handle) || /[\\/:]|\.\.|%2f|%5c/i.test(row.handle as string) || /^[a-z]+:/i.test(row.handle as string)) return invalid('SAFE_DESTINATION_INVALID', 'Destination handle must be opaque and non-path-like.');
  if (!['workspace', 'downloads', 'vault_inbox', 'temporary'].includes(String(row.scope))) return invalid('SAFE_DESTINATION_INVALID', 'Destination scope is invalid.');
  return { success: true, value: value as SafeDestinationV2 };
}

export function parseFileTransferDescriptorV2(value: unknown): ParseResult<FileTransferDescriptorV2> {
  const unsafe = requireSafeRecord(value, 'FILE_TRANSFER');
  if (unsafe) return unsafe as ParseResult<FileTransferDescriptorV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.transferId) || !isSafeTransferFileNameV2(row.fileName) || !safeId(row.mediaType) || !finiteInteger(row.sizeBytes) || !sha256(row.sha256)) return invalid('FILE_TRANSFER_INVALID', 'File transfer identity, safe filename, or checksum is invalid.');
  if (!['upload', 'download'].includes(String(row.direction)) || !['pending', 'transferring', 'completed', 'failed', 'cancelled'].includes(String(row.status))) return invalid('FILE_TRANSFER_INVALID', 'File transfer direction or status is invalid.');
  if (row.sourceDeviceId !== undefined && !safeId(row.sourceDeviceId) || row.targetDeviceId !== undefined && !safeId(row.targetDeviceId)) return invalid('FILE_TRANSFER_INVALID', 'Transfer device IDs are invalid.');
  if (row.createdAt !== undefined && !isoTimestamp(row.createdAt) || row.updatedAt !== undefined && !isoTimestamp(row.updatedAt)) return invalid('FILE_TRANSFER_INVALID', 'Transfer timestamps are invalid.');
  if (row.chunkManifest !== undefined) {
    const manifest = parseFileChunkManifestV2(row.chunkManifest);
    if (!manifest.success) return manifest as ParseResult<FileTransferDescriptorV2>;
    if (manifest.value.fileSha256.toLowerCase() !== String(row.sha256).toLowerCase()) return invalid('FILE_TRANSFER_INVALID', 'Transfer and manifest checksums must match.');
  }
  if (row.encryption !== undefined && !parseTransferEncryptionV2(row.encryption).success) return invalid('FILE_TRANSFER_INVALID', 'Transfer encryption metadata is invalid.');
  if (row.resume !== undefined && !parseTransferResumeV2(row.resume, { chunkCount: isRecord(row.chunkManifest) ? Number(row.chunkManifest.totalChunks) : undefined, sizeBytes: Number(row.sizeBytes) }).success) return invalid('FILE_TRANSFER_INVALID', 'Transfer resume metadata is invalid.');
  if (row.destination !== undefined && !parseSafeDestinationV2(row.destination).success) return invalid('FILE_TRANSFER_INVALID', 'Transfer destination metadata is invalid.');
  return { success: true, value: value as FileTransferDescriptorV2 };
}

function validCrossDeviceLineage(row: Record<string, unknown>): boolean {
  return isV21(row)
    && [row.ownerSessionBindingId, row.workspaceId, row.sessionId, row.sourceDeviceId, row.targetDeviceId].every((item) => safeId(item));
}

function validExpiryWindow(start: unknown, end: unknown, maximumMs = 24 * 60 * 60_000): boolean {
  return isoTimestamp(start) && isoTimestamp(end) && Date.parse(end) > Date.parse(start) && Date.parse(end) - Date.parse(start) <= maximumMs;
}

export function parseCrossDeviceTransferV2(value: unknown): ParseResult<CrossDeviceTransferV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_TRANSFER');
  if (unsafe) return unsafe as ParseResult<CrossDeviceTransferV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'transferId', 'direction', 'category', 'fileName', 'mediaType', 'sourceComputerLabel', 'sizeBytes', 'sha256', 'status', 'progress', 'destination', 'resume', 'capabilities', 'candidateEvidence', 'createdAt', 'updatedAt', 'expiresAt', 'errorCode'])) return invalid('CROSS_DEVICE_TRANSFER_UNKNOWN_FIELD', 'Transfer contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.transferId) || !isSafeTransferFileNameV2(row.fileName) || !safeId(row.mediaType) || !finiteInteger(row.sizeBytes, 1) || Number(row.sizeBytes) > 25 * 1024 * 1024 || !sha256(row.sha256)) return invalid('CROSS_DEVICE_TRANSFER_INVALID', 'Transfer lineage, safe filename, size, or checksum is invalid.');
  if (!['mobile_to_pc', 'pc_to_mobile'].includes(String(row.direction)) || !['pdf', 'image', 'document', 'other'].includes(String(row.category)) || !['pending', 'transferring', 'completed', 'failed', 'cancelled', 'configuration_required'].includes(String(row.status))) return invalid('CROSS_DEVICE_TRANSFER_INVALID', 'Transfer direction, category, or status is invalid.');
  if (!isRecord(row.progress) || !onlyKeys(row.progress, ['bytesTransferred', 'totalBytes', 'percent', 'integrity']) || !finiteInteger(row.progress.bytesTransferred) || row.progress.bytesTransferred > row.sizeBytes || row.progress.totalBytes !== row.sizeBytes || typeof row.progress.percent !== 'number' || row.progress.percent < 0 || row.progress.percent > 100 || !['pending', 'verified', 'failed'].includes(String(row.progress.integrity))) return invalid('CROSS_DEVICE_TRANSFER_PROGRESS_INVALID', 'Transfer progress must be byte-backed and bounded.');
  const expectedPercent = Number(row.sizeBytes) === 0 ? 0 : Number(((Number(row.progress.bytesTransferred) / Number(row.sizeBytes)) * 100).toFixed(2));
  if (Math.abs(Number(row.progress.percent) - expectedPercent) > 0.01 || row.status === 'completed' && (row.progress.bytesTransferred !== row.sizeBytes || row.progress.integrity !== 'verified')) return invalid('CROSS_DEVICE_TRANSFER_PROGRESS_INVALID', 'Transfer percentage and completion integrity must derive from verified bytes.');
  if (!isRecord(row.destination) || !onlyKeys(row.destination, ['kind', 'opaqueHandle', 'displaySummary', 'conflictPolicy', 'collisionDetected']) || !['desktop', 'downloads', 'approved_folder', 'mobile_inbox'].includes(String(row.destination.kind)) || !safeId(row.destination.opaqueHandle) || /[\\/:]|\.\.|%2f|%5c/i.test(String(row.destination.opaqueHandle)) || !safeId(row.destination.displaySummary) || !['reject', 'collision_safe_rename', 'approval_required'].includes(String(row.destination.conflictPolicy)) || typeof row.destination.collisionDetected !== 'boolean') return invalid('CROSS_DEVICE_TRANSFER_DESTINATION_INVALID', 'Transfer destination must use an opaque approved handle and explicit conflict policy.');
  if (row.destination.collisionDetected === true && row.destination.conflictPolicy === 'reject' && row.status !== 'failed') return invalid('CROSS_DEVICE_TRANSFER_COLLISION_UNRESOLVED', 'A rejected collision cannot continue or overwrite.');
  if (!parseTransferResumeV2(row.resume, { sizeBytes: Number(row.sizeBytes) }).success || !isRecord(row.capabilities) || !onlyKeys(row.capabilities, ['open', 'export', 'share', 'openLocation']) || !['open', 'export', 'share', 'openLocation'].every((key) => typeof row.capabilities[key] === 'boolean')) return invalid('CROSS_DEVICE_TRANSFER_CAPABILITIES_INVALID', 'Transfer resume or capability metadata is invalid.');
  if (isRecord(row.resume) && row.resume.acknowledgedBytes !== undefined && row.resume.acknowledgedBytes !== row.progress.bytesTransferred) return invalid('CROSS_DEVICE_TRANSFER_PROGRESS_INVALID', 'Resume acknowledgement must match byte-backed progress.');
  if (!validExpiryWindow(row.createdAt, row.expiresAt) || !isoTimestamp(row.updatedAt) || Date.parse(String(row.updatedAt)) < Date.parse(String(row.createdAt))) return invalid('CROSS_DEVICE_TRANSFER_TIME_INVALID', 'Transfer timestamps or expiry are invalid.');
  if (row.candidateEvidence !== undefined && (!isRecord(row.candidateEvidence) || !onlyKeys(row.candidateEvidence, ['candidateId', 'source', 'verified', 'evidenceSummary']) || !safeId(row.candidateEvidence.candidateId) || !['explicit_selection', 'semantic_fetch', 'drop_request'].includes(String(row.candidateEvidence.source)) || typeof row.candidateEvidence.verified !== 'boolean' || !safeId(row.candidateEvidence.evidenceSummary, 2_000))) return invalid('CROSS_DEVICE_TRANSFER_EVIDENCE_INVALID', 'Transfer candidate evidence is invalid.');
  return { success: true, value: value as CrossDeviceTransferV2 };
}

export function parseCrossDeviceClipboardRequestV2(value: unknown): ParseResult<CrossDeviceClipboardRequestV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_CLIPBOARD');
  if (unsafe) return unsafe as ParseResult<CrossDeviceClipboardRequestV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'clipboardId', 'direction', 'mimeType', 'content', 'explicitConsent', 'persistHistory', 'issuedAt', 'expiresAt'])) return invalid('CROSS_DEVICE_CLIPBOARD_UNKNOWN_FIELD', 'Clipboard request contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.clipboardId) || !['mobile_to_pc', 'pc_to_mobile'].includes(String(row.direction)) || !['text/plain', 'text/uri-list'].includes(String(row.mimeType)) || typeof row.content !== 'string' || new TextEncoder().encode(row.content).byteLength < 1 || new TextEncoder().encode(row.content).byteLength > 64 * 1024) return invalid('CROSS_DEVICE_CLIPBOARD_INVALID', 'Clipboard lineage, direction, MIME type, or bounded content is invalid.');
  if (row.explicitConsent !== true || row.persistHistory !== false || !validExpiryWindow(row.issuedAt, row.expiresAt, 5 * 60_000)) return invalid('CROSS_DEVICE_CLIPBOARD_CONSENT_REQUIRED', 'Clipboard transfer requires explicit consent, no history, and a short TTL.');
  return { success: true, value: value as CrossDeviceClipboardRequestV2 };
}

export function parseCrossDeviceClipboardMetadataV2(value: unknown): ParseResult<CrossDeviceClipboardMetadataV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_CLIPBOARD_METADATA');
  if (unsafe) return unsafe as ParseResult<CrossDeviceClipboardMetadataV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'clipboardId', 'direction', 'mimeType', 'explicitConsent', 'persistHistory', 'issuedAt', 'expiresAt', 'contentBytes', 'contentFingerprint', 'status', 'sensitive'])) return invalid('CROSS_DEVICE_CLIPBOARD_METADATA_UNKNOWN_FIELD', 'Clipboard metadata contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.clipboardId) || !['mobile_to_pc', 'pc_to_mobile'].includes(String(row.direction)) || !['text/plain', 'text/uri-list'].includes(String(row.mimeType)) || row.explicitConsent !== true || row.persistHistory !== false || !finiteInteger(row.contentBytes, 1) || row.contentBytes > 64 * 1024 || !sha256(row.contentFingerprint) || !['available', 'consumed', 'expired', 'rejected'].includes(String(row.status)) || row.sensitive !== false || !validExpiryWindow(row.issuedAt, row.expiresAt, 5 * 60_000)) return invalid('CROSS_DEVICE_CLIPBOARD_METADATA_INVALID', 'Clipboard metadata is invalid or exposes an unsafe lifecycle.');
  if ('content' in row) return invalid('CROSS_DEVICE_CLIPBOARD_PLAINTEXT_FORBIDDEN', 'Clipboard metadata must not include plaintext content.');
  return { success: true, value: value as CrossDeviceClipboardMetadataV2 };
}

export function parseCrossDeviceLiveViewSessionV2(value: unknown): ParseResult<CrossDeviceLiveViewSessionV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_LIVE_VIEW');
  if (unsafe) return unsafe as ParseResult<CrossDeviceLiveViewSessionV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'liveViewId', 'status', 'ownerApproved', 'continuousAutoStream', 'controlAuthority', 'framePolicy', 'overlayCapabilities', 'startedAt', 'stoppedAt', 'expiresAt', 'errorCode'])) return invalid('CROSS_DEVICE_LIVE_VIEW_UNKNOWN_FIELD', 'Live-view session contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.liveViewId) || !['requested', 'approved', 'configuration_required', 'streaming', 'stopped', 'expired'].includes(String(row.status)) || typeof row.ownerApproved !== 'boolean' || row.continuousAutoStream !== false || row.controlAuthority !== false) return invalid('CROSS_DEVICE_LIVE_VIEW_INVALID', 'Live-view identity or fail-closed authority flags are invalid.');
  if ((row.status === 'approved' || row.status === 'streaming') && row.ownerApproved !== true) return invalid('CROSS_DEVICE_LIVE_VIEW_APPROVAL_REQUIRED', 'Live view cannot activate without owner approval.');
  if (!isRecord(row.framePolicy) || !onlyKeys(row.framePolicy, ['maxFramesPerSecond', 'maxWidth', 'maxHeight']) || !finiteInteger(row.framePolicy.maxFramesPerSecond, 1) || row.framePolicy.maxFramesPerSecond > 5 || !finiteInteger(row.framePolicy.maxWidth, 1) || row.framePolicy.maxWidth > 1920 || !finiteInteger(row.framePolicy.maxHeight, 1) || row.framePolicy.maxHeight > 1080 || !isRecord(row.overlayCapabilities) || !onlyKeys(row.overlayCapabilities, ['cursor', 'click', 'target', 'operatorState']) || !['cursor', 'click', 'target', 'operatorState'].every((key) => typeof row.overlayCapabilities[key] === 'boolean') || !isoTimestamp(row.expiresAt)) return invalid('CROSS_DEVICE_LIVE_VIEW_POLICY_INVALID', 'Live-view frame, overlay, or expiry policy is invalid.');
  return { success: true, value: value as CrossDeviceLiveViewSessionV2 };
}

export function parseCrossDeviceLiveViewFrameMetadataV2(value: unknown): ParseResult<CrossDeviceLiveViewFrameMetadataV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_LIVE_VIEW_FRAME');
  if (unsafe) return unsafe as ParseResult<CrossDeviceLiveViewFrameMetadataV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'liveViewId', 'frameId', 'sequence', 'observedAt', 'width', 'height', 'cursor', 'click', 'target', 'operatorState', 'containsPixels'])) return invalid('CROSS_DEVICE_LIVE_VIEW_FRAME_UNKNOWN_FIELD', 'Live-view frame metadata contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.liveViewId) || !safeId(row.frameId) || !finiteInteger(row.sequence, 1) || !isoTimestamp(row.observedAt) || !finiteInteger(row.width, 1) || row.width > 1920 || !finiteInteger(row.height, 1) || row.height > 1080 || !DESKTOP_OPERATOR_STATES.includes(row.operatorState as DesktopOperatorStateV2) || row.containsPixels !== false) return invalid('CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID', 'Live-view frame metadata is invalid or contains pixel authority.');
  const normalizedPoint = (point: unknown): boolean => isRecord(point) && onlyKeys(point, ['x', 'y']) && typeof point.x === 'number' && point.x >= 0 && point.x <= 1 && typeof point.y === 'number' && point.y >= 0 && point.y <= 1;
  if (row.cursor !== undefined && !normalizedPoint(row.cursor)) return invalid('CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID', 'Cursor overlay coordinates are invalid.');
  if (row.click !== undefined && (!isRecord(row.click) || !onlyKeys(row.click, ['x', 'y', 'button']) || !normalizedPoint({ x: row.click.x, y: row.click.y }) || !['left', 'right', 'middle'].includes(String(row.click.button)))) return invalid('CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID', 'Click overlay metadata is invalid.');
  if (row.target !== undefined && (!isRecord(row.target) || !onlyKeys(row.target, ['targetId', 'label', 'x', 'y', 'width', 'height']) || !safeId(row.target.targetId) || !safeId(row.target.label, 500) || !normalizedPoint({ x: row.target.x, y: row.target.y }) || typeof row.target.width !== 'number' || row.target.width <= 0 || row.target.width > 1 || typeof row.target.height !== 'number' || row.target.height <= 0 || row.target.height > 1)) return invalid('CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID', 'Target overlay metadata is invalid.');
  return { success: true, value: value as CrossDeviceLiveViewFrameMetadataV2 };
}

export function parseCrossDeviceWakeReadyV2(value: unknown): ParseResult<CrossDeviceWakeReadyV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_WAKE_READY');
  if (unsafe) return unsafe as ParseResult<CrossDeviceWakeReadyV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'requestId', 'capability', 'capabilityStatus', 'status', 'attempted', 'runtimeReady', 'requestedAt', 'completedAt', 'errorCode'])) return invalid('CROSS_DEVICE_WAKE_READY_UNKNOWN_FIELD', 'Wake-and-ready result contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.requestId) || row.capability !== 'wake_on_lan' || !['available', 'unsupported', 'configuration_required'].includes(String(row.capabilityStatus)) || !['requested', 'attempted', 'ready', 'failed', 'unsupported', 'configuration_required'].includes(String(row.status)) || typeof row.attempted !== 'boolean' || typeof row.runtimeReady !== 'boolean' || !isoTimestamp(row.requestedAt)) return invalid('CROSS_DEVICE_WAKE_READY_INVALID', 'Wake-and-ready capability or result is invalid.');
  if (['unsupported', 'configuration_required'].includes(String(row.status)) && (row.attempted !== false || row.runtimeReady !== false) || row.status === 'ready' && (!row.attempted || !row.runtimeReady)) return invalid('CROSS_DEVICE_WAKE_READY_INCONSISTENT', 'Wake result must not claim an attempt or readiness without evidence.');
  return { success: true, value: value as CrossDeviceWakeReadyV2 };
}

export function parseCrossDeviceOfflineQueueItemV2(value: unknown): ParseResult<CrossDeviceOfflineQueueItemV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_OFFLINE_QUEUE');
  if (unsafe) return unsafe as ParseResult<CrossDeviceOfflineQueueItemV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'queueItemId', 'command', 'status', 'encryptedAtRest', 'queuedAt', 'expiresAt', 'cancelledAt', 'dispatchedAt', 'completedAt', 'result', 'errorCode'])) return invalid('CROSS_DEVICE_OFFLINE_QUEUE_UNKNOWN_FIELD', 'Offline queue item contains an unknown field.');
  const command = isRecord(row.command) ? row.command : undefined;
  if (!validCrossDeviceLineage(row) || !safeId(row.queueItemId) || !command || !onlyKeys(command, ['commandId', 'command', 'deviceId', 'workspaceId', 'sessionId', 'idempotencyKey', 'riskLevel', 'issuedAt', 'expiresAt', 'payloadFingerprint']) || ![command.commandId, command.deviceId, command.workspaceId, command.sessionId, command.idempotencyKey].every((item) => safeId(item)) || !MOBILE_REMOTE_COMMAND_NAMES.includes(command.command as MobileRemoteCommandNameV2) || command.command === 'emergency_stop' || ![0, 1].includes(Number(command.riskLevel)) || !validExpiryWindow(command.issuedAt, command.expiresAt) || !sha256(command.payloadFingerprint) || row.encryptedAtRest !== true || !['pending', 'cancelled', 'dispatching', 'completed', 'failed', 'expired'].includes(String(row.status)) || !validExpiryWindow(row.queuedAt, row.expiresAt)) return invalid('CROSS_DEVICE_OFFLINE_QUEUE_INVALID', 'Offline queue item must be encrypted, low risk, bounded, and must exclude emergency stop.');
  if (command.deviceId !== row.sourceDeviceId || command.workspaceId !== row.workspaceId || command.sessionId !== row.sessionId) return invalid('CROSS_DEVICE_OFFLINE_QUEUE_BINDING_INVALID', 'Queued command lineage does not match its authenticated queue item.');
  if (row.result !== undefined && !parseMobileRemoteCommandResultV2(row.result).success) return invalid('CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID', 'Offline queue result is invalid.');
  return { success: true, value: value as CrossDeviceOfflineQueueItemV2 };
}

export function parseCrossDeviceHandoffIntentV2(value: unknown): ParseResult<CrossDeviceHandoffIntentV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_HANDOFF');
  if (unsafe) return unsafe as ParseResult<CrossDeviceHandoffIntentV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'handoffId', 'direction', 'intent', 'taskId', 'resultId', 'artifactIds', 'status', 'requestedAt', 'expiresAt', 'acknowledgedAt'])) return invalid('CROSS_DEVICE_HANDOFF_UNKNOWN_FIELD', 'Handoff contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.handoffId) || !['desktop_to_mobile', 'mobile_to_desktop'].includes(String(row.direction)) || !['open', 'continue'].includes(String(row.intent)) || !['requested', 'acknowledged', 'rejected', 'expired'].includes(String(row.status)) || !Array.isArray(row.artifactIds) || row.artifactIds.length > 100 || !row.artifactIds.every((item) => safeId(item)) || new Set(row.artifactIds).size !== row.artifactIds.length || !validExpiryWindow(row.requestedAt, row.expiresAt)) return invalid('CROSS_DEVICE_HANDOFF_INVALID', 'Handoff identity, target, artifacts, or expiry is invalid.');
  if (![row.taskId, row.resultId, ...(row.artifactIds as unknown[])].some((item) => safeId(item))) return invalid('CROSS_DEVICE_HANDOFF_IDENTITY_REQUIRED', 'Handoff must preserve at least one task, result, or artifact identity.');
  return { success: true, value: value as CrossDeviceHandoffIntentV2 };
}

export function parseSharedResultCardV2(value: unknown): ParseResult<SharedResultCardV2> {
  const unsafe = requireSafeRecord(value, 'SHARED_RESULT_CARD');
  if (unsafe) return unsafe as ParseResult<SharedResultCardV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'cardId', 'kind', 'title', 'summary', 'outcome', 'provenance', 'preview', 'artifactRefs', 'actions', 'revision', 'createdAt', 'updatedAt', 'expiresAt'])) return invalid('SHARED_RESULT_CARD_UNKNOWN_FIELD', 'Result card contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.cardId) || !['research', 'file', 'screenshot', 'download', 'task', 'error_attention'].includes(String(row.kind)) || !['success', 'partial', 'failure', 'cancelled'].includes(String(row.outcome)) || !safeId(row.title, 500) || !safeId(row.summary, 10_000) || !finiteInteger(row.revision, 1) || !isoTimestamp(row.createdAt) || !isoTimestamp(row.updatedAt)) return invalid('SHARED_RESULT_CARD_INVALID', 'Result card identity, outcome, content, revision, or timestamps are invalid.');
  if (containsSensitiveText(row.title) || containsSensitiveText(row.summary)) return invalid('SHARED_RESULT_CARD_SENSITIVE_PREVIEW', 'Result card display text contains sensitive material.');
  if (!isRecord(row.provenance) || !onlyKeys(row.provenance, ['sourceType', 'sourceId', 'observedAt', 'verified']) || !safeId(row.provenance.sourceType) || !safeId(row.provenance.sourceId) || !isoTimestamp(row.provenance.observedAt) || typeof row.provenance.verified !== 'boolean' || !isRecord(row.preview) || !onlyKeys(row.preview, ['safeText', 'mediaType', 'artifactRef', 'redacted']) || typeof row.preview.redacted !== 'boolean') return invalid('SHARED_RESULT_CARD_PROVENANCE_INVALID', 'Result card provenance or redaction metadata is invalid.');
  if (row.preview.safeText !== undefined && (!safeId(row.preview.safeText, 10_000) || row.preview.redacted !== true) || row.preview.artifactRef !== undefined && !safeId(row.preview.artifactRef) || !Array.isArray(row.artifactRefs) || row.artifactRefs.length > 100 || !row.artifactRefs.every((item) => isRecord(item) && onlyKeys(item, ['artifactId', 'mediaType', 'checksumSha256', 'checksumStatus', 'provenance', 'retention', 'ownerSessionBindingId', 'downloadHandle']) && safeId(item.artifactId) && safeId(item.mediaType) && (item.checksumSha256 === undefined || sha256(item.checksumSha256)) && ['verified', 'failed', 'unavailable'].includes(String(item.checksumStatus)) && isRecord(item.provenance) && onlyKeys(item.provenance, ['sourceType', 'sourceId', 'observedAt', 'verified']) && safeId(item.provenance.sourceType) && safeId(item.provenance.sourceId) && isoTimestamp(item.provenance.observedAt) && typeof item.provenance.verified === 'boolean' && ['session', 'temporary', 'workspace'].includes(String(item.retention)) && item.ownerSessionBindingId === row.ownerSessionBindingId && (item.downloadHandle === undefined || safeId(item.downloadHandle) && !/[\\/:]|\.\.|%2f|%5c/i.test(String(item.downloadHandle))))) return invalid('SHARED_RESULT_CARD_PREVIEW_INVALID', 'Result card preview or artifact references are invalid.');
  if (isRecord(row.preview) && containsSensitiveText(row.preview.safeText)) return invalid('SHARED_RESULT_CARD_SENSITIVE_PREVIEW', 'Result card preview contains sensitive material.');
  if (!Array.isArray(row.actions) || row.actions.length > 12 || !row.actions.every((action) => isRecord(action) && onlyKeys(action, ['action', 'available', 'requiresApproval']) && ['open', 'export', 'share', 'open_location', 'retry', 'dismiss'].includes(String(action.action)) && typeof action.available === 'boolean' && typeof action.requiresApproval === 'boolean')) return invalid('SHARED_RESULT_CARD_ACTIONS_INVALID', 'Result card actions must advertise honest capabilities.');
  return { success: true, value: value as SharedResultCardV2 };
}

export function adaptSharedResultCardToLegacyV2(card: SharedResultCardV2): ResultCardV2 {
  return { title: card.title, summary: card.summary, outcome: card.outcome, artifactIds: card.artifactRefs.map((artifact) => artifact.artifactId), completedAt: card.updatedAt };
}

export function adaptLegacyResultCardToSharedV2(legacy: ResultCardV2, options: Omit<CrossDeviceLineageV2, 'contractVersion' | 'amendment'> & { cardId: string; kind: SharedResultCardKindV2; now: string }): SharedResultCardV2 {
  const lineage = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, ownerSessionBindingId: options.ownerSessionBindingId, workspaceId: options.workspaceId, sessionId: options.sessionId, sourceDeviceId: options.sourceDeviceId, targetDeviceId: options.targetDeviceId };
  return {
    ...lineage, cardId: options.cardId, kind: options.kind, title: legacy.title, summary: legacy.summary, outcome: legacy.outcome,
    provenance: { sourceType: 'legacy_result_card', sourceId: options.cardId, observedAt: options.now, verified: false },
    preview: { safeText: legacy.summary, redacted: true },
    artifactRefs: legacy.artifactIds.map((artifactId) => ({ artifactId, mediaType: 'application/octet-stream', checksumStatus: 'unavailable', provenance: { sourceType: 'legacy_core_artifact_id', sourceId: artifactId, observedAt: options.now, verified: false }, retention: 'session', ownerSessionBindingId: options.ownerSessionBindingId })),
    actions: [], revision: 1, createdAt: options.now, updatedAt: options.now,
  };
}

export function parseCrossDeviceAudioHandoffV2(value: unknown): ParseResult<CrossDeviceAudioHandoffV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_AUDIO_HANDOFF');
  if (unsafe) return unsafe as ParseResult<CrossDeviceAudioHandoffV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'handoffId', 'leaseId', 'epoch', 'sourceCaptureDeviceId', 'targetCaptureDeviceId', 'status', 'simultaneousCaptureAllowed', 'quietHoursRevision', 'requestedAt', 'acknowledgedAt', 'expiresAt'])) return invalid('CROSS_DEVICE_AUDIO_HANDOFF_UNKNOWN_FIELD', 'Audio handoff contains an unknown field.');
  if (!validCrossDeviceLineage(row) || ![row.handoffId, row.leaseId, row.sourceCaptureDeviceId, row.targetCaptureDeviceId].every((item) => safeId(item)) || row.sourceCaptureDeviceId === row.targetCaptureDeviceId || !finiteInteger(row.epoch, 1) || !['requested', 'acknowledged', 'active', 'released', 'expired', 'rejected'].includes(String(row.status)) || row.simultaneousCaptureAllowed !== false || !validExpiryWindow(row.requestedAt, row.expiresAt, 30 * 60_000)) return invalid('CROSS_DEVICE_AUDIO_HANDOFF_INVALID', 'Audio handoff must use a bounded single-capture lease with distinct devices.');
  if (row.sourceCaptureDeviceId !== row.sourceDeviceId || row.targetCaptureDeviceId !== row.targetDeviceId) return invalid('CROSS_DEVICE_AUDIO_HANDOFF_BINDING_INVALID', 'Audio capture lease must match cross-device source and target lineage.');
  if (row.quietHoursRevision !== undefined && !finiteInteger(row.quietHoursRevision, 1)) return invalid('CROSS_DEVICE_AUDIO_HANDOFF_INVALID', 'Audio handoff quiet-hours revision is invalid.');
  return { success: true, value: value as CrossDeviceAudioHandoffV2 };
}

export function parseCrossDevicePcStatusV2(value: unknown): ParseResult<CrossDevicePcStatusV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_PC_STATUS');
  if (unsafe) return unsafe as ParseResult<CrossDevicePcStatusV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'sourceDeviceId', 'targetDeviceId', 'snapshotId', 'runtime', 'observedAt', 'expiresAt', 'metrics', 'source'])) return invalid('CROSS_DEVICE_PC_STATUS_UNKNOWN_FIELD', 'PC status contains an unknown field.');
  if (!validCrossDeviceLineage(row) || !safeId(row.snapshotId) || !['ready', 'busy', 'offline', 'unknown'].includes(String(row.runtime)) || !validExpiryWindow(row.observedAt, row.expiresAt, 60_000) || !['native_adapter', 'backend_runtime'].includes(String(row.source)) || !isRecord(row.metrics) || !onlyKeys(row.metrics, ['cpuPercent', 'gpuPercent', 'ramPercent', 'networkState', 'activeDownloads', 'voiceActive', 'computerUseActive'])) return invalid('CROSS_DEVICE_PC_STATUS_INVALID', 'PC status lineage, freshness, source, or metrics are invalid.');
  for (const key of ['cpuPercent', 'gpuPercent', 'ramPercent']) if (row.metrics[key] !== undefined && (typeof row.metrics[key] !== 'number' || row.metrics[key] < 0 || row.metrics[key] > 100)) return invalid('CROSS_DEVICE_PC_STATUS_METRIC_INVALID', `${key} must be between 0 and 100.`);
  if (row.metrics.activeDownloads !== undefined && !finiteInteger(row.metrics.activeDownloads) || row.metrics.voiceActive !== undefined && typeof row.metrics.voiceActive !== 'boolean' || row.metrics.computerUseActive !== undefined && typeof row.metrics.computerUseActive !== 'boolean' || row.metrics.networkState !== undefined && !['online', 'offline', 'unknown'].includes(String(row.metrics.networkState))) return invalid('CROSS_DEVICE_PC_STATUS_METRIC_INVALID', 'PC status metrics are invalid.');
  return { success: true, value: value as CrossDevicePcStatusV2 };
}

export function parseCrossDeviceQuietHoursV2(value: unknown): ParseResult<CrossDeviceQuietHoursV2> {
  const unsafe = requireSafeRecord(value, 'CROSS_DEVICE_QUIET_HOURS');
  if (unsafe) return unsafe as ParseResult<CrossDeviceQuietHoursV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['contractVersion', 'amendment', 'workspaceId', 'ownerSessionBindingId', 'revision', 'enabled', 'startLocal', 'endLocal', 'timezone', 'suppressAudio', 'suppressNotifications', 'updatedAt'])) return invalid('CROSS_DEVICE_QUIET_HOURS_UNKNOWN_FIELD', 'Quiet-hours metadata contains an unknown field.');
  if (!isV21(row) || !safeId(row.workspaceId) || !safeId(row.ownerSessionBindingId) || !finiteInteger(row.revision, 1) || typeof row.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(row.startLocal)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(row.endLocal)) || !safeId(row.timezone) || typeof row.suppressAudio !== 'boolean' || typeof row.suppressNotifications !== 'boolean' || !isoTimestamp(row.updatedAt)) return invalid('CROSS_DEVICE_QUIET_HOURS_INVALID', 'Quiet-hours metadata is invalid.');
  return { success: true, value: value as CrossDeviceQuietHoursV2 };
}

const ADVANCED_BASE_KEYS = ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'revision', 'createdAt', 'updatedAt', 'expiresAt'] as const;
const ADVANCED_KINDS = ['task', 'app', 'window', 'bookmark', 'research', 'download'] as const;

function advancedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function advancedText(value: unknown, maximum = 2_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    && !containsSensitiveText(value)
    && !/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|etc)\/)/i.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseAdvancedRow(value: unknown, family: string, extraKeys: readonly string[]): ParseResult<Record<string, unknown>> {
  const unsafe = requireSafeRecord(value, family);
  if (unsafe) return unsafe;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, [...ADVANCED_BASE_KEYS, ...extraKeys])) return invalid(`${family}_UNKNOWN_FIELD`, `${family} contains an unknown field.`);
  if (!isV21(row) || !advancedId(row.ownerSessionBindingId) || !advancedId(row.workspaceId) || !finiteInteger(row.revision, 1)
    || !isoTimestamp(row.createdAt) || !isoTimestamp(row.updatedAt) || Date.parse(String(row.updatedAt)) < Date.parse(String(row.createdAt))) {
    return invalid(`${family}_LINEAGE_INVALID`, `${family} owner, workspace, revision, or timestamps are invalid.`);
  }
  if (row.expiresAt !== undefined && (!isoTimestamp(row.expiresAt) || Date.parse(String(row.expiresAt)) <= Date.parse(String(row.createdAt)))) {
    return invalid(`${family}_EXPIRY_INVALID`, `${family} expiry is invalid.`);
  }
  return { success: true, value: row };
}

function advancedStringList(value: unknown, maximum = 64): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(advancedId) && new Set(value).size === value.length;
}

function advancedTextList(value: unknown, maximum = 64): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => advancedText(item));
}

export function parsePriorityTaskPolicyV2(value: unknown): ParseResult<PriorityTaskPolicyV2> {
  const parsed = parseAdvancedRow(value, 'PRIORITY_TASK_POLICY', ['taskId', 'priority', 'dependencyTaskIds', 'atomicOperation', 'securityCritical', 'derivedFromUrgentLanguage', 'blockedByDependencies']);
  if (!parsed.success) return parsed as ParseResult<PriorityTaskPolicyV2>;
  const row = parsed.value;
  if (!advancedId(row.taskId) || !['LOW', 'NORMAL', 'HIGH'].includes(String(row.priority)) || !advancedStringList(row.dependencyTaskIds)
    || typeof row.atomicOperation !== 'boolean' || typeof row.securityCritical !== 'boolean' || row.derivedFromUrgentLanguage !== false || typeof row.blockedByDependencies !== 'boolean') {
    return invalid('PRIORITY_TASK_POLICY_INVALID', 'Priority task policy is invalid or derives priority from urgency wording.');
  }
  return { success: true, value: value as PriorityTaskPolicyV2 };
}

export function parseShadowModeV2(value: unknown): ParseResult<ShadowModeV2> {
  const parsed = parseAdvancedRow(value, 'SHADOW_MODE', ['enabled', 'consent', 'observationLevel', 'capturedFields', 'rawScreenArchive', 'secretCapture', 'suggestionOnly', 'disabledAt']);
  if (!parsed.success) return parsed as ParseResult<ShadowModeV2>;
  const row = parsed.value;
  const allowed = ['app_identity', 'task_identity', 'workflow_structure', 'timestamps'];
  if (typeof row.enabled !== 'boolean' || row.consent !== 'explicit' || row.observationLevel !== 'metadata_only'
    || !Array.isArray(row.capturedFields) || row.capturedFields.length > allowed.length || !row.capturedFields.every((item) => allowed.includes(String(item)))
    || row.rawScreenArchive !== false || row.secretCapture !== false || row.suggestionOnly !== true
    || row.disabledAt !== undefined && !isoTimestamp(row.disabledAt)) return invalid('SHADOW_MODE_INVALID', 'Shadow Mode must remain explicit, metadata-only, suggestion-only, and secret-free.');
  if (!row.enabled && !isoTimestamp(row.disabledAt)) return invalid('SHADOW_MODE_DISABLE_TIME_REQUIRED', 'Disabled Shadow Mode requires disabledAt.');
  return { success: true, value: value as ShadowModeV2 };
}

export function parseGhostTaskV2(value: unknown): ParseResult<GhostTaskV2> {
  const parsed = parseAdvancedRow(value, 'GHOST_TASK', ['ghostTaskId', 'taskId', 'background', 'focusPolicy', 'status', 'progressPercent', 'completionNotification', 'nativeExecution', 'reasonCode']);
  if (!parsed.success) return parsed as ParseResult<GhostTaskV2>;
  const row = parsed.value;
  const statuses: AdvancedExperienceStatusV2[] = ['planned', 'active', 'paused', 'completed', 'cancelled', 'failed', 'expired', 'configuration_required'];
  if (![row.ghostTaskId, row.taskId].every(advancedId) || row.background !== true || !['never_steal', 'visible_gui_only_when_explicit'].includes(String(row.focusPolicy))
    || !statuses.includes(row.status as AdvancedExperienceStatusV2) || typeof row.progressPercent !== 'number' || row.progressPercent < 0 || row.progressPercent > 100
    || row.completionNotification !== 'meaningful_only' || row.nativeExecution !== 'not_connected' || row.reasonCode !== undefined && !advancedId(row.reasonCode)) return invalid('GHOST_TASK_INVALID', 'Ghost task metadata, focus policy, progress, or execution truth is invalid.');
  if (row.status === 'completed' && row.progressPercent !== 100) return invalid('GHOST_TASK_COMPLETION_INVALID', 'Completed ghost tasks require 100 percent progress.');
  return { success: true, value: value as GhostTaskV2 };
}

export function parseMissionMemoryV2(value: unknown): ParseResult<MissionMemoryV2> {
  const parsed = parseAdvancedRow(value, 'MISSION_MEMORY', ['memoryId', 'sourceTaskId', 'sourcePlaybookRunId', 'sourceResearchRunId', 'verificationStatus', 'routeSummary', 'avoidRouteCodes', 'currentStateReverificationRequired']);
  if (!parsed.success) return parsed as ParseResult<MissionMemoryV2>;
  const row = parsed.value;
  if (![row.memoryId, row.sourceTaskId].every(advancedId) || row.sourcePlaybookRunId !== undefined && !advancedId(row.sourcePlaybookRunId)
    || row.sourceResearchRunId !== undefined && !advancedId(row.sourceResearchRunId) || row.verificationStatus !== 'verified'
    || !advancedText(row.routeSummary) || !advancedStringList(row.avoidRouteCodes, 32) || row.currentStateReverificationRequired !== true) return invalid('MISSION_MEMORY_INVALID', 'Mission Memory requires verified bounded evidence and current-state re-verification.');
  return { success: true, value: value as MissionMemoryV2 };
}

export function parseVisualBookmarkV2(value: unknown): ParseResult<VisualBookmarkV2> {
  const parsed = parseAdvancedRow(value, 'VISUAL_BOOKMARK', ['bookmarkId', 'capturedAt', 'appId', 'windowTitlePreview', 'fileRef', 'tabRef', 'taskId', 'userNote', 'screenshotArtifactHandle', 'screenshotPolicy', 'sensitiveAppBlocked']);
  if (!parsed.success) return parsed as ParseResult<VisualBookmarkV2>;
  const row = parsed.value;
  if (![row.bookmarkId, row.appId].every(advancedId) || !isoTimestamp(row.capturedAt)
    || [row.fileRef, row.tabRef, row.taskId, row.screenshotArtifactHandle].some((item) => item !== undefined && !advancedId(item))
    || row.windowTitlePreview !== undefined && !advancedText(row.windowTitlePreview, 500) || row.userNote !== undefined && !advancedText(row.userNote, 2_000)
    || !['metadata_only', 'opaque_handle', 'blocked_sensitive_app'].includes(String(row.screenshotPolicy)) || typeof row.sensitiveAppBlocked !== 'boolean') return invalid('VISUAL_BOOKMARK_INVALID', 'Visual bookmark contains unsafe identity, note, or screenshot metadata.');
  if (row.sensitiveAppBlocked && (row.screenshotPolicy !== 'blocked_sensitive_app' || row.screenshotArtifactHandle !== undefined)) return invalid('VISUAL_BOOKMARK_SENSITIVE_CAPTURE_FORBIDDEN', 'Sensitive app bookmarks must block screenshot artifacts.');
  if (row.screenshotPolicy === 'opaque_handle' && !advancedId(row.screenshotArtifactHandle)) return invalid('VISUAL_BOOKMARK_HANDLE_REQUIRED', 'Opaque screenshot policy requires an opaque handle.');
  return { success: true, value: value as VisualBookmarkV2 };
}

export function parseRecentContextEventV2(value: unknown): ParseResult<RecentContextEventV2> {
  const parsed = parseAdvancedRow(value, 'RECENT_CONTEXT_EVENT', ['eventId', 'kind', 'sourceId', 'safeSummary', 'occurredAt']);
  if (!parsed.success) return parsed as ParseResult<RecentContextEventV2>;
  const row = parsed.value;
  if (![row.eventId, row.sourceId].every(advancedId) || !ADVANCED_KINDS.includes(row.kind as RecentContextEventV2['kind']) || !advancedText(row.safeSummary) || !isoTimestamp(row.occurredAt) || !isoTimestamp(row.expiresAt)) return invalid('RECENT_CONTEXT_EVENT_INVALID', 'Recent context event must be source-backed, safe, and expiring.');
  return { success: true, value: value as RecentContextEventV2 };
}

export function parseWorkspaceSnapshotV2(value: unknown): ParseResult<WorkspaceSnapshotV2> {
  const parsed = parseAdvancedRow(value, 'WORKSPACE_SNAPSHOT', ['snapshotId', 'label', 'items', 'forbiddenStateExcluded', 'dangerousTransactionsExcluded', 'captureStatus']);
  if (!parsed.success) return parsed as ParseResult<WorkspaceSnapshotV2>;
  const row = parsed.value;
  const kinds = ['app', 'project', 'document', 'tab', 'task'];
  if (!advancedId(row.snapshotId) || !advancedText(row.label, 500) || !Array.isArray(row.items) || row.items.length > 100
    || !row.items.every((item) => isRecord(item) && onlyKeys(item, ['kind', 'refId', 'displayLabel']) && kinds.includes(String(item.kind)) && advancedId(item.refId) && advancedText(item.displayLabel, 500))
    || row.forbiddenStateExcluded !== true || row.dangerousTransactionsExcluded !== true || row.captureStatus !== 'metadata_only') return invalid('WORKSPACE_SNAPSHOT_INVALID', 'Workspace snapshot must contain safe metadata-only references.');
  return { success: true, value: value as WorkspaceSnapshotV2 };
}

export function parseWorkspaceRestorePlanV2(value: unknown): ParseResult<WorkspaceRestorePlanV2> {
  const parsed = parseAdvancedRow(value, 'WORKSPACE_RESTORE_PLAN', ['planId', 'snapshotId', 'steps', 'requiresVerification', 'secretsExcluded', 'dangerousTransactionsExcluded', 'status']);
  if (!parsed.success) return parsed as ParseResult<WorkspaceRestorePlanV2>;
  const row = parsed.value;
  const kinds = ['app', 'project', 'document', 'tab', 'task'];
  if (![row.planId, row.snapshotId].every(advancedId) || !Array.isArray(row.steps) || row.steps.length > 100
    || !row.steps.every((step) => isRecord(step) && onlyKeys(step, ['stepId', 'kind', 'refId', 'status']) && advancedId(step.stepId) && kinds.includes(String(step.kind)) && advancedId(step.refId) && ['planned', 'configuration_required'].includes(String(step.status)))
    || row.requiresVerification !== true || row.secretsExcluded !== true || row.dangerousTransactionsExcluded !== true || !['planned', 'configuration_required'].includes(String(row.status))) return invalid('WORKSPACE_RESTORE_PLAN_INVALID', 'Workspace restore plan must remain safe, explicit, and verification-bound.');
  return { success: true, value: value as WorkspaceRestorePlanV2 };
}

export function parseSceneProfileV2(value: unknown): ParseResult<SceneProfileV2> {
  const parsed = parseAdvancedRow(value, 'SCENE_PROFILE', ['sceneId', 'profile', 'changes', 'securityNotificationsImmutable', 'status']);
  if (!parsed.success) return parsed as ParseResult<SceneProfileV2>;
  const row = parsed.value;
  const profiles: SceneProfileNameV2[] = ['WORK', 'RESEARCH', 'GAMING', 'FOCUS', 'PRESENTATION', 'TRAVEL', 'QUIET'];
  const settings = ['notifications', 'preferred_apps', 'media', 'capsule', 'audio_routing', 'task_priority'];
  if (!advancedId(row.sceneId) || !profiles.includes(row.profile as SceneProfileNameV2) || !Array.isArray(row.changes) || row.changes.length > 32
    || !row.changes.every((change) => isRecord(change) && onlyKeys(change, ['setting', 'from', 'to', 'reversible']) && settings.includes(String(change.setting)) && advancedText(change.from, 500) && advancedText(change.to, 500) && change.reversible === true)
    || row.securityNotificationsImmutable !== true || !['planned', 'active', 'reverted', 'configuration_required'].includes(String(row.status))) return invalid('SCENE_PROFILE_INVALID', 'Scene profile must be transparent, reversible, and preserve security notifications.');
  return { success: true, value: value as SceneProfileV2 };
}

export function parseWatcherV2(value: unknown): ParseResult<WatcherV2> {
  const parsed = parseAdvancedRow(value, 'WATCHER', ['watcherId', 'kind', 'sourceRef', 'trigger', 'delivery', 'observationPolicy', 'status', 'cancelledAt', 'triggeredAt']);
  if (!parsed.success) return parsed as ParseResult<WatcherV2>;
  const row = parsed.value;
  if (![row.watcherId, row.sourceRef].every(advancedId) || !['download', 'file', 'folder', 'task'].includes(String(row.kind)) || !['completed', 'changed', 'created'].includes(String(row.trigger))
    || !['desktop', 'mobile', 'both'].includes(String(row.delivery)) || row.observationPolicy !== 'event_based' || !['active', 'cancelled', 'expired', 'triggered', 'configuration_required'].includes(String(row.status))
    || !isoTimestamp(row.expiresAt) || row.cancelledAt !== undefined && !isoTimestamp(row.cancelledAt) || row.triggeredAt !== undefined && !isoTimestamp(row.triggeredAt)) return invalid('WATCHER_INVALID', 'Watcher must be bounded, event-based, scoped, and cancellable.');
  return { success: true, value: value as WatcherV2 };
}

export function parseCompareChangeV2(value: unknown): ParseResult<CompareChangeV2> {
  const parsed = parseAdvancedRow(value, 'COMPARE_CHANGE', ['comparisonId', 'sourceType', 'previousRef', 'currentRef', 'provenance', 'added', 'removed', 'changed']);
  if (!parsed.success) return parsed as ParseResult<CompareChangeV2>;
  const row = parsed.value;
  const provenance = isRecord(row.provenance) ? row.provenance : undefined;
  if (![row.comparisonId, row.previousRef, row.currentRef].every(advancedId) || !['file', 'page', 'research'].includes(String(row.sourceType))
    || !provenance || !onlyKeys(provenance, ['sourceId', 'previousObservedAt', 'currentObservedAt', 'verified']) || !advancedId(provenance.sourceId) || !isoTimestamp(provenance.previousObservedAt) || !isoTimestamp(provenance.currentObservedAt) || typeof provenance.verified !== 'boolean'
    || !advancedTextList(row.added) || !advancedTextList(row.removed) || !advancedTextList(row.changed)) return invalid('COMPARE_CHANGE_INVALID', 'Change comparison requires bounded structured differences and provenance.');
  return { success: true, value: value as CompareChangeV2 };
}

export function parseCommunicationPolicyV2(value: unknown): ParseResult<CommunicationPolicyV2> {
  const parsed = parseAdvancedRow(value, 'COMMUNICATION_POLICY', ['autoBrief', 'smartSilence', 'voicePresence', 'voiceSummary', 'securityNotificationsImmutable']);
  if (!parsed.success) return parsed as ParseResult<CommunicationPolicyV2>;
  const row = parsed.value;
  if (!isRecord(row.autoBrief) || !onlyKeys(row.autoBrief, ['enabled', 'maxSentences']) || typeof row.autoBrief.enabled !== 'boolean' || ![1, 2, 3].includes(Number(row.autoBrief.maxSentences))
    || !isRecord(row.smartSilence) || !onlyKeys(row.smartSilence, ['routine', 'milestone', 'completion', 'actionRequired']) || row.smartSilence.routine !== 'capsule' || row.smartSilence.milestone !== 'concise_notification' || row.smartSilence.completion !== 'short_brief' || row.smartSilence.actionRequired !== 'clear_alert'
    || !isRecord(row.voicePresence) || !onlyKeys(row.voicePresence, ['enabled', 'response']) || typeof row.voicePresence.enabled !== 'boolean' || row.voicePresence.response !== 'short_acknowledgement'
    || !isRecord(row.voiceSummary) || !onlyKeys(row.voiceSummary, ['mode', 'actualStateOnly']) || row.voiceSummary.mode !== 'on_demand' || row.voiceSummary.actualStateOnly !== true || row.securityNotificationsImmutable !== true) return invalid('COMMUNICATION_POLICY_INVALID', 'Communication policy must remain concise, on-demand, and preserve security notifications.');
  return { success: true, value: value as CommunicationPolicyV2 };
}

export function parseOrchestrationPlanV2(value: unknown): ParseResult<OrchestrationPlanV2> {
  const parsed = parseAdvancedRow(value, 'ORCHESTRATION_PLAN', ['planId', 'kind', 'objective', 'references', 'steps', 'arbitraryShell', 'status', 'verifiedDownstreamResultIds']);
  if (!parsed.success) return parsed as ParseResult<OrchestrationPlanV2>;
  const row = parsed.value;
  const refKinds = ['task', 'skill', 'research', 'artifact', 'transfer'];
  if (!advancedId(row.planId) || !['one_command_workspace', 'outcome_mode'].includes(String(row.kind)) || !advancedText(row.objective)
    || !Array.isArray(row.references) || row.references.length > 64 || !row.references.every((ref) => isRecord(ref) && onlyKeys(ref, ['kind', 'id']) && refKinds.includes(String(ref.kind)) && advancedId(ref.id))
    || !Array.isArray(row.steps) || row.steps.length > 64 || !row.steps.every((step) => isRecord(step) && onlyKeys(step, ['stepId', 'referenceId', 'status']) && advancedId(step.stepId) && advancedId(step.referenceId) && ['planned', 'configuration_required', 'verified'].includes(String(step.status)))
    || row.arbitraryShell !== false || !['planned', 'running', 'configuration_required', 'completed', 'failed'].includes(String(row.status)) || !advancedStringList(row.verifiedDownstreamResultIds)) return invalid('ORCHESTRATION_PLAN_INVALID', 'Orchestration plan must use bounded existing references and forbid arbitrary shell execution.');
  if (row.status === 'completed' && ((row.steps as Array<Record<string, unknown>>).some((step) => step.status !== 'verified') || (row.verifiedDownstreamResultIds as string[]).length === 0)) return invalid('ORCHESTRATION_COMPLETION_UNVERIFIED', 'Outcome completion requires verified downstream steps and results.');
  return { success: true, value: value as OrchestrationPlanV2 };
}

export function parseSmartRetryPlanV2(value: unknown): ParseResult<SmartRetryPlanV2> {
  const parsed = parseAdvancedRow(value, 'SMART_RETRY_PLAN', ['retryId', 'taskId', 'failureClass', 'strategy', 'attempts', 'maxAttempts', 'staleTargetReobserve', 'permissionDeniedStop', 'status']);
  if (!parsed.success) return parsed as ParseResult<SmartRetryPlanV2>;
  const row = parsed.value;
  if (![row.retryId, row.taskId].every(advancedId) || !['network', 'page_changed', 'app_closed', 'stale_target', 'permission_denied', 'other'].includes(String(row.failureClass))
    || !['reconnect_backoff', 'reobserve', 'reopen_if_allowed', 'stop_report'].includes(String(row.strategy)) || !finiteInteger(row.attempts) || !finiteInteger(row.maxAttempts, 1) || Number(row.maxAttempts) > 2 || Number(row.attempts) > Number(row.maxAttempts)
    || typeof row.staleTargetReobserve !== 'boolean' || typeof row.permissionDeniedStop !== 'boolean' || !['planned', 'retrying', 'verified', 'exhausted', 'stopped'].includes(String(row.status))) return invalid('SMART_RETRY_PLAN_INVALID', 'Smart retry plan is invalid or exceeds the bounded retry budget.');
  if (row.failureClass === 'stale_target' && (row.strategy !== 'reobserve' || row.staleTargetReobserve !== true)) return invalid('SMART_RETRY_STALE_TARGET_UNSAFE', 'Stale targets require re-observation.');
  if (row.failureClass === 'permission_denied' && (row.strategy !== 'stop_report' || row.permissionDeniedStop !== true || row.status !== 'stopped')) return invalid('SMART_RETRY_PERMISSION_STOP_REQUIRED', 'Permission denial must stop and report.');
  return { success: true, value: value as SmartRetryPlanV2 };
}

export function parseDownloadButlerStatusV2(value: unknown): ParseResult<DownloadButlerStatusV2> {
  const parsed = parseAdvancedRow(value, 'DOWNLOAD_BUTLER_STATUS', ['downloadId', 'source', 'displayName', 'bytesTransferred', 'bytesTotal', 'speedBytesPerSecond', 'remainingBytes', 'etaSeconds', 'etaTrustworthy', 'status', 'observedAt']);
  if (!parsed.success) return parsed as ParseResult<DownloadButlerStatusV2>;
  const row = parsed.value;
  if (!advancedId(row.downloadId) || !['steam', 'browser', 'file_transfer', 'supported_app'].includes(String(row.source)) || !advancedText(row.displayName, 500)
    || !finiteInteger(row.bytesTransferred) || !finiteInteger(row.bytesTotal, 1) || Number(row.bytesTransferred) > Number(row.bytesTotal) || row.remainingBytes !== Number(row.bytesTotal) - Number(row.bytesTransferred)
    || row.speedBytesPerSecond !== undefined && (typeof row.speedBytesPerSecond !== 'number' || row.speedBytesPerSecond < 0) || typeof row.etaTrustworthy !== 'boolean'
    || row.etaSeconds !== undefined && (!finiteInteger(row.etaSeconds) || row.etaTrustworthy !== true) || row.etaTrustworthy && row.etaSeconds === undefined
    || !['pending', 'downloading', 'completed', 'failed', 'paused'].includes(String(row.status)) || !isoTimestamp(row.observedAt)) return invalid('DOWNLOAD_BUTLER_STATUS_INVALID', 'Download status, byte progress, speed, remaining bytes, or ETA evidence is invalid.');
  if (row.status === 'completed' && row.bytesTransferred !== row.bytesTotal) return invalid('DOWNLOAD_BUTLER_COMPLETION_INVALID', 'Completed downloads require full byte progress.');
  return { success: true, value: value as DownloadButlerStatusV2 };
}

export function parsePowerPresenceSnapshotV2(value: unknown): ParseResult<PowerPresenceSnapshotV2> {
  const parsed = parseAdvancedRow(value, 'POWER_PRESENCE_SNAPSHOT', ['snapshotId', 'source', 'powerSource', 'batteryPercent', 'lowPower', 'userPresence', 'cameraUsed', 'observedAt']);
  if (!parsed.success) return parsed as ParseResult<PowerPresenceSnapshotV2>;
  const row = parsed.value;
  if (!advancedId(row.snapshotId) || row.source !== 'trusted_native' || !['ac', 'battery', 'unknown'].includes(String(row.powerSource))
    || row.batteryPercent !== undefined && (typeof row.batteryPercent !== 'number' || row.batteryPercent < 0 || row.batteryPercent > 100)
    || typeof row.lowPower !== 'boolean' || !['active', 'away', 'unknown'].includes(String(row.userPresence)) || row.cameraUsed !== false || !isoTimestamp(row.observedAt) || !isoTimestamp(row.expiresAt)) return invalid('POWER_PRESENCE_SNAPSHOT_INVALID', 'Power/presence snapshot must be fresh trusted-native metadata without camera use.');
  return { success: true, value: value as PowerPresenceSnapshotV2 };
}

export function parseHistoryRetentionPolicyV2(value: unknown): ParseResult<HistoryRetentionPolicyV2> {
  const parsed = parseAdvancedRow(value, 'HISTORY_RETENTION_POLICY', ['policyId', 'retentionDays', 'includePrivate', 'purgedBefore', 'searchableKinds']);
  if (!parsed.success) return parsed as ParseResult<HistoryRetentionPolicyV2>;
  const row = parsed.value;
  if (!advancedId(row.policyId) || !finiteInteger(row.retentionDays, 1) || Number(row.retentionDays) > 365 || row.includePrivate !== false
    || row.purgedBefore !== undefined && !isoTimestamp(row.purgedBefore) || !Array.isArray(row.searchableKinds) || row.searchableKinds.length > ADVANCED_KINDS.length || !row.searchableKinds.every((kind) => ADVANCED_KINDS.includes(kind as RecentContextEventV2['kind']))) return invalid('HISTORY_RETENTION_POLICY_INVALID', 'History policy must remain bounded and exclude private history.');
  return { success: true, value: value as HistoryRetentionPolicyV2 };
}

export function parseCapsuleContextCandidateV2(value: unknown): ParseResult<CapsuleContextCandidateV2> {
  const unsafe = requireSafeRecord(value, 'CAPSULE_CONTEXT_CANDIDATE');
  if (unsafe) return unsafe as ParseResult<CapsuleContextCandidateV2>;
  const row = value as Record<string, unknown>;
  if (!onlyKeys(row, ['candidateId', 'kind', 'sourceId', 'safeLabel', 'observedAt', 'expiresAt']) || !advancedId(row.candidateId) || !advancedId(row.sourceId)
    || !['attention_required', 'critical_milestone', 'progress', 'media', 'idle_voice'].includes(String(row.kind)) || !advancedText(row.safeLabel, 500) || !validExpiryWindow(row.observedAt, row.expiresAt)) return invalid('CAPSULE_CONTEXT_CANDIDATE_INVALID', 'Capsule candidate is invalid, unsafe, or expired.');
  return { success: true, value: value as CapsuleContextCandidateV2 };
}

export function parseCapsuleContextSelectionV2(value: unknown): ParseResult<CapsuleContextSelectionV2> {
  const parsed = parseAdvancedRow(value, 'CAPSULE_CONTEXT_SELECTION', ['selectionId', 'selected', 'consideredCandidateIds', 'deterministicRank']);
  if (!parsed.success) return parsed as ParseResult<CapsuleContextSelectionV2>;
  const row = parsed.value;
  const selected = parseCapsuleContextCandidateV2(row.selected);
  if (!advancedId(row.selectionId) || selected.success === false || !advancedStringList(row.consideredCandidateIds) || !(row.consideredCandidateIds as string[]).includes(selected.value.candidateId)
    || ![1, 2, 3, 4, 5].includes(Number(row.deterministicRank))) return invalid('CAPSULE_CONTEXT_SELECTION_INVALID', 'Capsule selection must identify a considered valid candidate and deterministic rank.');
  const rankByKind: Record<CapsuleContextCandidateV2['kind'], number> = { attention_required: 1, critical_milestone: 2, progress: 3, media: 4, idle_voice: 5 };
  if (row.deterministicRank !== rankByKind[selected.value.kind]) return invalid('CAPSULE_CONTEXT_PRIORITY_INVALID', 'Capsule rank does not match deterministic priority.');
  return { success: true, value: value as CapsuleContextSelectionV2 };
}

export function parseSkillRef(value: unknown): ParseResult<SkillRef> {
  const unsafe = requireSafeRecord(value, 'SKILL_REF');
  if (unsafe) return unsafe as ParseResult<SkillRef>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.id) || !safeId(row.version) || !['builtin', 'workspace', 'plugin', 'remote'].includes(String(row.source))) return invalid('SKILL_REF_INVALID', 'Skill reference identity is invalid.');
  if (row.namespace !== undefined && !safeId(row.namespace)) return invalid('SKILL_REF_INVALID', 'Skill namespace is invalid.');
  if (row.canonicalId !== undefined && !safeId(row.canonicalId)) return invalid('SKILL_REF_INVALID', 'Skill canonicalId is invalid.');
  if (row.aliases !== undefined && (!Array.isArray(row.aliases) || !row.aliases.every((item) => safeId(item)) || new Set(row.aliases).size !== row.aliases.length)) return invalid('SKILL_REF_INVALID', 'Skill aliases must be unique identifiers.');
  return { success: true, value: value as SkillRef };
}

function validQuickActions(value: unknown): value is CapsuleQuickActionV2[] {
  return Array.isArray(value) && value.every((action) => isRecord(action)
    && safeId(action.actionId)
    && safeId(action.label)
    && ['open', 'pause', 'resume', 'cancel', 'retry', 'approve', 'dismiss'].includes(String(action.kind))
    && typeof action.requiresApproval === 'boolean'
    && typeof action.enabled === 'boolean')
    && new Set(value.map((action) => (action as CapsuleQuickActionV2).actionId)).size === value.length;
}

function validResultCard(value: unknown): value is ResultCardV2 {
  return isRecord(value)
    && safeId(value.title)
    && safeId(value.summary, 50_000)
    && ['success', 'partial', 'failure', 'cancelled'].includes(String(value.outcome))
    && Array.isArray(value.artifactIds)
    && value.artifactIds.every((item) => safeId(item))
    && (value.completedAt === undefined || isoTimestamp(value.completedAt));
}

export function parseCapsulePresentationV2(value: unknown): ParseResult<CapsulePresentationV2> {
  const unsafe = requireSafeRecord(value, 'CAPSULE_PRESENTATION');
  if (unsafe) return unsafe as ParseResult<CapsulePresentationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('CAPSULE_PRESENTATION_VERSION_REQUIRED', 'Capsule presentation requires V2.1 metadata.');
  if (!safeId(row.capsuleId) || !['compact', 'expanded', 'mission'].includes(String(row.mode)) || !['visible', 'hidden', 'minimized'].includes(String(row.visibility)) || typeof row.fullscreen !== 'boolean') return invalid('CAPSULE_PRESENTATION_INVALID', 'Capsule presentation state is invalid.');
  if (!validQuickActions(row.quickActions) || !['low', 'normal', 'high', 'urgent'].includes(String(row.priority))) return invalid('CAPSULE_PRESENTATION_INVALID', 'Capsule actions or priority are invalid.');
  if (row.queuePosition !== undefined && !finiteInteger(row.queuePosition, 1)) return invalid('CAPSULE_PRESENTATION_INVALID', 'queuePosition must be a positive integer.');
  if (row.resultCard !== undefined && !validResultCard(row.resultCard)) return invalid('CAPSULE_PRESENTATION_INVALID', 'Capsule result card is invalid.');
  return { success: true, value: value as CapsulePresentationV2 };
}

export function parseMissionPresentationV2(value: unknown): ParseResult<MissionPresentationV2> {
  const unsafe = requireSafeRecord(value, 'MISSION_PRESENTATION');
  if (unsafe) return unsafe as ParseResult<MissionPresentationV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('MISSION_PRESENTATION_VERSION_REQUIRED', 'Mission presentation requires V2.1 metadata.');
  if (!safeId(row.missionId) || !['compact', 'expanded', 'mission'].includes(String(row.mode)) || !['visible', 'hidden', 'minimized'].includes(String(row.visibility)) || typeof row.fullscreen !== 'boolean' || !validQuickActions(row.quickActions)) return invalid('MISSION_PRESENTATION_INVALID', 'Mission presentation state is invalid.');
  if (!Array.isArray(row.queueOrder) || !row.queueOrder.every((item) => safeId(item)) || new Set(row.queueOrder).size !== row.queueOrder.length) return invalid('MISSION_PRESENTATION_INVALID', 'Mission queue order must contain unique capsule IDs.');
  if (row.focusedCapsuleId !== undefined && (!safeId(row.focusedCapsuleId) || !row.queueOrder.includes(row.focusedCapsuleId))) return invalid('MISSION_PRESENTATION_INVALID', 'Focused capsule must exist in queueOrder.');
  if (row.resultCard !== undefined && !validResultCard(row.resultCard)) return invalid('MISSION_PRESENTATION_INVALID', 'Mission result card is invalid.');
  return { success: true, value: value as MissionPresentationV2 };
}

function parseResearchSource(value: unknown): ParseResult<ResearchSourceV2> {
  if (!isRecord(value) || !safeId(value.sourceId) || !safeId(value.url, 4_096) || !isoTimestamp(value.retrievedAt) || !isRecord(value.safety)) return invalid('RESEARCH_SOURCE_INVALID', 'Research source identity, URL, timestamp, or safety evidence is invalid.');
  let url: URL;
  try { url = new URL(value.url as string); } catch { return invalid('RESEARCH_SOURCE_INVALID', 'Research source URL is malformed.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return invalid('RESEARCH_SOURCE_INVALID', 'Research sources require credential-free HTTP(S) URLs.');
  const forbiddenQuery = ['token', 'api_key', 'apikey', 'key', 'signature', 'secret', 'password'];
  if ([...url.searchParams.keys()].some((key) => forbiddenQuery.includes(key.toLocaleLowerCase('en-US')))) return invalid('RESEARCH_SOURCE_SECRET_URL', 'Research source URL contains a secret-bearing query field.');
  const safety = value.safety;
  if (typeof safety.schemeValidated !== 'boolean' || typeof safety.redirectsValidated !== 'boolean' || typeof safety.retrievedByBackend !== 'boolean' || !safeId(safety.ssrfPolicyVersion)) return invalid('RESEARCH_SOURCE_INVALID', 'Research source SSRF evidence is incomplete.');
  if (!['public', 'private', 'loopback', 'link_local', 'local', 'unknown'].includes(String(safety.resolvedTargetClass))) return invalid('RESEARCH_SOURCE_INVALID', 'Research source target class is invalid.');
  const host = url.hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '');
  const obviouslyNonPublic = host === 'localhost' || host === '::1' || host === '0.0.0.0'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (obviouslyNonPublic && safety.resolvedTargetClass === 'public') return invalid('RESEARCH_SOURCE_SSRF_EVIDENCE_MISMATCH', 'Obvious non-public targets cannot be classified as public.');
  if (safety.resolvedTargetClass !== 'public' && safety.decision !== 'blocked') return invalid('RESEARCH_SOURCE_SSRF_BLOCK_REQUIRED', 'Non-public research targets must carry a blocked decision.');
  if (value.contentSha256 !== undefined && !sha256(value.contentSha256)) return invalid('RESEARCH_SOURCE_INVALID', 'Research source contentSha256 is invalid.');
  if (value.canonicalUrl !== undefined && !safeId(value.canonicalUrl, 4_096)) return invalid('RESEARCH_SOURCE_INVALID', 'Research canonical URL is invalid.');
  if (value.retriever !== undefined && !parseSkillRef(value.retriever).success) return invalid('RESEARCH_SOURCE_INVALID', 'Research retriever skill is invalid.');
  return { success: true, value: value as unknown as ResearchSourceV2 };
}

export function parseResearchRunV2(value: unknown): ParseResult<ResearchRunV2> {
  const unsafe = requireSafeRecord(value, 'RESEARCH_RUN');
  if (unsafe) return unsafe as ParseResult<ResearchRunV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.runId) || !safeId(row.query, 10_000) || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(String(row.status)) || !Array.isArray(row.sourceIds) || !Array.isArray(row.artifactIds)) return invalid('RESEARCH_RUN_INVALID', 'Research run core metadata is invalid.');
  if (!row.sourceIds.every((id) => safeId(id)) || new Set(row.sourceIds).size !== row.sourceIds.length || !row.artifactIds.every((id) => safeId(id))) return invalid('RESEARCH_RUN_INVALID', 'Research source and artifact IDs must be valid and source IDs unique.');
  if (row.mode !== undefined && !['FAST', 'DEEP', 'BROWSER'].includes(String(row.mode))) return invalid('RESEARCH_RUN_INVALID', 'Research mode is invalid.');
  const sources = Array.isArray(row.sources) ? row.sources : [];
  if (row.mode === 'BROWSER' && row.status === 'completed' && sources.length === 0) return invalid('RESEARCH_RUN_INVALID', 'Completed BROWSER research requires typed sources.');
  const sourceIds = new Set<string>();
  for (const source of sources) {
    const parsed = parseResearchSource(source);
    if (!parsed.success) return parsed as ParseResult<ResearchRunV2>;
    if (sourceIds.has(parsed.value.sourceId)) return invalid('RESEARCH_REFERENCE_INVALID', 'Research source IDs must be unique.');
    sourceIds.add(parsed.value.sourceId);
  }
  if (sources.length && (!row.sourceIds.every((id) => sourceIds.has(String(id))) || sourceIds.size !== row.sourceIds.length)) return invalid('RESEARCH_REFERENCE_INVALID', 'sourceIds must match typed sources.');
  const citations = Array.isArray(row.citations) ? row.citations : [];
  const citationIds = new Set<string>();
  for (const citation of citations) {
    if (!isRecord(citation) || !safeId(citation.citationId) || !safeId(citation.sourceId) || !sourceIds.has(citation.sourceId as string) || citationIds.has(citation.citationId as string)) return invalid('RESEARCH_REFERENCE_INVALID', 'Citation references are invalid.');
    if (citation.excerptSha256 !== undefined && !sha256(citation.excerptSha256)) return invalid('RESEARCH_REFERENCE_INVALID', 'Citation excerptSha256 is invalid.');
    citationIds.add(citation.citationId as string);
  }
  const claims = Array.isArray(row.claims) ? row.claims : [];
  const claimIds = new Set<string>();
  for (const claim of claims) {
    if (!isRecord(claim) || !safeId(claim.claimId) || claimIds.has(claim.claimId as string) || !safeId(claim.statement, 50_000) || typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1 || !Array.isArray(claim.citationIds) || !claim.citationIds.every((id) => citationIds.has(String(id)))) return invalid('RESEARCH_CLAIM_INVALID', 'Research claim or citation linkage is invalid.');
    claimIds.add(claim.claimId as string);
  }
  if (row.confidence !== undefined && (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1)) return invalid('RESEARCH_RUN_INVALID', 'Research confidence must be between 0 and 1.');
  if (row.provenance !== undefined) {
    if (!isRecord(row.provenance) || !safeId(row.provenance.generatedBy) || !isoTimestamp(row.provenance.generatedAt) || !Array.isArray(row.provenance.sourceIds) || !row.provenance.sourceIds.every((id) => sourceIds.has(String(id))) || !safeId(row.provenance.methodology, 10_000)) return invalid('RESEARCH_PROVENANCE_INVALID', 'Research provenance is invalid.');
  }
  if (row.freshness !== undefined && (!isRecord(row.freshness) || !isoTimestamp(row.freshness.checkedAt) || !['fresh', 'mixed', 'stale', 'unknown'].includes(String(row.freshness.status)))) return invalid('RESEARCH_FRESHNESS_INVALID', 'Research freshness metadata is invalid.');
  if (row.priorRunDelta !== undefined) {
    const delta = row.priorRunDelta;
    if (!isRecord(delta) || !safeId(delta.previousRunId) || !Array.isArray(delta.addedClaimIds) || !Array.isArray(delta.changedClaimIds) || !Array.isArray(delta.removedClaimIds) || !safeId(delta.summary, 10_000)) return invalid('RESEARCH_DELTA_INVALID', 'Research prior-run delta is invalid.');
  }
  return { success: true, value: value as ResearchRunV2 };
}

function validContractSchema(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 6 || !['string', 'number', 'boolean', 'object', 'array'].includes(String(value.type))) return false;
  if (value.required !== undefined && typeof value.required !== 'boolean') return false;
  if (value.properties !== undefined && (!isRecord(value.properties) || !Object.values(value.properties).every((item) => validContractSchema(item, depth + 1)))) return false;
  if (value.items !== undefined && !validContractSchema(value.items, depth + 1)) return false;
  return true;
}

export function parsePlaybookStepV2(value: unknown): ParseResult<PlaybookStepV2> {
  const unsafe = requireSafeRecord(value, 'PLAYBOOK_STEP');
  if (unsafe) return unsafe as ParseResult<PlaybookStepV2>;
  const row = value as Record<string, unknown>;
  if (!isV21(row)) return invalid('PLAYBOOK_STEP_VERSION_REQUIRED', 'Playbook step requires V2.1 metadata.');
  if (!safeId(row.stepId) || !safeId(row.title) || !Array.isArray(row.dependsOn) || !row.dependsOn.every((item) => safeId(item))) return invalid('PLAYBOOK_STEP_INVALID', 'Playbook step identity or dependencies are invalid.');
  if (!isRecord(row.inputSchema) || !Object.values(row.inputSchema).every((item) => validContractSchema(item)) || !isRecord(row.outputSchema) || !Object.values(row.outputSchema).every((item) => validContractSchema(item))) return invalid('PLAYBOOK_STEP_INVALID', 'Playbook schemas are invalid.');
  if (!Array.isArray(row.skills) || !row.skills.every((skill) => parseSkillRef(skill).success) || !Array.isArray(row.tools) || !row.tools.every((item) => safeId(item)) || !Array.isArray(row.permissions) || !row.permissions.every((item) => safeId(item))) return invalid('PLAYBOOK_STEP_INVALID', 'Playbook skills, tools, or permissions are invalid.');
  if (!finiteInteger(row.riskLevel) || row.riskLevel > 5 || !['none', 'owner', 'policy'].includes(String(row.approval)) || !finiteInteger(row.timeoutMs, 1)) return invalid('PLAYBOOK_STEP_INVALID', 'Playbook risk, approval, or timeout is invalid.');
  if (!isRecord(row.retry) || !finiteInteger(row.retry.maxAttempts, 1) || !finiteInteger(row.retry.backoffMs) || !Array.isArray(row.retry.retryableErrorCodes)) return invalid('PLAYBOOK_STEP_INVALID', 'Playbook retry policy is invalid.');
  if (!isRecord(row.verification) || typeof row.verification.required !== 'boolean' || !Array.isArray(row.verification.criteria) || !isRecord(row.undo) || typeof row.undo.supported !== 'boolean') return invalid('PLAYBOOK_STEP_INVALID', 'Playbook verification or undo policy is invalid.');
  if (row.undo.supported && !safeId(row.undo.toolId) && !safeId(row.undo.instructions)) return invalid('PLAYBOOK_STEP_INVALID', 'Supported undo requires a tool or instructions.');
  return { success: true, value: value as PlaybookStepV2 };
}

export function parsePlaybookDefinitionV2(value: unknown): ParseResult<PlaybookDefinitionV2> {
  const unsafe = requireSafeRecord(value, 'PLAYBOOK_DEFINITION');
  if (unsafe) return unsafe as ParseResult<PlaybookDefinitionV2>;
  const row = value as Record<string, unknown>;
  if (![row.playbookId, row.version, row.title].every((item) => safeId(item)) || !Array.isArray(row.skills) || !row.skills.every((skill) => parseSkillRef(skill).success) || !Array.isArray(row.stepIds) || !row.stepIds.every((item) => safeId(item))) return invalid('PLAYBOOK_DEFINITION_INVALID', 'Playbook definition identity is invalid.');
  if (new Set(row.stepIds).size !== row.stepIds.length) return invalid('PLAYBOOK_DEFINITION_INVALID', 'Playbook stepIds must be unique.');
  if (row.steps === undefined) return { success: true, value: value as PlaybookDefinitionV2 };
  if (!Array.isArray(row.steps) || !row.steps.every((step) => parsePlaybookStepV2(step).success)) return invalid('PLAYBOOK_DEFINITION_INVALID', 'Playbook steps are invalid.');
  const steps = row.steps as unknown as PlaybookStepV2[];
  const ids = steps.map((step) => step.stepId);
  if (new Set(ids).size !== ids.length || ids.length !== row.stepIds.length || ids.some((id, index) => id !== row.stepIds[index])) return invalid('PLAYBOOK_DEFINITION_INVALID', 'stepIds must exactly match ordered steps.');
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  if (steps.some((step) => step.dependsOn.some((dependency) => !byId.has(dependency)))) return invalid('PLAYBOOK_DEPENDENCY_INVALID', 'Playbook contains an unknown dependency.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const found = byId.get(id)?.dependsOn.some(cyclic) ?? false;
    visiting.delete(id);
    visited.add(id);
    return found;
  };
  if (ids.some(cyclic)) return invalid('PLAYBOOK_DEPENDENCY_CYCLE', 'Playbook dependencies must form a DAG.');
  return { success: true, value: value as PlaybookDefinitionV2 };
}

export function parsePlaybookRunV2(value: unknown, definition?: PlaybookDefinitionV2): ParseResult<PlaybookRunV2> {
  const unsafe = requireSafeRecord(value, 'PLAYBOOK_RUN');
  if (unsafe) return unsafe as ParseResult<PlaybookRunV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.runId) || !isRecord(row.playbook) || !safeId(row.playbook.playbookId) || !safeId(row.playbook.version) || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(String(row.status))) return invalid('PLAYBOOK_RUN_INVALID', 'Playbook run identity is invalid.');
  if (definition && (row.playbook.playbookId !== definition.playbookId || row.playbook.version !== definition.version)) return invalid('PLAYBOOK_RUN_DEFINITION_MISMATCH', 'Playbook run does not match its definition.');
  if (row.stepRuns !== undefined && (!Array.isArray(row.stepRuns) || row.stepRuns.some((step) => !isRecord(step) || !safeId(step.stepId) || !finiteInteger(step.attempt, 1) || (definition && !definition.stepIds.includes(step.stepId as string))))) return invalid('PLAYBOOK_RUN_INVALID', 'Playbook step run metadata is invalid.');
  return { success: true, value: value as PlaybookRunV2 };
}

function parseRealtimePayload(event: RealtimeEventName, payload: unknown): ParseResult<unknown> {
  const taskTypes: Partial<Record<RealtimeEventName, TaskEventTypeV2>> = {
    [REALTIME_EVENT_NAMES.TASK_CREATED]: 'task.created',
    [REALTIME_EVENT_NAMES.TASK_STATUS_CHANGED]: 'task.status_changed',
    [REALTIME_EVENT_NAMES.TASK_STEP_UPDATED]: 'task.step_updated',
    [REALTIME_EVENT_NAMES.TASK_TOOL_STARTED]: 'task.tool_started',
    [REALTIME_EVENT_NAMES.TASK_TOOL_COMPLETED]: 'task.tool_completed',
    [REALTIME_EVENT_NAMES.TASK_VERIFICATION_COMPLETED]: 'task.verification_completed',
    [REALTIME_EVENT_NAMES.TASK_RECOVERY_STARTED]: 'task.recovery_started',
    [REALTIME_EVENT_NAMES.TASK_COMPLETED]: 'task.completed',
    [REALTIME_EVENT_NAMES.TASK_FAILED]: 'task.failed',
    [REALTIME_EVENT_NAMES.TASK_CANCELLED]: 'task.cancelled',
  };
  if (event === REALTIME_EVENT_NAMES.TASK_EVENT) return parseTaskEventV2(payload);
  const taskType = taskTypes[event];
  if (taskType) return parseTaskEventPayload(taskType, payload);
  if (!isRecord(payload)) return invalid('INVALID_REALTIME_PAYLOAD', `${event} payload must be an object.`);
  if (event === REALTIME_EVENT_NAMES.TASK_PROGRESS) {
    if (!safeId(payload.taskId) || typeof payload.percent !== 'number' || payload.percent < 0 || payload.percent > 100) return invalid('INVALID_REALTIME_PAYLOAD', 'Task progress payload is invalid.');
  } else if (event === REALTIME_EVENT_NAMES.PAIRING_STATUS) {
    if (!safeId(payload.pairingId) || !['requested', 'approved', 'rejected', 'expired', 'revoked'].includes(String(payload.status))) return invalid('INVALID_REALTIME_PAYLOAD', 'Pairing status payload is invalid.');
  } else if (event === REALTIME_EVENT_NAMES.DEVICE_STATUS) {
    if (!safeId(payload.deviceId) || !['pending', 'trusted', 'revoked', 'expired'].includes(String(payload.status))) return invalid('INVALID_REALTIME_PAYLOAD', 'Device status payload is invalid.');
  } else if (event === REALTIME_EVENT_NAMES.FILE_TRANSFER_STATUS) {
    if (!safeId(payload.transferId) || !['pending', 'transferring', 'completed', 'failed', 'cancelled'].includes(String(payload.status))) return invalid('INVALID_REALTIME_PAYLOAD', 'File transfer status payload is invalid.');
  } else if (event === REALTIME_EVENT_NAMES.EMERGENCY_STOP_ACTIVATED) {
    return parseMobileEmergencyStopEventV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS) {
    return parseCrossDeviceTransferV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_CLIPBOARD_STATUS) {
    return parseCrossDeviceClipboardMetadataV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_STATUS) {
    return parseCrossDeviceLiveViewSessionV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_FRAME_METADATA) {
    return parseCrossDeviceLiveViewFrameMetadataV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_WAKE_READY_STATUS) {
    return parseCrossDeviceWakeReadyV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS) {
    return parseCrossDeviceOfflineQueueItemV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS) {
    return parseCrossDeviceHandoffIntentV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_RESULT_CARD_UPDATED) {
    return parseSharedResultCardV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS) {
    return parseCrossDeviceAudioHandoffV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CROSS_DEVICE_PC_STATUS_UPDATED) {
    return parseCrossDevicePcStatusV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.CAPSULE_UPDATED) {
    return parseCapsulePresentationV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.MISSION_UPDATED) {
    return parseMissionPresentationV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.DESKTOP_OBSERVATION) {
    return parseDesktopObservationV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.DESKTOP_ACTION_REQUESTED) {
    return parseDesktopActionV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.DESKTOP_ACTION_DISPATCH) {
    return parseActionDispatchV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.DESKTOP_ACTION_VERIFICATION) {
    return parseActionVerificationV2(payload);
  } else if (event === REALTIME_EVENT_NAMES.DESKTOP_RETRY_DECISION) {
    return parseRetryDecisionV2(payload);
  }
  return { success: true, value: payload };
}

export const REALTIME_PAYLOAD_VALIDATORS: Record<RealtimeEventName, (value: unknown) => boolean> = Object.fromEntries(
  Object.values(REALTIME_EVENT_NAMES).map((event) => [event, (value: unknown) => validateNoSecretMaterial(value).success && parseRealtimePayload(event, value).success]),
) as Record<RealtimeEventName, (value: unknown) => boolean>;

export function parseRealtimeEnvelopeV2_1(value: unknown): ParseResult<TypedRealtimeEnvelopeV2> {
  const unsafe = requireSafeRecord(value, 'REALTIME_ENVELOPE');
  if (unsafe) return unsafe as ParseResult<TypedRealtimeEnvelopeV2>;
  const compatible = parseRealtimeEnvelope(value);
  if (!compatible.success) return compatible as ParseResult<TypedRealtimeEnvelopeV2>;
  const row = value as Record<string, unknown>;
  if (!safeId(row.streamId) || !finiteInteger(row.cursor) || !safeId(row.correlationId) || typeof row.replayed !== 'boolean' || !isoTimestamp(row.occurredAt)) return invalid('INVALID_REALTIME_V2_1_ENVELOPE', 'V2.1 realtime stream, cursor, correlation, replay, or timestamp metadata is invalid.');
  if (row.causationId !== undefined && (!safeId(row.causationId) || row.causationId === row.eventId)) return invalid('INVALID_CAUSATION', 'Realtime causation metadata is invalid.');
  if (row.replayed) {
    if (!isRecord(row.replay) || !finiteInteger(row.replay.windowStartCursor) || !finiteInteger(row.replay.windowEndCursor) || row.replay.windowStartCursor > row.replay.windowEndCursor || row.cursor < row.replay.windowStartCursor || row.cursor > row.replay.windowEndCursor || typeof row.replay.truncated !== 'boolean') return invalid('INVALID_REPLAY_WINDOW', 'Replayed events require a valid replay window containing the cursor.');
  }
  const payload = parseRealtimePayload(row.event as RealtimeEventName, row.payload);
  if (!payload.success) return payload as ParseResult<TypedRealtimeEnvelopeV2>;
  return { success: true, value: value as TypedRealtimeEnvelopeV2 };
}

function timelineRows(task: TaskLike): TimelineLike[] {
  return Array.isArray(task.timeline) ? task.timeline.filter(isRecord) as TimelineLike[] : [];
}

export interface TaskNormalizationWarningV2 {
  code: 'UNKNOWN_TASK_STATUS';
  path: 'status';
  originalStatus: string;
  fallbackStatus: 'FAILED';
  message: string;
}

export interface TaskNormalizationDiagnosticsV2 {
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  warnings: TaskNormalizationWarningV2[];
}

export type TaskEventQuarantineReasonV2 =
  | 'LEGACY_TASK_EVENT_UNSUPPORTED'
  | 'INVALID_CANONICAL_TASK_EVENT'
  | 'TASK_EVENT_TASK_MISMATCH'
  | 'TASK_EVENT_AHEAD_OF_SNAPSHOT';

export type TaskLegacyTimelineTypeV2 =
  | 'status' | 'plan' | 'agent' | 'tool' | 'verification' | 'recovery'
  | 'memory' | 'checkpoint' | 'artifact' | 'observation' | 'permission' | 'audit';

export interface TaskEventQuarantineEntryV2 {
  sourceIndex: number;
  source: 'task_timeline';
  legacyType: TaskLegacyTimelineTypeV2 | 'unsupported';
  producer: 'edith-task-service' | 'unknown';
  reasonCode: TaskEventQuarantineReasonV2;
}

export interface TaskEventQuarantineDiagnosticsV2 {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  scope: 'task';
  taskId: string;
  sourceEventCount: number;
  canonicalEventCount: number;
  quarantinedEventCount: number;
  truncated: boolean;
  entries: TaskEventQuarantineEntryV2[];
}

export interface TaskEventProjectionV2 {
  events: TypedTaskEventV2[];
  diagnostics: TaskEventQuarantineDiagnosticsV2;
}

function normalizeLegacyTaskValue<T extends TaskLike>(input: T): T & TaskV2Metadata {
  const rows = timelineRows(input);
  const parsedStatus = parseTaskStatus(input.status);
  let cursor = 0;
  const timeline = rows.map((event) => {
    const sequence = positiveInteger(event.sequence, cursor + 1);
    cursor = Math.max(cursor, sequence);
    return {
      ...event,
      contractVersion: TASK_CONTRACT_VERSION,
      sequence,
      revision: positiveInteger(event.revision, sequence),
    };
  });
  return {
    ...input,
    status: parsedStatus.success ? parsedStatus.value : 'FAILED',
    dependencies: Array.isArray((input as Record<string, unknown>).dependencies) ? (input as Record<string, unknown>).dependencies : [],
    subtasks: Array.isArray((input as Record<string, unknown>).subtasks) ? (input as Record<string, unknown>).subtasks : [],
    candidateAgents: Array.isArray((input as Record<string, unknown>).candidateAgents) ? (input as Record<string, unknown>).candidateAgents : [],
    toolsRequired: Array.isArray((input as Record<string, unknown>).toolsRequired) ? (input as Record<string, unknown>).toolsRequired : [],
    permissionsRequired: Array.isArray((input as Record<string, unknown>).permissionsRequired) ? (input as Record<string, unknown>).permissionsRequired : [],
    checkpoints: Array.isArray((input as Record<string, unknown>).checkpoints) ? (input as Record<string, unknown>).checkpoints : [],
    artifacts: Array.isArray((input as Record<string, unknown>).artifacts) ? (input as Record<string, unknown>).artifacts : [],
    observations: Array.isArray((input as Record<string, unknown>).observations) ? (input as Record<string, unknown>).observations : [],
    validationRules: Array.isArray((input as Record<string, unknown>).validationRules) ? (input as Record<string, unknown>).validationRules : [],
    recoveryEvents: Array.isArray(input.recoveryEvents) ? input.recoveryEvents : [],
    agentActivity: Array.isArray((input as Record<string, unknown>).agentActivity) ? (input as Record<string, unknown>).agentActivity : [],
    memoryReferences: Array.isArray((input as Record<string, unknown>).memoryReferences) ? (input as Record<string, unknown>).memoryReferences : [],
    auditEvents: Array.isArray((input as Record<string, unknown>).auditEvents) ? (input as Record<string, unknown>).auditEvents : [],
    contractVersion: TASK_CONTRACT_VERSION,
    revision: positiveInteger(input.revision, 1),
    eventSequence: Math.max(nonNegativeInteger(input.eventSequence, 0), cursor),
    timeline,
  } as T & TaskV2Metadata;
}

export function normalizeLegacyTaskWithDiagnostics<T extends TaskLike>(input: T): {
  task: T & TaskV2Metadata;
  diagnostics: TaskNormalizationDiagnosticsV2;
} {
  const parsedStatus = parseTaskStatus(input.status);
  const originalStatus = typeof input.status === 'string'
    ? input.status.slice(0, 128)
    : Object.prototype.toString.call(input.status);
  return {
    task: normalizeLegacyTaskValue(input),
    diagnostics: {
      amendment: EDITH_CONTRACT_AMENDMENT,
      warnings: parsedStatus.success ? [] : [{
        code: 'UNKNOWN_TASK_STATUS',
        path: 'status',
        originalStatus,
        fallbackStatus: 'FAILED',
        message: 'Unknown legacy task status was preserved as migration evidence and normalized to FAILED.',
      }],
    },
  };
}

export function normalizeLegacyTask<T extends TaskLike>(input: T): T & TaskV2Metadata {
  return normalizeLegacyTaskWithDiagnostics(input).task;
}

export function prepareTaskCreate<T extends TaskLike>(input: T): T & TaskV2Metadata {
  const normalized = normalizeLegacyTask(input);
  return { ...normalized, revision: 1 };
}

export function prepareTaskMutation<T extends TaskLike>(previousInput: T, nextInput: T): T & TaskV2Metadata {
  const previous = normalizeLegacyTask(previousInput);
  const previousById = new Map<string, TimelineLike>();
  for (const event of timelineRows(previous)) {
    if (typeof event.id === 'string') previousById.set(event.id, event);
  }

  const revision = previous.revision + 1;
  let cursor = previous.eventSequence;
  const candidateRows = timelineRows(nextInput);
  const candidatesById = new Map(candidateRows.flatMap((event) => typeof event.id === 'string' ? [[event.id, event] as const] : []));
  const rows = [
    ...timelineRows(previous).map((event) => typeof event.id === 'string' ? candidatesById.get(event.id) ?? event : event),
    ...candidateRows.filter((event) => typeof event.id !== 'string' || !previousById.has(event.id)),
  ];
  const timeline = rows.map((event) => {
    const prior = typeof event.id === 'string' ? previousById.get(event.id) : undefined;
    const sequence = prior ? positiveInteger(prior.sequence, cursor + 1) : cursor + 1;
    cursor = Math.max(cursor, sequence);
    return {
      ...event,
      contractVersion: TASK_CONTRACT_VERSION,
      sequence,
      revision: prior ? positiveInteger(prior.revision, previous.revision) : revision,
    };
  });

  return {
    ...nextInput,
    contractVersion: TASK_CONTRACT_VERSION,
    revision,
    eventSequence: cursor,
    timeline,
  } as T & TaskV2Metadata;
}

const TASK_EVENT_QUARANTINE_LIMIT = 100;
const LEGACY_TASK_TIMELINE_TYPES = new Set<TaskLegacyTimelineTypeV2>([
  'status', 'plan', 'agent', 'tool', 'verification', 'recovery',
  'memory', 'checkpoint', 'artifact', 'observation', 'permission', 'audit',
]);

function diagnosticTaskId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : 'unknown-task';
}

function legacyTimelineType(value: unknown): TaskLegacyTimelineTypeV2 | 'unsupported' {
  return typeof value === 'string' && LEGACY_TASK_TIMELINE_TYPES.has(value as TaskLegacyTimelineTypeV2)
    ? value as TaskLegacyTimelineTypeV2
    : 'unsupported';
}

export function projectTaskEventsV2(taskInput: TaskLike): TaskEventProjectionV2 {
  const task = normalizeLegacyTask(taskInput);
  const taskId = diagnosticTaskId(task.id);
  const rows = timelineRows(task);
  const events: TypedTaskEventV2[] = [];
  const entries: TaskEventQuarantineEntryV2[] = [];
  let quarantinedEventCount = 0;

  rows.forEach((event, sourceIndex) => {
    const row = event as Record<string, unknown>;
    const parsed = parseTaskEventV2(event);
    let reasonCode: TaskEventQuarantineReasonV2 | undefined;
    if (parsed.success) {
      if (parsed.value.taskId !== taskId) reasonCode = 'TASK_EVENT_TASK_MISMATCH';
      else if (parsed.value.sequence > task.eventSequence || parsed.value.revision > task.revision) reasonCode = 'TASK_EVENT_AHEAD_OF_SNAPSHOT';
      else {
        events.push({
          contractVersion: TASK_CONTRACT_VERSION,
          taskId: parsed.value.taskId,
          eventId: parsed.value.eventId,
          sequence: parsed.value.sequence,
          revision: parsed.value.revision,
          type: parsed.value.type,
          occurredAt: parsed.value.occurredAt,
          payload: structuredClone(parsed.value.payload),
          context: structuredClone(parsed.value.context),
        } as TypedTaskEventV2);
        return;
      }
    } else {
      reasonCode = legacyTimelineType(event.type) !== 'unsupported'
        ? 'LEGACY_TASK_EVENT_UNSUPPORTED'
        : 'INVALID_CANONICAL_TASK_EVENT';
    }

    quarantinedEventCount += 1;
    if (entries.length < TASK_EVENT_QUARANTINE_LIMIT) {
      entries.push({
        sourceIndex,
        source: 'task_timeline',
        legacyType: legacyTimelineType(event.type),
        producer: row.actor === 'edith-task-service' ? 'edith-task-service' : 'unknown',
        reasonCode,
      });
    }
  });

  return {
    events,
    diagnostics: {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      scope: 'task',
      taskId,
      sourceEventCount: rows.length,
      canonicalEventCount: events.length,
      quarantinedEventCount,
      truncated: quarantinedEventCount > entries.length,
      entries,
    },
  };
}

export function taskEventsV2(taskInput: TaskLike): TypedTaskEventV2[] {
  return projectTaskEventsV2(taskInput).events;
}

const STATUS_PROGRESS: Record<CanonicalTaskStatus, number> = {
  CREATED: 0,
  ANALYZING: 5,
  QUEUED: 5,
  PLANNING: 10,
  WAITING_DEPENDENCY: 10,
  RUNNING: 20,
  PAUSED: 20,
  RETRYING: 25,
  VERIFYING: 85,
  WAITING_PERMISSION: 20,
  WAITING_FOR_APPROVAL: 20,
  BLOCKED: 20,
  RECOVERING: 25,
  COMPLETED: 100,
  FAILED: 100,
  CANCELLED: 100,
  ROLLING_BACK: 90,
  ROLLED_BACK: 100,
};

export function deriveTaskProgress(taskInput: TaskLike): TaskProgressSnapshot {
  const task = normalizeLegacyTask(taskInput);
  const parsedStatus = parseTaskStatus(task.status);
  const status = parsedStatus.success ? parsedStatus.value : 'FAILED';
  const plan = isRecord(task.plan) ? task.plan : undefined;
  const steps = plan && Array.isArray(plan.steps) ? plan.steps.filter(isRecord) : [];
  const completedSteps = steps.filter((step) => step.status === 'COMPLETED' || step.status === 'SKIPPED').length;
  const failedSteps = steps.filter((step) => step.status === 'FAILED').length;
  const verification = isRecord(task.verification) ? task.verification : undefined;
  const verificationStatus = verification && typeof verification.status === 'string'
    && ['PASS', 'FAIL', 'PARTIAL', 'RETRYABLE'].includes(verification.status)
    ? verification.status as TaskProgressSnapshot['verificationStatus']
    : undefined;
  const recoveryAttempts = Array.isArray(task.recoveryEvents) ? task.recoveryEvents.length : 0;
  const sources: TaskProgressSnapshot['sources'] = ['task_status'];
  if (steps.length) sources.push('plan_steps');
  if (verificationStatus) sources.push('verification');
  if (recoveryAttempts) sources.push('recovery');

  const planPercent = steps.length ? Math.round((completedSteps / steps.length) * 80) : 0;
  let percent = Math.max(STATUS_PROGRESS[status], planPercent);
  if (verificationStatus === 'PASS' || status === 'COMPLETED') percent = 100;
  if (verificationStatus && verificationStatus !== 'PASS') percent = Math.max(percent, 85);

  return {
    contractVersion: TASK_CONTRACT_VERSION,
    taskId: typeof task.id === 'string' ? task.id : '',
    revision: task.revision,
    status,
    percent: Math.min(100, percent),
    completedSteps,
    totalSteps: steps.length,
    failedSteps,
    recoveryAttempts,
    verificationStatus,
    terminal: ['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'].includes(status),
    sources,
  };
}

export function parseTrustedNativeVaultSelectionV1(value: unknown): ParseResult<TrustedNativeVaultSelectionV1> {
  if (!isRecord(value) || !onlyKeys(value, ['contractVersion', 'amendment', 'selectionId', 'deviceId', 'source', 'selectedPath', 'userConfirmed', 'selectedAt', 'expiresAt'])) {
    return invalid('OBSIDIAN_NATIVE_SELECTION_INVALID', 'Native vault selection contains unknown or missing fields.');
  }
  if (!isV21(value) || !safeId(value.selectionId) || !safeId(value.deviceId) || value.source !== 'trusted_native_picker'
    || value.userConfirmed !== true || !safeId(value.selectedPath, 4096) || !isAbsoluteLocalPath(String(value.selectedPath))
    || !isoTimestamp(value.selectedAt) || !isoTimestamp(value.expiresAt)
    || Date.parse(String(value.expiresAt)) <= Date.parse(String(value.selectedAt))
    || Date.parse(String(value.expiresAt)) - Date.parse(String(value.selectedAt)) > 5 * 60_000) {
    return invalid('OBSIDIAN_NATIVE_SELECTION_INVALID', 'Native vault selection identity, path, confirmation, or expiry is invalid.');
  }
  if (findUnsafeContractField(value)) return invalid('OBSIDIAN_NATIVE_SELECTION_SENSITIVE', 'Native vault selection contains forbidden sensitive data.');
  return { success: true, value: value as unknown as TrustedNativeVaultSelectionV1 };
}

export function parseObsidianProviderLocalConfigV1(value: unknown): ParseResult<ObsidianProviderLocalConfigV1> {
  if (!isRecord(value) || !onlyKeys(value, ['schemaVersion', 'revision', 'provider', 'selectedPath', 'deviceId', 'selectionId', 'approvedAt', 'revokedAt', 'updatedAt'])) {
    return invalid('OBSIDIAN_PROVIDER_CONFIG_INVALID', 'Obsidian provider configuration contains unknown fields.');
  }
  if (value.schemaVersion !== OBSIDIAN_PROVIDER_CONFIG_VERSION || !finiteInteger(value.revision, 1)
    || !['user_vault', 'revoked'].includes(String(value.provider)) || !isoTimestamp(value.updatedAt)) {
    return invalid('OBSIDIAN_PROVIDER_CONFIG_INVALID', 'Obsidian provider configuration version, revision, provider, or timestamp is invalid.');
  }
  if (value.provider === 'user_vault') {
    if (!safeId(value.selectedPath, 4096) || !isAbsoluteLocalPath(String(value.selectedPath)) || !safeId(value.deviceId)
      || !safeId(value.selectionId) || !isoTimestamp(value.approvedAt) || value.revokedAt !== undefined) {
      return invalid('OBSIDIAN_PROVIDER_CONFIG_INVALID', 'User vault configuration requires approved device-local selection metadata.');
    }
  } else if (value.selectedPath !== undefined || value.deviceId !== undefined || value.selectionId !== undefined
    || value.approvedAt !== undefined || !isoTimestamp(value.revokedAt)) {
    return invalid('OBSIDIAN_PROVIDER_CONFIG_INVALID', 'Revoked configuration must not retain a local vault path or selection identity.');
  }
  if (findUnsafeContractField(value)) return invalid('OBSIDIAN_PROVIDER_CONFIG_SENSITIVE', 'Obsidian provider configuration contains forbidden sensitive data.');
  return { success: true, value: value as unknown as ObsidianProviderLocalConfigV1 };
}

export function parseObsidianProviderPublicStatusV1(value: unknown): ParseResult<ObsidianProviderPublicStatusV1> {
  if (!isRecord(value) || !onlyKeys(value, ['contractVersion', 'amendment', 'state', 'reasonCode', 'provider', 'configured', 'available', 'readable', 'writable', 'selectionAction', 'promptPolicy', 'configRevision', 'executionAuthority', 'knowledgeOnly', 'checkedAt'])) {
    return invalid('OBSIDIAN_PROVIDER_STATUS_INVALID', 'Obsidian provider status contains unknown fields.');
  }
  if (!isV21(value) || !['FIRST_RUN_REQUIRED', 'READY', 'DEGRADED'].includes(String(value.state))
    || !['VAULT_SELECTION_REQUIRED', 'VAULT_SELECTION_REVOKED', 'VAULT_UNAVAILABLE', 'VAULT_READY', 'TEST_SANDBOX_REQUIRED', 'TEST_SANDBOX_READY', 'CONFIG_INVALID'].includes(String(value.reasonCode))
    || !['none', 'user_vault', 'sandbox_vault'].includes(String(value.provider)) || typeof value.configured !== 'boolean'
    || typeof value.available !== 'boolean' || typeof value.readable !== 'boolean' || typeof value.writable !== 'boolean'
    || !['show_first_run', 'none'].includes(String(value.selectionAction)) || value.promptPolicy !== 'user_initiated_only'
    || !finiteInteger(value.configRevision) || value.executionAuthority !== false || value.knowledgeOnly !== true || !isoTimestamp(value.checkedAt)) {
    return invalid('OBSIDIAN_PROVIDER_STATUS_INVALID', 'Obsidian provider status is inconsistent or unsafe.');
  }
  if (findUnsafeContractField(value)) return invalid('OBSIDIAN_PROVIDER_STATUS_SENSITIVE', 'Obsidian provider status contains forbidden sensitive data.');
  const status = value as unknown as ObsidianProviderPublicStatusV1;
  if (status.state === 'READY' && (!status.configured || !status.available || !status.readable || status.selectionAction !== 'none')) {
    return invalid('OBSIDIAN_PROVIDER_STATUS_INCONSISTENT', 'Ready provider status requires a configured readable vault and no picker action.');
  }
  if (status.state === 'FIRST_RUN_REQUIRED' && (status.available || status.selectionAction !== 'show_first_run')) {
    return invalid('OBSIDIAN_PROVIDER_STATUS_INCONSISTENT', 'First-run status must require explicit user selection.');
  }
  if (status.state === 'DEGRADED' && status.selectionAction !== 'none') {
    return invalid('OBSIDIAN_PROVIDER_STATUS_INCONSISTENT', 'Unavailable configured vaults must not repeatedly request the picker.');
  }
  return { success: true, value: status };
}

const REDACTED_LOCAL_PATH = '[REDACTED_LOCAL_PATH]';
const SENSITIVE_PATH_KEYS = new Set(['vaultPath', 'obsidianVaultPath', 'absolutePath']);

function isAbsoluteLocalPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || value.startsWith('/');
}

function collectSensitivePaths(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitivePaths(item, paths));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item && (
      SENSITIVE_PATH_KEYS.has(key)
      || ((key === 'path' || key === 'previousPath') && isAbsoluteLocalPath(item))
    )) paths.add(item);
    collectSensitivePaths(item, paths);
  }
}

function redactPublicKnowledgeValue(value: unknown, sensitivePaths: string[]): unknown {
  if (typeof value === 'string') {
    return sensitivePaths.reduce((text, localPath) => text.split(localPath).join(REDACTED_LOCAL_PATH), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactPublicKnowledgeValue(item, sensitivePaths));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_PATH_KEYS.has(key)
      ? (typeof item === 'string' && item ? REDACTED_LOCAL_PATH : item)
      : (key === 'path' || key === 'previousPath') && typeof item === 'string' && isAbsoluteLocalPath(item)
        ? REDACTED_LOCAL_PATH
        : redactPublicKnowledgeValue(item, sensitivePaths);
  }
  return output;
}

export function toPublicKnowledgeDto<T>(value: T): T {
  const paths = new Set<string>();
  collectSensitivePaths(value, paths);
  const sensitivePaths = [...paths].sort((left, right) => right.length - left.length);
  return redactPublicKnowledgeValue(value, sensitivePaths) as T;
}
