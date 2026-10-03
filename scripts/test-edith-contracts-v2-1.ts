import assert from 'node:assert/strict';
import {
  EDITH_CONTRACT_AMENDMENT,
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  REALTIME_EVENT_NAMES,
  REALTIME_PAYLOAD_VALIDATORS,
  normalizeLegacyTaskWithDiagnostics,
  parseActionDispatchV2,
  parseActionVerificationV2,
  parseCapsulePresentationV2,
  parseDesktopActionV2,
  parseDesktopObservationV2,
  parseDesktopOperatorSessionV2,
  parseDeviceCapabilitiesV2,
  parseDeviceTrustV2,
  parseFileChunkManifestV2,
  parseFileTransferDescriptorV2,
  parseMissionPresentationV2,
  parseOwnerSessionBindingV2,
  parsePairingChallengeV2,
  parsePlaybookDefinitionV2,
  parsePlaybookRunV2,
  parsePlaybookStepV2,
  parseRealtimeEnvelopeV2_1,
  parseResearchRunV2,
  parseRetryDecisionV2,
  parseSafeDestinationV2,
  parseScopedApprovalV2,
  parseSemanticTargetV2,
  parseSkillRef,
  parseTaskEventV2,
  parseTransferEncryptionV2,
  parseTransferResumeV2,
  validateNoSecretMaterial,
  type CapsulePresentationV2,
  type MissionPresentationV2,
  type PlaybookDefinitionV2,
  type PlaybookStepV2,
} from '../src/edith/contracts';

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const now = '2026-09-28T10:00:00.000Z';
const later = '2026-09-28T11:00:00.000Z';
const v21 = { contractVersion: 2 as const, amendment: EDITH_CONTRACT_AMENDMENT };
const desktopStarted = new Date(Date.now() - 5_000).toISOString();
const desktopNow = new Date(Date.now() - 1_000).toISOString();
const desktopDeadline = new Date(Date.now() + 30_000).toISOString();
const desktopLater = new Date(Date.now() + 60_000).toISOString();

const action = {
  actionId: 'open-task', label: 'Open', kind: 'open' as const, requiresApproval: false, enabled: true,
};
const capsule: CapsulePresentationV2 = {
  ...v21,
  capsuleId: 'capsule-1', mode: 'compact', visibility: 'visible', fullscreen: false,
  quickActions: [action], queuePosition: 1, priority: 'high',
};
const mission: MissionPresentationV2 = {
  ...v21,
  missionId: 'mission-1', mode: 'mission', visibility: 'visible', fullscreen: true,
  focusedCapsuleId: 'capsule-1', queueOrder: ['capsule-1'], quickActions: [action],
};
const taskEvent = {
  contractVersion: 2 as const,
  taskId: 'task-1', eventId: 'event-1', sequence: 1, revision: 1,
  type: 'task.status_changed' as const, occurredAt: now,
  context: { correlationId: 'corr-1', idempotencyKey: 'idem-1', fromStatus: 'QUEUED' as const, toStatus: 'RUNNING' as const },
  payload: { fromStatus: 'QUEUED' as const, toStatus: 'RUNNING' as const },
};

const playbookStep: PlaybookStepV2 = {
  ...v21,
  stepId: 'collect', title: 'Collect evidence', dependsOn: [],
  inputSchema: { query: { type: 'string', required: true } },
  outputSchema: { artifactIds: { type: 'array', items: { type: 'string' } } },
  skills: [{ id: 'research', version: '1.0.0', source: 'builtin', namespace: 'edith', canonicalId: 'edith/research', aliases: ['research-fast'] }],
  tools: ['safe-fetch'], permissions: ['network:read'], riskLevel: 1, approval: 'policy',
  timeoutMs: 30_000, retry: { maxAttempts: 2, backoffMs: 250, retryableErrorCodes: ['TIMEOUT'] },
  verification: { required: true, criteria: ['artifact exists'] }, undo: { supported: false },
};
const secondStep: PlaybookStepV2 = { ...playbookStep, stepId: 'summarize', title: 'Summarize', dependsOn: ['collect'] };
const playbook: PlaybookDefinitionV2 = {
  ...v21,
  playbookId: 'research-playbook', version: '1.0.0', title: 'Research',
  skills: playbookStep.skills, stepIds: ['collect', 'summarize'], steps: [playbookStep, secondStep],
};

const desktopCapabilities = { screenshot: true, uia: true, accessibility: true, ocr: false, multiMonitor: false };
const logical = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, coordinateSpace: 'logical' as const });
const physical = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, coordinateSpace: 'physical_virtual_desktop' as const });
const desktopSession = {
  ...v21,
  sessionId: 'desktop-session-1', runtime: 'tauri' as const, state: 'observing' as const, mode: 'owner_command' as const,
  killSwitch: 'inactive' as const,
  currentObservationId: 'observation-7', currentGeneration: 7, capabilities: desktopCapabilities,
  startedAt: desktopStarted, updatedAt: desktopNow, expiresAt: desktopLater,
};
const desktopObservation = {
  ...v21,
  observationId: 'observation-7', sessionId: 'desktop-session-1', generation: 7,
  capturedAt: desktopNow, expiresAt: desktopLater,
  foreground: {
    hwndFingerprint: shaA, processId: 42, processName: 'example.exe', titleFingerprint: shaB,
    logicalBounds: logical(100, 100, 800, 600), physicalBounds: physical(100, 100, 800, 600),
  },
  virtualDesktop: {
    origin: { x: 0, y: 0 }, logicalBounds: logical(0, 0, 1920, 1080), physicalBounds: physical(0, 0, 1920, 1080),
  },
  monitor: {
    monitorId: 'monitor-1', origin: { x: 0, y: 0 }, logicalBounds: logical(0, 0, 1920, 1080),
    physicalBounds: physical(0, 0, 1920, 1080), dpiScale: 1,
  },
  source: 'composite' as const, confidence: 0.95, capabilities: desktopCapabilities,
};
const semanticTarget = {
  ...v21,
  targetId: 'target-1', observationId: 'observation-7', observationGeneration: 7,
  provenance: 'uia' as const, confidence: 0.9, role: 'button', automationIdFingerprint: shaA,
  physicalBounds: physical(200, 200, 120, 40), logicalBounds: logical(200, 200, 120, 40),
};
const scopedApproval = {
  ...v21,
  approvalId: 'approval-1', sessionId: 'desktop-session-1', observationId: 'observation-7', observationGeneration: 7,
  scope: { actions: ['clickMouse'] as Array<'clickMouse'>, targetIds: ['target-1'], physicalBounds: physical(100, 100, 800, 600), maxActions: 1 },
  grantedBy: 'owner' as const, grantedAt: desktopNow, expiresAt: desktopLater, consumedActionIds: [], status: 'active' as const,
};
const desktopAction = {
  ...v21,
  actionId: 'action-1', idempotencyKey: 'desktop-idem-1', sessionId: 'desktop-session-1', approvalId: 'approval-1',
  observationId: 'observation-7', observationGeneration: 7, kind: 'clickMouse' as const, target: semanticTarget,
  coordinates: { x: 240, y: 220 }, button: 'left' as const, expectedEffect: 'visual_change' as const,
  deadlineAt: desktopDeadline, retryBudget: { maxAttempts: 2 as const, attempt: 1, backoffMs: 250 },
};
const actionDispatch = {
  ...v21,
  dispatchId: 'dispatch-1', actionId: 'action-1', idempotencyKey: 'desktop-idem-1', sessionId: 'desktop-session-1', approvalId: 'approval-1',
  observationId: 'observation-7', observationGeneration: 7, status: 'dispatched' as const, attempt: 1, dispatchedAt: desktopNow,
};
const actionVerification = {
  ...v21,
  verificationId: 'verification-1', actionId: 'action-1', dispatchId: 'dispatch-1', expectedEffect: 'visual_change' as const,
  preObservationId: 'observation-7', preObservationGeneration: 7, postObservationId: 'observation-8', postObservationGeneration: 8,
  status: 'verified' as const, evidence: [{ kind: 'visual_change' as const, matched: true, observationId: 'observation-8', confidence: 0.88 }],
  confidence: 0.88, verifiedAt: desktopNow,
};
const retryDecision = {
  ...v21,
  decisionId: 'retry-1', actionId: 'action-1', verificationId: 'verification-1', decision: 'retry' as const,
  attempt: 1, maxAttempts: 2 as const, reasonCode: 'TRANSIENT_INPUT_FAILURE', requiresFreshObservation: false,
  nextAttemptAt: desktopDeadline, decidedAt: desktopNow,
};

function envelope(event: string, payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    schema: EDITH_CONTRACT_SCHEMA,
    version: EDITH_CONTRACT_VERSION,
    event,
    eventId: `rt-${event}`,
    occurredAt: now,
    sequence: 1,
    streamId: 'stream-1',
    cursor: 1,
    correlationId: 'corr-1',
    replayed: false,
    payload,
    ...overrides,
  };
}

assert.equal(EDITH_CONTRACT_AMENDMENT, '2.1');
for (const forbidden of ['secret', 'token', 'accessToken', 'refreshToken', 'apiKey', 'privateKey', 'plaintextKey', 'encryptionKey', 'rawProof', 'signature']) {
  assert.equal(validateNoSecretMaterial({ nested: [{ [forbidden]: 'must-not-pass' }] }).success, false, forbidden);
}

const normalized = normalizeLegacyTaskWithDiagnostics({ id: 'legacy', status: 'OLD_RUNNING' });
assert.equal(normalized.task.status, 'FAILED');
assert.equal(normalized.diagnostics.warnings[0]?.originalStatus, 'OLD_RUNNING');
assert.equal(normalizeLegacyTaskWithDiagnostics({ id: 'known', status: 'RUNNING' }).diagnostics.warnings.length, 0);

assert.equal(parseTaskEventV2(taskEvent).success, true);
assert.equal(parseTaskEventV2({ ...taskEvent, payload: { fromStatus: 'QUEUED', toStatus: 'COMPLETED' } }).success, false);
assert.equal(parseTaskEventV2({ ...taskEvent, metadata: { apiKey: 'must-not-pass' } }).success, false);

const eventFixtures: Record<string, unknown> = {
  [REALTIME_EVENT_NAMES.TASK_EVENT]: taskEvent,
  [REALTIME_EVENT_NAMES.TASK_PROGRESS]: { taskId: 'task-1', percent: 50 },
  [REALTIME_EVENT_NAMES.TASK_CREATED]: { status: 'QUEUED' },
  [REALTIME_EVENT_NAMES.TASK_STATUS_CHANGED]: { fromStatus: 'QUEUED', toStatus: 'RUNNING' },
  [REALTIME_EVENT_NAMES.TASK_STEP_UPDATED]: { stepId: 'step-1', status: 'RUNNING' },
  [REALTIME_EVENT_NAMES.TASK_TOOL_STARTED]: { toolId: 'tool-1', runId: 'run-1' },
  [REALTIME_EVENT_NAMES.TASK_TOOL_COMPLETED]: { toolId: 'tool-1', runId: 'run-1', outcome: 'success' },
  [REALTIME_EVENT_NAMES.TASK_VERIFICATION_COMPLETED]: { verificationId: 'verify-1', status: 'PASS' },
  [REALTIME_EVENT_NAMES.TASK_RECOVERY_STARTED]: { recoveryId: 'recovery-1', attempt: 1, classification: 'RETRYABLE' },
  [REALTIME_EVENT_NAMES.TASK_COMPLETED]: { resultArtifactIds: ['artifact-1'] },
  [REALTIME_EVENT_NAMES.TASK_FAILED]: { errorCode: 'FAILED_CHECK', retryable: false },
  [REALTIME_EVENT_NAMES.TASK_CANCELLED]: { reasonCode: 'OWNER_CANCELLED' },
  [REALTIME_EVENT_NAMES.PAIRING_STATUS]: { pairingId: 'pair-1', status: 'approved' },
  [REALTIME_EVENT_NAMES.DEVICE_STATUS]: { deviceId: 'device-1', status: 'trusted' },
  [REALTIME_EVENT_NAMES.FILE_TRANSFER_STATUS]: { transferId: 'transfer-1', status: 'transferring' },
  [REALTIME_EVENT_NAMES.EMERGENCY_STOP_ACTIVATED]: { ...v21, eventId: 'emergency-1', deviceId: 'device-1', workspaceId: 'workspace-1', sessionId: 'session-1', activatedAt: now, reasonCode: 'MOBILE_EMERGENCY_STOP', killSwitchActive: true },
  [REALTIME_EVENT_NAMES.CAPSULE_UPDATED]: capsule,
  [REALTIME_EVENT_NAMES.MISSION_UPDATED]: mission,
  [REALTIME_EVENT_NAMES.DESKTOP_OBSERVATION]: desktopObservation,
  [REALTIME_EVENT_NAMES.DESKTOP_ACTION_REQUESTED]: desktopAction,
  [REALTIME_EVENT_NAMES.DESKTOP_ACTION_DISPATCH]: actionDispatch,
  [REALTIME_EVENT_NAMES.DESKTOP_ACTION_VERIFICATION]: actionVerification,
  [REALTIME_EVENT_NAMES.DESKTOP_RETRY_DECISION]: retryDecision,
};
for (const [event, payload] of Object.entries(eventFixtures)) {
  assert.equal(REALTIME_PAYLOAD_VALIDATORS[event as keyof typeof REALTIME_PAYLOAD_VALIDATORS](payload), true, event);
  assert.equal(parseRealtimeEnvelopeV2_1(envelope(event, payload)).success, true, event);
}
assert.equal(REALTIME_PAYLOAD_VALIDATORS[REALTIME_EVENT_NAMES.TASK_PROGRESS]({ taskId: 'task-1', percent: 10, apiKey: 'secret' }), false);
assert.equal(parseRealtimeEnvelopeV2_1(envelope(REALTIME_EVENT_NAMES.TASK_FAILED, { taskId: 'task-1', percent: 10 })).success, false);
assert.equal(parseRealtimeEnvelopeV2_1(envelope(REALTIME_EVENT_NAMES.TASK_PROGRESS, { taskId: 'task-1', percent: 10 }, { replayed: true })).success, false);
assert.equal(parseRealtimeEnvelopeV2_1(envelope(REALTIME_EVENT_NAMES.TASK_PROGRESS, { taskId: 'task-1', percent: 10 }, {
  replayed: true, replay: { windowStartCursor: 0, windowEndCursor: 2, truncated: false },
})).success, true);

assert.equal(parseDesktopOperatorSessionV2(desktopSession).success, true);
const parsedObservation = parseDesktopObservationV2(desktopObservation, { latestGeneration: 7, session: desktopSession });
assert.equal(parsedObservation.success, true);
assert.equal(parseDesktopObservationV2({ ...desktopObservation, generation: 6 }, { latestGeneration: 7 }).success, false);
assert.equal(parseDesktopObservationV2({ ...desktopObservation, expiresAt: '2000-01-01T00:00:00.000Z' }).success, false);
assert.equal(parseDesktopObservationV2({ ...desktopObservation, confidence: 1.1 }).success, false);
assert.equal(parseDesktopObservationV2({ ...desktopObservation, monitor: { ...desktopObservation.monitor, dpiScale: 2 } }).success, false);
assert.equal(parseDesktopObservationV2({ ...desktopObservation, foreground: { ...desktopObservation.foreground, physicalBounds: physical(100, 100, 0, 600) } }).success, false);
assert.equal(parseSemanticTargetV2(semanticTarget, desktopObservation).success, true);
assert.equal(parseSemanticTargetV2({ ...semanticTarget, observationGeneration: 6 }, desktopObservation).success, false);
const parsedApproval = parseScopedApprovalV2(scopedApproval, { observation: desktopObservation });
assert.equal(parsedApproval.success, true);
assert.equal(parseScopedApprovalV2({ ...scopedApproval, expiresAt: '2000-01-01T00:00:00.000Z' }).success, false);
assert.equal(parseScopedApprovalV2({ ...scopedApproval, status: 'consumed', consumedActionIds: ['action-1'] }).success, false);
assert.equal(parseDesktopActionV2(desktopAction, { observation: desktopObservation, approval: scopedApproval }).success, true);
assert.equal(parseDesktopActionV2({ ...desktopAction, observationGeneration: 6 }, { observation: desktopObservation, approval: scopedApproval }).success, false);
assert.equal(parseDesktopActionV2({ ...desktopAction, coordinates: { x: 1_500, y: 700 } }, { observation: desktopObservation, approval: scopedApproval }).success, false);
assert.equal(parseDesktopActionV2({ ...desktopAction, retryBudget: { maxAttempts: 3, attempt: 1, backoffMs: 0 } }).success, false);
assert.equal(parseDesktopActionV2({ ...desktopAction, kind: 'typeText', text: 'raw secret', textLength: 10, textFingerprint: shaA }).success, false);
assert.equal(parseDesktopActionV2({ ...desktopAction, metadata: { apiKey: 'must-not-pass' } }).success, false);
assert.equal(parseActionDispatchV2(actionDispatch).success, true);
assert.equal(parseActionDispatchV2({ ...actionDispatch, attempt: 3 }).success, false);
assert.equal(parseActionVerificationV2(actionVerification).success, true);
assert.equal(parseActionVerificationV2({ ...actionVerification, postObservationGeneration: 7 }).success, false);
assert.equal(parseRetryDecisionV2(retryDecision).success, true);
assert.equal(parseRetryDecisionV2({ ...retryDecision, attempt: 2 }).success, false);
assert.equal(parseRetryDecisionV2({ ...retryDecision, maxAttempts: 3 }).success, false);

const capabilities = {
  ...v21,
  realtime: true, fileTransfer: true, notifications: true, camera: false,
  microphone: false, computerControl: false, browserControl: false,
};
assert.equal(parseDeviceCapabilitiesV2(capabilities).success, true);
assert.equal(parsePairingChallengeV2({
  ...v21,
  challengeId: 'challenge-1', pairingId: 'pair-1', deviceId: 'device-1', algorithm: 'Ed25519',
  challengeFingerprint: shaA, proofFingerprint: shaB, issuedAt: now, expiresAt: later, oneTime: true,
  status: 'consumed', attempt: 1, maxAttempts: 3, verifiedAt: now, consumedAt: later,
}).success, true);
assert.equal(parsePairingChallengeV2({
  ...v21,
  challengeId: 'challenge-1', pairingId: 'pair-1', deviceId: 'device-1', algorithm: 'Ed25519',
  challengeFingerprint: shaA, issuedAt: now, expiresAt: later, oneTime: true, rawProof: 'secret',
}).success, false);
assert.equal(parseDeviceTrustV2({ ...v21, deviceId: 'device-1', fingerprint: shaA, status: 'trusted', trustedAt: now, reconnectCredentialId: 'cred-1', reconnectCredentialFingerprint: shaB }).success, true);
assert.equal(parseOwnerSessionBindingV2({ ...v21, bindingId: 'binding-1', ownerSessionId: 'session-1', deviceId: 'device-1', workspaceId: 'workspace-1', deviceFingerprint: shaA, createdAt: now, expiresAt: later, status: 'active' }).success, true);

const manifest = {
  ...v21,
  transferId: 'transfer-1', sizeBytes: 4, chunkSizeBytes: 2, totalChunks: 2, fileSha256: shaA, createdAt: now,
  chunks: [{ index: 0, offsetBytes: 0, sizeBytes: 2, sha256: shaA }, { index: 1, offsetBytes: 2, sizeBytes: 2, sha256: shaB }],
};
const encryption = { ...v21, algorithm: 'AES-256-GCM' as const, keyId: 'key-1', keyFingerprint: shaA, nonceStrategy: 'per_chunk_derived' as const, authenticated: true as const, aadContext: 'transfer-1' };
const resume = { ...v21, resumable: true, nextChunkIndex: 1, completedChunkIndexes: [0], retryCount: 0, maxRetries: 3, acknowledgedBytes: 2 };
const destination = { ...v21, handle: 'destination-1', scope: 'workspace' as const, overwritePolicy: 'reject' as const };
assert.equal(parseFileChunkManifestV2(manifest).success, true);
assert.equal(parseTransferEncryptionV2(encryption).success, true);
assert.equal(parseTransferResumeV2(resume, { chunkCount: 2, sizeBytes: 4 }).success, true);
assert.equal(parseSafeDestinationV2(destination).success, true);
assert.equal(parseSafeDestinationV2({ ...destination, handle: 'C:\\Users\\owner' }).success, false);
assert.equal(parseFileChunkManifestV2({ ...manifest, chunks: [...manifest.chunks].reverse() }).success, false);
assert.equal(parseTransferEncryptionV2({ ...encryption, plaintextKey: 'secret' }).success, false);
assert.equal(parseFileTransferDescriptorV2({
  ...v21,
  transferId: 'transfer-1', fileName: 'report.txt', mediaType: 'text/plain', sizeBytes: 4, sha256: shaA,
  direction: 'upload', status: 'transferring', sourceDeviceId: 'device-1', targetDeviceId: 'device-2',
  chunkManifest: manifest, encryption, resume, destination, createdAt: now, updatedAt: now,
}).success, true);

assert.equal(parseCapsulePresentationV2(capsule).success, true);
assert.equal(parseCapsulePresentationV2({ ...capsule, queuePosition: 0 }).success, false);
assert.equal(parseMissionPresentationV2(mission).success, true);
assert.equal(parseMissionPresentationV2({ ...mission, focusedCapsuleId: 'orphan' }).success, false);

const research = {
  ...v21,
  runId: 'research-1', query: 'contract safety', status: 'completed', mode: 'BROWSER',
  sourceIds: ['source-1'], artifactIds: ['artifact-1'], confidence: 0.9,
  sources: [{
    sourceId: 'source-1', url: 'https://example.com/report', retrievedAt: now,
    safety: { schemeValidated: true, redirectsValidated: true, resolvedTargetClass: 'public', retrievedByBackend: true, ssrfPolicyVersion: '1', decision: 'allowed' },
  }],
  citations: [{ citationId: 'citation-1', sourceId: 'source-1' }],
  claims: [{ claimId: 'claim-1', statement: 'The contract is additive.', citationIds: ['citation-1'], confidence: 0.9 }],
  provenance: { generatedBy: 'edith-research', generatedAt: now, sourceIds: ['source-1'], methodology: 'browser evidence' },
  freshness: { checkedAt: now, status: 'fresh' },
};
assert.equal(parseResearchRunV2(research).success, true);
assert.equal(parseResearchRunV2({ ...research, sources: [{ ...research.sources[0], url: 'https://user:pass@example.com/report' }] }).success, false);
assert.equal(parseResearchRunV2({ ...research, sources: [{ ...research.sources[0], url: 'http://127.0.0.1/admin', safety: { ...research.sources[0].safety, resolvedTargetClass: 'loopback', decision: 'allowed' } }] }).success, false);
assert.equal(parseResearchRunV2({ ...research, claims: [{ ...research.claims[0], citationIds: ['orphan'] }] }).success, false);
assert.equal(parseResearchRunV2({ ...research, sources: [{ ...research.sources[0], url: 'https://example.com/?api_key=secret' }] }).success, false);

assert.equal(parseSkillRef(playbookStep.skills[0]).success, true);
assert.equal(parsePlaybookStepV2(playbookStep).success, true);
assert.equal(parsePlaybookDefinitionV2(playbook).success, true);
assert.equal(parsePlaybookDefinitionV2({ ...playbook, steps: [{ ...playbookStep, dependsOn: ['summarize'] }, secondStep] }).success, false);
assert.equal(parsePlaybookDefinitionV2({ ...playbook, stepIds: ['collect'] }).success, false);
assert.equal(parsePlaybookStepV2({ ...playbookStep, inputSchema: { apiKey: { type: 'string' } } }).success, false);
assert.equal(parsePlaybookRunV2({
  ...v21,
  runId: 'run-1', playbook: { playbookId: playbook.playbookId, version: playbook.version }, status: 'running',
  stepRuns: [{ stepId: 'collect', status: 'running', attempt: 1 }],
}, playbook).success, true);
assert.equal(parsePlaybookRunV2({ ...v21, runId: 'run-1', playbook: { playbookId: 'other', version: '1' }, status: 'running' }, playbook).success, false);

console.log(JSON.stringify({
  success: true,
  amendment: EDITH_CONTRACT_AMENDMENT,
  eventValidators: Object.keys(eventFixtures).length,
  checks: [
    'task_event_context_and_diagnostics', 'strict_realtime_payload_registry', 'pairing_device_session_binding',
    'chunked_encrypted_resumable_transfer', 'safe_destination', 'capsule_mission_presentation',
    'research_provenance_ssrf_references', 'playbook_dag_schema_run', 'recursive_secret_rejection',
    'desktop_observation_generation_coordinates', 'scoped_owner_approval', 'bounded_idempotent_action',
    'separate_dispatch_verification_realtime', 'bounded_retry_decision',
  ],
}, null, 2));
