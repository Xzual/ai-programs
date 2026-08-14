# E.D.I.T.H Memory V2 Foundation

Date: 2026-08-14

## Purpose

This document records the first Memory V2 foundation. EDITH now has a server-side memory service that adds typed, scoped, provenance-aware memory records on top of the existing SQLite persistence layer.

This is not a vector database or full semantic memory engine yet. It is the durable contract layer needed before richer retrieval, merge, and context selection can be safely integrated into Planner and chat.

## Added Component

| File | Role |
|---|---|
| `src/edith/memoryService.ts` | Memory V2 service for upsert, search, context selection, conflict detection, merge, delete, and export |
| `scripts/test-edith-memory-v2.ts` | Regression coverage for Memory V2 behavior |

## Memory Fields

The existing `MemoryItem` remains backward-compatible and now supports optional V2 fields:

| Field | Purpose |
|---|---|
| `type` | `working`, `episodic`, `semantic`, `preference`, `project`, `procedural`, or `failure` |
| `scope` | `global`, `user`, `project`, `task`, or `conversation` |
| `content` | Canonical memory text |
| `source` | Origin of the memory |
| `provenance` | How/why the memory was created |
| `confidence` | 0-1 confidence score |
| `importance` | 0-1 retrieval priority |
| `sensitivity` | `public`, `internal`, or `sensitive` |
| `updatedAt` | Last update timestamp |
| `lastAccessed` | Retrieval timestamp foundation |
| `ttlMs` | Optional expiry duration |
| `relatedEntityIds` | Links to tasks, projects, artifacts, or other entities |
| `mergeOf` | Source memory IDs merged into this memory |

## New Backend Endpoints

```text
GET /api/edith/memory-v2
POST /api/edith/memory-v2
GET /api/edith/memory-v2/context
POST /api/edith/memory-v2/merge
GET /api/edith/memory-v2/export
DELETE /api/edith/memory-v2/:id
```

The legacy endpoint remains available:

```text
GET /api/edith/memories
POST /api/edith/memories
```

## Current Behavior

Memory V2 supports:

- create/update through normalized upsert
- list by type/scope/sensitivity
- keyword search with importance/confidence scoring
- context retrieval that excludes sensitive memories by default
- conflict detection by matching key with different values
- merge of related memory records
- delete through persistence store
- export snapshot
- audit for upsert, merge, and delete

## Persistence

The foundation still uses the existing SQLite `memories` table:

```text
.edith/edith.db -> memories
```

The table stores the full memory object in JSON, so V2 fields can be added without a destructive migration.

## Verification

Commands:

```bash
npm run test:edith-memory-v2
npm run test:edith-mark-l
npm run test:edith-agents
npm run test:edith-planner
npm run test:edith-recovery
npm run test:edith-verifier
npm run test:edith-executor
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- typed/scoped memory upsert
- search and context retrieval
- sensitive memory redaction from default context
- conflict detection
- memory merge
- memory delete
- export snapshot
- audit event persistence

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3110` | Started successfully |
| `POST /api/edith/memory-v2` | Created a typed `project` memory |
| `GET /api/edith/memory-v2?query=...` | Returned matching memory |
| `GET /api/edith/memory-v2/context?query=...` | Excluded sensitive memory from default context |
| `GET /api/edith/memory-v2/export` | Returned export snapshot |
| `DELETE /api/edith/memory-v2/:id` | Deleted the smoke memory |

## Remaining Memory V2 Work

1. Migrate frontend memory writes from localStorage to Memory V2 endpoints.
2. Add real context service integration for Planner and chat prompt assembly.
3. Add first-class `memory_relations` persistence rows.
4. Add backup/restore commands.
5. Add conflict resolution UI.
6. Add failure-memory creation from repeated Recovery events.
7. Evaluate vector search only after privacy, deletion, and export rules are settled.
