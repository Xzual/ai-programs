# E.D.I.T.H Planner Foundation

Date: 2026-08-14

## Purpose

This document records the first Planner foundation. EDITH can now create a structured, persisted plan for a task without relying on freeform prose.

This is intentionally a small deterministic planner. It does not pretend to be a full autonomous planner yet; it creates the schema and persistence path that the future Executor and Verifier can consume.

## Added Component

| File | Role |
|---|---|
| `src/edith/planner.ts` | Heuristic structured planner |
| `scripts/test-edith-planner.ts` | Planner regression coverage |

## Plan Shape

`EdithPlan` is now part of the core task model.

Important fields:

| Field | Purpose |
|---|---|
| `id` | Stable plan ID |
| `taskId` | Parent task |
| `status` | `DRAFT`, `READY`, or `INVALID` |
| `steps` | Ordered structured plan steps |
| `requiredTools` | Tool IDs selected for execution |
| `requiredPermissions` | Permissions needed by selected tools |
| `requiredAgents` | Compact agent labels such as `orchestrator`, `operations`, `research` |
| `validationCriteria` | Conditions that must be checked before completion |
| `stopConditions` | Budget/risk/failure stop rules |
| `maxIterations`, `maxRetries`, `maxToolCalls`, `taskTimeoutMs` | Execution budgets |

## New Backend Endpoint

```text
POST /api/edith/tasks/:id/plan
```

This loads a task, creates a structured plan, attaches it to the persisted task, updates task metadata, and emits an audit event.

## Current Heuristics

The first planner chooses tools conservatively:

| Objective Signal | Suggested Tool |
|---|---|
| system, CPU, RAM, memory, performance, health report | `system_monitor` |
| web, internet, research, site, URL, browser | `browser_search` |
| skill, tool, catalog, capability | `ai_skill_catalog` |

The generated plan always includes:

1. Gather context.
2. Run selected tools, when tools are needed.
3. Verify result.

## Verification

Commands:

```bash
npm run test:edith-planner
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- plan is created for a persisted task
- system health objective selects `system_monitor`
- dependencies are represented between steps
- validation criteria are generated
- plan is persisted back onto the task
- `task.plan` audit event exists

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3103` | Started successfully |
| `POST /api/edith/tasks` | Created a smoke task |
| `POST /api/edith/tasks/:id/plan` | Returned `READY` plan |
| Generated plan | 3 steps, selected `system_monitor`, task moved to `PLANNING` |

## Remaining Planner Work

1. Add schema validation for externally generated plans.
2. Store plan steps as first-class `task_steps` rows.
3. Add missing-information detection.
4. Add parallelizable step grouping beyond simple tool discovery.
5. Add permission-aware replanning when selected tools are unavailable.
6. Route complex chat objectives into plan creation after task creation.
