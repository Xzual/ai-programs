# E.D.I.T.H. Phase 1 Shared Contract Freeze

Date: 2026-09-28

## Canonical source

`src/edith/contracts.ts` is the canonical dependency-free TypeScript source for Phase 1 shared names, versions, parsers, task normalization, progress derivation, and public knowledge DTO redaction.

- Schema: `edith.shared`
- Shared contract version: `2`
- Task contract version: `2`
- Task status names remain backward compatible with the existing `EdithTaskStatus` union.
- Legacy task records receive safe in-memory defaults for `contractVersion`, `revision`, `eventSequence`, and timeline event sequence metadata.

## Frozen Phase 1 contracts

- `TaskV2Metadata`
- `TaskEventV2`
- `TaskProgressSnapshot`
- `SkillRef`
- `DeviceIdentityV2`
- `OwnerAuthContextV2`
- `PairingSessionV2`
- `FileTransferDescriptorV2`
- `RealtimeEnvelopeV2` and `REALTIME_EVENT_NAMES`
- `CapsuleV2` and `MissionViewV2`
- `ResearchRunV2`
- `PlaybookDefinitionV2` and `PlaybookRunV2`

Pairing, device, file-transfer, capsule, mission, research, and playbook definitions are contracts only. They do not claim that a mobile channel or operational runtime exists.

## Task invariants

1. Persisted task revisions increase monotonically at the persistence boundary.
2. Existing timeline event sequence numbers are retained; newly persisted events receive the next sequence.
3. Invalid task status mutation input returns HTTP 400 with `INVALID_TASK_STATUS`.
4. Progress is derived only from task status, plan step state, verification, and recovery records. Human-readable text is not inspected.
5. Existing task and activity response fields remain present. Version, progress, and V2 event fields are additive.

## Security boundaries

- Task POST/PATCH routes require owner session, same-origin validation, and CSRF validation.
- Task GET routes remain read-only and unchanged in authentication behavior.
- Public knowledge and status DTOs redact `vaultPath`, `obsidianVaultPath`, `absolutePath`, and absolute `path`/`previousPath` values.
- Internal Obsidian services retain real filesystem paths and continue to perform filesystem boundary validation.

## Migration order

1. Parser and safe defaults
2. Task status validation
3. Revision and event sequence persistence
4. Deterministic progress derivation
5. Versioned task and activity API envelope
6. Redacted public knowledge DTO
7. Consumer adapters

## Coordination

PROPOSED_CHANGE: additive V2 contracts + guarded mutation + deterministic progress

IMPACTED_OWNERS: Chat 2, Chat 5, Chat 6, Mobile owner, Chat 8

ACK_STATUS: Chat 5 discovery complete; consumers verify after integration

MIGRATION_ORDER: parser/defaults -> status validation -> revision/sequence -> progress -> API envelope -> redacted DTO -> consumer adapters

Breaking renames or field removals require a new proposal and consumer acknowledgement. Phase 1 consumers should prefer the V2 envelope while retaining legacy parsing during migration.

## V2.1 additive amendment

Amendment marker: `EDITH_CONTRACT_AMENDMENT = "2.1"`.

The transport and task contract version remains numeric `2`. No V2 field, status alias, event value, or compatibility parser was removed or renamed.
New standalone V2.1 detail records carry explicit `contractVersion: 2` and `amendment: "2.1"` fields; additive detail fields on pre-existing V2 records remain optional for compatibility.

### Task and realtime details

- `TaskEventContextV2` adds correlation, causation, idempotency, status transition, workspace/device, stream cursor, and replay evidence.
- `TaskEventPayloadMapV2` and `TypedTaskEventV2` provide discriminated lifecycle payloads.
- `normalizeLegacyTaskWithDiagnostics()` preserves an unknown legacy status as bounded migration evidence while retaining the existing safe `FAILED` fallback.
- Existing `parseRealtimeEnvelope()` remains compatibility-oriented.
- `parseRealtimeEnvelopeV2_1()` requires stream, cursor, correlation, replay metadata, a valid timestamp, and an event-specific payload.
- `REALTIME_PAYLOAD_VALIDATORS` is the canonical runtime payload registry for all frozen realtime event names.

### Pairing, device, and owner binding

- `PairingChallengeV2` carries one-time challenge and proof fingerprints, lifecycle evidence, attempts, and expiry. It never carries a raw challenge proof.
- `DeviceCapabilitiesV2` and `DeviceTrustV2` describe declared capabilities, trusted/revoked/expired lifecycle, and reconnect credential IDs/fingerprints.
- `OwnerSessionBindingV2` binds owner-session identity metadata to device and workspace identity without carrying session tokens.

These are contracts and parsers only. They do not enable pairing, reconnect, remote control, or a mobile channel.

### File transfer

- `FileChunkManifestV2` validates contiguous chunk indexes, offsets, sizes, and SHA-256 checksums.
- `TransferEncryptionV2` permits authenticated-encryption metadata and key IDs/fingerprints, never key material.
- `TransferResumeV2` validates retry, resume cursor, acknowledged bytes, and completed chunk indexes.
- `SafeDestinationV2` uses an opaque, non-authorizing destination handle. Filesystem paths and traversal syntax are rejected.
- `FileTransferDescriptorV2` additively links devices, manifest, encryption, resume, destination, and timestamps.

### Presentation, research, playbooks, and skills

- `CapsulePresentationV2` and `MissionPresentationV2` freeze compact/expanded/mission modes, visibility/fullscreen state, quick actions, queue state, priority, focus, and result cards.
- `ResearchRunV2` additively supports `FAST`, `DEEP`, and `BROWSER` modes with typed sources, claims, citations, provenance, freshness, confidence, uncertainty, prior-run delta, and SSRF validation evidence.
- Research parsers reject credential-bearing URLs, secret query fields, orphan references, invalid confidence, and non-public targets lacking an explicit blocked decision. DNS/IP/redirect enforcement remains a backend network responsibility.
- `PlaybookStepV2` freezes dependencies, bounded typed schemas, skills/tools, permissions, risk, approval, timeout, retry, verification, and undo metadata.
- Playbook validators enforce ordered step identity, dependency existence, DAG structure, definition/run identity, and secret rejection.
- `SkillRef` additively supports `namespace`, `canonicalId`, and unique `aliases`.

### Shared security rules

All strict V2.1 parsers recursively reject raw secret, token, password, API key, private-key, plaintext-key, raw-proof, signature, credential-secret, and prototype-pollution fields. Safe IDs and fingerprints are metadata only and grant no authority.

### Consumer acknowledgement

PROPOSED_CHANGE: additive V2.1 detail contracts + validators

IMPACTED_OWNERS: Chat 2, Chat 5, Chat 6, Mobile owner, Chat 8

ACK_STATUS: Chat 5 audit complete; Chat 6 consumer in progress; Mobile pending

MIGRATION_ORDER: additions -> parsers -> fixtures -> backend persistence/replay -> mobile -> capsule/mission consumers

Consumers may continue using the V2 compatibility parser during migration. New persistence/replay, mobile, capsule, and mission consumers should use the strict V2.1 parsers before trusting payloads.

## Native desktop V2.1 handoff

The following additive contracts freeze the boundary between shared orchestration and the local native desktop runtime:

- `DesktopOperatorSessionV2`
- `DesktopObservationV2`
- `SemanticTargetV2`
- `ScopedApprovalV2`
- `DesktopActionV2`
- `ActionDispatchV2`
- `ActionVerificationV2`
- `RetryDecisionV2`

Observations bind a session to a short-lived, monotonically increasing generation and carry safe foreground-window identity, logical and physical bounds, monitor origin, DPI scale, source, confidence, and declared targeting capabilities. Screenshot bytes, command lines, raw OCR text, raw HWND pointers, and authorization material are excluded from the shared contract.

Actions require an idempotency key, the exact observation ID and generation, a scoped owner approval, an expected effect, an expiry-bounded deadline, and a retry budget of at most two attempts. Typed text is represented only by length and fingerprint metadata. Raw typed content remains ephemeral inside the local native boundary.

Dispatch and verification are deliberately separate records and realtime events:

- `desktop.observation.v2`
- `desktop.action.requested.v2`
- `desktop.action.dispatch.v2`
- `desktop.action.verification.v2`
- `desktop.retry.decision.v2`

`dispatched` means only that native input injection was attempted. It never implies that the expected effect was observed. Observation-backed verification requires a newer post-observation generation.

### Native migration

1. Keep the current Tauri camelCase wire structures unchanged during migration.
2. Convert epoch-millisecond observation timestamps to ISO timestamps at the adapter boundary.
3. Map `originX/originY/width/height`, `windowBounds`, `monitorBounds`, and `scaleFactor` into canonical logical/physical bounds and DPI fields.
4. Normalize the legacy `click` alias to canonical `clickMouse`; do not add `click` to `DesktopActionKindV2`.
5. Bind every action and approval to the latest `observationId + generation` pair and re-check expiry immediately before dispatch.
6. Split the existing combined native action result into `ActionDispatchV2` followed by `ActionVerificationV2`.
7. Preserve action ID and idempotency key across retries; allocate a new dispatch ID per attempt.
8. Treat target movement, generation changes, DPI changes, expired observations, and expired approvals as re-observe/re-approve conditions rather than blind retries.

The parsers reject stale observations, expired or consumed approvals, coordinate/DPI mismatches, invalid confidence or bounds, unbound generations, retry budgets above the native limit, raw typed text, and recursively nested secret-bearing fields. These contracts do not enable computer control and do not relax the current owner approval or kill-switch policy.

### Cross-chat request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-v2.1-native-desktop-adapter-2026-09-28`
- FROM_OWNER: `Shared contracts owner`
- TO_OWNER: `Chat 6 native desktop runtime owner`
- REQUEST: Add pure adapters from the current `ComputerObservation` and combined action result wire types to the canonical V2.1 desktop contracts. Emit dispatch and verification as separate events. Do not change native permissions, owner approval, kill switch, or computer-use capability defaults.
- CONTRACT_SOURCE: `src/edith/contracts.ts`
- MIGRATION_ORDER: `adapter -> parser fixtures -> client event mapping -> native wire mapping -> runtime verification`
- ACK_REQUIRED: Confirm field mapping, generation/expiry enforcement, idempotency handling, and separate dispatch/verification event ordering before enabling producers.
- STATUS: `pending`
