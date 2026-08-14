# E.D.I.T.H TaskService Foundation

Date: 2026-08-14

## Purpose

This document records the next Phase 3 / Phase 4 bridge: task mutation is now routed through a dedicated `TaskService` instead of scattered direct store calls.

This is not the full durable Task Engine yet. It is the service boundary that future Planner, Executor, Verifier, and Recovery layers can use without knowing whether task state is stored in SQLite or JSON fallback.

## Added Component

| File | Role |
|---|---|
| `src/edith/taskService.ts` | Task creation, lookup, status changes, observations, checkpoints, artifacts |
| `scripts/test-edith-task-service.ts` | Regression coverage for durable task mutation and audit |

## Preserved Compatibility

Existing functions in `src/edith/taskStore.ts` still exist:

- `listTasks()`
- `createStoredTask()`
- `updateTaskStatus()`
- `getTaskStorePath()`

They now delegate to `TaskService`, so existing callers such as `server.ts` and `serverRegistry.ts` continue working.

## New Task Mutations

`TaskService` supports:

| Operation | Purpose |
|---|---|
| `createTask()` | Create a persisted EDITH task |
| `getTask()` | Load a task by ID |
| `updateStatus()` | Move a task through lifecycle states |
| `addObservation()` | Store execution/planning observations |
| `addCheckpoint()` | Store durable checkpoints |
| `addArtifact()` | Attach produced artifacts or references |

Each mutation emits an audit event with `toolId: "task_service"`.

## New Backend Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/edith/tasks/:id/observations` | Append a task observation |
| `POST /api/edith/tasks/:id/checkpoints` | Append a task checkpoint |
| `POST /api/edith/tasks/:id/artifacts` | Append a task artifact reference |

## Verification

Commands:

```bash
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- task creation persists
- observation persists
- checkpoint persists
- artifact persists
- status/result update persists
- audit events are emitted for task mutations

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3102` | Started successfully |
| `POST /api/edith/tasks` | Created a persisted smoke task |
| `POST /api/edith/tasks/:id/observations` | Appended `smoke observation` |
| `POST /api/edith/tasks/:id/checkpoints` | Appended `smoke checkpoint` |
| `POST /api/edith/tasks/:id/artifacts` | Appended `artifact://smoke` |

## Remaining Task Engine Work

1. Add first-class `task_steps` APIs and persistence methods.
2. Add dependency management.
3. Add retry policy and attempt counters.
4. Add pause/resume/cancel semantics.
5. Add verifier result attachment.
6. Add executor-safe state transitions.
