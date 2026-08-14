# E.D.I.T.H Recovery / Replanner Foundation

Date: 2026-08-14

## Purpose

This document records the first Recovery/Replanner foundation. EDITH can now classify failed or retryable task states, record recovery history, and attach a fresh structured plan when retry budget allows.

This is deliberately controlled recovery, not an uncontrolled retry loop.

## Added Component

| File | Role |
|---|---|
| `src/edith/recovery.ts` | Recovery decision and replan service |
| `scripts/test-edith-recovery.ts` | Regression coverage for retryable verification and permission wait recovery |

## Recovery Data Shape

New core types:

| Type | Purpose |
|---|---|
| `EdithRecoveryClassification` | Failure/recovery category |
| `EdithRecoveryAction` | `REPLAN`, `WAIT_PERMISSION`, or `STOP` |
| `EdithRecoveryEvent` | Persisted recovery attempt metadata |

Recovery history is stored on:

```text
task.recoveryEvents
```

## Current Classifications

| Classification | Meaning |
|---|---|
| `VERIFICATION_RETRYABLE` | Verifier found missing/incomplete evidence that can be retried |
| `PARTIAL_RESULT` | Verifier produced a partial result |
| `EXECUTION_FAILED` | Task is failed after execution/tool failure |
| `PERMISSION_DENIED` | Task is waiting for explicit permission |
| `BUDGET_EXHAUSTED` | Task paused because execution budget was exhausted |
| `UNKNOWN` | Recoverable status exists but cause is not yet specific |

## Lifecycle Behavior

| Condition | Recovery Action | New Task Status |
|---|---|---|
| Retryable/partial/failed/paused and retry budget remains | `REPLAN` | `QUEUED` |
| Waiting for permission | `WAIT_PERMISSION` | `WAITING_PERMISSION` |
| Retry budget exhausted | `STOP` | `FAILED` |

When `REPLAN` is selected, the service creates a new structured plan through the existing PlannerService and stores both the previous plan ID and the new plan ID in the recovery event.

## Retry Budget

The first recovery service uses:

```text
task.plan.maxRetries
```

If the task has no plan, the fallback retry budget is `2`.

The service does not execute automatically after replanning. It returns the task to `QUEUED`, where a caller can explicitly run Executor again.

## New Backend Endpoint

```text
POST /api/edith/tasks/:id/recover
```

This endpoint classifies the current task state and either attaches a new plan, waits for permission, or stops the task.

## Verification

Commands:

```bash
npm run test:edith-recovery
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

- retryable verification becomes recoverable
- recovery creates a fresh `READY` plan
- task moves to `QUEUED`, not directly back to execution
- recovery event persists previous and new plan IDs
- `task.recover` audit event exists
- permission-denied task stays in `WAITING_PERMISSION`

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3106` | Started successfully |
| `POST /api/edith/tasks` | Created a recovery smoke task |
| `POST /api/edith/tasks/:id/plan` | Attached first `READY` plan |
| `PATCH /api/edith/tasks/:id/status` | Forced task to `VERIFYING` without execution evidence |
| `POST /api/edith/tasks/:id/verify` | Returned `status: "RETRYABLE"` |
| `POST /api/edith/tasks/:id/recover` | Returned `success: true`, `action: "REPLAN"`, `classification: "VERIFICATION_RETRYABLE"` |
| `GET /api/edith/tasks` | Persisted task status was `QUEUED`; new plan ID replaced previous plan ID |

## Remaining Recovery Work

1. Add automatic Executor handoff only when policy permits it.
2. Add backoff timing and scheduled retry windows.
3. Add fallback tool selection when a required tool is unavailable.
4. Add alternative agent selection.
5. Persist failure memories for recurring failures.
6. Add UI controls in EDITH Ops for retry, pause, cancel, and permission requests.
