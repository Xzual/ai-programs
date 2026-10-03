# E.D.I.T.H. Chat 5 Phase 7B Advanced Producers Handoff

Date: 2026-09-28

OWNER: Chat 5 Knowledge / History / Orchestration Producers

STATUS: COMPLETE for producer/resolver scope. Chat 4 publication wiring, durable advanced-state persistence, native background execution, OS/push delivery, and React consumption remain outside this change.

## Changed Files

- `src/edith/advancedExperienceProducers.ts`
- `scripts/test-edith-phase7b-advanced-producers.ts`
- `package.json` (`test:edith-phase7b-producers` only)
- `docs/EDITH_CHAT5_PHASE7B_ADVANCED_PRODUCERS_HANDOFF_2026-09-28.md`

Frozen `src/edith/contracts.ts`, `server/**`, `src-tauri/**`, `mobile/**`, React UI, crypto, and Mark-L were not changed.

## Implemented Producers

`AdvancedExperienceProducerService` consumes injected `EdithPersistenceStore` and `Phase4Persistence` instances and emits DTOs accepted by the frozen Phase 7A parsers. It does not mutate Chat 4 runtime state directly.

- Mission Memory requires a persisted completed task with `verification.status === PASS`. Referenced research must be completed and citation-backed. Referenced playbook runs must be completed with PASS verification on every completed step. An indexed Obsidian note is never accepted as task evidence.
- Recent Context derives bounded events from task timelines, safe audit metadata, research status, and explicitly verified transfer metadata. Retention, `purgedBefore`, searchable kinds, and private-text exclusion are enforced. Missing history is omitted.
- History Search searches only already-validated recent-context records within the active retention policy.
- Compare What Changed requires both safe snapshots and emits structured added/removed/changed keys with observation timestamps and provenance. Missing content returns `configuration_required`.
- Outcome Mode builds a DAG from existing task/research/playbook output IDs plus verified file-generation, generated Obsidian journal, result-card, skill-registry, or transfer evidence. Completion requires every step verified and at least one verified downstream result.
- One-command Workspace emits separate `snapshots` and `orchestration` publishes. Captures are metadata-only. Password/payment/checkout/transaction state is rejected. Skills must exist in an injected registry set. Terminal is accepted only as an explicitly allowlisted safe skill; arbitrary shell remains false.
- Smart Retry caps attempts at two, re-observes stale targets, stops on permission denial, and only proposes a reviewable playbook update after both task and playbook success are verified. It never auto-updates a playbook.
- Watcher Intent can report a desktop Obsidian file/folder watcher active only when the existing watcher is observed active. Mobile/both delivery or absent watcher foundations remain `configuration_required`; no delivered notification is fabricated.
- Download Butler accepts only verified trusted observations or valid cross-device transfers. ETA requires verified progress, positive speed, and a minimum five-second telemetry window. Identity/revision rollback and same-revision conflicts are rejected.
- Communication policy, actual-state brief/voice summary, smart-silence policy, and capsule candidates use persisted task state only and expose no chain-of-thought or hidden reasoning.
- Knowledge graph suggestions are review-only `KnowledgeRecommendation` records. They never create, delete, or rewrite graph relationships.
- Ghost Task is an adapter over existing Task/checkpoint state. Completed requires task PASS. Without a native background executor, non-terminal work publishes `configuration_required` with `nativeExecution: not_connected`.

## Truth And Privacy Boundaries

- User-authored Obsidian content remains provenance-bearing local content, not verified fact.
- Generated Obsidian journal evidence is accepted only when the stored knowledge node has an `edith_generated` marker and the trusted caller also marks the evidence verified.
- Audit history includes action/result metadata, not raw audit messages.
- Raw screenshots, pixels, clipboard contents, audio bytes, secrets, password forms, transactions, and absolute local paths are not produced.
- No camera, arbitrary shell, notification delivery, background executor, native restore, or hidden scheduler is claimed.
- Producer audit events record important Mission Memory, retry, watcher, download, and Ghost metadata production without source content.

## Chat 4 Publish Integration Request

1. Construct one `AdvancedExperienceProducerService` per backend workspace/runtime using the canonical local and Phase 4 persistence instances plus a server-resolved installed-skill allowlist.
2. Add an internal-only producer adapter, not a public owner payload bypass. For every `CanonicalPublish`, invoke the existing parser and then `AdvancedExperienceRuntime.put(resource, payload)` under the authenticated owner/workspace lineage.
3. For `workspacePlan`, publish `snapshot` to `snapshots` before publishing `plan` to `orchestration`; if either fails, report partial publication and do not claim restore readiness.
4. Outcome records with `status: completed` must use this trusted producer path after re-reading source IDs server-side. Keep the existing generic client-completion rejection.
5. Supply transfer/download evidence only from the existing trusted native producer or canonical cross-device service. Never trust owner-body `verified: true` by itself.
6. Supply generated Obsidian journal evidence after re-reading the persisted node marker. Keep ordinary Obsidian notes unverified.
7. Persist or replay these producer outputs before claiming durable Phase 7 recovery. Until then, preserve `memory_only` and `restartRecovery: partial` status.
8. OS/push scheduler absence must continue to produce `configuration_required`; do not translate watcher intent into delivered notification state.

## Chat 2 UI Fields

- Mission Memory: `sourceTaskId`, optional research/playbook IDs, `verificationStatus`, `routeSummary`, `currentStateReverificationRequired`.
- Recent Context: `kind`, `safeSummary`, `occurredAt`, `expiresAt`; empty means no retained evidence, not loading success with invented rows.
- Comparison: added/removed/changed counts, both observation timestamps, provenance verified flag.
- Outcome: objective, reference kind/ID, each step status, verified downstream result IDs, overall status.
- Workspace: metadata-only snapshot items and orchestration status. Keep launch/restore controls disabled while `configuration_required`.
- Retry: failure class, attempts/maxAttempts, strategy, stopped/exhausted state.
- Watcher: source, trigger, delivery, expiry, and literal `configuration_required` status.
- Download: verified byte counts, remaining bytes, status, observedAt; show ETA only when `etaTrustworthy` is true.
- Brief/Capsule: display the provided safe labels and persisted state only. Do not synthesize hidden progress.
- Ghost: task ID, progress, reason code, `nativeExecution`; label non-terminal configuration-required records as partial metadata, not active background execution.
- Knowledge suggestions: confidence and explicit review action; never apply automatically.

## Tests

- `npm run test:edith-phase7b-producers`
- `npm run test:edith-phase7a-contracts`
- `npm run test:edith-phase7a-backend`
- `npm run test:edith-task-service`
- `npm run test:edith-task-queue`
- `npm run test:edith-recovery`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npm run test:edith-obsidian-knowledge`
- `npm run lint`
- `npm run build`

The Phase 7B suite uses JSON-backed task/audit/knowledge persistence and JSON-backed Phase 4 research/playbook persistence. It verifies behavior and provenance, not schema shape alone.
