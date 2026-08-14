# E.D.I.T.H Tool Execution Hardening

Date: 2026-08-14

## Purpose

This document records the next Phase 2 hardening step for backend-enforced tool execution. The goal is to keep the existing tools working while making execution safer, more observable, and more durable.

## Added Behavior

Backend registry execution now applies shared safeguards before and around tool handlers:

| Safeguard | Behavior |
|---|---|
| Input validation | Required fields and primitive schema types are checked before handler execution |
| Permission check | Existing backend permission enforcement remains in place |
| Timeout | Each registered tool is wrapped with its metadata `timeoutMs` |
| Normalized errors | Results can now include `errorCode` values such as `VALIDATION_ERROR`, `PERMISSION_DENIED`, `TIMEOUT`, `TOOL_ERROR`, and `UNKNOWN_TOOL` |
| Timing metadata | Results include `startedAt`, `finishedAt`, and `durationMs` |
| Tool-run persistence | Every known tool execution result is recorded through the persistence layer |
| Tool health | Registry can report `HEALTHY`, `DEGRADED`, or `UNAVAILABLE` per tool |

## Tool Run Access

New endpoint:

```text
GET /api/edith/tool-runs
GET /api/edith/tools/health
```

These return recent persisted tool execution records and computed registry health from the active backend policy.

## Files Changed

| File | Change |
|---|---|
| `src/edith/core.ts` | Added validation and timeout errors, schema validation, execution timeout wrapper, normalized result fields |
| `src/edith/serverRegistry.ts` | Records tool runs and maps validation/permission/timeout errors into normalized results |
| `src/edith/persistence/types.ts` | Added optional store close hook for tests |
| `src/edith/persistence/sqliteStore.ts` | Added ESM-safe SQLite require and close support |
| `src/edith/persistence/jsonStore.ts` | Added no-op close support |
| `server.ts` | Added `/api/edith/tool-runs` and `/api/edith/tools/health` endpoints |
| `scripts/test-edith-registry.ts` | Added registry regression coverage |

`server.ts` also honors the `PORT` environment variable, which allows side-by-side runtime smoke checks without colliding with an already running dev server.

## Verification

Commands run:

```bash
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Registry regression scenarios:

| Scenario | Expected |
|---|---|
| `system_monitor` with valid input | Success result with duration metadata |
| `task_create` with missing required input | `VALIDATION_ERROR` |
| `playwright_browser_agent` without high-risk permission | `PERMISSION_DENIED` |
| All above | Persisted tool-run records exist |
| Registry health | High-risk Playwright tool is `UNAVAILABLE` while high-risk mode is disabled |

Runtime smoke check:

| Check | Result |
|---|---|
| Production server on `PORT=3100` | Started successfully |
| `GET /api/edith/persistence` | Returned `kind: "sqlite"` |
| Malformed `POST /api/tools/execute` for `task_create` | Returned `VALIDATION_ERROR` with validation details |
| `GET /api/edith/tool-runs?limit=5` | Returned the persisted failed tool run |

Known warning:

- Node v22.22.3 still emits an experimental warning for `node:sqlite`.

## Remaining Phase 2 Work

1. Add registry health status.
2. Apply richer input schemas, including enum and URL/path validation.
3. Persist frontend legacy tool executions through the backend registry path.
4. Move all currently switch-based `server.ts` tools into backend registry definitions.
5. Add timeout coverage with a deliberately slow test tool.
6. Add normalized output validation.
