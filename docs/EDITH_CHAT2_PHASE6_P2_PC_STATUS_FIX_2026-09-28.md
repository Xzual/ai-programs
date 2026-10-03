# E.D.I.T.H. Phase 6 P2 Android PC Status Freshness Fix

Date: 2026-09-28  
Owner: Chat 2 Android Mobile  
Scope: `mobile/**`, Android tests, and QA/handoff documentation only

## Outcome

Android PC-status consumption now applies one current-time-aware policy to initial HTTP snapshots, realtime events, and reconnect/replay delivery:

- `observedAt` may be at most 60 seconds old.
- Future clock skew may be at most 5 seconds.
- `expiresAt` must be strictly later than the receiving clock.
- The source interval must be positive and at most 60 seconds, with nanosecond-accurate duration validation.
- Equal/older `observedAt` values and equal/older realtime cursor revisions cannot replace accepted state.

No server, Tauri, desktop, crypto, or trading implementation was changed.

## Implementation

- Added `PcStatusFreshnessPolicy` with injectable current time and stable safe error codes.
- Kept canonical envelope parsing structural for PC telemetry, then enforced freshness in the cross-device parser. A stale replay is dropped without revoking the trusted owner session.
- Bound realtime cursor to a local PC-status revision high-watermark.
- Preserved that high-watermark when visible telemetry expires and across revisionless HTTP refreshes.
- Applied cross-device payloads only when the realtime reducer accepts the envelope.
- Scheduled expiry only for a snapshot actually accepted by the reducer.
- Cleared visible expired telemetry while preserving replay protection until authority is revoked, expires, or is locally wiped.
- Changed the Compose surface to hide runtime metrics unless the snapshot is currently fresh and show an explicit stale/unavailable state.

## Revoke And Logout Safety

`CrossDeviceReducer.clearAuthority()` still clears the PC snapshot and revision high-watermark. Remote revoke/session expiry and local wipe continue through existing authority-clearing paths; local wipe and ViewModel teardown also cancel the expiry job.

## Deterministic Coverage

Clock-injected JVM tests cover stale first snapshot, expiry, excessive future skew, equal/older revision and observed-time replay, reconnect stale replay, valid clock boundaries, two-stage parser behavior, expiry watermark retention, HTTP refresh watermark retention, and authority clearing.

## Commands And Results

- `mobile/gradlew.bat testDebugUnitTest --tests "com.edith.mobile.CrossDeviceContractTest" --no-daemon` - passed.
- `mobile/gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleRelease --no-daemon --rerun-tasks` - passed; 47/47 JVM tests, lint, debug APK, and unsigned release APK.
- `mobile/gradlew.bat connectedDebugAndroidTest --no-daemon --rerun-tasks` - passed on Pixel 8 Pro AVD, API 34; 4/4 tests.

`ANDROID_HOME` and `ANDROID_SDK_ROOT` were set to `C:\Users\arday\AppData\Local\Android\Sdk`. The API 34 emulator was stopped after verification.

## Remaining QA Boundary

- Integration QA should independently rerun the Phase 6 acceptance matrix.
- API 33, API 35, physical-device, signed-release, and real paired-device evidence remain outside this fix.
- No backend freshness constants or wire contracts were changed.
