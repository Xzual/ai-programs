# E.D.I.T.H. Chat 5 Phase 8B Registry / Research Freeze Handoff

Date: 2026-09-28

OWNER: Chat 5 Registry / Research / Knowledge

STATUS: COMPLETE for Phase 8B reconciliation and regression scope. No new feature was added.

## Freeze Result

Phase 1 through Phase 7 handoffs were reviewed in dependency order against the current registry, research, Obsidian, journal, unified-search, playbook, context/history, and advanced-producer implementations. The frozen contracts were not changed. Existing dirty-worktree changes were preserved; no commit, reset, cleanup, or unrelated refactor was performed.

One concrete integration defect was fixed: the public skill/capability registry included configured absolute Obsidian and workspace paths in skill `details`. Registry details now expose configuration booleans only. Regression coverage proves that direct snapshots and all five skill/capability HTTP responses contain neither the temporary workspace root nor the sensitive path field names.

## Files Changed In This Freeze

- `src/edith/skillRegistry.ts`
- `scripts/test-edith-skills.ts`
- `docs/EDITH_CHAT5_PHASE8B_REGISTRY_RESEARCH_FREEZE_HANDOFF_2026-09-28.md`

Earlier Chat 5 Phase 7B producer files remain present and were regression-tested, but were not changed during this freeze.

## Reconciled Service State

| Area | Current reality |
|---|---|
| Canonical tool registry | Real local registry with schemas, permission requirements, risk, dry-run/rollback metadata, execution records, and health snapshots. Permission and kill-switch enforcement remain server-owned. |
| Skill registry | Real status adapter over observed provider/runtime/workspace state. `planned`, `config_required`, `degraded`, and `ready` remain distinct. Planning capabilities are explicitly `planning_abstraction` and `executable:false`. |
| Memory v2 | Real durable JSON/SQLite CRUD, namespace, importance, timestamps, conflict/merge, context redaction, delete/forget, export, and audit behavior. |
| Knowledge graph/map | Real projection from persisted tasks, memories, tools, audits, agents, RAG, and Obsidian index data. Missing Obsidian integration degrades honestly; synthetic map nodes are rejected by tests. |
| Obsidian knowledge | Real local index/read/write boundary with containment, atomic writes, secret redaction, user-note preservation, generated-note ownership markers, and graph extraction. Tests use OS-temp vaults only. |
| Research | Real orchestration, persistence, SSRF policy, bounded retry/timeout/concurrency, citation/freshness/provenance checks, and prior-run delta. Live acquisition is not wired in default composition and therefore returns `configuration_required` without fake claims. |
| Research journal | Real provider interface and sandbox implementation. Default backend composition has no production vault provider, so journal export is `configuration_required`. |
| Unified local search | Real scoped search over task, memory, knowledge, research, and playbook metadata with provenance, limits, and redaction. |
| Playbooks | Real definition/run persistence, DAG validation, dry-run, approval gates, bounded retry/timeout, verification, undo contract, and history. Default backend has no trusted execution/approval/undo adapter, so executable runs remain `configuration_required`. |
| Context/history | Real persisted context assembly and redacted prompt attachment. Phase 7 recent-context/history records obey retention and private-data exclusion. |
| Advanced producers | Real evidence resolvers over persisted state. Mission Memory and completed Outcome require verified persisted evidence; workspace is metadata-only; retry is bounded; knowledge suggestions are review-only. |
| Advanced publication | Real protected source-ID composition and parser revalidation. State is still process-memory only, restart recovery is partial, native background execution/scheduler delivery are not connected, and transfer evidence cannot complete Outcome yet. |

## Truth And Safety Checks

- `skill_store`, `file_organizer`, and `release_builder` remain `planned` and never report ready.
- Supabase cannot report ready from environment configuration alone; it remains `config_required` or `degraded` until explicitly verified.
- Browser research does not claim extraction/operator capability when only search/open foundations exist.
- High-risk canonical tools remain permission-gated; client-supplied permission or approval claims do not grant authority.
- Kill-switch and owner-session revocation paths remain enforced by the existing backend tests.
- Research cannot complete with uncited claims or absent workers.
- Playbook approval evidence cannot be forged by a client, and absent adapters never produce simulated success.
- Generated Obsidian evidence requires the persisted `edith_generated` marker. Ordinary vault content is not promoted to verified fact.
- Outcome completion is accepted only after server-side source re-read. Workspace partial publication never implies restore readiness.
- No test reads or writes a user vault. Vault tests use a unique OS-temp root with containment checks.
- Registry/API output contains no configured absolute workspace or vault path and no provider secret.

## What Chat 2 Can Display

- Skill status, readiness reason, risk, limitations, required permissions/configuration, related endpoints/screens, and safe configuration booleans.
- Canonical tool metadata/health separately from non-executable planning capabilities.
- Persisted research runs with literal operational status, sources, claims, citations, confidence, freshness, uncertainty, and prior-run delta.
- Journal status including literal `configuration_required`; never imply that a note was written when no provider is bound.
- Scoped search results with provenance and redacted metadata.
- Playbook definition/run state, approval need, attempts, verification, undo availability, and literal configuration failures.
- Knowledge-map nodes/relationships from the real projection, including honest degraded state when Obsidian is absent.
- Mission Memory, recent context, comparison, Outcome, workspace, retry, watcher, download, brief/capsule, Ghost, and knowledge-suggestion fields defined in the Phase 7B handoff.
- Advanced status must continue to show `memory_only`, `restartRecovery: partial`, and `configuration_required` for disconnected native/scheduler/watcher foundations.

## What Chat 4 Must Expose Or Preserve

Existing Phase 4 and Phase 7 routes are present and passed integration/security tests. Chat 4 must preserve their owner-session, origin, CSRF, parser, idempotency, audit, kill-switch, redaction, and source re-read boundaries.

Production capability still requires explicit trusted adapters in backend composition for DNS/redirect-safe research acquisition, production research-journal vault writes, playbook execution/policy/verification/undo, durable advanced-state recovery, and trusted transfer-to-Outcome resolution. Until each adapter exists and is health-checked, the corresponding API must keep returning `configuration_required`, `memory_only`, or partial status. Skill/capability APIs must keep the new path-free registry projection.

## Verification

Passed:

- `npm run test:edith-skills`
- `npm run test:edith-registry`
- `npm run test:edith-obsidian-knowledge`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npx tsx scripts/test-edith-phase4-api.ts`
- `npm run test:edith-phase7b-producers`
- `npm run test:edith-phase7d-producers`
- `npm run test:edith-contracts`
- `npm run test:edith-contracts-v2-1`
- `npm run test:edith-phase7a-contracts`
- `npm run test:edith-phase7a-backend`
- `npm run test:edith-memory-v2`
- `npm run test:edith-knowledge-map`
- `npm run test:edith-context-service`
- `npm run test:edith-chat-context`
- `npm run test:edith-awesome-agent-skills`
- `npm run test:edith-workspace`
- `npm run test:edith-backend-security`
- `npm run test:edith-permission-service`
- `npm run test:edith-task-service`
- `npm run test:edith-interaction-safety`
- `npm run lint`
- `npm run build`

Browser runtime check against `http://localhost:3000/` could not be performed because no development server was listening (`ERR_CONNECTION_REFUSED`). This freeze changed no UI. The production build passed with the existing Vite large-chunk warning; SQLite-backed tests emitted the existing Node experimental warning.

## Remaining Risks

- Advanced experience state is process-memory only and is lost on restart.
- Live research acquisition, production journal export, and real playbook tool execution require trusted backend adapters.
- OS watcher/push scheduling and native Ghost/background execution remain disconnected.
- Outcome transfer completion needs a dedicated trusted server-side resolver.
- Tool health expresses registry/permission/dependency state; it is not a substitute for provider-specific runtime probes.
- The working tree contains extensive unrelated changes from other owners; they were intentionally left untouched.

COMMITS: None

CONTRACTS_ADDED_OR_CHANGED: None

APIS_ADDED_OR_CHANGED: No route shape changed; public skill/capability payload details were made path-free.

EXTERNAL_BLOCKERS: Trusted production adapters and durable advanced-state persistence described above.

NEXT_OWNER: Chat 4 Backend/API for adapter composition and durability; Chat 2 UI for literal status presentation; Chat 8 QA for final cross-owner acceptance.

DO_NOT_TOUCH: Frozen contracts, native runtime, React UI, crypto, Mark-L, or unrelated dirty-worktree files from this handoff.
