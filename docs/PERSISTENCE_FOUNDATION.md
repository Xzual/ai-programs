# E.D.I.T.H Persistence Foundation

Date: 2026-08-14

## Purpose

This document records the first Phase 1 persistence foundation work. The goal is to move E.D.I.T.H from ad hoc JSON/runtime files toward a durable local persistence layer without breaking existing UI, task, audit, chat, voice, Mark-L, or crypto behavior.

## Current Persistence Mode

Default backend persistence now uses local SQLite through Node's built-in `node:sqlite` module.

Runtime database path:

```text
.edith/edith.db
```

Legacy runtime paths are still recognized:

```text
.edith/tasks.json
.edith/audit.log.jsonl
```

If SQLite is unavailable, the backend falls back to the existing JSON/JSONL behavior.

## Implemented Interfaces

New persistence modules:

| File | Role |
|---|---|
| `src/edith/persistence/types.ts` | Store interface and migration result types |
| `src/edith/persistence/sqliteStore.ts` | SQLite-backed EDITH store |
| `src/edith/persistence/jsonStore.ts` | Compatibility fallback store |
| `src/edith/persistence/index.ts` | Store selection and initialization |
| `scripts/migrate-edith-persistence.mjs` | Repeatable migration command |

Existing API surfaces preserved:

- `listTasks()`
- `createStoredTask()`
- `updateTaskStatus()`
- `appendAuditEvent()`
- `readRecentAuditEvents()`

## SQLite Schema Added

Tables created idempotently:

| Table | Purpose |
|---|---|
| `schema_migrations` | Future migration tracking |
| `tasks` | Durable EDITH task records |
| `task_steps` | Future task engine step records |
| `task_checkpoints` | Future checkpoint records |
| `audit_events` | Durable audit event history |
| `memories` | Server-side memory foundation |
| `tool_runs` | Server-side tool run foundation |

## Migration Behavior

Migration command:

```bash
npm run edith:migrate
```

Behavior:

- Creates `.edith/edith.db` if missing.
- Creates tables/indexes with `CREATE TABLE IF NOT EXISTS`.
- Imports existing `.edith/tasks.json` records with `INSERT OR IGNORE`.
- Imports existing `.edith/audit.log.jsonl` records with `INSERT OR IGNORE`.
- Can be run repeatedly without duplicating records.
- Does not delete legacy JSON/JSONL files.

Observed verification:

| Run | Tasks Imported | Audit Events Imported |
|---|---:|---:|
| First migration | 1 | 9 |
| Second migration | 0 | 0 |

## Backend Endpoints Added

| Endpoint | Purpose |
|---|---|
| `GET /api/edith/persistence` | Reports active store kind and runtime paths |
| `GET /api/edith/memories` | Lists server-side persisted memories |
| `POST /api/edith/memories` | Upserts a server-side memory record |

Existing endpoints now read/write through the persistence abstraction:

- `GET /api/edith/tasks`
- `POST /api/edith/tasks`
- `PATCH /api/edith/tasks/:id/status`
- `GET /api/edith/audit`

## Verification

Commands run:

```bash
npm run edith:migrate
npm run test:edith-persistence
npm run lint
npm run build
```

Runtime smoke checks:

- `GET /api/edith/persistence` returned `kind: "sqlite"`.
- `GET /api/edith/tasks` returned the migrated task.
- `GET /api/edith/audit?limit=3` returned migrated audit events.
- `npm run test:edith-persistence` verified migration idempotency in an isolated temporary workspace.

Known warning:

- `node:sqlite` emits an experimental warning on Node v22.22.3. The runtime works, but this should be tracked before treating SQLite support as final production-hardening.

## Remaining Phase 1 Work

This is the foundation, not the full persistence migration.

Next steps:

1. Add structured migration version rows in `schema_migrations`.
2. Move frontend memory writes from localStorage to backend endpoints.
3. Add server-side tool run recording for all backend tool executions.
4. Add task step/checkpoint APIs for the upcoming Task Engine.
5. Add automated tests for migration idempotency, fallback behavior, and corrupt legacy file handling.
6. Decide whether to keep `node:sqlite` or move to a maintained SQLite package once dependency policy review is complete.
