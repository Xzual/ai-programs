# E.D.I.T.H. Chat 6 Phase 6B Desktop Native Handoff

Date: 2026-09-28

## Outcome

Phase 6B adds a fail-closed Tauri native adapter surface for cross-device capture, PC telemetry, opaque file transfer, inbox retention, audio leases, and owner lifecycle revocation. End-to-end Phase 6 capability remains `configuration_required` because the frozen Phase 6A backend intentionally has no trusted native producer route and the React/mobile consumers are outside Chat 6 ownership.

No remote-control authority, automatic screen stream, mouse/keyboard action, microphone capture, Wake-on-LAN packet, private-path response, or background service was added.

## Implemented

- `cross_device_native_status` reports control-plane connectivity as false. The screen adapter is `compiled_unverified`, PC telemetry is `runtime_verified`, transfer/audio adapters are `fixture_verified`, and Live View remains `configuration_required`.
- Live View start requires a native owner warning dialog, a current owner/session/device lineage, a bounded expiry, the main Tauri WebView, and an inactive Emergency Stop.
- Only one capture lease may exist. Live View and audio handoff cannot overlap.
- Frames are pull-only. There is no timer, worker, reconnect loop, or automatic stream. Policy is capped at 2 FPS and 1920x1080.
- Windows capture targets the monitor containing the current cursor, validates physical bounds, uses per-monitor effective DPI, downsamples before PNG encoding, and returns pixels only in a separate transport object. Canonical frame metadata always has `containsPixels:false`.
- Emergency Stop is checked before and after frame capture. A stop during capture discards the encoded frame and revokes active leases.
- Owner logout/session-expiry/rotation has an explicit main-window revoke hook. Expiry is checked on every stateful operation, and application exit revokes native state.
- Native PC telemetry measures CPU and RAM with Windows APIs. GPU is omitted and network is `unknown` because neither is currently measured. Snapshots carry `observedAt` and a 30-second expiry.
- Wake-on-LAN returns canonical `configuration_required`, `attempted:false`, and `runtimeReady:false`. No packet is sent and no receipt is fabricated.
- File source and destination paths are selected through native dialogs. Only random opaque handles, safe display metadata, size, checksum, and expiry cross the Tauri boundary.
- PC-to-mobile reads are limited to 256 KiB chunks, re-check source size and full SHA-256, support caller-provided resume offsets, and report progress from actual bytes.
- Mobile-to-PC writes require exact sequential offsets, per-chunk SHA-256, bounded decoded bytes, expected final size, and final full-file SHA-256.
- Final destination creation uses `create_new(true)` and never overwrites. Existing files fail with `TRANSFER_DESTINATION_COLLISION`.
- `open`, `export`, `share`, and `openLocation` remain false because native action commands were not implemented in this phase.
- Completed artifact retention cleanup is fixed at 24 hours and preserves active retained artifacts and all pending transfers. Expired/revoked partial files are removed. Paths remain internal and are never serialized.
- Production native module code contains no `println!`, `eprintln!`, or `dbg!` logging.

## Canonical Contract Boundary

The native serializers target the frozen V2.1 shapes for:

- `CrossDeviceLiveViewSessionV2`
- `CrossDeviceLiveViewFrameMetadataV2`
- `CrossDeviceWakeReadyV2`
- `CrossDeviceTransferV2`
- `CrossDeviceAudioHandoffV2`
- `CrossDevicePcStatusV2`

`scripts/test-edith-phase6b-native-contract.ts` runs representative Rust-target JSON shapes through the canonical TypeScript parsers. `src/edith/contracts.ts`, `server/**`, React UI, mobile code, and Chat 5 producer files were not changed.

## Real Windows Runtime Evidence

### Verified on the current machine

- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture` exercised Windows CPU/RAM APIs and reported CPU `15.686274509803921%`, RAM `46%`, network `unknown`.
- `npm run tauri:dev` built and launched `src-tauri/target/debug/edith.exe`.
- Express listened on `127.0.0.1:3000`, Vite on `[::1]:5173`, and exactly one `edith.exe` process was present.
- The smoke was terminated with `Ctrl+C`, producing `STATUS_CONTROL_C_EXIT` and a Chromium window-class cleanup warning. Two seconds later there was no `edith.exe` process and neither port remained listening.

### Not runtime-verified

- The owner Live View dialog was not invoked, so no real screen pixels were captured or encoded in this run.
- Native source/destination pickers were not opened and no user file was read or written.
- No microphone/audio device was opened; only lease state was tested.
- No WOL packet was attempted by design.
- Graceful close through the app window was not tested in this run; `Ctrl+C` shutdown is not graceful-close evidence.

## Tests

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture` - 15 passed
- `npx tsx scripts/test-edith-phase6b-native-contract.ts` - 10 checks passed
- `npm run lint`
- `npm run build`
- `npm run tauri:dev` - launch/no-orphan smoke, manually stopped

## Known Limitations

- Phase 6A backend has no trusted native producer endpoint. Native DTOs and commands are ready, but status publication, Live View session handoff, logout notification, and transfer control-plane orchestration are not connected end to end.
- Live View capture/encode is compiled but remains runtime-unverified until the owner explicitly accepts its native dialog.
- Inbox retention metadata is process-memory only. Cleanup works during the running process; completed artifacts cannot be rediscovered for timed cleanup after a full application restart without a future privacy-preserving durable opaque registry design.
- There is no background retention scheduler. Cleanup is explicit and bounded.
- GPU and network-online telemetry are unavailable rather than inferred.
- Open/export/share/open-location actions are unavailable and reported false.
- WOL configuration and packet adapter are absent.

## HANDOFF

OWNER: Chat 6 Desktop Native

STATUS: PARTIAL - native safety adapters and tests complete; end-to-end producer wiring and owner-approved physical capture smoke remain blocked

FILES_CHANGED:

- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/src/lib.rs`
- `src-tauri/src/computer.rs`
- `src-tauri/src/cross_device.rs`
- `scripts/test-edith-phase6b-native-contract.ts`
- `docs/EDITH_CHAT6_PHASE6B_NATIVE_HANDOFF_2026-09-28.md`

CAPABILITY_TRUTH:

- Live View end to end: `configuration_required`
- Native screen adapter: `compiled_unverified`
- PC status: `runtime_verified` for CPU/RAM, other fields unavailable/unknown
- PC-to-mobile bytes: `fixture_verified`, control-plane unbound
- Mobile-to-PC inbox: `fixture_verified`, control-plane unbound
- Audio handoff: lease hook `fixture_verified`, no device capture
- Wake-on-LAN: `configuration_required`, no attempt
- Remote control: `false`
- Continuous auto-stream: `false`

NEXT_OWNER: Chat 4 backend owner must design an authenticated native-producer route using the existing process-secret bridge and owner binding, without weakening CSRF/device boundaries. Chat 2/5 consumers may then bind UI/producers to these Tauri commands. Chat 6 must perform the owner-approved physical capture/file-dialog smoke after that integration.

DO_NOT_CLAIM: Do not advertise Live View, native file transfer, WOL, audio capture, or cross-device PC status as end-to-end enabled from this handoff alone.
