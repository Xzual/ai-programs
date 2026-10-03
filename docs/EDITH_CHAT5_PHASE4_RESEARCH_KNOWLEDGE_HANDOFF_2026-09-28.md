# E.D.I.T.H. Phase 4 Research / Knowledge Handoff

Date: 2026-09-28

## Implemented services

- `ResearchService`: FAST, DEEP, and BROWSER specialized-worker plans; bounded concurrency, retry, and timeout; deterministic source/citation/claim merge; citation-required completion; freshness and prior-run delta.
- `ResearchSsrfPolicy`: credential-free HTTP(S) only; blocks localhost, private, link-local, metadata, documentation/reserved addresses, secret query parameters, and non-public DNS results. Every redirect is revalidated. DNS and acquisition remain injected backend responsibilities.
- `ResearchJournalService`: writes only into `E.D.I.T.H/Research Journal`, marks E.D.I.T.H.-owned notes, redacts secrets/local paths, preserves colliding user notes, and records prior-run delta. Test/development writes require `SandboxVaultProvider`, whose root must be below the OS temp directory.
- `PlaybookService`: canonical validation, persistence, dry-run, owner/policy approval gates, bounded timeout/retry, verification, undo, and run/attempt history. Missing execution, policy, verification, or undo adapters are reported honestly.
- `LocalSearchService`: typed, scoped local results for task, memory, knowledge, research, and playbook metadata with provenance and output redaction.
- `JsonPhase4Persistence` and `MemoryPhase4Persistence`: ResearchRun, PlaybookDefinition, and PlaybookRun persistence with atomic JSON replacement and legacy-array migration.

## Reality boundary

- No live network/browser acquisition adapter was added. Research without injected workers and DNS/acquisition capability returns `configuration_required`; it never creates synthetic findings.
- No production Obsidian provider is wired. The journal service is provider-injected; tests can only instantiate the temp-root sandbox provider.
- No tool execution is simulated. Playbook steps requiring tools, policy decisions, verification, or undo remain blocked/configuration-required until trusted adapters are injected.
- No Express route or UI was added in this ownership scope.

## Contract gaps

The canonical file provides `ResearchRunV2` and Playbook V2.1 types, but does not define a canonical research request, worker plan, operational outcome (`configuration_required`, `blocked`, `waiting_for_approval`), journal result, or unified-search request/result. Phase 4 uses `Pick`-based service inputs and separate operational result wrappers so persisted canonical statuses are not renamed.

PROPOSED_CHANGE: Additive `ResearchRequestV2_1`, `ResearchWorkerPlanV2_1`, `OperationalOutcomeV2_1`, `ResearchJournalResultV2_1`, and `LocalSearchResultV2_1` contracts; do not remove or rename existing V2.1 fields.

IMPACTED_OWNERS: Shared Contracts, Chat 4 Backend/API, Chat 2 UI, Mobile, Chat 8 QA.

ACK_STATUS: Phase 4 service implementation complete; contract and route owner acknowledgement pending.

MIGRATION_ORDER: canonical additive types -> backend adapters -> protected routes -> client adapters -> integration/security QA.

## Verification

- `npm run lint`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npm run test:edith-contracts`
- `npm run test:edith-contracts-v2-1`
- `npm run test:edith-obsidian-knowledge`
- `npm run test:edith-knowledge-map`
- `npm run build`

The build retains the existing Vite large-chunk warning. Node emits its existing experimental SQLite warning in persistence-backed tests.

OWNER: E.D.I.T.H. Chat 5 Research / Knowledge

SCOPE: Phase 4 research orchestration, SSRF policy, journal, playbooks, unified local search, and Phase 4 persistence

STATUS: COMPLETE

COMMITS: None

FILES_CHANGED: `src/edith/researchService.ts`, `src/edith/researchSsrfPolicy.ts`, `src/edith/researchJournalService.ts`, `src/edith/playbookService.ts`, `src/edith/localSearchService.ts`, `src/edith/phase4Persistence.ts`, `scripts/test-edith-phase4-research.ts`, `docs/EDITH_CHAT5_PHASE4_RESEARCH_KNOWLEDGE_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED: No canonical contract changed; provider and operational service interfaces are local to Phase 4 pending additive contract acknowledgement

APIS_ADDED_OR_CHANGED: None

TESTS_PASS: Targeted Phase 4, lint, build, contracts V2/V2.1, Obsidian knowledge, and knowledge map

KNOWN_LIMITATIONS: Live acquisition, production vault binding, actual playbook tool execution, and HTTP transport require trusted backend adapters

EXTERNAL_BLOCKERS: Backend DNS/redirect-safe acquisition adapter; owner-session protected routes; production vault provider; canonical operational outcome/request/search contracts

DOWNSTREAM_DEPENDENCIES: Chat 4 API wiring, Chat 2 research/playbook/search UI, Mobile read-only presentation, Chat 8 security/integration QA

NEXT_OWNER: Chat 4 Backend/API Owner, then Chat 8 QA

DO_NOT_TOUCH: `src/edith/contracts.ts`, `server.ts`, Express routes, React UI, native, crypto, and Mark-L-main from this handoff

NOTES_FOR_NEXT_AGENT: Inject real adapters explicitly. Never replace `configuration_required` with sample claims, simulated tool success, or an unrestricted filesystem/network provider.

CROSS_CHAT_REQUEST: Expose Phase 4 services through protected backend APIs and add missing shared contract wrappers

FROM_OWNER: E.D.I.T.H. Chat 5 Research / Knowledge

TO_OWNER: Chat 4 Backend/API Owner and Shared Contracts Owner

REASON: This ownership scope excludes routes and canonical contract edits; live DNS/acquisition and production vault access must be enforced at the trusted backend boundary

REQUESTED_CHANGE: Add owner-session/CSRF-protected research and playbook mutation routes, read-only scoped search/history routes, audit events, kill-switch checks, a DNS-rebinding-safe acquisition adapter that invokes redirect validation on every hop, and an explicit production journal provider. Add the proposed request/outcome/search contracts without breaking existing V2.1 consumers.

FILES_OR_CONTRACTS: `server/routes/*`, server composition, `src/edith/contracts.ts`, backend adapter implementations; consume the new Phase 4 services rather than duplicating their policy

BLOCKING: Live research, production Obsidian journal export, frontend integration, and end-to-end approval/audit verification

ACCEPTANCE_EVIDENCE: Unauthorized mutations rejected; every redirect and resolved address policy-checked; no result when providers are absent; uncited claims cannot complete; journal writes stay inside the owned folder; playbook approvals/retries/verification/undo audited; scoped search responses contain no secrets or absolute paths.
