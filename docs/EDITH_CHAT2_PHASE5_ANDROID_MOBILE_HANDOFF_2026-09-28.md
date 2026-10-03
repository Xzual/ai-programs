# E.D.I.T.H. Chat 2 Phase 5 Android Mobile Handoff

Date: 2026-09-28

OWNER: Chat 2 Android Mobile Client

SCOPE: Android 13+ mobile client, canonical Phase 5 pairing/transport consumer, Compose UI, local security, honest offline states, tests, and handoff. Backend, desktop, crypto trading, Mark-L, and canonical TypeScript contracts were not edited by Chat 2.

STATUS: Mobile foundation and reconciled P-256 transport consumer implemented. Android 14/API 34 runtime verification passed. API 33 and API 35 runtime verification, adverse-network testing, credential rotation, push registration, and executable file transfer remain downstream work.

COMMITS: None. Work remains in the shared dirty workspace; unrelated changes from other teams were preserved.

## Files Changed

- New Android project under `mobile/` with Gradle 8.9 wrapper, min SDK 33, compile/target SDK 35, Kotlin, Compose, Material 3, OkHttp, serialization, JVM tests, and instrumentation tests.
- UI: `MainActivity.kt`, `ui/EdithMobileApp.kt`, `ui/EdithTheme.kt`, `ui/EdithViewModel.kt`.
- Android contract consumers: `contracts/CanonicalContracts.kt`, `contracts/ContractParser.kt`, `contracts/MobileWireContracts.kt`.
- Pairing/state/data: `data/MobilePairingCoordinator.kt`, `data/MobileRepository.kt`, reducers under `domain/`.
- Cryptography/storage: `security/MobileCryptoEngine.kt`, `security/MobilePairingKeys.kt`, `security/EncryptedCredentialStore.kt`, `storage/ScopedTransferStore.kt`.
- Transport: `network/EndpointPolicy.kt`, `MobileHttpTransport.kt`, `MobileRealtimeAdapter.kt`, `MobileCommandAdapter.kt`, `NetworkTypes.kt`.
- Policies/tests: `background/MobileBackgroundPolicy.kt`, JVM tests, Android Keystore and Compose instrumentation tests.
- Security review profile: `.cursor/agents/edith-mobile-security-auditor.md`.

## Implemented

1. Adaptive Compose screens for Home, Tasks, Transfers, trusted PCs/pairing, and Settings. No fake devices, progress, connectivity, receipts, or transfer state.
2. Separate non-exportable Android Keystore P-256 signing and ECDH keys. No production software-key fallback.
3. Exact `edith.mobile.pair.v1` transcript, standard Base64 SPKI, lowercase SHA-256 fingerprints, DER ECDSA proofs encoded Base64URL without padding, and consume assertion suffix.
4. P-256 ECDH plus directional HKDF-SHA256 keys and AES-256-GCM application envelopes with canonical sorted AAD, random 12-byte nonces, independent direction/channel counters, exact-next sequence, and replay/tamper rejection.
5. Canonical pairing request, proof, owner-status, and encrypted credential consume. Offer, status, proof, challenge, device, workspace, server, trust, owner binding, session, expiry, and approved-command bindings are checked before credential persistence or session activation.
6. Credentials are encrypted with Android Keystore AES-GCM and synchronously committed before Trusted state. Plaintext byte/char buffers are cleared where controllable. Local wipe synchronously clears ciphertext and deletes pairing/wrapping aliases; it does not claim remote revocation.
7. HTTPS/WSS policy with matching host and release certificate pinning. Debug cleartext is restricted to emulator loopback.
8. Device-authenticated WSS resume encrypted as `realtime.command`; incoming `realtime.event` envelopes are authenticated/decrypted before canonical parsing. UI does not show CONNECTED until a verified event arrives. Cursor gaps, duplicate/reordered events, and malformed/tampered envelopes fail closed.
9. Canonical low-risk command/result adapter and typed verified receipt. Emergency Stop uses encrypted HTTP and cannot report delivered without a completed, identity-bound result.
10. Encrypted transfer metadata binds session, transfer ID, chunk index, plaintext size/checksum, and exact AAD purpose. Actual upload/download execution remains disabled.
11. ContentResolver URI-only scoped storage, no broad storage permission. Manifest contains INTERNET plus the AndroidX signature-level dynamic receiver guard only.
12. Missing push capability does not schedule a polling fallback. Offline queue cannot turn a boolean transport result into delivery; current trust and a typed verified receipt are required.

## Security Evidence

- No API key, owner token, private key, session key, raw credential, or proof is displayed or logged.
- Pairing UI does not ask the user to enter or persist a secret. The backend-issued six-digit owner verification code is held in memory and shown only while awaiting approval.
- Pairing activation occurs only after `PairingReducer` returns `Trusted`; a failed trust chain cannot leave an active credential/session behind.
- Response bodies are bounded while reading; oversized realtime messages close the socket.
- Emergency Stop remains disabled until a trusted target, active owner binding, and verified realtime connection exist.
- Backups are disabled and data-extraction rules exclude cloud/device transfer.
- Independent mobile security re-audit found no remaining release-blocking high-severity issue after trust-chain, revocation, reconnect, lifecycle, confirmation, bounded-response, and per-message authority-expiry fixes.

## Commands And Results

- `gradlew clean :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease --no-daemon`: PASS.
- Final combined `gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease :app:connectedDebugAndroidTest --no-daemon`: PASS after all security hardening; 32 JVM tests, lint 0 errors/7 dependency-update warnings, and 3/3 Android tests.
- Device target: Pixel_8_Pro AVD, Android 14/API 34. Instrumentation includes separate Android Keystore signing/agreement key generation and two Compose honesty/safety checks.
- Debug APK: `mobile/app/build/outputs/apk/debug/app-debug.apk`.
- Release artifact: `mobile/app/build/outputs/apk/release/app-release-unsigned.apk` (unsigned; not a production distribution claim).
- Debug APK SHA-256: `A957052B1157924FCFEBAE36C15864FDE2DCA2AB283534EDFE948840C45B574D` (59,137,665 bytes).
- Unsigned release APK SHA-256: `723955A5963B18FA23FEDE89FDD25EA57930F3056070C2C75EDD3A9CEF1F70D7` (2,794,056 bytes).

## Known Limitations

- API 33 and API 35 runtime images are not installed locally. Min/compile/target coverage is not runtime evidence; only API 34 is device-tested.
- Credential/session restoration after process death is not enabled because backend session keys/history are memory-only. Re-pairing is required after either side loses the in-memory session.
- Credential rotation/revocation polling and explicit owner-logout propagation are not implemented. Backend expiry/revocation and verified realtime lifecycle events remain authoritative while connected.
- Transfer create/chunk/status execution and resumable upload/download are not connected to UI. Only canonical metadata, checksum, reducer, scoped destination, and authorization foundations exist.
- Task list/control HTTP routes are not yet surfaced in the Compose UI. Emergency Stop is the only encrypted command wired end to end on Android.
- Push provider/registration is absent; there is deliberately no hidden polling substitute.
- Remote view, Wake-on-LAN, clipboard, Ask My Computer, voice, camera, microphone, destructive computer/browser control, and broad file access remain disabled/configuration-required.
- No live backend interoperability run was performed because this task did not start or mutate Chat 4 backend state. Independent Kotlin vectors and contract fixtures passed; an integrated backend/device environment is still required.
- Physical-device, API 33/35, TalkBack, large-font, rotation, process-death, TLS pin failure, packet loss, reconnect/replay, and long-running battery tests remain.

## Downstream

- Chat 4: provide/verify credential rotation and revocation lifecycle plus explicit owner-session logout propagation when available.
- Chat 8 / Mobile QA: run API 33/34/35, physical-device, adverse-network, TLS pin, process-death, accessibility, and end-to-end backend interoperability suites.
- Release engineering: configure production HTTPS/WSS endpoints, certificate pins, signing, and reproducible release pipeline. Do not ship the unsigned APK.

DO NOT TOUCH: backend/server behavior, canonical TypeScript contracts, desktop UI/native, crypto trading, Mark-L-main, or provider secrets from this mobile workstream.
