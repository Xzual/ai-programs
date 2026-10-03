# E.D.I.T.H. Chat 6 Phase 2 Desktop Native Handoff

Date: 2026-09-28

## Safety outcome

Computer Use remains `READ_ONLY` until the owner opens a bounded native session. The HTTP API cannot inject input. The native process now checks the backend kill switch through a loopback-only, process-random bridge secret before session approval, observation, and action dispatch. The owner cookie and CSRF boundary was not relaxed, and the bridge secret is never returned by an API.

## Implemented and verified in code/tests

- Dev and packaged runtimes share a random `EDITH_DESKTOP_BRIDGE_TOKEN`. A pre-existing port 3000 process that does not possess the token blocks Tauri dev startup instead of silently disabling safety checks.
- Native observations have `observationId`, monotonic generation, expiry, foreground window identity, process id, window bounds, monitor identity/bounds, scale factor, confidence, and physical virtual-desktop coordinate metadata.
- Windows GDI captures the virtual desktop, including negative monitor origins. Coordinate validation accepts the virtual coordinate range but native dispatch additionally requires the point to remain inside the observed foreground window.
- Native dispatch rejects missing context, stale generation, expired observation, changed foreground window, moved window, monitor mismatch, invalid retry budget, and interrupted sessions.
- Dispatch and verification are separate. The TypeScript adapter captures a fresh post-action observation and reports generic `verified` only for a confirmed cursor position or foreground-window change. A visual-frame change remains `partial` unless the calling workflow supplies an application-specific verifier.
- Automatic side-effect retry is intentionally disabled. `maxAttempts` is bounded to 1-2 at the native boundary, while the current adapter sends 1. Re-observation/re-plan must occur before another attempt.
- Operator events use contract version 2 and carry sanitized session/plan/step/observation/action correlation. Pixels and raw typed secrets are not journaled.
- The native consumer now maps wire session/observation/action results into the frozen V2.1 `DesktopOperatorSessionV2`, `DesktopObservationV2`, `ScopedApprovalV2`, `DesktopActionV2`, `ActionDispatchV2`, `ActionVerificationV2`, and `RetryDecisionV2` contracts. Every mapped record is passed through the canonical runtime parser and fails closed.
- Physical virtual-desktop coordinates, negative monitor origins, per-monitor DPI, and millisecond wire timestamps are converted to canonical physical/logical bounds and ISO timestamps without changing the native capture format.
- Canonical realtime metadata is emitted in strict order: observation, action requested, dispatch, verification, retry decision. A failed native dispatch produces a failed dispatch, a pending verification, and a re-observe decision; it never claims success or retries automatically.
- Action idempotency is enforced in the Tauri client process. A repeated key bound to the same action reuses the original promise and does not invoke native input twice; a key reused by another action is rejected. This ledger is process-local and resets on application restart.
- Raw screenshot pixels and typed text are excluded from canonical DTOs and event storage. Typed content is represented only by character count and SHA-256 fingerprint. The server additionally rejects canonical events containing pixel/base64 or raw-text field names.
- `POST /api/computer-use/realtime-events` requires the existing owner session, CSRF protection, same-origin request, and local Tauri reporter marker. Per-stream cursor gaps, duplicates, and reordering fail closed.
- The legacy `screen_processor` endpoint no longer captures the desktop. It returns `approved_native_session_required` and `capturePerformed: false`.
- The React screenshot guide is labeled as an in-app diagnostic guide. Click pulse appears only after native dispatch succeeds.

## Partial or intentionally blocked

- UIA/accessibility target discovery: **MISSING**. Current target mode is an explicitly reported `window_relative_fallback`; it is not advertised as semantic targeting.
- OCR: **MISSING**. No OCR capture or confidence is fabricated.
- Native transparent always-on-top overlay/capsule: **MISSING**. The existing React guide remains inside the main window and runtime status reports native overlay as missing.
- General outcome verification: **PARTIAL**. Post-observation frame/window/cursor checks exist, but application-specific semantic state verification does not.
- Scoped approval mapping: **BOUNDED SESSION DERIVATION**. The adapter narrows the existing owner-approved native session to the current observation, foreground physical bounds, action allowlist, expiry, and action cap. It does not claim a new per-action owner prompt.
- Realtime replay durability: **PROCESS LOCAL**. Event journal cursors and action idempotency entries are not persisted across a full backend/app restart.
- Multi-monitor: virtual-desktop capture and monitor/DPI metadata are implemented; physical multi-monitor hardware validation is still required.
- Background/tray and remote view: **NOT IMPLEMENTED**.
- High-risk external actions remain blocked by the command and permission layers. No unrestricted shell, process launch, mouse, or keyboard surface was added.

## Required runtime verification

Use a dedicated local fixture window. Do not test against login, payment, messaging, permission, or destructive surfaces.

1. Run `npm run tauri:dev` with port 3000 free.
2. Confirm browser mode still reports native control unavailable.
3. Start Computer Use and approve the native dialog.
4. Observe the fixture, move it, then verify the old action fails with `target_moved` or `foreground_mismatch`.
5. Verify an in-window diagnostic action receives a post-observation result.
6. Activate Emergency Stop and confirm queued/new actions fail before dispatch.
7. On a two-monitor DPI setup, verify virtual origin, monitor bounds, cursor mapping, and screenshot framing.

2026-09-28 smoke result: `npm run tauri:dev` compiled and launched `src-tauri/target/debug/edith.exe`; Express and Vite started on ports 3000 and 5173 and shut down cleanly with the Tauri dev process. The available UI automation inventory did not expose the native window, so no owner dialog, screenshot, mouse, or keyboard action was triggered. With the kill switch active and the Computer Use screen not mounted, `/api/computer-use/status` remained honestly `blocked`/`browser_only`; a live native heartbeat and physical multi-monitor behavior remain unverified.

## HANDOFF

OWNER: Chat 6 Desktop Native

SCOPE: Tauri Computer Use safety bridge, V2.1 canonical adapter/event boundary, observation/action/verification correlation, virtual desktop geometry, legacy capture shutdown, native capability truthfulness

STATUS: PARTIAL - safe Phase 2 foundation implemented; UIA/OCR/native overlay and physical hardware validation remain blocked

COMMITS: None

FILES_CHANGED: `scripts/tauri-dev-preflight.mjs`, `scripts/tauri-before-dev.mjs`, `server/routes/computerUse.ts`, `server.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/computer.rs`, `src-tauri/Cargo.toml`, `src/edith/computerDesktopClient.ts`, `src/edith/computerContractAdapter.ts`, `src/edith/computerOperatorEvents.ts`, `src/components/ui/edithOS.tsx`, `scripts/test-edith-computer-use.ts`, `scripts/test-edith-computer-contract-adapter.ts`, `docs/EDITH_CHAT6_PHASE2_DESKTOP_NATIVE_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED: Chat 4 V2.1 desktop contracts are consumed through `src/edith/computerContractAdapter.ts`; canonical `src/edith/contracts.ts` remains unchanged

APIS_ADDED_OR_CHANGED: Added internal `GET /api/computer-use/native-safety` and owner/CSRF/Tauri-reporter protected canonical event journal `GET/POST /api/computer-use/realtime-events`; legacy `screen_processor` fails closed without capture

TESTS_PASS: `npm run lint`; `npm run build`; `npx tsx scripts/test-edith-computer-contract-adapter.ts` (12 checks); `npm run test:edith-computer-use` (18 scenarios); `npm run test:edith-interaction-safety` (13 scenarios); `npm run test:edith-contracts` (7 checks); `npm run test:edith-contracts-v2-1` (14 checks); `npm run test:edith-backend-security` (20 checks); `npm run test:edith-kill-switch` (6 scenarios); `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`; `cargo test --manifest-path src-tauri/Cargo.toml --lib` (7 tests); `cargo check --release --manifest-path src-tauri/Cargo.toml`; Tauri dev process launch/shutdown smoke

KNOWN_LIMITATIONS: UIA/OCR absent; native overlay/capsule absent; semantic application-state verification absent; no automatic side-effect retry; process-local idempotency/event cursor state; no tray/background or remote view

EXTERNAL_BLOCKERS: Windows UIA fixture, OCR provider decision, physical mixed-DPI multi-monitor machine, user-approved Tauri runtime smoke

DOWNSTREAM_DEPENDENCIES: Integration QA, frontend status consumer

NEXT_OWNER: Integration QA for a user-approved native fixture smoke; UI owner for the supplied JARVIS visual reference; Chat 6 only after an explicit UIA/OCR/native-overlay phase is approved

DO_NOT_TOUCH: `crypto/`, `Mark-L-main/`, provider logic, mobile implementation, frozen `src/edith/contracts.ts` without owner acknowledgement

NOTES_FOR_NEXT_AGENT: Preserve the process-secret bridge and fail-closed behavior. Do not convert window-relative fallback into a ready UIA claim. Do not retry a dispatched side effect without a new observation and approval.

## CROSS_CHAT_REQUEST - ACKNOWLEDGED

CROSS_CHAT_REQUEST: Canonical native operator contract extension

FROM_OWNER: Chat 6 Desktop Native

TO_OWNER: edith-shared-contracts-owner

REASON: Phase 1 contracts do not yet define native observation, target, dispatch, verification, stop epoch, or retry records.

REQUESTED_CHANGE: Add runtime-validated, additive V2 types for `DesktopObservation`, `SemanticTarget`, `DesktopActionPlan`, `DesktopActionStep`, `ActionDispatchResult`, `ActionVerificationResult`, and `OperatorSessionState`.

FILES_OR_CONTRACTS: `src/edith/contracts.ts`, generated/native adapter fixtures, realtime event names if owner accepts them

STATUS: **ACKNOWLEDGED AND CONSUMED.** Chat 4 supplied the additive V2.1 desktop contracts and validators. Chat 6 implemented only the adapter/event producer boundary; the frozen canonical contract file was not edited.

BLOCKING: UIA-first target resolver, native capsule renderer, persistent cross-process replay protection, deterministic multi-step progress

ACCEPTANCE_EVIDENCE: TS and Rust fixtures reject stale observation, moved/foreground-mismatched target, expired approval, unbounded retry, kill-switch interruption, and secret-bearing events; both adapters consume one canonical schema version.
