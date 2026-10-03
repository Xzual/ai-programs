# E.D.I.T.H. Phase 11E Packaged Windows Obsidian E2E Handoff

Date: 2026-09-29

## Verdict

Overall: **PARTIAL** for production release, **PASS** for the packaged Obsidian first-run safety flow after the narrow fix.

| Check | Result | Evidence |
| --- | --- | --- |
| Native Windows folder picker | PASS | Real packaged `edith.exe` dialog used; no WebView file input or path argument. |
| First-run activation | PASS | `FIRST_RUN_REQUIRED` -> `READY / VAULT_READY`. |
| Cancel | PASS | Remained first-run and reported no configuration change. |
| Change vault | PASS | Second disposable vault became `READY`; path was not displayed. |
| Missing vault | PASS | `DEGRADED / VAULT_UNAVAILABLE`, no picker popup, other UI remained usable. |
| Revoke | PASS | `FIRST_RUN_REQUIRED / VAULT_SELECTION_REVOKED`; local config became a path-free tombstone. |
| Restart reuse | PASS | Provider configuration survived backend restart without a picker. |
| Activation tree integrity | PASS after fix | Third clean vault remained byte-for-byte identical after activation. |
| Restart tree integrity | PASS after fix | Third clean vault remained byte-for-byte identical after full packaged restart. |
| Initial vault tree integrity | FAIL before fix | First fixture gained 66 generated registry/index Markdown files on restart. Evidence was retained. |
| Project `.edith` isolation | PASS | 39 before, 39 after, no path/hash/size/mtime differences. |
| Real Tauri profile isolation after fix | PASS | 4400 baseline files, 4400 after fixed runs, no differences. |
| Runtime process cleanup | PASS | No owned `edith.exe` or `edith-backend.exe` remained. |
| NSIS freshness | PASS | Current NSIS postdates scoped source inputs. |
| Production signing | BLOCKED | Current executables and installers are `NotSigned`. |
| MSI and portable freshness | BLOCKED | Only NSIS was rebuilt; existing MSI and portable ZIP are stale. |

## Root Cause And Fix

The packaged backend called `writeSkillRegistryNotes(...)` on every server startup when a writable vault was configured. This changed a user-selected vault during a restart even though the first-run selection contract is observation/configuration only.

`server.ts` now requires the explicit environment opt-in `EDITH_OBSIDIAN_SYNC_REGISTRY_ON_STARTUP=true` before any startup registry export. The default packaged startup only observes/indexes and does not write registry notes.

A regression assertion was added to the Phase 11C backend test. Explicit note-writing APIs remain available and permission-gated; no execution authority is derived from Obsidian content.

## Packaged E2E Isolation

Release builds accept a test root only when all of these are true:

- `EDITH_PACKAGED_E2E=true`
- `EDITH_PACKAGED_E2E_ROOT` is an existing local absolute directory strictly below the OS temp root
- the root contains `.edith-phase11e-root` with exact marker `EDITH_PHASE11E_ISOLATED_RUNTIME_V1\n`

The Tauri app-data directory and WebView2 user-data directory are redirected below that marked root. Normal product startup is unchanged. The release smoke test uses this same marker-gated isolation.

One early packaged attempt occurred before this isolation was corrected and touched the real Tauri profile. That evidence was retained and was not reverted. All fixed runs were compared against the post-incident baseline and caused no additional real-profile changes.

## Safety Model

- Native picker invocation is argument-free from the WebView.
- Selection paths remain inside Rust and backend-private state.
- Publication requires loopback, the native bridge bearer, one active owner binding, permission allowance, and an inactive kill switch.
- Native selection sessions are one-use, owner-bound, fixed-target, and expire within five minutes.
- Generic WebView producer authorization cannot use native-selection-only sessions.
- Responses, UI, and audit entries do not contain vault paths, selection IDs, device IDs, handles, or credentials.
- Obsidian remains knowledge-only and grants no tool or execution authority.
- No computer control, screenshot/OCR, wake word, browser automation, global OS shortcut, or tray mode was enabled.
- No crypto source file was changed by this work.

## Files Changed By Phase 11E

- `src-tauri/src/lib.rs`
- `src-tauri/src/cross_device.rs`
- `src-tauri/src/obsidian_picker.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/permissions/edith-desktop.toml`
- `src/edith/desktopShell.ts`
- `server/security/ownerSession.ts`
- `server/mobile/desktopProducerService.ts`
- `server/routes/obsidianProvider.ts`
- `server.ts`
- `scripts/test-edith-phase11b-native-vault-picker.ts`
- `scripts/test-edith-phase11c-obsidian-backend.ts`
- `scripts/test-edith-desktop-release.mjs`
- `artifacts/phase11e-obsidian-packaged/*`
- this handoff

The repository was already heavily dirty. No unrelated user changes were reverted, staged, committed, or cleaned.

## Packaged UI Evidence

- `artifacts/phase11e-obsidian-packaged/first-run-required.png`
- `artifacts/phase11e-obsidian-packaged/cancel-remains-first-run.png`
- `artifacts/phase11e-obsidian-packaged/vault1-ready-attempt.png`
- `artifacts/phase11e-obsidian-packaged/restart-reuse-ready.png`
- `artifacts/phase11e-obsidian-packaged/vault2-ready.png`
- `artifacts/phase11e-obsidian-packaged/vault2-degraded.png`
- `artifacts/phase11e-obsidian-packaged/revoked-first-run-required.png`
- `artifacts/phase11e-obsidian-packaged/vault3-ready-no-mutation.png`

Tree and isolation evidence:

- `vault1-before.json` / `vault1-after.json`: retained failing pre-fix evidence, 2 -> 68 files.
- `vault2-before.json` / `vault2-after.json`: 2 -> 2 unchanged.
- `vault3-before.json` / `vault3-after-activation.json` / `vault3-after-restart.json`: 2 -> 2 unchanged.
- `isolation-comparison-final.json`: project and real-profile trees unchanged after fixed runs.
- `build-provenance-final.json`: final artifact hashes, sizes, mtimes, signing state, and empty owned-process list.

All vaults were disposable fixtures under the OS temp directory. No real user vault was selected.

## Tests And Builds

Passed:

- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test` (41 passed)
- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts`
- `npm run test:edith-phase11c-obsidian-backend`
- `npm run test:edith-phase11d-obsidian-ui`
- `npm run test:edith-phase11d-obsidian-browser` against `vite preview` on `127.0.0.1:4173`
- `npm run test:edith-backend-security`
- `npm run test:edith-interaction-safety`
- `npm run lint`
- `npm run build`
- `$env:EDITH_CRYPTO_PYTHON_BUNDLE_DIR=(Resolve-Path 'src-tauri\target\release\python').Path; npm run tauri:build -- --bundles nsis`

Release smoke runtime checks passed for launch, managed sidecar, bounded sidecar restart, single instance, normal close, and descendant cleanup. The smoke command returns external-blocker status because artifacts are unsigned and non-NSIS packages were not rebuilt.

## Final Artifacts

- Desktop EXE: `src-tauri/target/release/edith.exe`
  - SHA-256: `0dda27af295ad405899787ad8fe6163ec1af091727490a932b56ef3f6fa19aa0`
- Backend sidecar: `src-tauri/target/release/edith-backend.exe`
  - SHA-256: `4f0a0b75c8fbedccc8a11fe9be7fb2330e86045631698c2b0a3d00e6171bbf0c`
- NSIS installer: `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe`
  - SHA-256: `77303cda244b58cc38ade9e0df1b5b8d1c6d31a279c05926b0f3d8ea80f9f60e`

## Remaining Work

1. Sign the release executable, sidecar, and installers with the production certificate.
2. Rebuild MSI and portable ZIP if those distribution formats are required for this release.
3. Decide whether registry-note export should have a separate explicit UI command; do not restore implicit startup writes.
4. Chat 2 may consume only the existing path-free provider status fields: `state`, `reasonCode`, `configured`, `available`, `readable`, `writable`, `selectionAction`, `configRevision`, `knowledgeOnly`, and `executionAuthority`.
5. Chat 4 may retain the backend native-session, replay, owner-binding, kill-switch, permission, and audit checks. No provider/backend redesign is required.

