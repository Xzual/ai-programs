# E.D.I.T.H. Chat 2 Phase 6C Android Cross-Device Handoff

## Scope

Phase 6C adds the Android consumer for the canonical V2.1 cross-device backend. Work is limited to `mobile/**`; backend, desktop, crypto, and Mark-L code were not changed.

## Implemented Surfaces

- Strict Kotlin DTOs and parsers for capabilities, clipboard metadata/content, transfers, offline queue, smart handoff, shared result cards, audio capture leases, live-view metadata, wake readiness, PC status, and quiet-hours metadata.
- Canonical realtime event acceptance for all Phase 6 event names, including metadata-only live-view frames. Unknown fields, forbidden secret keys, malformed timestamps, invalid direction, stale revisions, and invalid progress fail closed.
- Encrypted HTTP client using the existing P-256/AES-GCM mobile application envelope and exact request purpose/response purpose pairing.
- Capability handshake at `GET /api/mobile/cross-device/capabilities` with the canonical truth matrix:
  - available: clipboard, offline queue, smart handoff, result cards, audio handoff, mobile-to-PC transfer
  - configuration required: PC-to-mobile transfer, live view, Wake-on-LAN, PC status
  - metadata only: quiet hours
  - memory only: persistence
- Ephemeral clipboard publish/consume:
  - explicit confirmation, maximum 64 KiB, maximum five-minute server TTL
  - sensitive-value rejection
  - no local persistence or history
  - redacted UI and memory wipe at the earlier of server expiry or 60 seconds
- Real mobile-to-PC file upload through Android `OpenDocument`:
  - no storage permission
  - maximum 25 MiB bounded read
  - safe filename validation
  - chunk manifest and SHA-256 per file/chunk
  - exact command receipt binding for create and every chunk
  - resume/progress monotonicity, collision rejection, and completed state only after full byte count plus verified integrity
- Offline low-risk `task.list` refresh queue with explicit enqueue/cancel/dispatch controls. Emergency Stop is excluded by adapter, parser, reducer, and UI copy. Dispatch is never represented as execution completion.
- Bidirectional smart handoff state with preserved task/result/artifact identity and strict acknowledgement binding.
- Shared result cards with monotonic revisions, redacted preview rules, provenance, artifact integrity metadata, and honest available-action display.
- Single-capture audio lease orchestration only. The app does not claim to transfer audio bytes. Lease ID, epoch, handoff identity, and terminal release are enforced.
- Cross-device state is cleared on trust expiry, revoke, local wipe, or authority failure. The Android window uses `FLAG_SECURE` to prevent screenshots of ephemeral clipboard input.

## Android UI

The former `Gelenler` navigation destination is now `Handoff`. It contains:

- capability truth panel
- ephemeral clipboard controls
- system-picker mobile-to-PC transfer and verified progress
- offline command queue
- smart handoff requests and acknowledgements
- shared result cards
- audio capture lease controls
- metadata-only/configuration-required surface summary

Controls remain disabled until the backend advertises the matching capability. No green/online state is synthesized.

## Backend Endpoints Consumed

- `GET /api/mobile/cross-device/capabilities`
- `POST /api/mobile/cross-device/clipboard`
- `POST /api/mobile/cross-device/clipboard/:clipboardId/consume`
- `POST /api/mobile/cross-device/offline-queue`
- `POST /api/mobile/cross-device/offline-queue/:queueItemId/cancel`
- `POST /api/mobile/cross-device/offline-queue/dispatch`
- `POST /api/mobile/cross-device/handoffs`
- `POST /api/mobile/cross-device/handoffs/:handoffId/ack`
- `GET /api/mobile/cross-device/result-cards`
- `POST /api/mobile/cross-device/audio-handoffs`
- `POST /api/mobile/cross-device/audio-handoffs/:handoffId/ack`
- `POST /api/mobile/cross-device/audio-handoffs/:handoffId/release`
- `GET /api/mobile/cross-device/pc-status` only when capability becomes available
- `POST /api/mobile/transfers`
- `PUT /api/mobile/transfers/:transferId/chunks/:chunkIndex`

## Security Decisions

- `ownerSessionBindingId` is bound to the pairing record's canonical `ownerSessionId`, not its local binding record ID.
- Workspace, session, mobile device, server ID, source/target direction, command ID, transfer fingerprint, handoff identity, result revision, and audio epoch are checked before state mutation.
- Secrets, API keys, credential tokens, clipboard plaintext, and file bytes are never logged or persisted by Phase 6C.
- Clipboard drafts are ordinary short-lived Compose state only; they reset when pairing authority changes. Consumed content is stored as a wipeable `CharArray` and displayed only as a redacted preview.
- Quiet hours remain read-only metadata because there is no device-authenticated mobile mutation endpoint.

## Intentionally Unimplemented

- PC-to-mobile binary download/export
- pixel-bearing live view or remote control
- Wake-on-LAN execution
- live PC metrics while backend reports `configuration_required`
- push/background delivery
- persistent cross-device queue/card/history storage
- audio recording, streaming, transcription, or playback

These surfaces are explicitly shown as configuration-required or metadata-only. The Android client does not simulate them.

## Verification

Commands executed with the installed Android SDK supplied through process-local `ANDROID_HOME` / `ANDROID_SDK_ROOT`:

```powershell
.\gradlew.bat testDebugUnitTest --no-daemon
.\gradlew.bat lintDebug assembleDebug assembleRelease --no-daemon
.\gradlew.bat connectedDebugAndroidTest --no-daemon
```

The connected smoke target is the available `Pixel_8_Pro` API 34 AVD. API 33 and API 35 AVDs are not installed on this machine, so they were not claimed as tested.

Final results:

- JVM: 38 tests, 0 failures
- Android API 34 instrumentation: 4 tests, 0 failures
- `lintDebug`: passed
- `assembleDebug`: passed
- `assembleRelease`: passed with R8

No screenshot artifact is attached because the mobile activity intentionally enables Android `FLAG_SECURE`; protected screens must not be captured as visual evidence.

## Remaining Integration Notes

- The backend capability matrix currently marks live view, WOL, PC status, and PC-to-mobile transfer as `configuration_required`; Android controls stay unavailable until the backend changes the authenticated capability response and supplies matching real data.
- Cross-device backend persistence is currently `memory_only`; process restart recovery is therefore not available.
- Production validation still needs a real paired Android device against a TLS-pinned desktop endpoint, including interruption/resume during a multi-chunk upload.
