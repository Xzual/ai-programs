# E.D.I.T.H. Chat 6 Phase 6G Native Producer Ingest Handoff

Date: 2026-09-28

## Outcome

The Tauri shell now owns the complete trusted desktop-producer authentication boundary. The main WebView may request a bootstrap with an active owner CSRF token and may submit an allowlisted evidence kind plus canonical metadata. It never receives the desktop bridge bearer, producer session token, or producer sequence.

No remote control, automatic capture, arbitrary HTTP request, clipboard plaintext, audio bytes, private path, or background service was enabled.

## Native Flow

1. `cross_device_producer_ingest` accepts calls only from the `main` WebView and checks the Emergency Stop through the existing native safety bridge.
2. Bootstrap reads the HttpOnly `edith_owner_session` cookie from the WebView cookie store, accepts the WebView's current CSRF value, and calls the fixed loopback route `POST /api/edith/mobile/desktop-producer/session/:deviceId`.
3. The native process keeps `EDITH_DESKTOP_BRIDGE_TOKEN`, the returned short-lived producer token, and exact-next sequence in Rust memory only.
4. Ingest accepts a typed kind, maps it to one of eight fixed backend routes, rejects unknown fields/private payload classes, and sends only canonical metadata/evidence.
5. Success is returned only when the backend responds with HTTP 202 and `success:true`. Network failure, non-202, malformed response, auth/CSRF/session/sequence rejection, or replay clears native producer authority and requires a new bootstrap.
6. Logout/owner rotation, owner-session expiry, Emergency Stop, bridge shutdown, and app exit clear the producer token and sequence.

## Capability Truth

- `controlPlaneConnected` is false until native bootstrap succeeds and becomes false again on expiry or revocation.
- Live View, transfer, inbox, and audio handoff become `available` only while the trusted producer session is active. This does not grant remote-control authority.
- `remoteControl` remains false.
- `continuousAutoStream` remains false.
- Wake-on-LAN remains `configuration_required` and does not send a packet.
- Browser-only mode remains unable to invoke native producer commands.
- The existing physical screen capture adapter is still owner-dialog gated and was not exercised in this phase.

## WebView Boundary

`src/edith/crossDeviceDesktopBridge.ts` now passes only:

- bootstrap: `{ operation, deviceId, csrfToken }`
- ingest: `{ operation, kind, payload }`

The previous JavaScript-held `producerSessionToken` and `nextSequence` were removed. The native result contains only safe session lineage for bootstrap or an empty accepted-data object for ingest. Backend response bodies and secrets are not reflected into JavaScript.

## Files Changed

- `src-tauri/src/cross_device.rs`
- `src-tauri/src/lib.rs`
- `src/edith/crossDeviceDesktopBridge.ts`
- `scripts/test-edith-phase6b-native-contract.ts`
- `scripts/test-edith-phase6f-desktop-bridge.ts`
- `scripts/test-edith-phase6g-native-ingest.ts`
- `package.json`
- `docs/EDITH_CHAT6_PHASE6G_NATIVE_INGEST_HANDOFF_2026-09-28.md`

No `server/**`, `mobile/**`, `src/edith/contracts.ts`, crypto, Mark-L, or general UI files were changed for Phase 6G.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run test:edith-phase6g-native-ingest`
- `npx tsx scripts/test-edith-phase6b-native-contract.ts`
- `npm run test:edith-phase6e-backend-integration`
- `npm run test:edith-phase6f-desktop-bridge`
- `npm run test:edith-cross-device-phase6`
- `npm run test:edith-interaction-safety`
- `npm run lint`
- `npm run build`
- `npm run tauri:dev` launch/no-orphan smoke

The Tauri smoke launched one `edith.exe`, Express on port 3000, and Vite on port 5173. It was stopped without invoking screen capture or input control; afterward there was no `edith.exe` and neither port remained listening. The Chromium class cleanup warning on Ctrl+C is the same forced-development-shutdown warning seen in Phase 6B.

## Test Coverage

- bridge secret and producer token stay native-only;
- missing bridge environment/configuration fails closed;
- non-main WebView restriction is present;
- arbitrary URL/body and unknown command fields are rejected;
- only typed kinds and canonical metadata shapes are accepted;
- pixels, image/audio bytes, clipboard plaintext, private paths, arbitrary URLs/bodies, and credentials are rejected recursively;
- exact-next sequence advances only after HTTP 202;
- non-202/replay/sequence rejection revokes native state;
- expiry and owner rotation revoke token and sequence;
- no production native debug logging;
- command registration and Tauri runtime startup.

## Remaining Runtime Evidence

- A real producer bootstrap was not performed because this smoke did not create or use a paired trusted mobile device. Therefore no claim is made that a current user/device pairing completed end to end during this run.
- No owner Live View approval dialog was opened and no screen pixels were captured.
- No microphone, mouse, keyboard, WOL, clipboard, tray, background, or global-shortcut capability was enabled or exercised.
- Packaged release behavior still needs a signed/release build smoke with an actual trusted pairing before release certification.

## Handoff

OWNER: Chat 6 Desktop Native

STATUS: IMPLEMENTED AND TESTED IN CONTRACT/LOCAL LOOPBACK HARNESS; REAL PAIRED-DEVICE BOOTSTRAP NOT EXERCISED

NEXT: Chat 2 may update its Phase 6F handoff wording and run an owner-approved paired-device UI smoke. Chat 4 should keep the existing backend dual-auth, exact-sequence, CSRF, owner-binding, and 202-only contract unchanged.

DO NOT CLAIM: Do not claim remote control, automatic streaming, physical capture runtime verification, or real paired-device success from this handoff alone.
