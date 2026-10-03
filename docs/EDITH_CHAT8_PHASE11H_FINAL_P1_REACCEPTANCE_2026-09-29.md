# E.D.I.T.H. Phase 11H Final Independent P1 Re-Acceptance

**Tarih:** 2026-09-29  
**Sorumlu:** Chat 8 - Independent QA / Test / Cleanup  
**Kapsam:** Phase 11F'te bulunan generic producer native-selection ve packaged E2E junction/reparse P1'lerinin audit-only yeniden kabulu.  
**Phase 11 functional/security karari:** **ACCEPTED**  
**Master karar:** **NOT_READY**

## 1. Executive Summary

Phase 11F'te yeniden uretilen iki P1, guncel kaynak ve guncel release EXE uzerinde bagimsiz olarak tekrar denendi ve kapali bulundu.

1. Generic mobile/device producer credential, native-selection authorization'da exact `OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED` ile fail-closed reddediliyor. Ret, session sequence veya publication durumunu tuketmiyor; ayni generic credential normal `authorize(token, 1)` akisinda calismaya devam ediyor. Gercek HTTP route `401` ve safe error code donduruyor; response/audit token, session, device, selection ID veya path sizdirmiyor.
2. Packaged E2E root, root component veya `app-data`/`webview-data` child icinde Windows junction, directory symlink veya reparse point varsa fail-closed cikiyor. Gercek release EXE root-junction exploit'inde `101` ile kapandi; sidecar baslamadi, target'ta `app-data` veya `webview-data` olusmadi. Child-junction hedeflerine yazim olmadi.

Normal marker-gated OS-temp packaged smoke `20 PASS / 0 FAIL / 9 EXTERNAL_BLOCKER` verdi. Dis blockerlar imza ve stale dagitim artefaktlari: EXE, sidecar, NSIS ve MSI unsigned; MSI ve portable eski. Bu nedenle Phase 11 functional/security acceptance **ACCEPTED**, master release **NOT_READY**.

## 2. Acceptance Matrix

| Kontrol | Sonuc | Bagimsiz kanit |
|---|---|---|
| Generic `create()` -> native selection | PASS | Exact `OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED`; sequence/publication tuketilmeden ret. |
| Generic normal `authorize()` | PASS | Ayni token sequence 1 ile normal akista `mobile-phase11h` target'i dondurdu. |
| Native-only normal producer yolu | PASS | `authorize()` exact `DESKTOP_PRODUCER_SESSION_INVALID` ile reddetti. |
| Native-only TTL | PASS | 300,000 ms; `<= 5m`. |
| Native-only one-shot/replay | PASS | Ilk sequence 1 kabul; ikinci kullanim `OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID`. |
| HTTP generic native-selection | PASS | HTTP 401, exact safe code; token/session/device/selection/path response ve audit leak yok. |
| Owner/bridge/lineage/kill/permission | PASS | Phase 11C 19-check integration matrisi gecti. |
| Root junction exploit | PASS | EXE exit 101; target yalniz marker; app-data/webview-data yok; sidecar/process kalmadi. |
| Pre-created `app-data` junction | PASS | EXE exit 101; redirect target bos; sidecar/process kalmadi. |
| Pre-created `webview-data` junction | PASS | EXE exit 101; redirect target bos; sidecar/process kalmadi. |
| Directory symlink root | PASS | Windows fixture olustu; EXE exit 101, symbolic-link safe error. |
| Gate absent / non-exact | PASS | Her iki durumda exit 101; exact `true` zorunlu. |
| Missing/invalid marker | PASS | Exit 101; ayrik safe root errors. |
| Relative/temp-outside root | PASS | Exit 101; local absolute ve strict temp containment zorunlu. |
| Positive packaged runtime | PASS | Launch, managed sidecar, bounded restart, single-instance, coordinated close; 20 PASS, 0 FAIL. |
| `.edith` full non-mutation | PASS | 39 files, 69,887,062 bytes, full path/size/mtime/hash aggregate before/after ayni. |
| Artifact signing/distribution | BLOCKED | PE/MSI unsigned; MSI ve portable stale. |

## 3. Commands and Results

| Komut / probe | Sonuc |
|---|---|
| Independent `DesktopProducerService` `npx tsx -e` probe | PASS, exit 0; exact generic/native/TTL/replay sonuclari. |
| `npm run test:edith-obsidian-provider` | PASS, 11 checks. |
| `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts` | PASS, 13 checks. |
| `npm run test:edith-phase11c-obsidian-backend` | PASS, 19 checks; real HTTP generic deny ve audit leak canary'leri dahil. |
| `npm run test:edith-phase6e-backend-integration` | PASS, 13 checks. |
| `npm run test:edith-phase6g-native-ingest` | PASS, 12 checks. |
| `npm run test:edith-backend-security` | PASS, 27 checks. |
| `npm run test:edith-interaction-safety` | PASS, 13 scenarios. |
| `npm run lint` | PASS, `tsc --noEmit`. |
| `npm run build` | PASS; 1,730 modules; existing 868.41 kB main chunk warning only. |
| `cargo fmt --all -- --check` | PASS. |
| `cargo check --all-targets` | PASS. |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS. |
| `cargo test --all-targets` | PASS, 44/44. |
| Fresh root/app-data/webview-data reparse EXE probes | PASS; uc kosu exit 101, redirected targets bos, process kalmadi. |
| Gate/marker/relative/outside/symlink EXE matrix | PASS; 7/7 exit 101 with expected reason. |
| `npm run smoke:edith-desktop-release` | Runtime PASS: 20 PASS, 0 FAIL; command exit 1 only 9 `EXTERNAL_BLOCKER`. |
| `npm run test:edith-phase11d-obsidian-browser` | PASS; 390/768/1366/1920, explicit picker only, harmless cancel, fail-closed browser, no canary leak. |
| `@Browser` localhost smoke | PASS; UI `ONLINE`, backend `OFFLINE`, provider/security `PENDING`, memory/voice/Tauri `DEGRADED`. |
| `Get-AuthenticodeSignature` + SHA-256 | BLOCKED packaging: current EXE/sidecar/NSIS `NotSigned`; MSI `NotSigned` and stale. |

## 4. Audit A - Native Credential Isolation

### Source boundary

`DesktopProducerService.authorizeNativeSelection()` now checks `session.nativeSelectionOnly !== true` before sequence validation and before `nativeSelectionPublished` mutation. Generic credentials therefore fail with `OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED` without consuming their normal producer sequence.

### Independent service result

```json
{"genericNativeError":"OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED","genericNormalTarget":"mobile-phase11h","nativeNormalError":"DESKTOP_PRODUCER_SESSION_INVALID","nativeOnly":true,"nativeTtlMs":300000,"replayError":"OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID"}
```

### HTTP and leak result

The real Express route integration created a valid generic producer through `/api/edith/mobile/desktop-producer/session/:deviceId`, submitted a correctly shaped native-selection request with bridge and exact lineage headers, and received:

- HTTP `401`
- `errorCode: OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED`
- safe generic message
- no producer token, device session, device ID, selection ID or selected path in response
- no matching sensitive canary in recent `obsidian.*` audit events

Native-only happy path retained TTL, sequence 1, replay, owner logout, kill-switch, permission, lineage and path-redaction coverage.

## 5. Audit B - Junction / Reparse Denial

### Source boundary

`reject_reparse_components()` walks all existing ancestors with `symlink_metadata`, rejects `.`/`..`, symbolic links and Windows `FILE_ATTRIBUTE_REPARSE_POINT` before canonicalization. `prepare_packaged_e2e_directory()` checks both before and after create, then verifies canonical containment. The root, exact marker, `app-data` and `webview-data` all pass through these guards.

### Real packaged probes

- Root junction: exit `101`; error `Packaged E2E paths must not contain symbolic links`; target contained only `.edith-phase11e-root`; no target `app-data`/`webview-data`.
- Pre-created `app-data` junction: exit `101`; redirected target remained empty.
- Pre-created `webview-data` junction: exit `101`; redirected target remained empty.
- No `edith.exe` or `edith-backend.exe` remained after probes.

The negative release matrix also independently verified gate missing, gate `TRUE` instead of exact `true`, missing marker, invalid marker, relative root, root outside OS temp and a real Windows directory symlink. All seven failed closed with exit `101` and the expected bounded reason.

### Positive packaged smoke

An ordinary exact-marker OS-temp root launched the current EXE and managed sidecar, restarted the sidecar after one controlled crash, rejected a second instance, and closed without descendants. Result: `20 PASS`, `0 FAIL`, `9 EXTERNAL_BLOCKER`.

## 6. Artifact Provenance

| Artifact | Bytes | SHA-256 | Status |
|---|---:|---|---|
| `src-tauri/target/release/edith.exe` | 17,176,064 | `1368c76177c4489a1e4dde7184dc64f3ea877824cecead2e75c593ecf4ebaae5` | Fresh, NotSigned |
| `src-tauri/target/release/edith-backend.exe` | 50,687,084 | `927e6d853393c2ae13b2b2df0410b52be45f832c60520a90c34fff622093dfaa` | Fresh, NotSigned |
| Sidecar binary copy | 50,687,084 | `927e6d853393c2ae13b2b2df0410b52be45f832c60520a90c34fff622093dfaa` | Fresh, identical, NotSigned |
| NSIS setup | 100,006,200 | `1f25c65ccc3776d623b93008154e901ef3c1586052fd8c68bb25bc8990bb07ce` | Fresh, NotSigned |
| MSI | 149,554,012 | `8458fbc57e643eb0a327ee5c3236d52c85adaab5d4262480ddf495ad3737d626` | Stale, NotSigned |
| Portable ZIP | existing prior artifact | current EXE/sidecar/frontend ile eslesmiyor | Stale |

Current hashes match `artifacts/phase11g-b-reparse-root/build-provenance-final.json` exactly.

## 7. Runtime Data and Historical Evidence Guard

- Project `.edith` before/after: 39 files, 69,887,062 bytes, aggregate SHA-256 `916c2027344ec2ef2d208cc901d281fbb2aa3854c647e14ceed10bee54b693f7`.
- `.edith/edith.db`: 53,260,288 bytes; UTC ticks `639262252175863204`; SHA-256 `3ee2e2dcf762a4ddb91b48891af4b690acf94c59e69d15c13e3396e7d368dcff`.
- Phase 11E first pre-fix vault mutation evidence (`vault1-before.json`, `vault1-after.json`) remains present and unchanged by this audit.
- Phase 11E real-profile mtime incident evidence remains present.
- Two Phase 11G-B retained OS-temp junction fixtures remain present as documented; this audit did not remove them.
- No real user vault was selected or mutated.

## 8. Files Changed by This Audit

- `docs/EDITH_CHAT8_PHASE11H_FINAL_P1_REACCEPTANCE_2026-09-29.md`
- `docs/EDITH_CHAT8_PHASE11F_OBSIDIAN_INDEPENDENT_REACCEPTANCE_2026-09-29.md`
- `docs/EDITH_CHAT8_PHASE9_FINAL_INDEPENDENT_QA_2026-09-28.md`
- `docs/EDITH_MASTER_PRODUCT_EXPANSION_FINAL_REPORT_2026-09-28.md`

No product source, task queue, agent, Crypto, Mark-L, Git index/history or pre-existing dirty change was edited, reverted, staged, committed or cleaned by this audit. Build output and OS-temp runtime fixtures were isolated from source data.

## 9. Remaining External Blockers

1. Release EXE, sidecar, NSIS and MSI are unsigned.
2. MSI predates the accepted fixes.
3. Portable ZIP and its EXE/sidecar/frontend tree are stale.
4. Other master blockers remain: API33/35 runtime, physical mobile, real Computer/Browser operator and push/live-view/audio/watcher end-to-end acceptance.
5. Main frontend bundle remains 868.41 kB with the existing Vite large-chunk warning.

## 10. Final Verdict

**Phase 11 functional/security acceptance: ACCEPTED**

Both Phase 11F P1 findings are independently closed on the current source and current release EXE. The Obsidian first-run/native-selection functional and security scope is accepted.

**Master release: NOT_READY**

Acceptance does not waive signing, stale distribution artifacts or unrelated master runtime blockers. The branch is safe to continue from for development, but it is not production-ready.
