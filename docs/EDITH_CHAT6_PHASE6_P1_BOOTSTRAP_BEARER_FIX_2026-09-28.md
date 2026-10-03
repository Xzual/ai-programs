# E.D.I.T.H. Chat 6 Phase 6 P1 Bootstrap Bearer Fix

Date: 2026-09-28

## Root Cause

The native producer ingest request already authenticated with `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>`, but the native producer-session bootstrap request sent only the owner cookie and CSRF token. The hardened backend correctly rejects that bootstrap without the native bridge bearer.

## Fix

- Added `.bearer_auth(&bridge.token)` to the fixed-loopback producer bootstrap HTTP request.
- Kept the bridge token in `ProducerBridge` native process memory. It is not returned to JavaScript, serialized in command results, logged, or reflected in safe errors.
- Extracted the bounded bootstrap HTTP request into a private Rust helper so the exact native authorization header can be tested without weakening the WebView cookie boundary.
- Preserved existing cookie, CSRF, owner-session, main-WebView, kill-switch, loopback, expiry, and response validation.
- Missing native bridge configuration still fails before any request with `DESKTOP_BRIDGE_CONFIGURATION_REQUIRED`.
- A wrong bearer receives backend HTTP 403 and remains fail-closed as `DESKTOP_PRODUCER_UNAUTHORIZED`.

## Tests

The Rust test server now grants bootstrap only when it receives the exact header:

`Authorization: Bearer <native bridge token>`

Coverage includes:

- exact bootstrap bearer succeeds with HTTP 201;
- wrong bearer receives HTTP 403;
- missing native bridge state fails closed before network activity;
- bootstrap command result excludes bridge and producer secrets;
- frontend ingest/bootstrap DTOs still contain no bridge token, producer token, or sequence;
- native production code has no `println!`, `eprintln!`, or `dbg!` secret logging surface.

## Files Changed

- `src-tauri/src/cross_device.rs`
- `scripts/test-edith-phase6g-native-ingest.ts`
- `docs/EDITH_CHAT6_PHASE6_P1_BOOTSTRAP_BEARER_FIX_2026-09-28.md`

No `server/**`, `mobile/**`, contracts, crypto, Mark-L, or UI files were changed.

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib --tests -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run test:edith-phase6g-native-ingest`
- `npm run test:edith-phase6e-backend-integration`
- `npm run test:edith-phase6f-desktop-bridge`

## Capability Truth

This fix restores the authenticated producer bootstrap path only. It does not enable remote computer control, automatic capture, screenshot/OCR, microphone access, wake word, WOL, tray/background mode, or global shortcuts.
