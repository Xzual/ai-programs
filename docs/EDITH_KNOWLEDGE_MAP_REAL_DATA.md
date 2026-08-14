# E.D.I.T.H Knowledge Map Real Data Foundation

Date: 2026-08-14

## Purpose

This document records the first step that turns Knowledge Map from a mostly frontend-composed visualization into a backend-backed EDITH introspection snapshot.

The map still renders in the existing React view, but the graph can now be generated from real EDITH sources:

- persisted tasks
- Memory V2 records
- backend tool registry
- tool health
- audit events
- tool runs
- agent registry
- ModelRouter node

## Added Component

| File | Role |
|---|---|
| `src/edith/knowledgeMapService.ts` | Builds graph nodes, edges, metrics, and source counts from current EDITH state |
| `scripts/test-edith-knowledge-map.ts` | Regression coverage for task, memory, tool, audit, agent, and model-router graph nodes |

## Backend Endpoint

```text
GET /api/edith/knowledge-map
```

The endpoint returns:

- `nodes`
- `edges`
- `metrics`
- `sources`
- `generatedAt`

## Current Graph Types

| Type | Source |
|---|---|
| `core` | EDITH system root |
| `memory` | Memory V2 service |
| `tool` | backend tool registry and tool health |
| `task` | persisted task store |
| `audit` | persisted audit events and tool runs |
| `agent` | agent registry |
| `model` | ModelRouter foundation |

## Verification

Commands:

```bash
npm run test:edith-knowledge-map
npm run test:edith-memory-v2
npm run test:edith-model-router
npm run lint
npm run build
```

Regression scenarios:

- persisted task node appears
- memory-to-task relation appears from `relatedEntityIds`
- registry tool node appears
- audit event node appears
- agent hub and agent nodes appear
- ModelRouter node appears

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3112` | Started successfully |
| `GET /api/edith/knowledge-map` | Returned graph snapshot |
| Core node | Present |
| Agent hub | Present |
| ModelRouter node | Present |
| Snapshot size | 48 nodes / 113 edges in current local state |

## Remaining Work

1. Move the React Knowledge Map fully to the backend snapshot.
2. Add graph filters by node type, risk, status, and source.
3. Add task-step and artifact nodes after task-step persistence is expanded.
4. Add memory relation rows instead of relying only on `relatedEntityIds`.
5. Add lightweight polling or websocket updates for live introspection.
