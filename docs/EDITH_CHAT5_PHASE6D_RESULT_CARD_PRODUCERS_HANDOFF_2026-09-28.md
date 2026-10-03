# E.D.I.T.H. Phase 6D Shared Result Card Producer Handoff

Date: 2026-09-28

OWNER: Chat 5 Research / Knowledge / Task / Artifact Producers

STATUS: COMPLETE for producer integration. Cross-device publication remains owned by the existing Chat 4 endpoint and runtime.

## Files Changed

- `src/edith/sharedResultCardProducer.ts`
- `src/edith/researchService.ts`
- `src/edith/taskService.ts`
- `src/edith/knowledgeGraphService.ts`
- `scripts/test-edith-phase6d-result-card-producers.ts`
- `package.json`
- `docs/EDITH_CHAT5_PHASE6D_RESULT_CARD_PRODUCERS_HANDOFF_2026-09-28.md`

No changes were made to `src/edith/contracts.ts`, `server/mobile/**`, `mobile/**`, `src-tauri/**`, or general UI redesign files.

## Real Producer Integration

- `SharedResultCardProducerService` produces canonical `SharedResultCardV2` payloads from real `ResearchRunV2`, `EdithTask`, `KnowledgeGraphNode`, `CrossDeviceTransferV2`, `DesktopObservationV2`, and explicit error evidence.
- `ResearchService.execute()` accepts an optional server-owned result output binding and returns the produced card without modifying or flattening the stored research run. Sources, citations, claims, freshness, and provenance remain intact.
- `TaskService.createSharedResultCard()` resolves the current persisted task before producing a card.
- `KnowledgeGraphService.createSharedResultCard()` resolves the current persisted, non-deleted knowledge node before producing a card.
- Completed cross-device transfers produce `file` or `download` cards from actual transfer checksums, byte-integrity state, destination handles, expiry, and capability flags.
- Screenshot cards require both a real desktop observation and explicit artifact evidence. The producer does not synthesize pixels, checksums, handles, or media availability.
- Error-attention cards require an explicit error code, safe message, source identity, observation time, and retry availability.

## Artifact And Safety Boundary

- `SharedArtifactRefV2` checksum state is `verified` or `failed` only when a valid SHA-256 value accompanies that evidence; otherwise it is downgraded to `unavailable`.
- Download handles are included only when they are opaque identifiers. Path-like handles are discarded.
- Absolute/private artifact paths are replaced by deterministic opaque artifact IDs. Paths and secret assignments are removed from title, summary, and preview text.
- Artifact action availability is derived from real transfer/handle/error evidence. Callers may disable an action but cannot elevate an unavailable action.
- Owner session, workspace, session, source device, and target device lineage are carried on every produced card. Transfer producers additionally reject lineage mismatches.
- `SharedResultCardProducerStore` enforces revision `N + 1`, stable `createdAt`, and strictly increasing `updatedAt` within the producer lifecycle.
- Retention is explicit per artifact. Card `expiresAt` is preserved from the real transfer/observation evidence when supplied.

## Legacy Phase 3 Compatibility

No second canonical result-card schema was introduced. Producers emit `SharedResultCardV2`; legacy consumers use the existing `adaptSharedResultCardToLegacyV2()` adapter. Safe legacy IDs, title, summary, outcome, and completion time round-trip without display loss. Unsafe private-path IDs are intentionally replaced at the security boundary.

## Chat 4 Publish Binding

The returned `SharedResultCardV2` object is the exact request body accepted by:

`POST /api/edith/mobile/cross-device/result-cards/:deviceId`

No Chat 4 route or runtime file was changed. The caller must supply lineage from the authenticated owner/device context and post the producer output directly. Backend publication remains responsible for owner-session/CSRF checks, target-device binding, revision conflict enforcement, realtime publication, and runtime retention.

## Schema Evidence Versus Producer Evidence

The pre-existing Phase 6A suite proves strict contract parsing, adapter shape, backend revision rejection, realtime envelopes, and owner-session invalidation. It does not by itself prove that Phase 4/task/knowledge/native evidence produces cards.

`test:edith-phase6d-result-card-producers` separately proves live producer behavior for research, persisted task, persisted knowledge, file, download, screenshot, and error-attention outputs; verified/unavailable checksums; preserved citations; preview redaction; monotonic revisions; lineage; retention/expiry; opaque handles; truthful actions; and legacy display adaptation.

## Tests Passed

- `npm run lint`
- `npm run build`
- `npm run test:edith-phase6d-result-card-producers`
- `npm run test:edith-cross-device-phase6`
- `npm run test:edith-contracts-v2-1`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npx tsx scripts/test-edith-phase4-api.ts`
- `npx tsx scripts/test-edith-phase3-task-ui.ts`
- `npm run test:edith-task-service`
- `npm run test:edith-knowledge-map`

Build retains the existing Vite chunk-size warning; it is not a Phase 6D failure.

## Remaining External Work

- Chat 4 must pass authenticated owner/device lineage into the optional research output binding and publish the returned card through its existing protected endpoint.
- Native screenshot/download/file adapters must supply actual artifact evidence and opaque handles. Missing checksum or handle data remains honestly unavailable.
- The producer revision store is process-memory coordination. Durable cross-device result-card persistence and restart reconciliation remain Chat 4 runtime ownership.
- Phase 3 UI remains compatible through the adapter but does not automatically render the richer shared artifact metadata until Chat 2 consumes the shared card endpoint.
