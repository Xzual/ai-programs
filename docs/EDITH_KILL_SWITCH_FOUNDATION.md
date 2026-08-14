# E.D.I.T.H Kill Switch Foundation

Date: 2026-08-14

## Purpose

This document records the first backend-enforced kill switch foundation. EDITH now has an emergency stop state that is enforced server-side instead of being only a UI concept.

The foundation is intentionally conservative: when active, it blocks new task creation and external tool execution while preserving existing task state, audit records, and read-only inspection endpoints.

## Added Component

| File | Role |
|---|---|
| `src/edith/killSwitch.ts` | Persistent emergency stop state, assertions, and audit events |
| `src/components/views/EdithOpsView.tsx` | EDITH Ops kill switch status and control panel |
| `scripts/test-edith-kill-switch.ts` | Regression coverage for blocking task creation, tool execution, executor execution, deactivation, and audit |

## Backend Endpoints

```text
GET  /api/edith/kill-switch
POST /api/edith/kill-switch/activate
POST /api/edith/kill-switch/deactivate
```

## Disabled Capabilities

When active, the kill switch marks these capabilities disabled:

- `task_creation`
- `tool_execution`
- `browser_control`
- `computer_control`
- `trading_execution`
- `proactive_tasks`

The current implementation enforces the first two directly and uses them to stop executor/tool paths. Browser, computer, trading, and proactive actions are included in the state contract so future adapters can bind to the same backend policy.

## Enforcement Points

| Enforcement point | Behavior when active |
|---|---|
| `TaskService.createTask()` | Throws `KillSwitchActiveError`; no new task is persisted |
| `/api/edith/tasks` | Returns HTTP `423` with kill switch state |
| `executeEdithTool()` | Returns denied `EdithToolResult`, writes audit, records denied tool run |
| `ExecutorService.executeTask()` | Returns `PAUSED` and preserves the existing task |
| Legacy `/api/tools/execute` fallback | Returns HTTP `423` before legacy tool switch execution |

Read-only endpoints such as task listing, audit, persistence status, registry health, and Knowledge Map remain available.

## EDITH Ops UI

EDITH Ops now shows:

- active/inactive kill switch state
- disabled capability badges
- reason input before activation
- activation timestamp/reason while active
- activate/deactivate controls
- paused task count

The UI is only a control surface. The enforcement remains in the backend service and execution paths.

## Persistence

The state is stored beside EDITH local persistence data:

```text
.edith/kill-switch.json
```

## Verification

Commands:

```bash
npm run test:edith-kill-switch
npm run test:edith-registry
npm run test:edith-executor
npm run lint
npm run build
```

Regression scenarios:

- activate kill switch
- block task creation
- block tool execution
- pause executor without deleting task state
- deactivate kill switch
- audit activation, deactivation, block, and denied tool execution

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3114` | Started successfully |
| `GET /api/edith/kill-switch` | Returned inactive state before activation |
| `POST /api/edith/kill-switch/activate` | Activated emergency stop |
| `POST /api/edith/tasks` while active | HTTP `423` |
| Legacy `/api/tools/execute` while active | HTTP `423` |
| Registered `/api/tools/execute` while active | HTTP `423` |
| `POST /api/edith/kill-switch/deactivate` | Deactivated emergency stop |
| Production server on `PORT=3115` | EDITH Ops status/activate/status/deactivate endpoint flow passed |

## Remaining Work

1. Add a second confirmation dialog for activation/deactivation.
2. Bind future browser/computer/trading/proactive adapters directly to capability-specific checks.
3. Add role/authorization checks before deactivation once user/account auth exists.
4. Add global frontend status banner and polling outside EDITH Ops.
5. Add recovery behavior that can resume paused tasks after user review.
