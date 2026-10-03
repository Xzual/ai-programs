# E.D.I.T.H. Chat 6 Phase 7C Advanced Native Handoff

Date: 2026-09-28

OWNER: Chat 6 Desktop Native

STATUS: PARTIAL. Trusted native adapters and lifecycle controls are implemented. Phase 7 producer publication and event-based filesystem watcher delivery remain configuration required because their backend route/dependency boundaries do not exist.

## Implemented

- Added a typed Tauri `advanced` module and registered all commands in the main shell.
- Real Windows power and presence adapter:
  - `GetSystemPowerStatus` for AC/battery source and battery percentage;
  - `GetLastInputInfo` plus monotonic system uptime for active/away state;
  - no camera access or camera-derived presence.
- Real foreground metadata adapter:
  - application identity and process ID are fingerprinted;
  - bounded title preview is omitted for sensitive apps and path-like titles;
  - no executable path, private path, raw HWND, or plaintext process ID crosses the command boundary.
- Visual Bookmark:
  - metadata-only by default;
  - optional screenshot requires a native owner warning dialog;
  - password managers, authenticators, banking/wallet/login surfaces and path-like titles are denied before capture;
  - foreground identity is rechecked after approval to prevent a window-switch race;
  - screenshot bytes stay in native memory behind a random opaque handle, are never returned/logged, and are zeroed on expiry/revocation.
- Workspace snapshot:
  - bounded app/project/document/tab/task references only;
  - metadata-only, no password/form/secret/transaction state;
  - current foreground app may be added as safe metadata.
- Workspace restore executor:
  - native owner approval required;
  - at most 16 steps;
  - only hardcoded `notepad`, `calculator`, and `paint` application references may launch;
  - project/document/tab/task restoration reports `configuration_required` rather than fabricating success;
  - each launched process is verified as started;
  - partial outcomes are explicit;
  - stop/logout/expiry/Emergency Stop/app exit can kill only child processes launched by that restore lease.
- Reversible scenes for `WORK`, `RESEARCH`, `GAMING`, `FOCUS`, `PRESENTATION`, `TRAVEL`, and `QUIET`:
  - explicit native approval;
  - transparent capsule-level diff and rollback;
  - security notifications remain immutable;
  - Discord, Spotify, media and audio-routing control remain `configuration_required`;
  - Game Butler policy explicitly forbids cheating, process memory, and anti-cheat interaction.
- Presentation mode is represented by a reversible presentation-capsule hook only. It does not suppress security UI or silently alter OS notification policy.
- Download Butler:
  - owner selects a real local file through the native dialog;
  - private path remains native-only;
  - actual file bytes, total, remaining, status and sample-derived speed are reported;
  - ETA appears only after at least three changing samples with at least one second of evidence.
- Shadow Mode:
  - explicit opt-in;
  - bounded high-level app/workflow/timestamp metadata only;
  - no raw screen archive or secret capture;
  - disable clears retained events.
- Smart Retry:
  - maximum two attempts;
  - stale/page-changed targets require re-observation;
  - permission denial stops and reports;
  - no click or other action is dispatched by the retry hook.
- Lifecycle:
  - main WebView only;
  - kill-switch check before native activity;
  - owner logout/rotation, expiry, restore stop, kill switch, shutdown and app exit revoke advanced leases and native artifacts.

## Capability Truth

| Capability | Native status |
|---|---|
| Power/battery | `runtime_verified` on Windows |
| Idle presence | `runtime_verified`, no camera |
| Foreground metadata | `runtime_verified` on Windows |
| Visual Bookmark metadata | `available` |
| Visual Bookmark screenshot | `approval_required` |
| Workspace snapshot | `available`, metadata only |
| Workspace restore | `allowlisted_apps_only` |
| Scenes | `metadata_reversible` |
| Presentation | `metadata_only` |
| Download telemetry | `owner_selected_file` |
| Shadow Mode | `metadata_only_opt_in` |
| Smart Retry | `metadata_only_max_2` |
| Event watchers | `configuration_required` |
| Phase 7 producer publication | `configuration_required` |
| Arbitrary shell / camera / raw archive / cheating | disabled |

## CROSS_CHAT_REQUEST

TARGET: Chat 4 Backend / Shared Contracts

BLOCKER: `server/routes/desktopProducer.ts` has no producer-authenticated Phase 7 endpoint or `ProducerIngestKind` mapping. The owner generic PUT route intentionally rejects `downloads` and `power-presence`. Native therefore returns `ADVANCED_NATIVE_PRODUCER_KIND_UNAVAILABLE` and does not bypass the boundary.

REQUEST:

1. Add these fixed producer routes, or one equally strict discriminated Phase 7 route:
   - `POST /api/edith/mobile/desktop-producer/advanced/power-presence`
   - `POST /api/edith/mobile/desktop-producer/advanced/downloads`
   - `POST /api/edith/mobile/desktop-producer/advanced/bookmarks`
   - `POST /api/edith/mobile/desktop-producer/advanced/snapshots`
   - `POST /api/edith/mobile/desktop-producer/advanced/scenes`
   - `POST /api/edith/mobile/desktop-producer/advanced/watchers`
   - `POST /api/edith/mobile/desktop-producer/advanced/shadow`
   - `POST /api/edith/mobile/desktop-producer/advanced/retries`
2. Reuse the Phase 6G dual-auth boundary exactly: loopback, native bridge bearer, short-lived producer session, exact-next sequence, active owner binding, kill-switch revocation, strict canonical parser, and HTTP 202-only acceptance.
3. Reject owner generic PUT publication for trusted-native power/download truth.
4. Return no bridge token, producer token, private path, screenshot pixels, audio, clipboard plaintext, or secret-bearing errors.
5. After backend implementation, Chat 6 can add the corresponding fixed native kind mappings without changing WebView token ownership.

Event watcher delivery needs a separately approved native filesystem notification dependency or direct OS implementation. No busy-polling watcher is claimed or shipped in Phase 7C.

## Files Changed

- `src-tauri/src/advanced.rs`
- `src-tauri/src/cross_device.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `scripts/test-edith-phase7c-advanced-native.ts`
- `docs/EDITH_CHAT6_PHASE7C_ADVANCED_NATIVE_HANDOFF_2026-09-28.md`

No `server/**`, `src/edith/contracts.ts`, `mobile/**`, general React UI, crypto, Mark-L, or Chat 5 producer file was changed.

## Verification

- Rust tests include real Windows read-only power/presence and foreground metadata calls.
- Harness tests cover canonical DTO shape, private path/secret rejection, sensitive app denial, opaque screenshot policy, app launch allowlist, reversible security-preserving scenes, bounded Shadow Mode, three-sample ETA, lifecycle cleanup, and truthful blockers.
- The Tauri launch smoke does not invoke screenshot approval, launch an application, execute a restore, or alter a scene.

## Runtime Versus Harness

REAL WINDOWS RUNTIME:

- power source/battery API;
- local idle/presence signal;
- foreground application/window safe metadata;
- Tauri command registration and shell launch.

HARNESS ONLY:

- screenshot opaque-handle lifecycle; no owner capture approval was requested;
- restore launch/stop lifecycle; only blocked allowlist cases were tested and no app was launched;
- download speed/ETA sampling math; no private user download was selected;
- scene activation/rollback state;
- Shadow Mode bounded event lifecycle;
- retry policy decisions.

BLOCKED:

- Phase 7 authenticated producer publication;
- filesystem/download-completion event watcher delivery;
- Discord, Spotify, audio routing and external media controls;
- project/document/tab/task state restoration beyond safe reference reporting.

DO NOT CLAIM: Do not describe these adapters as remote control, automatic screen capture, camera presence, general process automation, arbitrary shell execution, durable recovery, or completed end-to-end Phase 7 publication.
