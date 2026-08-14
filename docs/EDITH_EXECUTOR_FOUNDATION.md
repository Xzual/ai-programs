# E.D.I.T.H Executor Foundation

Date: 2026-08-14

## Purpose

This document records the first Executor foundation. EDITH can now load a persisted `READY` plan, find runnable steps, execute selected backend registry tools, store observations, update step state, and stop at a verification boundary.

This is not the full autonomous Executor yet. It deliberately does not mark tasks as `COMPLETED`; completion still requires the future Verifier layer.

## Added Component

| File | Role |
|---|---|
| `src/edith/executor.ts` | Durable executor foundation |
| `scripts/test-edith-executor.ts` | Regression coverage for plan execution |

## Execution Behavior

The first executor:

- requires a task with a `READY` plan
- marks task as `RUNNING`
- finds runnable steps whose dependencies are terminal
- marks steps `RUNNING` then `COMPLETED` or `FAILED`
- executes suggested tools through backend `executeEdithTool`
- records tool observations on the task
- respects plan budgets: `maxIterations`, `maxToolCalls`, `taskTimeoutMs`
- returns `WAITING_PERMISSION` if a tool is denied
- returns `FAILED` if a tool fails
- moves successful execution only to `VERIFYING`

## New Backend Endpoint

```text
POST /api/edith/tasks/:id/execute
```

This executes the currently attached plan for a task.

## Verification

Commands:

```bash
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

- plan executes from persisted task state
- `system_monitor` runs through backend registry
- tool run is persisted
- task observations are stored
- all plan steps become `COMPLETED`
- task moves to `VERIFYING`, not `COMPLETED`

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3104` | Started successfully |
| `POST /api/edith/tasks` | Created an executor smoke task |
| `POST /api/edith/tasks/:id/plan` | Returned a `READY` plan with 3 steps |
| `POST /api/edith/tasks/:id/execute` | Returned `success: true`, `status: "VERIFYING"`, `toolCalls: 1`, `reports: 3` |
| `GET /api/edith/tasks` | Persisted task status was `VERIFYING`; plan steps were `COMPLETED` |

## Remaining Executor Work

1. Persist task steps as first-class rows instead of only embedded plan JSON.
2. Add pause/resume/cancel controls.
3. Add retry counters and backoff.
4. Add rollback/compensation hooks where supported.
5. Add permission-request workflow instead of immediate stop.
6. Connect Verifier results before allowing `COMPLETED`.
