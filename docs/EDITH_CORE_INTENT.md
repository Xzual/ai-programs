# E.D.I.T.H Core Intent Foundation

Date: 2026-08-14

## Purpose

This document records the first Phase 3 EDITH Core step. The chat route now asks a dedicated `IntentService` what the user wants before deciding whether to continue with normal model conversation or route into a backend tool/task action.

## Added Component

| File | Role |
|---|---|
| `src/edith/intent.ts` | Structured intent understanding service |
| `src/edith/contextService.ts` | Safe context snapshot service for Memory V2, task, tool, tool-run, and audit references |
| `scripts/test-edith-intent.ts` | Regression coverage for current chat routing behavior |

## Intent Decision Shape

`IntentService.understand()` returns:

| Field | Meaning |
|---|---|
| `kind` | `conversation`, `task_objective`, or `tool_execution` |
| `confidence` | Heuristic confidence score |
| `originalText` | Raw user text |
| `normalizedText` | Turkish-locale normalized text |
| `requiresTask` | Whether durable task state is expected |
| `requiresPlanning` | Whether this looks like a planning-worthy objective |
| `route` | Optional backend tool route |
| `rationale` | Short machine-readable explanation |

## Preserved Behavior

The previous inline chat routing behavior is preserved:

- task creation requests route to `task_create`
- system/CPU/RAM status requests route to `system_monitor`
- skill/tool catalog requests route to `ai_skill_catalog`
- URL open requests route to `browser_open`
- web search requests route to `browser_search`
- ordinary conversation continues to the configured model path

## Why This Matters

This is a small but important step away from hidden prompt-state and toward the requested EDITH loop:

```text
USER OBJECTIVE
  -> INTENT UNDERSTANDING
  -> TASK / TOOL / CONVERSATION ROUTE
```

The service is intentionally heuristic for now. It does not fake full autonomy; it creates a stable interface that Planner, Task Engine, PermissionService, AgentRouter, and ContextService components can consume.

## Verification

Commands:

```bash
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

## Remaining Phase 3 Work

1. Add CapabilityService to reason over tool health and permissions.
2. Add provider-specific context budgets for ModelRouter decisions.
3. Continue integrating the ModelRouter foundation into provider health, metrics, and future model adapters.
4. Route complex objectives through the Planner/Executor/Verifier loop instead of only creating a task shell.
