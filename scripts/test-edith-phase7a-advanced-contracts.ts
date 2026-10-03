import assert from 'node:assert/strict';
import {
  parseCapsuleContextSelectionV2,
  parseMissionMemoryV2,
  parsePowerPresenceSnapshotV2,
  parsePriorityTaskPolicyV2,
  parseSmartRetryPlanV2,
  parseVisualBookmarkV2,
  parseWorkspaceSnapshotV2,
} from '../src/edith/contracts';

const now = new Date().toISOString();
const later = new Date(Date.now() + 60_000).toISOString();
const base = { contractVersion: 2 as const, amendment: '2.1' as const, ownerSessionBindingId: 'owner-1', workspaceId: 'workspace-1', revision: 1, createdAt: now, updatedAt: now };

const priority = { ...base, taskId: 'task-1', priority: 'HIGH' as const, dependencyTaskIds: [], atomicOperation: false, securityCritical: false, derivedFromUrgentLanguage: false as const, blockedByDependencies: false };
assert.equal(parsePriorityTaskPolicyV2(priority).success, true);
assert.equal(parsePriorityTaskPolicyV2({ ...priority, derivedFromUrgentLanguage: true }).success, false);
assert.equal(parsePriorityTaskPolicyV2({ ...priority, apiKey: 'secret' }).success, false);

const memory = { ...base, memoryId: 'memory-1', sourceTaskId: 'task-1', verificationStatus: 'verified' as const, routeSummary: 'Verified route summary.', avoidRouteCodes: ['unsafe-route'], currentStateReverificationRequired: true as const };
assert.equal(parseMissionMemoryV2(memory).success, true);
assert.equal(parseMissionMemoryV2({ ...memory, routeSummary: 'api_key=secret-value' }).success, false);

const bookmark = { ...base, bookmarkId: 'bookmark-1', capturedAt: now, appId: 'editor', userNote: 'Useful context.', screenshotPolicy: 'metadata_only' as const, sensitiveAppBlocked: false };
assert.equal(parseVisualBookmarkV2(bookmark).success, true);
assert.equal(parseVisualBookmarkV2({ ...bookmark, userNote: 'C:\\Users\\owner\\secret.txt' }).success, false);
assert.equal(parseVisualBookmarkV2({ ...bookmark, sensitiveAppBlocked: true, screenshotPolicy: 'opaque_handle', screenshotArtifactHandle: 'shot-1' }).success, false);

const snapshot = { ...base, snapshotId: 'snapshot-1', label: 'Work context', items: [{ kind: 'task' as const, refId: 'task-1', displayLabel: 'Primary task' }], forbiddenStateExcluded: true as const, dangerousTransactionsExcluded: true as const, captureStatus: 'metadata_only' as const };
assert.equal(parseWorkspaceSnapshotV2(snapshot).success, true);
assert.equal(parseWorkspaceSnapshotV2({ ...snapshot, pixels: 'raw' }).success, false);

const retry = { ...base, retryId: 'retry-1', taskId: 'task-1', failureClass: 'stale_target' as const, strategy: 'reobserve' as const, attempts: 1, maxAttempts: 2, staleTargetReobserve: true, permissionDeniedStop: false, status: 'retrying' as const };
assert.equal(parseSmartRetryPlanV2(retry).success, true);
assert.equal(parseSmartRetryPlanV2({ ...retry, maxAttempts: 3 }).success, false);
assert.equal(parseSmartRetryPlanV2({ ...retry, strategy: 'reconnect_backoff', staleTargetReobserve: false }).success, false);

const power = { ...base, expiresAt: later, snapshotId: 'power-1', source: 'trusted_native' as const, powerSource: 'battery' as const, batteryPercent: 40, lowPower: false, userPresence: 'active' as const, cameraUsed: false as const, observedAt: now };
assert.equal(parsePowerPresenceSnapshotV2(power).success, true);
assert.equal(parsePowerPresenceSnapshotV2({ ...power, cameraUsed: true }).success, false);

const candidate = { candidateId: 'candidate-1', kind: 'attention_required' as const, sourceId: 'task-1', safeLabel: 'Owner attention required.', observedAt: now, expiresAt: later };
const selection = { ...base, selectionId: 'selection-1', selected: candidate, consideredCandidateIds: ['candidate-1'], deterministicRank: 1 as const };
assert.equal(parseCapsuleContextSelectionV2(selection).success, true);
assert.equal(parseCapsuleContextSelectionV2({ ...selection, deterministicRank: 5 }).success, false);

console.log(JSON.stringify({ success: true, scenarios: ['strict_unknown_fields', 'secret_and_path_rejection', 'metadata_only_snapshot', 'bounded_retry', 'trusted_native_no_camera', 'deterministic_capsule_priority'] }, null, 2));
