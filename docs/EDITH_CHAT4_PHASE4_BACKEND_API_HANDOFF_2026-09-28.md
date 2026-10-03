# E.D.I.T.H. Phase 4 Backend / API Handoff

Date: 2026-09-28

## Implemented API surface

All Phase 4 endpoints require an owner session. Every POST/PUT mutation additionally requires trusted same-origin metadata and the owner-session CSRF token.

### Research

- `GET /api/edith/research`
- `GET /api/edith/research/:runId`
- `GET /api/edith/research/:runId/delta`
- `GET /api/edith/research/:runId/journal-status`
- `POST /api/edith/research`
- `POST /api/edith/research/run`
- `POST /api/edith/research/:runId/run`
- `POST /api/edith/research/:runId/cancel`

FAST, DEEP, and BROWSER requests are bounded and validated before reaching `ResearchService`. Seed URLs are passed only through the service SSRF policy. URL credentials, secret query parameters, local/metadata hosts, loopback/private/link-local/reserved addresses, and unsafe DNS results are rejected. Redirect chains produced by a future worker remain subject to the service's per-hop validation.

No live research worker, trusted DNS resolver, acquisition adapter, or production journal provider is installed by this backend integration. Execution therefore returns HTTP 503 with `CONFIGURATION_REQUIRED`; no sample claims or synthetic completion is produced. Cancellation returns `RESEARCH_CANCELLATION_NOT_SUPPORTED` without changing persisted state because the current service has no cooperative cancellation contract.

### Playbooks

- `GET /api/edith/playbooks`
- `GET /api/edith/playbooks/:playbookId?version=...`
- `GET /api/edith/playbooks/history`
- `GET /api/edith/playbooks/runs/:runId`
- `POST /api/edith/playbooks`
- `PUT /api/edith/playbooks/:playbookId/:version`
- `POST /api/edith/playbooks/:playbookId/dry-run`
- `POST /api/edith/playbooks/:playbookId/run`
- `POST /api/edith/playbooks/runs/:runId/undo`
- `POST /api/edith/playbooks/runs/:runId/resume`
- `POST /api/edith/playbooks/runs/:runId/cancel`

Definitions pass the canonical V2.1 parser before persistence. Client-supplied `approvedStepIds` are rejected and cannot act as approval proof. Playbooks requiring tools, permissions, non-zero risk, owner/policy approval, verification, or undo remain configuration-required until trusted server-side adapters and policy evaluators are injected. Resume and cooperative cancellation are exposed honestly as unsupported and never mutate state.

### Local search

- `GET /api/edith/search`
- `POST /api/edith/search`

Search is owner-session protected because it includes task, memory, local knowledge, research, and playbook metadata. Query terms, scope count, task IDs, and result count are bounded. Sensitive-memory inclusion is denied at this API boundary. Results recursively redact credential fields, bearer/assignment-style secrets, and local absolute paths.

## Transport contract

Responses use an additive envelope:

```json
{
  "success": true,
  "contract": { "schema": "edith.shared", "version": 2, "amendment": "2.1" },
  "correlationId": "corr-...",
  "data": {}
}
```

Mutating create/run/update/undo operations require `x-idempotency-key` with 8-160 safe characters. Repeating the same key and payload replays the stored HTTP result without executing again. Reusing the key with another payload returns `IDEMPOTENCY_KEY_REUSED`. `x-correlation-id` is accepted only in a bounded safe format; otherwise the backend allocates one.

Stable errors include `OWNER_SESSION_REQUIRED`, existing lowercase owner-session middleware codes, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `INVALID_RESEARCH_*`, `CONFIGURATION_REQUIRED`, `BLOCKED`, `PLAYBOOK_*`, `CLIENT_APPROVAL_EVIDENCE_FORBIDDEN`, `INVALID_SEARCH_*`, and `SENSITIVE_PAYLOAD_FORBIDDEN`.

## Reality and activity boundary

- Existing task APIs were not changed.
- Phase 4 routes do not emit synthetic task activity, progress, or realtime events.
- Research and playbook services persist only the states they actually produce.
- Unsupported cancel/resume operations do not claim success and do not modify records.
- No frontend, native, mobile, crypto, or Mark-L-main code was changed.

## Verification

- `npm run lint`
- `npx tsx scripts/test-edith-phase4-api.ts`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npm run test:edith-backend-security`
- `npm run build`

OWNER: E.D.I.T.H. Chat 4 Backend / API

SCOPE: Phase 4 protected Express routes, API adapters, persistence composition, transport redaction/idempotency, and HTTP security tests

STATUS: COMPLETE

COMMITS: None

FILES_CHANGED: `server/routes/phase4Api.ts`, `server/routes/research.ts`, `server/routes/playbooks.ts`, `server/routes/search.ts`, `server.ts`, `scripts/test-edith-phase4-api.ts`, this handoff

CONTRACTS_ADDED_OR_CHANGED: No canonical shared contract changed; HTTP envelopes use existing V2/V2.1 markers and route-local request/outcome DTO validation

APIS_ADDED_OR_CHANGED: Research, playbook, and scoped local-search endpoints listed above

TESTS_PASS: `npm run lint`, `npx tsx scripts/test-edith-phase4-api.ts`, `npx tsx scripts/test-edith-phase4-research.ts`, `npm run test:edith-backend-security`, and `npm run build`

KNOWN_LIMITATIONS: No live research/DNS/acquisition/journal adapters; no playbook execution/policy/verification/undo adapters; current services have no cooperative cancel or resume contract

EXTERNAL_BLOCKERS: Trusted adapters and canonical additive operational request/outcome/search contracts

DOWNSTREAM_DEPENDENCIES: Chat 2 frontend adapters and Chat 8 integration/security QA

NEXT_OWNER: Chat 2 frontend, then Chat 8 QA

DO_NOT_TOUCH: Chat 5 service implementations, native, mobile, crypto, Mark-L-main

NOTES_FOR_NEXT_AGENT: Treat HTTP `outcome` separately from persisted canonical `run.status`. A configuration-required research run is persisted as failed by the service and must not be presented as completed.

## Cross-chat request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-phase4-frontend-adapters-2026-09-28`
- FROM_OWNER: Chat 4 Backend / API
- TO_OWNER: Chat 2 Frontend
- REQUEST: Consume the V2.1 envelopes for research, playbooks, and local search. Show `configuration_required`, `blocked`, `waiting_for_approval`, and unsupported cancel/resume states literally. Send owner-session CSRF metadata plus a unique idempotency key for mutations. Do not infer completion from a persisted failed run or hide reason codes.
- STATUS: pending
