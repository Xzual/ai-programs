# E.D.I.T.H. Chat 4 Phase 11G-A Native Credential Isolation Handoff

Date: 2026-09-29

## Verdict

Phase 11G-A P1: **PASS**.

`DesktopProducerService.authorizeNativeSelection()` now fails closed unless the stored producer session was issued by `createNativeSelection()` with `nativeSelectionOnly === true`. A general mobile/desktop producer session can no longer authorize the Obsidian native-selection route.

## Scoped Changes

- `server/mobile/desktopProducerService.ts`
  - Added the exact fail-closed error `OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED` before sequence consumption or publication state mutation.
- `scripts/test-edith-phase11c-obsidian-backend.ts`
  - Added a service-level negative test proving a generic `create()` credential is rejected for native selection.
  - Proved the rejected generic credential still works through normal `authorize()` sequence 1.
  - Added a real HTTP route negative test proving a valid generic producer credential receives HTTP 401 with the exact safe error code.
  - Proved the denial body omits producer token, session, device, selection ID, and selected path.
  - Migrated successful native-selection test traffic to credentials issued by `/api/edith/obsidian/native-session`.
  - Retained five-minute maximum TTL, exact sequence 1, replay, lineage, owner logout, kill-switch, permission, and redaction coverage.

No crypto, Mark-L, frontend, Tauri capability, or unrelated backend source was changed.

## Authorization Result

| Credential | Native selection result | Normal producer result |
| --- | --- | --- |
| Native-only producer | Allowed once when all bridge, owner, lineage, TTL, sequence, permission, and kill-switch checks pass | Rejected |
| General desktop producer | HTTP 401 / `OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED` | Preserved |
| Browser owner credential alone | HTTP 403 / `OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED` | Not applicable |
| Mobile device credential alone | HTTP 403 / `OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED` | Not applicable |

The new error contains no path, token, session, device, or selection material. Existing route auditing records only the safe error code and path-free action metadata.

## Test Evidence

Passed:

- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts`
- `npm run test:edith-phase11c-obsidian-backend`
- `npm run test:edith-phase6e-backend-integration`
- `npm run test:edith-phase6g-native-ingest`
- `npm run test:edith-backend-security`
- `npm run test:edith-interaction-safety`
- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test --all-targets` (44 passed)
- `npm run lint`
- `npm run build` (existing Vite large-chunk warning only)

Phase 11E packaged release smoke:

- Runtime launch: PASS
- Managed sidecar and bounded restart: PASS
- Single-instance behavior: PASS
- Normal close and descendant cleanup: PASS
- Functional failures: 0
- External blockers: existing unsigned executables/installers and stale MSI/NSIS/portable distribution artifacts

The smoke result remained `EXTERNAL_BLOCKER`; it was not represented as a full release pass.

## Runtime Data Guard

The complete project `.edith` inventory was captured before and after the full matrix using relative path, SHA-256, byte length, and UTC mtime ticks.

- Before: 39 files, aggregate snapshot SHA-256 `2DCDD2476C7F37A0357C7557D9189F5B205944AE2C1BC76558ED406810D68FD1`
- After: 39 files, aggregate snapshot SHA-256 `2DCDD2476C7F37A0357C7557D9189F5B205944AE2C1BC76558ED406810D68FD1`
- Result: unchanged

All integration tests used isolated OS temporary workspaces. No real Obsidian vault was selected or mutated.

## Remaining Risks

- Production signing and rebuilding stale MSI/NSIS/portable artifacts remain release-owner work and are outside this P1.
- The separate packaged E2E root junction/reparse concern identified by Phase 11F is intentionally outside this credential-isolation change.
- The repository remains heavily dirty from parallel work; no unrelated files were reverted, staged, committed, or cleaned.
