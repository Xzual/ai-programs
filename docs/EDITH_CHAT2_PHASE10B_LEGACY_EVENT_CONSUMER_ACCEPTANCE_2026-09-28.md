# E.D.I.T.H. Chat 2 Phase 10B Legacy Event Consumer Acceptance

**Date:** 2026-09-28  
**Owner:** Chat 2 - Frontend / Consumer Acceptance  
**Scope:** Read-only consumer verification for the Phase 10A legacy task-event quarantine  
**Result:** **PASS** for the scoped consumer acceptance

## 1. Acceptance Summary

The Phase 10A compatibility boundary was exercised with persisted-style legacy `status`, `plan`, and `audit` timeline rows alongside one valid canonical `task.step_updated` event. The frontend remained readable across Command Center, Tasks, Dynamic Task Capsule, Mission View, and advanced task panels.

- `UNKNOWN_TASK_EVENT_TYPE` was not rendered and did not put the task surfaces into an error state.
- The valid canonical event remained visible as `task.step_updated`.
- Quarantine diagnostics did not become task state, activity, completion, verification, or progress.
- The fixture task remained `RUNNING`, non-terminal, and at 40% progress.
- No raw legacy message, payload, local path, or secret was rendered.
- Owner-session rejection remained fail-closed as `OWNER_SESSION_REQUIRED`.
- No frontend product-source change was required.

## 2. Contract Interpretation

The consumer follows the Phase 10A contract:

- `data.events` is the only canonical activity list consumed by task UI.
- Each canonical event is still validated through the strict V2 parser.
- Additive `eventDiagnostics` metadata is not interpreted as task progress or user-visible activity.
- Legacy timeline records are not promoted into canonical events.
- The neutral diagnostics notice proposed by Chat 4 remains optional and was not added in this acceptance pass.

## 3. Browser Fixture

The browser smoke used an isolated temporary Playwright fixture derived from the existing Phase 8D consumer freeze harness. It was deleted after execution and never opened backend persistence.

Fixture facts:

- Task status: `RUNNING`
- Progress: 40%, revision 4, terminal false
- Canonical activity: one `task.step_updated`
- Quarantined legacy types: `status`, `plan`, `audit`
- Diagnostics: 4 source rows, 1 canonical row, 3 quarantined rows, not truncated
- Advanced state: memory-only / native configuration required
- Owner negative: `/api/edith/advanced/state` returned HTTP 401 with `owner_session_required`

## 4. Surface Results

| Surface | Result | Evidence |
|---|---:|---|
| Command Center / Dynamic Capsule | PASS | Task title, `RUNNING`, and 40% remained readable; no unknown-event error. |
| Mission View | PASS | `task.step_updated`, `RUNNING`, and `40% · rev 4` remained visible. |
| Tasks workspace | PASS | Canonical activity rendered; quarantine did not become progress or completion. |
| Advanced panels | PASS | Honest memory-only/configuration-required states remained intact. |
| Owner-session negative | PASS | HTTP 401 normalized to `OWNER_SESSION_REQUIRED`; advanced state did not appear available. |
| Mobile/tablet responsive | PASS | No horizontal overflow or major render error at 390 and 768 widths. |
| Laptop/desktop responsive | PASS | No horizontal overflow or major render error at 1366 and 1920 widths. |

Screenshots are stored in `artifacts/phase10b-legacy-event-consumer/`:

- `tasks-mobile.png`, `tasks-tablet.png`, `tasks-laptop.png`, `tasks-desktop.png`
- `system-mobile.png`, `system-tablet.png`, `system-laptop.png`, `system-desktop.png`

## 5. Data Honesty and Redaction

- The UI did not show quarantined rows as completed work, successful verification, or canonical task activity.
- The canonical task snapshot remained authoritative for status and progress.
- The browser fixture asserted that diagnostic metadata contained neither the sentinel local path nor the sentinel API-key-like secret.
- The Phase 10A isolated backend test independently verified that serialized diagnostics exclude raw message, path, secret, actor, and payload material.
- No raw local path or secret appeared in tested DOM surfaces.

## 6. Persistence Isolation Gate

The real runtime database was measured before and after all scoped tests.

| Property | Before | After |
|---|---|---|
| Path | `.edith/edith.db` | `.edith/edith.db` |
| SHA-256 | `3EE2E2DCF762A4DDB91B48891AF4B690ACF94C59E69D15C13E3396E7D368DCFF` | Same |
| Size | 53,260,288 bytes | Same |
| UTC mtime | `2026-09-28T20:46:57.5863204Z` | Same |

**Gate result:** `sourceRuntimeDatabaseUnchanged: true`.

## 7. Commands and Results

| Command | Result |
|---|---:|
| `npm run lint` | PASS |
| `npm run build` | PASS; existing 852.64 kB main-chunk warning only |
| `npm run test:edith-phase10a-legacy-task-events` | PASS; isolated DB gate true |
| `npx tsx scripts/test-edith-phase3-task-ui.ts` | PASS |
| `node scripts/test-edith-phase3-ui.mjs` | PASS |
| `npm run test:edith-cross-device-phase6` | PASS; isolated DB gate true |
| `npm run test:edith-phase6f-desktop-bridge` | PASS |
| `npm run test:edith-phase7a-contracts` | PASS |
| `npm run test:edith-phase7f-ui` | PASS, 13 assertions |
| `npm run test:edith-phase7f-browser` | PASS, 390/768/1366/1920 |
| `npm run test:edith-phase8d-ui-freeze` | PASS, 390/768/1366/1920 and owner-session negative |
| Temporary Phase 10B browser fixture | PASS, 390/768/1366/1920 |

Expected fixture-only HTTP 503 responses were used for unavailable integrations. Browser suites reported no page errors and no major console errors after excluding those expected failed-resource messages.

## 8. Files Changed

- `docs/EDITH_CHAT2_PHASE10B_LEGACY_EVENT_CONSUMER_ACCEPTANCE_2026-09-28.md`
- `artifacts/phase10b-legacy-event-consumer/*.png` (8 browser evidence screenshots)

No frontend source, backend, Crypto, Mark-L, package metadata, or persistence file was changed by this acceptance pass. The temporary browser fixture was removed after execution.

## 9. Remaining Risks

- Legacy records remain quarantined rather than migrated, so their historical messages are intentionally absent from canonical activity UI.
- The UI does not currently show the optional neutral quarantine-count notice. This is not required for compatibility and avoids presenting diagnostics as user activity.
- Phase 9 release blockers outside this scope remain: signed Windows artifacts, connected Android instrumentation, and real device/native E2E scenarios.
- The existing production main-bundle size warning remains unchanged.

## 10. Decision

**PASS — Phase 10A legacy event quarantine is consumer-safe for the tested frontend surfaces.**

This result closes the Phase 9 `UNKNOWN_TASK_EVENT_TYPE` frontend readability blocker for the scoped compatibility path. It does not change the broader product release decision or claim completion of unrelated native/device E2E work.
