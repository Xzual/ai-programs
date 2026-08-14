# E.D.I.T.H ContextService Foundation

**Date:** 2026-08-14
**Status:** Foundation implemented

## Purpose

ContextService is the first dedicated context assembly layer for EDITH Core. It keeps Planner and future chat prompt assembly from directly dumping all stored data into a model request.

The service builds a small, traceable context snapshot from:

- Memory V2 safe context
- persisted tasks
- backend tool health
- persisted tool runs
- recent audit events

Sensitive memories are excluded by default.

## Added Files

| File | Purpose |
|---|---|
| `src/edith/contextService.ts` | Builds scoped context snapshots with references and redaction notes |
| `src/edith/chatContext.ts` | Formats bounded chat system prompt context without dumping all memory |
| `scripts/test-edith-context-service.ts` | Regression coverage for context assembly and planner integration |
| `scripts/test-edith-chat-context.ts` | Regression coverage for chat prompt context assembly |
| `docs/EDITH_CONTEXT_SERVICE_FOUNDATION.md` | This implementation note |

## Updated Files

| File | Change |
|---|---|
| `src/edith/core.ts` | Added context reference and context snapshot types; plans can carry an optional `contextSnapshot` |
| `src/edith/planner.ts` | Planner now builds a context snapshot before creating plan steps |
| `server.ts` | Chat route now uses bounded ContextService prompt context when memory is enabled |
| `src/App.tsx` | Chat requests now send the explicit `memoryEnabled` setting |
| `package.json` | Added `test:edith-context-service` script |
| `PROJECT_FULL_REPORT.md` | Added ContextService status to the project report |

## Behavior

`contextService.build()` accepts a query and optional task ID. It returns:

- snapshot ID
- query
- creation time
- memory references
- related task references
- tool references
- tool run references
- audit references
- redaction notes
- short summary

The snapshot is attached to new plans so later execution, verification, and reporting can explain which context was used.

## Verification

```bash
npm run test:edith-context-service
npm run test:edith-chat-context
npm run test:edith-planner
npm run lint
npm run build
```

Runtime coverage verifies:

- sensitive memories are excluded by default
- relevant project memory is included
- related tasks are selected
- tool health references are available
- context build emits audit
- planner attaches a context snapshot to persisted plans
- chat prompt assembly respects `memoryEnabled`
- sensitive client/server memories are excluded from chat context

## Remaining Work

1. Add provider-specific context budgets for ModelRouter decisions.
2. Add conversation/session context once conversations are server-side persisted.
3. Add richer task-step, artifact, and agent-run references.
4. Add frontend visibility for context snapshots in EDITH Ops.
5. Add UI controls for context inclusion diagnostics.
