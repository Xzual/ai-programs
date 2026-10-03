# Gemini and Codex migration — 2026-10-01

Scope: Windows minik bot. Keep the Mochi character, animation, layout, colors,
sounds and CSS unchanged. macOS is not modified.

## Implemented

- Chat requests now use Google's Gemini generateContent endpoint, not Anthropic.
- Gemini API key can be entered in Settings and stored in Windows Credential
  Manager. No key is saved in preferences or frontend storage.
- Model refresh uses the real authenticated Gemini model list.
- Conversation history, reset, Google Search and bounded inbox file attachments
  are supported by the Rust transport. Errors are shown without raw API secrets.
- The old Vercel integration is removed from the Windows UI and poller. Older
  preferences migrate its enabled entry to the Codex integration.
- Codex uses the same local named-pipe relay as the existing VS Code/Claude
  integration, but routes to its own pill. It supports work steps, completion,
  interruption, subagent events and click-only permission decisions.
- Codex setup shows a diff, preserves foreign hooks, takes a dated backup and
  rejects stale previews. Uninstall removes only this app's Codex entries.
- Approval routing does not rename the Claude pill. A previous completion timer
  cannot idle a newer task. Concurrent permission requests return to the terminal.
- Window context accepts the frontend's camelCase `appName` field. Preference
  migration removes duplicate Codex entries while retaining existing user settings.

## Verified

- `npm run build`: PASS (TypeScript and Vite).
- `npm run test:hooks`: PASS (Codex event routing, steps, finish text, stale timer,
  approval isolation, concurrent-request decline, pause, interrupt, session end
  and absence of the Vercel pill).
- `cargo test --locked -p coucou --lib -- --test-threads=1`: 19 passed,
  1 intentionally ignored network test.
- Working native `coucou.exe` responds. A **synthetic** Codex PreToolUse payload
  passed through the real relay and reached the actual WebView handler:
  `2026-10-01 20:08:00 ui hook ui codex PreToolUse`.
- Native accessibility output includes Codex and Ask Gemini.
- Stylesheet build hashes remain settings-D7UCIG31.css and island-CAe1mmvD.css.
- Expanded browser preview was inspected: Codex occupies the former purple pill,
  with the existing character and layout. Settings visibly include Gemini, model
  refresh and local Codex setup. This preview has no native bridge and cannot
  prove successful credential storage or hook installation.
  Screenshot: `screenshots/codex-migration.jpg`.
- The Codex card's leftover VS Code launcher was corrected. Its link now says
  Open Codex, and both the card and jump/finished actions launch the desktop app,
  or the current session through a validated `codex://threads/<id>` deep link.
  Claude's VS Code launcher remains unchanged. Windows accepted the actual app
  activation through the installed version-independent app ID. No new chat or
  installer was requested. Launch-target and invalid-ID tests PASS.
  Browser preview: `screenshots/open-codex.jpg` (preview has no native hook bridge).

## Owner-approved setup and live checks

- Owner subsequently authorized handling connection approval. The installed
  Codex runtime's `hooks/list` returned the exact hashes of the 10 Coucou entries.
  Only those entries were trusted; unrelated hook trust and existing ORCA hooks
  were preserved. A follow-up runtime query returned all 10 as `trusted`, enabled,
  and zero configuration errors. No hook-trust or approval bypass flag was used.
- Before the trust change, `config.toml` was backed up to
  `C:/Users/arday/.codex/config.toml.bak-coucou-trust-20261001-2020`.
- The existing project Gemini key was stored in Windows Credential Manager with
  owner authorization. The setup command preserves any existing stored key and
  never prints key material. No billing or account settings were changed.
- Mandatory Google Search on every chat was removed: ordinary conversation no
  longer consumes separate grounding quota. Explicit search/research/current-info
  queries still enable Google Search. Transient HTTP 502/503/504 receives one
  bounded retry; authentication and quota failures are not retried.
- `npm run test:gemini:live` now PASS: two real Gemini replies, follow-up remembers
  COBALT, then conversation reset succeeds. Earlier quota/service failures remain
  diagnostic history, not the current ordinary-chat outcome.

## Remaining live acceptance boundary

- A normal Codex session producing events from the trusted hooks is not yet
  proved. Attaching the current conversation through an independent test client
  was refused because it already has an active writer; that boundary was honored.
  No new chat/model task was created for testing and the live writer was not
  interrupted. Installed hook trust and the real synthetic relay check are proved,
  but they are not the same as a normal-session lifecycle acceptance test.
- Native screenshot capture saw the auto-hidden strip; a complete expanded-panel
  visual inspection has not been completed. Core visual source files are unchanged.

The existing VS Code/Claude Code session integration stays available. Gemini is
the chatbot provider; Codex is a local session monitor, not a Gemini chat model.

References: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Gemini generateContent](https://ai.google.dev/api/generate-content).

## Live-status repair — 2026-10-01

- Existing long-running desktop chat did not emit work lifecycle hooks to Coucou;
  only real SessionEnd callbacks were seen. Shared-daemon `app-server proxy`
  connection failed with Windows socket error 10050. No writer takeover or new
  chat was attempted. OpenAI Docs / [App Server](https://learn.chatgpt.com/docs/app-server)
  was used to check read-only access versus session ownership.
- Added `src-tauri/src/codex_live.rs`: read-only, bounded incremental monitoring
  of local Codex rollout events. Only lifecycle metadata reaches the island;
  prompt, command arguments, reasoning text and outputs are not forwarded/logged.
  Starts/completions/interruptions come from recorded events, not timer progress.
  Idle history is not replayed as a new success. Missing/stale live data is marked
  unavailable, never inferred as completed. Subagents and symlinks are excluded.
- `lib.rs` and `core/bridge.ts` expose a startup snapshot and live event channel.
  `island/hooks.ts` receives live status, rejects stale snapshots, bounds timeline,
  protects human approval cards and ignores unrelated SessionEnd hooks once the
  live observer is connected. `island/integrations.ts` preserves live metadata.
  `views/integrations.ts` distinguishes connected idle from waiting for a session.
- Real runtime evidence: `C:/Users/arday/AppData/Local/Coucou/coucou.log` recorded
  `codex live working` + frontend `PreToolUse` at 20:50:50 and `codex live thinking`
  + frontend `UserPromptSubmit` at 20:50:51 from this actual ongoing chat. These
  were not synthetic hook injections. The native dev application was hot rebuilt.
- Checks: frontend production build PASS; both hook/live lifecycle test groups
  PASS; Rust library suite PASS (23 passed, one paid-network test ignored) using
  `--test-threads=1`. Parallel full-suite execution initially hit an existing
  process-environment race between hook installer tests; serial execution passed.
  Live completion, partial/oversized lines, privacy, stale finish timer, missing
  data and approval isolation are unit tested. A new real completed turn and
  expanded native-panel screenshot are not yet claimed as observed acceptance.
- CSS/character design unchanged: build CSS hashes remain settings-D7UCIG31 and
  island-CAe1mmvD. Hooks remain the sole permission-decision source. Monitoring
  latency is approximately one second, with new-file discovery every five seconds.
  Boot reconstruction is bounded to the latest 2 MiB: if a very long active turn's
  start falls outside that tail, it cannot reconstruct that turn until the next
  lifecycle boundary. This fallback depends on local rollout schema, not a stable
  public streaming API; unknown schemas are ignored.

## Existing-chat message box — 2026-10-01

- Added a compact Codex-only input/send row above Open Codex / Refresh. Existing
  card size, bot drawing and other integrations are unchanged. Native input click
  enables keyboard focus; Enter or the send arrow explicitly submits the draft.
- `codex_send.rs`, `lib.rs`, and `core/bridge.ts` use the installed `codex queue
  --thread ID --message TEXT` command. No shell interpolation, new thread, writer
  takeover, model override or safety override. Backend pins the target to the
  observed session, validates inputs, prevents concurrent sends and bounds runtime.
- `views/codex-composer.ts` preserves drafts per session, prevents double-clicks,
  retains text on errors and only reports queue acceptance (not delivery). No
  automatic retries after uncertain results; no message text logged.
- Runtime probe: installed CLI exited successfully and queued test message ID
  `01a0f89f-6f2e-7bf2-9292-c8b179fff002` for the current existing chat. Read-only
  queue database check confirmed that exact ID/target. Consumption by the desktop
  chat is not yet observed while the current turn is running; acceptance into the
  queue is not claimed as completed model delivery. No extra chat was created.
- Production build PASS; Rust 25 tests PASS, one paid-network test ignored; hook
  test groups PASS; composer tests PASS (Turkish text, target isolation, draft
  redraw, double sends, queue receipt and error preservation).
- Browser visual preview checked via UI; disabled sending in plain-browser mode
  is expected (no native bridge/session). Preview saved as
  `screenshots/codex-message-box.png`. Native app was hot rebuilt.
- OpenAI Docs skill informed existing-thread versus new-chat deep-link behavior:
  https://learn.chatgpt.com/docs/reference/commands and
  https://learn.chatgpt.com/docs/developer-commands. Installed CLI help establishes
  the queue command; the fetched reference does not document that command yet.
