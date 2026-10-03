# Minik bot / Android feature upgrade — 2026-10-01

Independent Minik bot stays independent. It has NOT been connected to EDITH.
Work was partitioned using the requested create-subagent skill, with project-local focused agent configurations in `.cursor/agents`.

## Implemented

- Fullscreen: foreground window must cover the same monitor; ordinary maximized windows, desktop shell and taskbar are excluded. Hide/show preserves the bot state. Settings can disable it. Unit-tested geometry; real fullscreen game/movie acceptance remains unverified.
- Bar personalization: expanded/compact width, left/center/right placement, accent, pinned utility tabs. Fluid utility layouts and monitor width-aware hit-testing. Visual/native narrow-monitor acceptance remains unverified.
- File shelf: at most 32 persistent references, missing-file state, open/reveal/remove, incoming native drop, outgoing native COPY-only drag. Originals never moved/deleted. Windows Shell CF_HDROP exact path and original-byte preservation tested. Actual mouse drop into another app still unverified.
- Spotify: per-process Spotify-only audio volume, real track seek, no noisy success text. Snapshot/playback/volume/seek native acceptance passed and original playback/time/volumes restored.
- Steam: read-only real manifest discovery across libraries, byte-derived progress, sampled speed and network-transfer ETA, unknown values shown honestly. Actual installed Steam source smoke passed. Workshop excluded; live counters depend on Steam's manifest update frequency. Completion alerts are opt-in in bar settings and work while minibar is visible.
- Zen: opt-in WebExtension + native messaging host and integration-ready display; actual counters, privacy-safe metadata and freshness checks. Host builds and adapter/format tests pass. NOT installed; UI reports bridge_required until installation. See integrations/zen-downloads/README.md.
- Windows notifications: actual UserNotificationListener integration, explicit permission, private-by-default preview, native app icon, compact new-message preview and known-ID application opening. No generic inline reply implementation. Current unpackaged app lacks required package capability; native probe confirmed capability_required and zero messages read. Thus WhatsApp previews are NOT runtime-ready yet.
- Android: opted-in Android13+ notification permission UI, accepted authenticated realtime task/transfer success/failure notifications, hashed bounded dedup, replay/age filtering, quiet hours, privacy and navigation. 54 tests, lintDebug and assembleDebug pass. APK: ../../../mobile/app/build/outputs/apk/debug/app-debug.apk. No device connected: actual notification tray/permission/click remains unverified.

## Explicitly not completed

- Windows package identity / userNotificationListener capability provisioning.
- Zen extension/native host installation and permanent signed addon distribution.
- Android closed-app/background push transport/provider.
- Scheduled smart-reminder engine. A versioned future bot reminder/download notice contract exists only; it is not connected to the authenticated stream or Minik bot.
- EDITH ↔ independent bot integration, intentionally deferred as requested.

## Verification

- Frontend TypeScript + Vite production build: PASS.
- Rust library suite serial: 49 passed, 8 ignored; native Spotify and package probe checks were separately explicitly run. Serial execution is required because legacy hook tests mutate process-global test environment variables.
- Existing hooks, composer, visibility and shortcuts frontend checks: PASS.
- Zen adapter and localized download view checks: PASS.
- zen-download-host cargo check: PASS.
- Android tests/lint/APK: PASS as above.

During the initial upgrade verification, no download was started, extension installed, registry permission changed, notification message sent or original shelf file moved/deleted.

## Follow-up goal — 2026-10-02, still active

Full objective: game artwork, working real speed/ETA, actual Zen connection, screenshot-matched minimalist Spotify volume, and real incoming file dragging. Not marked complete.

- Local Steam artwork now covers both direct app-ID folders and newer hash subfolders, including library_capsule.jpg. Actual source smoke: 9 libraries, 56 manifests, 5 rows and 5 readable covers. Rendered-panel verification remains pending.
- Added fresh single-transfer Steam log-rate parsing with Mbps→bytes/sec conversion and explicit stale/ambiguous rejection. ETA still requires actual remaining-byte counters. Live bot speed/ETA acceptance is pending.
- Spotify volume is a short, white thin slider with a speaker icon, no always-visible percentage, matching the supplied reference. Native rendered view inspection remains pending.
- COPY-only OLE targets now register on the island and its late WebView2 children rather than just revoking the child's existing target. Registration refreshes at startup and on button presses; stationary-cursor button transitions are no longer skipped. Real cross-app mouse dragging remains pending; native CF_HDROP extraction test passed without changing source bytes.
- Zen installation was explicitly approved. Release native host built successfully, copied to `%LOCALAPPDATA%/Coucou/bin/zen-download-host.exe`, and the exact current-user Mozilla NativeMessagingHosts registration now points to `%LOCALAPPDATA%/Coucou/zen-native-host.json`. Temporary addon loading is still pending: Computer Use cannot target the file picker (same `point is over zen.exe "", not target window` failure after activation and one fresh retry). User must select the local integration manifest in the already-open picker. No real browser snapshot exists yet, so runtime connection and real download acceptance are NOT verified. Permanent signed-addon distribution remains unimplemented.
- Live Steam UI check: a pre-existing Warhammer update was briefly resumed during testing (scroll movement changed the row under the intended click), then suspended. Steam confirms 0 B/s and downloads paused. One update remains queued; the original zero-queued schedule was not restored. This is not proof that the bot speed/ETA UI works.

Latest continuation: bot dev runtime is running (PID 26792 at observation); Zen adapter/view checks both passed again. User interrupted Computer Use with Escape, then explicitly resumed it. No browser safety or signing settings were changed. All remaining runtime checks above remain outstanding.

User subsequently loaded the addon. Real Zen debugging UI confirms Temporary Extensions (1), Coucou Downloads — Zen, extension ID downloads@coucou.local. Native connection currently FAILS with `No such native application fr.louisraille.coucou.downloads`, reproduced in the addon console. Exact REG_SZ registration, both registry views, physical user hive, manifest JSON, absolute executable path and user identity were checked. Reapplying the exact registration via a separate hidden reg.exe process exited 0 but did not establish a connection. No native-host process or snapshot has appeared. Added connection-only console diagnostics (no download metadata), adapter/view tests both pass again. A machine-specific `integrations/zen-downloads/register-local-host.reg` is provided for user-applied Windows registration; any Windows import warning must be handled by the user. Cause of lookup rejection is not conclusively established; do not claim a Zen upstream issue or successful real download acceptance.

After the user's registry import, reloaded the addon. Zen parent-process Browser Console reveals the precise rejection: the registered AppData manifest `does not exist`, despite being readable from the Codex execution context. Added a workspace-local native manifest pointing to the already-built release host and updated the machine-specific .reg to it. Tool-side registry update still leaves Zen observing the old AppData path; this demonstrates differing visibility rather than host-protocol failure. User must import the updated .reg from normal Windows. Optional unpackaged setup helper builds successfully; launching it through Computer Use did not fix visibility and is NOT accepted as successful installation. Rust serial regression: 52 passed, 8 ignored again. No live download started, no fresh native snapshot, no DONE claim.
