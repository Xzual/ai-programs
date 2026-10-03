# E.D.I.T.H. Phase 11G-B - Packaged E2E Reparse Root Deny Handoff

Date: 2026-09-29  
Owner: Chat 6 Desktop / Tauri / Computer Safety  
Scope: packaged E2E isolation-root junction, symlink, and reparse-point denial only

## Result

The P1 issue is fixed. A packaged E2E root, marker, `app-data` child, or `webview-data` child that contains a Windows junction, symbolic link, or other reparse point is rejected fail-closed. The rejection happens before canonicalization and before the desktop app or sidecar can create redirected runtime data.

Normal startup behavior and the exact opt-in gate remain unchanged:

- `EDITH_PACKAGED_E2E=true` is still required.
- `EDITH_PACKAGED_E2E_ROOT` is still required when the gate is enabled.
- The root must still be a dedicated local absolute directory below the canonical OS temp root.
- `.edith-phase11e-root` must still contain exactly `EDITH_PHASE11E_ISOLATED_RUNTIME_V1\n`.
- With the gate absent, normal application-data resolution is unchanged.

## Root Cause

The previous validation canonicalized the candidate before enforcing containment. A junction located below OS temp could resolve to another directory that was also below OS temp, so the canonical containment and exact marker checks passed. The candidate's original path components were not inspected for Windows reparse metadata before canonicalization.

## Fix

`src-tauri/src/lib.rs` now:

1. Walks every existing component from the filesystem root to the candidate with `symlink_metadata`.
2. Rejects symbolic links and, on Windows, any component with `FILE_ATTRIBUTE_REPARSE_POINT`.
3. Rejects `.` and `..` components and fails closed when metadata cannot be inspected.
4. Performs the same check on the exact marker file.
5. Checks `app-data` and `webview-data` both before and after directory creation, then canonicalizes and confirms each remains strictly below the accepted root.

The safe directory helper is used by both the sidecar application-data path and `WEBVIEW2_USER_DATA_FOLDER`; neither can be independently redirected through a pre-created reparse child.

## Automated Coverage

Rust tests cover:

- real positive OS-temp marker directory
- exact gate and temp-root exclusion
- relative root
- root outside OS temp
- missing marker
- invalid marker
- Windows junction as the configured root
- pre-created `webview-data` junction
- pre-created `app-data` junction
- Windows directory symlink when the platform permits fixture creation

Results:

- `cargo fmt --all -- --check`: PASS
- `cargo check --all-targets`: PASS
- `cargo clippy --all-targets --all-features -- -D warnings`: PASS
- `cargo test --all-targets`: PASS, 44 passed / 0 failed
- `npm run lint`: PASS
- `npm run build`: PASS; Vite emitted only the existing large-chunk warning
- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts`: PASS, 13 checks

## Real Packaged Probe

The current release EXE was launched with the exact gate and marker against a real OS-temp junction:

- Process alive after six seconds: `false`
- Exit code: `101`
- Failure: `invalid packaged E2E isolation root`
- Target `webview-data` created: `false`
- Target `app-data` created: `false`
- Junction `webview-data` created: `false`
- Junction `app-data` created: `false`
- Owned processes remaining: none

Evidence: `artifacts/phase11g-b-reparse-root/junction-adversarial-probe-final.json` plus its stdout/stderr logs.

The positive path was exercised by `npm run smoke:edith-desktop-release` with a real marker-gated OS-temp directory. Runtime launch, managed sidecar, bounded restart, single-instance handling, and coordinated close all passed. Summary: 20 PASS, 0 FAIL, 9 EXTERNAL_BLOCKER. The command exits `1` because unsigned and stale distribution artifacts are deliberately classified as external release blockers, not runtime failures.

## Profile Guard

The real `C:\Users\arday\Desktop\ai programs\.edith` profile was hashed before and after all work:

- Files: 39 before / 39 after
- Bytes: 69,887,062 before / 69,887,062 after
- Inventory SHA-256: `7a7c7d7a64167c6998d7803b4c77483980a03536634f5b835ea20465c8dd03f1`
- Path, size, content hash, and mtime differences: none

Evidence:

- `artifacts/phase11g-b-reparse-root/real-edith-before.json`
- `artifacts/phase11g-b-reparse-root/real-edith-after.json`
- `artifacts/phase11g-b-reparse-root/real-edith-guard.json`

The first real-profile incident evidence from earlier phases was not deleted or altered.

## Final Package Provenance

Build command:

```powershell
$env:EDITH_CRYPTO_PYTHON_BUNDLE_DIR=(Resolve-Path 'src-tauri\target\release\python').Path
npm run tauri:build -- --bundles nsis
```

Artifacts:

- `src-tauri/target/release/edith.exe`
  - 17,176,064 bytes
  - SHA-256 `1368c76177c4489a1e4dde7184dc64f3ea877824cecead2e75c593ecf4ebaae5`
  - Authenticode: `NotSigned`
- `src-tauri/target/release/edith-backend.exe`
  - 50,687,084 bytes
  - SHA-256 `927e6d853393c2ae13b2b2df0410b52be45f832c60520a90c34fff622093dfaa`
  - Authenticode: `NotSigned`
- `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe`
  - 100,006,200 bytes
  - SHA-256 `1f25c65ccc3776d623b93008154e901ef3c1586052fd8c68bb25bc8990bb07ce`
  - Authenticode: `NotSigned`

Machine-readable evidence: `artifacts/phase11g-b-reparse-root/build-provenance-final.json`.

No signing claim is made.

## Remaining External Blockers

- Release EXE, sidecar, NSIS installer, and existing MSI are unsigned.
- The existing MSI predates this fix and was not rebuilt by the requested NSIS-only package command.
- The existing portable ZIP is stale and does not match the current EXE, sidecar, or frontend tree.
- Two isolated OS-temp junction fixtures were retained because environment policy blocked recursive cleanup. They contain only the exact test marker and empty test directories; no real profile data or secrets were written.

## Boundaries Preserved

- No crypto source or trading logic was changed.
- No real computer control, screenshot/OCR, wake word, tray mode, global shortcut, or browser automation capability was enabled.
- No backend provider logic was changed.
- No agent/chat was created and no message was sent to another task.
- The existing dirty worktree was preserved; no commit, reset, revert, or broad cleanup was performed.
- No E.D.I.T.H. process remained after testing.

