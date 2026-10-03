# E.D.I.T.H. Chat 2 - Phase 6F Desktop Bridge Handoff

Date: 2026-09-28  
Scope: Desktop React/TypeScript bridge and System Diagnostics UI only

## Implemented

- Added a dependency-injectable desktop bridge that combines native Tauri capability truth, owner-protected backend status, trusted device inventory, and Emergency Stop state.
- Added fail-closed Live View orchestration:
  - requires Tauri invoke, active owner session, inactive verified kill switch, connected control plane, and an available native capability;
  - requests and approves the backend lease before invoking native capture;
  - remains pull-only and enforces a 500 ms minimum frame cadence (maximum 2 FPS);
  - opens a short-lived owner+CSRF producer session, keeps its token only in memory, and sends exact-next sequence values;
  - validates frame lineage, media type, and byte length;
  - treats a native frame as successful only after metadata-only producer ingest returns backend HTTP 202 acceptance;
  - clears frame/session state on stop, error, expiry, logout, unmount, or Emergency Stop.
- Added transfer chunk integrity validation for bounded 256 KiB chunks, Base64 byte count, source SHA-256 identity, and monotonic offsets.
- Added native retention cleanup integration with strict result validation and the native 24-hour retention boundary.
- Added native PC telemetry sampling support with freshness classification and authenticated producer-ingest acceptance gating.
- Added server-owned shared result-card publication using only `{ cardId, source: { type, id } }`; the returned canonical server card is validated and adapted to the existing lossless legacy display contract.
- Added honest WOL response handling: current runtime remains `configuration_required` and `attempted:false`.
- Added System Diagnostics panel with device selection, capability matrix, control-plane counts, privacy guarantees, and disabled controls when end-to-end capability proof is absent.
- Wired App logout and Emergency Stop events into cross-device lease/frame revocation.

## Current Runtime Truth

The existing native status reports `controlPlaneConnected:false`, Live View and WOL as `configuration_required`, transfer/audio adapters as fixture-verified, and remote control as false. The UI therefore does not enable Live View, transfer, WOL, audio, or retention controls in the current build. Fixture or compiled status is not presented as a working feature.

Phase 6F expects a future trusted native `cross_device_producer_ingest` invoke command to add the backend-only bridge bearer and submit the producer session token, exact-next sequence, endpoint allowlist entry, and metadata payload over loopback. That command is not currently registered in Tauri, so the existing `controlPlaneConnected:false` status correctly keeps the path disabled. The frontend never receives or constructs `EDITH_DESKTOP_BRIDGE_TOKEN`.

Browser/dev mode can inspect backend truth but cannot invoke native commands. It shows `TAURI ABSENT`, `CONTROL PLANE NOT CONNECTED`, and disabled native controls.

## Security And Privacy

- No frame pixels, Base64 payloads, private paths, credentials, or source handles are logged or persisted.
- The short-lived producer token is held only in the bridge instance memory, passed to the trusted native invoke boundary, never rendered, and cleared on rejection, expiry, stop, logout, or Emergency Stop.
- Frame bytes only exist in component memory for the current displayed frame.
- Remote input/control is never enabled.
- Unknown kill-switch state blocks mutations.
- Owner denial, expired leases, stale telemetry, malformed responses, invalid lineage, and integrity mismatch fail closed.
- Logout and Emergency Stop revoke native owner state and attempt backend Live View stop when a lease exists.

## Files Changed

- `src/edith/crossDeviceDesktopBridge.ts`
- `src/components/cross-device/CrossDeviceBridgePanel.tsx`
- `src/components/ui/edithOS.tsx`
- `src/App.tsx`
- `scripts/test-edith-phase6f-desktop-bridge.ts`
- `package.json`
- `docs/EDITH_CHAT2_PHASE6F_DESKTOP_BRIDGE_HANDOFF_2026-09-28.md`

No files under `mobile/**`, `server/**`, `src-tauri/**`, canonical contracts, or producer services were edited.

## Verification

- `npm run lint` - passed.
- `npm run build` - passed. Vite emitted the existing large-chunk warning for the main bundle.
- `npm run test:edith-phase6f-desktop-bridge` - passed.
- `npm run test:edith-phase6e-backend-integration` - passed (8 checks).
- `npm run test:edith-cross-device-phase6` - passed (13 checks).
- `npm run test:edith-phase6d-result-card-producers` - passed (11 checks).
- `npm run test:edith-interaction-safety` - passed (13 scenarios).
- Browser smoke in the in-app browser - System Diagnostics and the bridge panel rendered without console warnings/errors. Browser mode correctly showed native invoke unavailable and all unsupported controls disabled.

## Phase 6F Test Coverage

- Tauri invoke absence.
- Owner-session denial.
- Emergency Stop dominance before mutation/capture.
- Live View start, explicit frame pull, 2 FPS cadence, expiry, stop, and state clearing.
- Owner+CSRF producer-session bootstrap, exact-next producer sequence, backend acceptance gating, and token lifecycle cleanup.
- Public error privacy (no private path or Base64 reflection).
- Transfer chunk byte count, hash identity, and offset integrity.
- Stale PC telemetry and preservation of unknown/absent metrics.
- Server-owned result-card source reference, canonical response validation, raw-card exclusion, and legacy display adaptation.
- Capability honesty when native reports fixture/compiled support but no control-plane connection.

## Remaining Backend / Native Needs

These are intentionally not implemented or simulated by the frontend:

1. Chat 6/native must implement the trusted `cross_device_producer_ingest` invoke command. It must add the process-only bridge bearer internally, enforce loopback and the endpoint allowlist, and return only safe HTTP status/body metadata. The bridge secret must never enter webview JavaScript.
2. Native status must set `controlPlaneConnected:true` and individual capabilities to `available` only after that producer path is operational.
3. End-to-end PC-to-mobile byte delivery and acknowledgement/resume channel.
4. Native orchestration for audio handoff lifecycle and producer ingest.
5. Real WOL configuration and a producer-ingested, verifiable attempted/ready result.
6. Per-artifact retention receipts from native cleanup. The current aggregate cleanup DTO cannot satisfy the backend receipt schema, so the UI keeps cleanup disabled.
7. Native runtime verification for capture dialogs, file pickers, and transfer/audio adapters on packaged Windows builds.

Until those exist and native status reports `controlPlaneConnected:true` plus capability `available`, the desktop UI will continue to show configuration required and keep action controls disabled.
