# E.D.I.T.H. Phase 6 Independent Acceptance / Security / Regression Audit

Date: 2026-09-28  
Owner: Chat 8 Integration QA  
Audit mode: Read-only product audit; this report is the only intentional file change  
Branch / base: `master` / `51af863`, with a large pre-existing dirty working tree  
Overall decision: **PASS_WITH_LIMITATIONS**

## Executive Decision

Phase 6 has substantial, testable contract, backend, Tauri and Android implementation. TypeScript, production build, all registered Phase 6 suites, Rust gates, Android unit/lint/debug/release, API 34 instrumentation, browser diagnostics, and Tauri launch/cleanup passed independently.

The original producer-token and Android PC-status blockers documented below received scoped owner remediations and now pass an independent Integration QA rerun. Physical-device, signed-package and real paired-device evidence listed in this report remains required before any production-readiness claim.

No product source was modified by this audit. Crypto and Mark-L were not touched.

## Findings

### P1 - Producer session token remains directly obtainable by WebView JavaScript (RESOLVED 2026-09-28)

**Evidence**

- `server/routes/desktopProducer.ts:120-128` protects session creation with owner cookie, same-origin and CSRF, but does not require the native bridge bearer. The JSON response includes `producerSessionToken`.
- `server/security/ownerSession.ts:254-264` returns the CSRF token to frontend JavaScript.
- `src/edith/ownerMutationClient.ts:23-30` intentionally reads that CSRF token in JavaScript.
- `scripts/test-edith-phase6e-backend-integration.ts:80-85` independently demonstrates a normal HTTP client calling the route and reading `producerSessionToken`.
- Native bootstrap correctly reads the HttpOnly cookie and stores the returned token in Rust at `src-tauri/src/cross_device.rs:628-713`, but the backend route itself does not enforce that the caller is the native bridge.

**Reproduction**

1. Establish a valid owner browser session.
2. Read `/api/security/session` to obtain its CSRF token, as the current frontend does.
3. From same-origin JavaScript, `POST /api/edith/mobile/desktop-producer/session/:trustedDeviceId` with the CSRF header.
4. The response body contains `data.producerSessionToken`.

**Impact**

The bridge bearer is still required for ingest and was not exposed, so the stolen token alone is insufficient. Nevertheless, one trusted-producer credential crosses the renderer boundary and violates the Phase 6G invariant. Any renderer/XSS compromise gains a credential that was promised to remain native-only.

**Required owner**: Chat 4 Backend Security, coordinated with Chat 6 Desktop Native. Require the bridge bearer (and loopback) on producer-session bootstrap, send it only from Rust, and add a negative test proving an owner-authenticated WebView request cannot receive a producer token.

### P2 - Android can accept and display an already-expired first PC-status snapshot (RESOLVED; INDEPENDENT RERUN PASSED 2026-09-28)

**Evidence**

- `mobile/app/src/main/java/com/edith/mobile/contracts/CrossDeviceContracts.kt:471-477` validates that `expiresAt - observedAt <= 60s`, but never compares either timestamp to `Instant.now()`.
- `mobile/app/src/main/java/com/edith/mobile/domain/CrossDeviceState.kt:101-104` rejects only snapshots older than a prior snapshot. The first stale snapshot is accepted.
- `server/mobile/realtime.ts:169-182` supports retained-event replay.
- Backend ingestion correctly rejects stale producer input at `server/mobile/crossDeviceService.ts:420-426`; the gap is Android consumption after delayed delivery or replay.

**Reproduction**

Feed the Android parser a valid lineage with `observedAt=2025-01-01T00:00:00Z` and `expiresAt=2025-01-01T00:00:30Z`. The parser's 30-second window succeeds, and a reducer with no prior PC status accepts it.

**Impact**

A reconnect/replay can present expired PC telemetry as the current snapshot. Metrics are not forged by this condition, but freshness truth is weakened.

**Resolution**: Chat 2 added one now-aware policy for HTTP, realtime and reconnect paths; strict expiry, 60-second freshness and 5-second future-skew checks; monotonic observed-time/cursor replay protection; expiry-driven metric hiding; and deterministic clock-boundary coverage. See `docs/EDITH_CHAT2_PHASE6_P2_PC_STATUS_FIX_2026-09-28.md`.

### P2 - Browser startup health is slow and leaves diagnostics pending during the initial window

`npm run dev` listened successfully, but the first root request took approximately 20.2 seconds and `/api/status` later took approximately 2.15 seconds. During this period System Diagnostics showed backend pending/degraded and the Dynamic Capsule remained loading. There were no browser console errors and the UI failed closed, so this is a performance/freshness risk rather than a false-online claim.

**Required owner**: Backend Runtime / Obsidian owner. Profile synchronous startup/index work and keep health/status routes responsive while optional indexing proceeds.

### P3 - Phase 6B test command is not registered in package scripts

`npm run test:edith-phase6b-native-contract` fails with `Missing script`. The underlying documented command `npx tsx scripts/test-edith-phase6b-native-contract.ts` passes all 10 checks.

**Required owner**: Chat 6 Desktop Native or package-script owner. Add the missing package alias so the release matrix can invoke a stable command.

## Acceptance Matrix

| Area | Status | Independent evidence / limitation |
|---|---|---|
| Bidirectional transfer / Gelenler | PARTIAL | Rust and backend tests prove real in-memory bytes, SHA-256, resume, sequential offsets, no-overwrite and truthful disabled actions. Android upload code/build passes. No owner-approved real file picker or paired-device PC-to-mobile transfer was exercised. Retention is explicit/process-memory and not restart-discoverable. |
| Live View | PARTIAL | Owner dialog, main WebView, kill switch, expiry, pull-only and native 2 FPS cap are covered by Rust/TS tests. Browser UI correctly disables it. No physical capture dialog/pixels or paired-device stream was exercised. |
| Clipboard | DONE for contract/backend/client logic | Explicit consent, secret rejection, <=5 minute server TTL, one-time consume, AES-GCM process-memory payload and no history tests pass. No real paired-device exchange was exercised. |
| PC status | DONE for freshness/replay logic; runtime evidence partial | Native CPU/RAM and backend checks pass. Android now rejects expired/stale/future snapshots on initial, realtime and reconnect paths, preserves cursor high-watermark, and hides stale metrics. Diagnostics polling and real paired-device evidence remain as stated. |
| Wake-on-LAN | DONE for honesty, BLOCKED for operation | Returns `configuration_required`, `attempted:false`; no packet is sent. No WOL adapter/configuration exists. |
| Offline queue | DONE for logic | Encrypted memory queue, idempotency, cancel, reconnect sequencing, result separation and Emergency Stop exclusion pass. No adverse-network paired-device run. |
| Smart handoff | DONE for logic | Source/target/task/result/artifact identity and ACK binding tests pass. No live paired-device handoff. |
| Shared Result Cards | PARTIAL | Real task/research/knowledge/transfer/screenshot/error producer tests, redaction, provenance, revision, retention/action truth and legacy adapter pass. Publication persistence is memory-only; no live mobile publication run. |
| Audio handoff | DONE for lease semantics, BLOCKED for media | Single active capture lease, epoch, revoke/expiry and Live View mutual exclusion pass. No microphone or audio bytes are implemented or claimed. |
| Quiet hours | DONE for metadata | Owner/workspace binding, timezone and monotonic revision tests pass. Push/background notification delivery is absent and not claimed. |
| Trusted desktop producer auth | **DONE in contract/local harness; real paired-device smoke pending** | Bootstrap now requires owner+CSRF, real loopback and exact native bridge Bearer together. WebView-only, wrong bearer, mobile credential, non-loopback, prior-token replay and sequence replay are rejected; Rust sends the native-only bearer and does not return secrets to JavaScript. |
| Android API evidence | PARTIAL | P2 owner rerun: API 34 AVD instrumentation 4/4 passed; JVM 47/47 passed; lint/debug/release passed. API 33 AVD, API 35 AVD and physical device were not available. Release APK is unsigned. |

## Commands And Results

### Passed

- `npm run lint`
- `npm run build` - passed; main bundle 807.91 kB, existing >500 kB warning
- `npm run test:edith-cross-device-phase6` - 13 checks
- `npx tsx scripts/test-edith-phase6b-native-contract.ts` - 10 checks
- `npm run test:edith-phase6d-result-card-producers` - 11 checks
- `npm run test:edith-phase6e-backend-integration` - 13 checks
- `npm run test:edith-phase6f-desktop-bridge`
- `npm run test:edith-phase6g-native-ingest` - 12 checks
- `npm run test:edith-contracts-v2-1` - 14 checks, 23 event validators
- `npm run test:edith-mobile-backend` - 18 checks
- `npm run test:edith-mobile-contract-reconciliation` - 15 checks
- `npm run test:edith-backend-security` - 22 checks
- `npm run test:edith-interaction-safety` - 13 scenarios
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture` - 22/22 passed
- `mobile/gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleRelease --no-daemon --rerun-tasks` - 99 tasks executed; 38/38 JVM tests; lint/debug/release passed
- `mobile/gradlew.bat connectedDebugAndroidTest --no-daemon --rerun-tasks` - Pixel 8 Pro AVD, API 34, 4/4 passed

### Failed / unavailable

- `npm run test:edith-phase6b-native-contract` - package script missing; direct test command passed
- API 33 AVD - unavailable
- API 35 AVD - unavailable; only SDK platforms 34/35/36.1 are installed
- Physical Android device - unavailable
- Signed Android release - not produced; output is `app-release-unsigned.apk`
- Real trusted paired-device bootstrap, file picker, Live View capture, audio device and WOL runtime - not exercised

## Real Runtime Evidence

- Browser dev server listened on `127.0.0.1:3000`; rejected unauthenticated producer bootstrap and mobile capabilities with HTTP 401.
- System Diagnostics rendered without visible overlap and without console warnings/errors.
- Browser mode honestly displayed `TAURI ABSENT`, `CONTROL PLANE NOT CONNECTED`, `REMOTE CONTROL BLOCKED`; Live View, pull-frame, retention and refresh controls remained disabled without owner/native proof.
- `npm run tauri:dev` independently launched exactly one responsive `edith.exe`, Express on `127.0.0.1:3000`, and Vite on `[::1]:5173`.
- Tauri smoke was stopped with Ctrl+C. It emitted the known Chromium class-unregister warning and `STATUS_CONTROL_C_EXIT`; after three seconds no `edith.exe` remained and ports 3000/5173 were free.
- API 34 emulator was explicitly verified with `ro.build.version.sdk=34`, ran 4 instrumentation tests, and was stopped. No audit ports or EDITH process remained listening afterward.

## Security / Privacy Search

- No hardcoded real API key, private key or GitHub token signature was found in production source.
- Matches resembling API keys were deliberate test fixtures only.
- No production Rust `println!`, `eprintln!` or `dbg!` logging exists in the Phase 6 native module.
- Recursive ingest guards reject pixels, image/Base64 transport, audio bytes, clipboard plaintext, credentials, URLs and private paths.
- Bridge bearer generation and storage remain native/backend-process only.
- Android manifest requests only `INTERNET`; no broad storage, microphone or camera permission is declared. `FLAG_SECURE` is enabled.

## Generated / Runtime Files

- Android `app/build/` and Tauri `src-tauri/target/` outputs are correctly ignored.
- The working tree already contains untracked generated evidence/release directories including `artifacts/desktop/`, `artifacts/mobile-phase5/`, `artifacts/phase3-desktop-ui/`, `artifacts/wave2-frontend/`, and `artifacts/chat8-final-qa-2026-09-27/`. They predate this audit and should not be committed wholesale without an explicit artifact-retention decision.
- The original audit added only this report. The later scoped P2 remediation modified Android mobile source/tests and documentation only; crypto and Mark-L remained untouched.

## Required Follow-up Order

1. **Chat 4 Backend Security + Chat 6 Desktop Native: COMPLETE for P1**: bridge-authenticated loopback bootstrap and owner-WebView negative coverage pass in HTTP/Rust harnesses.
2. **Chat 2 Android Mobile: COMPLETE for P2 owner verification**: current-time freshness, delayed replay, clock boundaries, UI hiding, and API 34 instrumentation pass locally.
3. **Package/Release owner**: register the Phase 6B npm test alias and keep it in the release matrix.
4. **Backend Runtime / Obsidian owner**: profile startup blocking so diagnostics and health become responsive promptly.
5. **Integration QA**: independent P1/P2 and regression rerun is complete. Signed/package smoke with a real trusted Android device, real file transfer and owner-approved Live View capture remains outstanding.

## Final Release Boundary

Phase 6 is accepted as **PASS_WITH_LIMITATIONS** for continued branch integration. The former P1 producer-token and P2 Android freshness blockers pass independent source review and automated reruns. This is not a production-ready declaration: physical paired-device, API 33/API 35, signed packaged-runtime and real capture/transfer/audio/WOL evidence remain outstanding.

## 2026-09-28 P1 Backend Remediation Update

Chat 4 closed the server-side producer-token renderer boundary after this audit:

- `POST /api/edith/mobile/desktop-producer/session/:deviceId` now requires owner cookie, same-origin/CSRF, real loopback socket, and timing-safe `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>` authentication together.
- Owner+CSRF without the native bridge bearer, wrong bearer, mobile `Device` credential, and non-loopback requests return HTTP 403 without issuing a token.
- Bootstrap responses are `no-store, private`; error bodies and audit/log paths do not include submitted credentials.
- A repeated valid bootstrap rotates the prior owner/device producer token; old-token ingest is rejected and exact-next sequence replay remains rejected.
- `scripts/test-edith-phase6e-backend-integration.ts` now exercises all negative cases plus a native-shaped 201 bootstrap followed by a successful 202 ingest.

The backend remediation intentionally did not modify `src-tauri/**`. Chat 6 independently added the same native-only bearer to the fixed-loopback bootstrap request, verified exact-header 201/wrong-header 403 behavior in the Rust harness, and kept the command result secret-free. The coordinated `npm run test:edith-phase6e-backend-integration` and `npm run test:edith-phase6g-native-ingest` reruns pass. This P1 is therefore **RESOLVED** at backend/native contract and local harness level. A real paired-device packaged bootstrap remains runtime evidence still to collect.

## 2026-09-28 P2 Android Remediation Update

Chat 2 closed the Android PC-status freshness/replay gap in `mobile/**` without changing backend, Tauri, desktop or crypto code:

- Initial HTTP, realtime and reconnect/replay paths now share current-time expiry, 60-second freshness and 5-second future-skew rules.
- Equal/older `observedAt` and realtime cursor revisions cannot overwrite accepted state.
- Expired metrics are removed from the UI; stale/unavailable states are explicit.
- Replay high-watermark survives display expiry and revisionless HTTP refresh, then clears on authority revoke/logout/local wipe.
- Realtime envelope rejection cannot apply its cross-device payload, and rejected snapshots cannot replace the accepted expiry schedule.

Owner verification passed 47/47 JVM tests, Android lint, debug/release builds, and 4/4 instrumentation tests on API 34. Independent Integration QA rerun is recorded below.

## 2026-09-28 Independent Re-Acceptance

**Decision: PASS_WITH_LIMITATIONS.** No critical or high-severity finding remains in the focused P1/P2 acceptance boundary. The branch is safe to continue from, but the runtime gaps below prevent a production-ready claim.

### Independently passed

- `npm run lint` - TypeScript completed with exit 0.
- `npm run build` - production frontend/server build completed with exit 0; the existing 807.91 kB main-chunk warning remains.
- `npm run test:edith-phase6e-backend-integration` - 13/13 checks. Owner+CSRF without native bearer, wrong bearer, mobile credential and simulated non-loopback bootstrap returned 403; exact bearer returned 201; token rotation rejected the old token with 401; ingest returned 202; sequence replay returned 409; denial bodies were secret-free.
- `npm run test:edith-phase6f-desktop-bridge` - passed.
- `npm run test:edith-phase6g-native-ingest` - 12/12 checks, including exact native bearer, secret-free command result, no frontend producer token/sequence and no native debug logging.
- `npm run test:edith-cross-device-phase6` - 13/13 regression checks.
- `npm run test:edith-backend-security` - 22/22 checks.
- `cargo fmt --all -- --check`, `cargo check --all-targets`, `cargo clippy --all-targets -- -D warnings` - passed.
- `cargo test --all-targets` - 22/22 Rust tests passed, including exact bootstrap bearer/wrong-token fail-closed behavior.
- `mobile/gradlew.bat testDebugUnitTest --no-daemon --rerun-tasks` - 47/47 JVM tests passed; `CrossDeviceContractTest` passed 15/15. Coverage includes stale initial, expired, excessive future skew, old/equal revision and timestamp, reconnect replay, valid clock boundaries, retained realtime high-watermark, and authority reset.
- `mobile/gradlew.bat connectedDebugAndroidTest --no-daemon --rerun-tasks` - Pixel 8 Pro AVD, API 34, 4/4 passed; emulator was stopped afterward.
- Browser smoke on `http://127.0.0.1:3000` - normal browser/dev mode loaded; System Diagnostics showed `TAURI ABSENT`, disconnected control plane, read-only Computer Use and blocked trading/control instead of claiming availability. Emergency Stop remained visible and no browser warning/error log was emitted.
- Focused secret scan found no hardcoded Gemini/desktop-bridge key, private-key block, producer token in `localStorage`, or sensitive-token console logging in production source. Bootstrap sets `Cache-Control: no-store, private`, `Pragma: no-cache` and `Expires: 0`.

### Remaining limitations

- No physical Android device, API 33 AVD or API 35 AVD run was available.
- No signed Android/desktop release package or real paired-device packaged bootstrap was exercised.
- Real file picker/transfer, owner-approved screen capture, microphone/audio handoff and configured Wake-on-LAN remain unverified or intentionally unavailable.
- Producer sessions, selected publication state and some retention paths remain process-memory/RAM-only and were not restart-durability tested.
- Browser startup/status latency remains a known performance risk; the UI fails closed while health is pending.
- The Phase 6B npm alias remains absent even though its direct script passed in the earlier audit.

### Audit change boundary

Only this QA report was intentionally changed by the independent re-acceptance. The pre-existing dirty working tree was preserved; no product source, crypto, Mark-L, Git index or Git history was modified.
