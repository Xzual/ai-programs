# E.D.I.T.H. Phase 12A - Fresh Release Set Handoff

Date: 2026-09-29  
Owner: Chat 6 Desktop / Tauri / Computer Safety  
Status: FUNCTIONAL PASS / PRODUCTION SIGNING EXTERNAL BLOCKER

## 1. Result

The stale-distribution blocker is closed. A fresh desktop EXE, backend sidecar, MSI, NSIS installer, and portable ZIP were produced from one current packaging-input revision. All five deliverables postdate the newest packaging input. The portable EXE, sidecar, frontend, Crypto resources, and vetted Python runtime match their current build sources.

No production signing credential was available or used. Every PE/MSI signature check is honestly `NotSigned`; no signed-release claim is made. This is the only remaining blocker in the Phase 12A scope.

No product source was edited for this phase. The existing dirty worktree was preserved without commit, reset, revert, staging, or broad cleanup.

## 2. Source Provenance

- Git HEAD: `51af863a2b15311a88ac015936bbb0a2c65677dd`
- Packaging input files: 236
- Packaging input aggregate SHA-256: `c2d23f8fc361c7b7219aab932897670d1ff78efc70d55acaa3835728495f14cf`
- Newest packaging input: `src-tauri/src/lib.rs`
- Newest input UTC: `2026-09-29T01:24:18.525Z`
- Newest input SHA-256: `d4ecbf01541cf51200b2126eb2897370c83b21f8760378964ebec3d3b28a4ae9`

Machine-readable input inventory: `artifacts/phase12a-fresh-release-set/packaging-input-manifest.json`.

## 3. Exact Build Commands

The existing project scripts were used without inventing another package format:

```powershell
npm run test:edith-desktop-python-lock
node scripts/test-edith-crypto-runtime-lock.mjs
npm run test:edith-portable-security

$env:EDITH_CRYPTO_PYTHON_BUNDLE_DIR=(Resolve-Path 'src-tauri\target\release\python').Path
npm run tauri:build -- --bundles msi,nsis

npm run desktop:portable
npm run desktop:portable:verify
```

Tauri completed both WiX `candle`/`light` and NSIS `makensis` in the same build call. No toolchain download, installer workaround, or ad-hoc archive layout was used.

## 4. Artifact Matrix

| Artifact | Bytes | UTC mtime | SHA-256 | Authenticode | Fresh |
|---|---:|---|---|---|---|
| `src-tauri/target/release/edith.exe` | 17,176,064 | `2026-09-29T02:01:14.7132427Z` | `19ed5bcce966a22e39b6f571c459cd59bfbb113c95f6df3cfe698b96538a775e` | NotSigned | Yes |
| `src-tauri/target/release/edith-backend.exe` | 50,687,222 | `2026-09-29T01:52:03.3086830Z` | `08634974dc74126b86a35aea0a49e2242b6ddab1c4f026fc5a7a7b53eaf01d1c` | NotSigned | Yes |
| `src-tauri/target/release/bundle/msi/E.D.I.T.H._1.0.0_x64_en-US.msi` | 149,656,412 | `2026-09-29T01:55:04.2800000Z` | `73caa534507cdeb519f71be7ed6662bdacf66915706e18a688b118e91168fb4e` | NotSigned | Yes |
| `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe` | 99,994,001 | `2026-09-29T02:01:14.6242227Z` | `a5e3b720c3246a3b7df98746ab1705185a874e97dcfbba2cd1ecbd2b9bda15c9` | NotSigned | Yes |
| `artifacts/desktop/E.D.I.T.H.-1.0.0-windows-x64.zip` | 151,781,989 | `2026-09-29T02:02:12.2112986Z` | `6ad8cc48b06059b772cdabeb4b8c1fccdbc94b5cfc4420e198b3e588a35b7ea4` | N/A | Yes |

Portable metadata:

- Declared payload files: 11,437
- `manifest.json` SHA-256: `9550cad5207b61dc8f465c8e3040750347d6ccd4c6d34051f94f9f5ab443670a`
- `SHA256SUMS.txt` SHA-256: `290d35bde4a23b6215145df6fc2f0d9578ff53ac0dcaccd24dafaaf871e34823`
- ZIP hash sidecar is present and was verified against the actual ZIP.

Complete provenance, including the Tauri sidecar copy and portable PE signatures: `artifacts/phase12a-fresh-release-set/release-provenance.json`.

## 5. Portable Parity

`npm run desktop:portable:verify` validated the package directory, ZIP entry safety, extracted ZIP, manifest declarations, file sizes, hashes, required files, Crypto allowlist, and developer-path leak scan.

Additional full-tree comparisons passed:

- Release EXE -> portable EXE: exact hash match
- Release sidecar -> portable sidecar: exact hash match
- Frontend `dist`: 4 / 4 files, exact tree digest
- Crypto runtime: 33 / 33 allowed files, exact tree digest
- Vetted Python runtime: 11,398 / 11,398 files, exact tree digest

The staged-runtime smoke creates `__pycache__` only after packaging. Those forbidden generated files were excluded with the packager's existing exclusion rule; they are not present in the portable payload.

Evidence: `artifacts/phase12a-fresh-release-set/portable-parity.json`.

## 6. Runtime Smoke

### Packaged release

`npm run smoke:edith-desktop-release` result:

- 25 PASS
- 0 FAIL
- 4 EXTERNAL_BLOCKER
- Launch: PASS
- Managed sidecar: PASS
- Bounded sidecar restart after one controlled crash: PASS
- Single-instance rejection: PASS
- Normal window close: PASS
- Descendant cleanup: PASS
- EXE/MSI/NSIS/portable freshness and portable hash parity: PASS

The four external blockers are exactly the four `NotSigned` checks for release EXE, sidecar, MSI, and NSIS. The command therefore returns nonzero without a functional failure.

### Portable runtime

The portable directory's own `edith.exe` was launched from its portable working directory with an exact marker-gated OS-temp root:

- Launch: PASS
- Managed portable sidecar: PASS
- Bounded restart: PASS
- Single-instance rejection: PASS
- Normal WM_CLOSE: PASS, five window messages accepted
- Descendant cleanup: PASS

Evidence: `artifacts/phase12a-fresh-release-set/portable-runtime-smoke-final.json`.

The first local harness attempt reached launch, sidecar restart, and single-instance PASS but its Win32 callback contained a PowerShell spacing typo, so normal-close measurement was invalid. Cleanup ran and left no process. The corrected final run above is the accepted evidence; the failed harness attempt is retained as `portable-runtime-smoke.json` rather than hidden.

## 7. Python / Resource Verification

- Exact Python lock parser: PASS; broad requirements rejected, exact lock accepted, mismatch rejected.
- Runtime lock/import closure: PASS; 16 exact pins and packaged import closure.
- Portable ZIP security: PASS; all five malicious path/collision fixtures rejected.
- Staged bundled Python runtime: PASS; real health and Crypto status returned 200.
- Packaged runtime remained safe: `realOrderEndpointsAvailable=false`, `liveExecutionEnabled=false`.
- Crypto and Python portable parity: PASS.

No Python dependency was downloaded or changed during this phase.

## 8. Phase 11H Junction/Reparse Fix

The fresh release EXE SHA-256 `19ed5bcce966a22e39b6f571c459cd59bfbb113c95f6df3cfe698b96538a775e` was tested against a real Windows junction under OS temp with the exact Phase 11 marker.

- Alive after six seconds: false
- Exit code: 101
- Error: packaged E2E path contains a symbolic link
- Target `app-data` created: false
- Target `webview-data` created: false
- Owned processes remaining: none

The portable EXE has the exact same hash, so the tested fix is present in the portable set as well. MSI and NSIS were produced by the same Tauri build invocation after compiling this source input revision.

Evidence: `artifacts/phase12a-fresh-release-set/junction-probe-current.json` and its stderr/stdout logs.

## 9. Real Profile Guard

The real project `.edith` tree was inventoried before and after all builds and runtime tests:

- Files: 39 before / 39 after
- Bytes: 69,887,062 before / 69,887,062 after
- Full manifest SHA-256: `7a7c7d7a64167c6998d7803b4c77483980a03536634f5b835ea20465c8dd03f1`
- Path, size, mtime, and content-hash differences: none

Evidence:

- `artifacts/phase12a-fresh-release-set/real-edith-before.json`
- `artifacts/phase12a-fresh-release-set/real-edith-after.json`
- `artifacts/phase12a-fresh-release-set/real-edith-guard.json`

No real user vault or profile was selected or mutated. Runtime tests used only exact-marker OS-temp roots. No `edith.exe` or `edith-backend.exe` process remained at handoff.

## 10. Other Checks

- `npm run lint`: PASS
- `cargo check --all-targets`: PASS
- Tauri MSI + NSIS build: PASS
- Portable package + extracted verification: PASS

The existing Vite large-chunk warning remains informational and is outside this freshness-only scope.

## 11. Remaining Blocker

`PRODUCTION_AUTHENTICODE_CERT_REQUIRED` remains an external blocker. Release EXE, sidecar, MSI, NSIS, and their portable PE copies are all `NotSigned` according to `Get-AuthenticodeSignature`.

No self-signed certificate, signature workaround, or signed claim was introduced. Apart from production signing, Phase 12A's freshness and runtime requirements are complete.

