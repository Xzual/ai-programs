# E.D.I.T.H. Chat 4 Phase 10A Legacy Task Event Fix Handoff

**Date:** 2026-09-28  
**Owner:** Chat 4 - Backend / Task Contracts  
**Scope:** Runtime compatibility for persisted legacy task timeline events and test persistence isolation  
**Result:** PASS for the scoped backend fix and the 28-command regression matrix

## 1. Root Cause

Persisted tasks contain timeline records produced by `edith-task-service` with legacy event types `status`, `audit`, and `plan`. The records have this shape:

- Common fields: `actor`, `createdAt`, `id`, `message`, `riskLevel`, `status`, `taskId`, `type`.
- Audit records additionally contain `auditEventId`.
- They do not contain canonical V2 `payload` or `context` fields.

`taskEventsV2()` previously copied each legacy timeline record into a canonical event envelope without validating the event type first. The strict V2 parser then rejected `status`, `audit`, and `plan` with `UNKNOWN_TASK_EVENT_TYPE`. The task itself was valid, but activity projection made Command Center, Tasks, and advanced task reads fail closed.

## 2. Compatibility Behavior

The canonical `parseTaskEventV2()` boundary remains strict and unchanged. Compatibility is implemented only at the persisted-task projection boundary:

- Valid canonical events for the requested task are returned unchanged in meaning.
- Legacy or malformed timeline entries are not promoted to canonical events.
- Cross-task and ahead-of-task entries are quarantined.
- Quarantined entries cannot create completion, progress, or other synthetic task state.
- Diagnostics are bounded to 100 entries while preserving the total quarantine count and a `truncated` flag.
- Diagnostics expose only source index, source class, allowlisted legacy type, generic producer lineage, and reason code. Raw messages, payloads, actor values, paths, and secrets are excluded.

Desktop task activity responses expose additive top-level and `data.eventDiagnostics` metadata. Mobile task activity includes the same diagnostics inside the existing authenticated and encrypted response. Existing event and activity fields remain compatible.

## 3. Runtime Copy Evidence

A read-only isolated copy of `.edith/edith.db` was inspected. The source runtime database was not modified by reproduction.

- Tasks: 27
- Persisted timeline events: 8 across 2 tasks
- Legacy types: `status` (2), `audit` (4), `plan` (2)
- Producer lineage: `edith-task-service`
- Canonical events emitted after projection: 0
- Legacy events quarantined: 8
- Affected tasks readable after projection: 2 of 2

This is deliberate quarantine, not migration. Source task history remains intact and restart behavior is idempotent.

## 4. Test Persistence Isolation

`EDITH_TEST_MODE=true` or `NODE_ENV=test` now requires an explicit `EDITH_TEST_DATA_DIR`. The directory must be strictly below the operating-system temporary directory and cannot be the temp root or project `.edith` directory. Unsafe or missing configuration fails closed before persistence opens.

The shared isolated runner creates temporary workspace, config, and data directories, then verifies the real `.edith/edith.db` before and after each wrapped test by existence, size, modification time, and SHA-256. It rejects any source-runtime database change.

The following suites now use the isolated runner because they can initialize global persistence or audit state:

- Phase 10A legacy task events
- Backend security
- Mobile backend
- Mobile contract reconciliation
- Phase 6E backend integration
- Phase 7D native publication
- Phase 6 cross-device owner-session flow

During the first audit run, before permanent isolation was complete, test routes appended 32 audit rows to the real runtime database. No task rows or task logical content changed. In accordance with the preservation rule, these audit rows were not deleted or edited. Their safe categories are test owner-session, pairing, device-auth denial, and device-revocation events; no secret values are included in this report.

The final full matrix proved the source database unchanged:

- Before and after SHA-256: `3EE2E2DCF762A4DDB91B48891AF4B690ACF94C59E69D15C13E3396E7D368DCFF`
- Before and after size: `53,260,288` bytes
- Before and after UTC mtime ticks: `639262252175863204`
- Result: `sourceRuntimeDatabaseUnchanged: true`

## 5. Files Changed

- `src/edith/contracts.ts`
- `src/edith/persistence/index.ts`
- `server/routes/tasks.ts`
- `server/routes/mobileTasks.ts`
- `scripts/test-edith-contracts.ts`
- `scripts/test-edith-backend-security.ts`
- `scripts/test-edith-phase10a-legacy-task-events.ts`
- `scripts/run-edith-isolated-test.mjs`
- `package.json`
- `docs/EDITH_CHAT4_PHASE10A_LEGACY_TASK_EVENT_FIX_HANDOFF_2026-09-28.md`

## 6. Verification

All 28 commands passed:

- Focused: Phase 10A, contracts, contracts V2.1, Phase 2 foundation, task service, queue, planner, executor, verifier, recovery.
- Backend/security: backend security, mobile backend, mobile reconciliation, Phase 6 cross-device, Phase 6B/6D/6E/6F/6G.
- Advanced: Phase 7A contracts/backend, Phase 7B producers, Phase 7D producers/native, Phase 7F UI.
- Safety/build: interaction safety, lint, production build.

The production build retains the existing large main-chunk warning; it is unrelated to this backend compatibility fix.

## 7. Remaining Risks

- Legacy records remain quarantined rather than migrated. This preserves history and avoids inventing canonical semantics, but legacy timeline messages are not rendered as canonical activity events.
- The bounded diagnostics are intended for operational visibility, not a user-facing event history.
- Other future tests that initialize persistence under test mode must provide an isolated test data directory or use the shared runner; they will now fail closed otherwise.

## 8. Cross-Chat Coordination

**CROSS_CHAT_REQUEST - Chat 2:** No frontend change is required for compatibility. Optionally render `eventDiagnostics.quarantinedCount` and `eventDiagnostics.truncated` as a neutral historical-data notice. Do not present quarantined legacy entries as completed work, progress, or canonical activity.

