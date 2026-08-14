# E.D.I.T.H Verifier Foundation

Date: 2026-08-14

## Purpose

This document records the first Verifier foundation. EDITH can now validate a task after Executor reaches the `VERIFYING` boundary.

The key rule is preserved: a task is not marked `COMPLETED` just because a tool returned `success: true`. Completion now requires a structured verification result with status `PASS`.

## Added Component

| File | Role |
|---|---|
| `src/edith/verifier.ts` | Evidence-based verification service |
| `scripts/test-edith-verifier.ts` | Regression coverage for verification and completion gating |

## Verification Result Shape

New core types:

| Type | Purpose |
|---|---|
| `EdithVerificationStatus` | `PASS`, `FAIL`, `PARTIAL`, or `RETRYABLE` |
| `EdithVerificationCheck` | One evidence check with status, label, evidence, and required flag |
| `EdithVerificationResult` | Persisted structured verification result attached to a task |

The result is stored on:

```text
task.verification
```

## Current Verification Checks

The first verifier is deterministic and evidence-based. It checks:

- task is at `VERIFYING`
- structured plan exists
- all plan steps are terminal
- no plan step failed
- each required tool has a successful executor observation
- each required tool has a successful task-scoped audit event
- execution produced observations, artifacts, or a result
- objective keywords overlap with recorded evidence
- file artifacts, when present as local paths or `file://` URLs, exist and are non-empty

## Lifecycle Behavior

| Verification Status | Task Status |
|---|---|
| `PASS` | `COMPLETED` |
| `FAIL` | `FAILED` |
| `PARTIAL` | `PAUSED` |
| `RETRYABLE` | `RETRYING` |

Premature verification is rejected if the task has not reached `VERIFYING`.

## New Backend Endpoint

```text
POST /api/edith/tasks/:id/verify
```

This endpoint evaluates the task, stores the verification result, emits task audit, and only returns success for `PASS`.

## Verification

Commands:

```bash
npm run test:edith-verifier
npm run test:edith-executor
npm run test:edith-planner
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- verification before `VERIFYING` is blocked
- Executor evidence is checked before completion
- successful `system_monitor` execution can verify the health-report task
- task moves to `COMPLETED` only after `PASS`
- verification result persists on the task
- `task.verify` audit event exists

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3105` | Started successfully |
| `POST /api/edith/tasks` | Created a verifier smoke task |
| `POST /api/edith/tasks/:id/plan` | Returned a `READY` plan |
| `POST /api/edith/tasks/:id/execute` | Returned `status: "VERIFYING"` |
| `POST /api/edith/tasks/:id/verify` | Returned `success: true`, `status: "PASS"` |
| `GET /api/edith/tasks` | Persisted task status was `COMPLETED`; verification had 8 checks |

## Remaining Verifier Work

1. Add domain-specific verifiers for file creation, browser tasks, code tasks, memory updates, and reports.
2. Store verification checks in first-class persistence rows.
3. Add stronger objective satisfaction scoring through model-assisted verification with strict evidence inputs.
4. Trigger Replanner/Recovery automatically for `RETRYABLE`.
5. Add artifact MIME/type validation and safe path policy.
6. Surface verification details in EDITH Ops and Knowledge Map.
