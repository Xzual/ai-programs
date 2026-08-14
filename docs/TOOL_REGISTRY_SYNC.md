# E.D.I.T.H Tool Registry Sync

Date: 2026-08-14

## Purpose

This document records the first Phase 2 step toward making the backend EDITH tool registry the authoritative source for tool metadata, risk, and permission policy.

## Current Behavior

The frontend still keeps its broad `DEFAULT_TOOLS` catalog for compatibility and for legacy/prototype tools that are not yet fully represented in the backend registry.

On application startup, the frontend now calls:

```text
GET /api/edith/tools
```

It then merges returned backend registry metadata into the local automation list.

## Merge Rules

Backend registry metadata currently overrides or supplies:

- tool ID
- permissions
- category
- input schema
- high-risk/manual-confirmation default

Frontend compatibility currently preserves:

- localized display names where a matching local tool exists
- localized descriptions where a matching local tool exists
- last run state
- current UI status
- user confirmation toggle state

Backend security remains enforced during execution. Even if the UI state changes, high-risk tools remain blocked by backend permission and environment gates unless explicitly enabled.

## Files Changed

| File | Change |
|---|---|
| `src/lib/storage.ts` | Added registry tool type, schema-to-input mapping, and merge helper |
| `src/App.tsx` | Hydrates automation tools from `/api/edith/tools` on startup |

## Verification

Commands run:

```bash
npm run lint
npm run build
npm run test:edith-persistence
```

Runtime smoke check:

- `GET /api/edith/tools` returned backend registry metadata.
- `GET /api/edith/persistence` still returned `kind: "sqlite"`.

## Remaining Phase 2 Work

This is a compatibility bridge, not the complete registry migration.

Next steps:

1. Add explicit registry health metadata.
2. Move all prototype/legacy frontend tools into backend registry definitions.
3. Remove or demote frontend `DEFAULT_TOOLS` into display-only fallback data.
4. Add backend input validation before tool execution.
5. Persist backend tool runs through the new persistence layer.
6. Add tests for permission denied, high-risk disabled, malformed input, timeout, and normalized errors.
