# Independent bot utilities — acceptance checkpoint

Objective: drag/drop application shortcuts and reorder icons, memory-only clipboard history, nicely designed Spotify-only media panel. No EDITH or voice integration.

Implemented:
- Native `.exe`/argument-free `.lnk` drop metadata extraction, transactional batch additions to selected group, duplicate prevention, persistent ordering. Pointer-capture reorder handle avoids Tauri/OLE HTML drag conflicts.
- Clipboard tab: explicit opt-in per app run, pause/resume, search, copy without auto-paste, remove/clear, 50-entry deduplicated text history only in memory. Windows exclusion markers honored, obvious secret heuristic (not a guarantee), 32 KiB limit, no logging/model/network/persistence. Tray pause skips capture.
- Spotify-only WinRT source selection (no current-session/global-media-key fallback), title/artist/album/artwork/timeline, previous/play/pause/next and supported-control gating. No account/API key required. Snapshot polls only while panel is expanded, every two seconds.

Evidence 2026-10-01:
- TypeScript/Vite production build PASS.
- Rust lib suite: 33 PASS, 4 opt-in tests ignored by default.
- Explicit native dropped-executable metadata test PASS for Windows Notepad, including actual PNG icon extraction and invalid-path rejection.
- Explicit read-only native Spotify snapshot test PASS: connected=true, playing=true, title_present=true, artwork_present=true.
- Frontend launch feedback and media time formatting unit tests PASS.
- Hooks, Codex composer and persistent visibility regression suites PASS.
- Browser preview Spotify layout inspected. Increased panel height to 290 to avoid footer clipping. Browser preview intentionally disables native operations, not evidence of native commands.

Remaining before claiming goal complete:
- Exercise actual external Explorer drop routed to the selected group and actual pointer ordering in native WebView; test restarting preserves order.
- Exercise native clipboard capture/copy/pause/removal/exclusion behavior with disposable known text while preserving user's current clipboard contents.
- Verify next/previous transport UI wiring in native runtime (play/pause backend roundtrip is now verified; see below).
- Final native rendered appearance checks for all populated panels; refresh UI screenshots after final layout tweak.

Goal is BLOCKED on native UI acceptance; do not equate build/unit tests or read-only Spotify metadata with complete end-to-end acceptance. Resume after the user opens the bot and leaves Kısayollar visible.

Continuation evidence:
- Found and fixed clipboard contention loss: a busy OpenClipboard is now retried, native read happens outside the history mutex, sequence/enable/pause are rechecked before commit. Disabled history worker parks on a condition variable instead of polling.
- Native `live_spotify_transport_roundtrip` PASS: actual play/pause changed Spotify playback and restored the original playback state. Uses the same extracted command function as the UI bridge.
- Artwork reads request the full bounded stream, reject incomplete bytes, and render a music-note fallback on decode error.
- Latest production frontend build PASS. Native compact bot is visible, but keyboard activation remained at RootWebArea; hidden view accessibility text is not proof of an active rendered panel. Asked user to leave Kısayollar open for native UI acceptance. No existing user groups or clipboard contents were modified.
- Second consecutive verified native-acceptance blocker turn: refreshed live Coucou window (id 724268) is still compact. Screenshot-targeted click reported the underlying ChatGPT window; activation plus a fresh screenshot and the single allowed retry produced the same mismatch. Stopped native input per Computer Use recovery guidance. User has not yet confirmed opening Kısayollar. No new implementation defect found in the inspected sources; remaining acceptance requirements are unchanged. If the same condition repeats on the next goal turn and no safe independent progress remains, the three-turn blocked threshold is met.
- Third consecutive blocker audit: refreshed the live returned Coucou window (id 724268), confirmed compact-only rendering, and tried the current screenshot-backed bot target. The helper again reported the underlying ChatGPT window instead of Coucou. Native target mismatch is unchanged; no user confirmation/open panel is available. Existing code/unit/native backend evidence remains valid, but outstanding end-to-end UI tests cannot be completed through the supported Computer Use surface in this state. Marked goal BLOCKED, not complete; implementation preserved.
