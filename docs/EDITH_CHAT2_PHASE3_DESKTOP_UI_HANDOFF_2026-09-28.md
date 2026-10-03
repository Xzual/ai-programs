# E.D.I.T.H. Chat 2 Phase 3 Desktop UI Handoff

Date: 2026-09-28

## Outcome

The React desktop surface now consumes the canonical V2 task envelope from `GET /api/edith/tasks` and task activity from `GET /api/edith/tasks/:id/activity`. A persistent in-app Dynamic Capsule presents the displayed task selected from backend response order, structured progress, priority, current structured plan step, revision, verification state, and latest typed event. It does not call that selection authoritative because the backend does not advertise focus/queue position. It expands in place and opens a portal-based Mission View.

No progress is inferred from human-readable strings. Malformed, legacy-only, secret-bearing, mismatched, or unsupported task payloads fail into an explicit error state. HTTP 502/503/504 and network failures render an offline state; empty task lists render an idle state; background refresh is labeled as reconnecting.

## UI behavior

- Compact capsule: displayed V2 task title, canonical status, structured current step or latest typed event, and contract-derived percent.
- Expanded capsule: structured progress sources, revision, priority, verification, last check time, and a route to the Tasks screen.
- Mission View: real task queue records, plan steps, typed activity events, runtime truth panel, and responsive three-column/stacked layout.
- Tasks screen: replaced the former chat/log-derived illustrative timeline with the same V2 task/activity source.
- Controls: pause, resume, retry, and cancel remain disabled because the current response does not advertise V2 action capabilities. A visible explanation is provided.
- Runtime truth: native overlay, voice, browser, computer-use, research, and transfer are not presented as active when the task response does not advertise them.
- Accessibility: semantic dialog, labelled controls, initial focus, Escape close, Tab focus loop, inert/hidden background, focus restoration, body scroll lock, visible focus styles, and reduced-motion handling.
- Parser hardening: UI-critical priority/plan shape, task-progress status/terminal consistency, and event sequence/revision bounds are rejected before render.
- Request discipline: the persistent capsule is hidden on the Tasks route, so only one polling surface is active at a time.

## HANDOFF

OWNER: Chat 2 Frontend / Desktop UI

SCOPE: Typed V2 task/activity frontend adapter, Dynamic Capsule compact/expanded modes, in-app Mission View, Tasks screen integration, responsive/accessibility states, frontend tests and screenshots

STATUS: COMPLETE for the current read-only V2 task/activity contract; PARTIAL for action controls and native overlay because those capabilities are not exposed by the backend/native contracts

COMMITS: None

FILES_CHANGED: `src/edith/taskActivityClient.ts`, `src/components/tasks/DynamicTaskCapsule.tsx`, `src/App.tsx`, `src/components/ui/edithOS.tsx`, `src/index.css`, `scripts/test-edith-phase3-task-ui.ts`, `scripts/test-edith-phase3-ui.mjs`, `.cursor/agents/edith-phase3-ui-auditor.md`, `docs/EDITH_CHAT2_PHASE3_DESKTOP_UI_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED: None. Frozen `src/edith/contracts.ts` was consumed without modification.

APIS_CONSUMED: `GET /api/edith/tasks`; `GET /api/edith/tasks/:id/activity`

APIS_CHANGED: None

TESTS_PASS: `npm run lint`; `npm run build`; `npx tsx scripts/test-edith-phase3-task-ui.ts`; `EDITH_UI_URL=http://127.0.0.1:5173 node scripts/test-edith-phase3-ui.mjs`

VISUAL_EVIDENCE: `artifacts/phase3-desktop-ui/capsule-desktop.png`, `mission-desktop.png`, `capsule-mobile.png`, `mission-mobile.png`, `capsule-offline-tablet.png`

KNOWN_LIMITATIONS: Task updates use 12-second polling because no task realtime consumer endpoint was provided; server queue position is not included in the V2 task list; quick actions are not advertised by current API responses; native always-on-top overlay is absent; voice/browser/computer/research/transfer runtime states are not part of the task response; no Android/mobile client behavior is claimed

EXTERNAL_BLOCKERS: Additive capsule/mission presentation delivery, action capability advertisement with safe dispatch mapping, canonical realtime task stream ownership, native overlay implementation and capability signal

DOWNSTREAM_DEPENDENCIES: Backend task owner for action capability payloads; shared-contract owner for additive presentation/action dispatch contract; Chat 6/native owner for any future always-on-top overlay; Integration QA for live backend and packaged desktop validation

NEXT_OWNER: Integration QA can validate read-only task presentation now. Shared-contract/backend task owners are needed before enabling mutations.

DO_NOT_TOUCH: `src/edith/contracts.ts`, backend/security/provider logic, `crypto/`, `Mark-L-main/`, Rust/native implementation, `package.json`

NOTES_FOR_NEXT_AGENT: Keep UI actions disabled unless an explicit, runtime-validated capability says the exact action is enabled. Do not derive progress or actions from task status text. Preserve the `In-app` and native-overlay-unavailable labels until Chat 6 supplies a verified capability.

## CROSS_CHAT_REQUEST

CROSS_CHAT_REQUEST: Additive task presentation and action capability delivery

FROM_OWNER: Chat 2 Frontend / Desktop UI

TO_OWNER: edith-shared-contracts-owner and backend task owner

REASON: Frozen V2 types define `CapsulePresentationV2`, `MissionPresentationV2`, and `CapsuleQuickActionV2`, but current task endpoints do not deliver those presentation records or a safe dispatch mapping for advertised actions.

REQUESTED_CHANGE: Add a backward-compatible V2 endpoint or additive envelope fields that return validated capsule/mission presentation records for task IDs, including enabled/disabled quick actions. Define a canonical action-dispatch descriptor or endpoint mapping with owner-session/CSRF requirements, approval requirements, idempotency/correlation IDs, and explicit error codes. Provide a realtime task/presentation stream only if replay/cursor semantics use the existing frozen realtime contract.

FILES_OR_CONTRACTS: Owner-controlled additive contract amendment, task route response adapters, runtime fixtures; do not ask the frontend to infer capabilities from status

BLOCKING: Enabling pause/resume/retry/cancel controls, showing authoritative queue position, consuming server-selected focus/visibility/fullscreen state, and replacing polling with realtime updates

ACCEPTANCE_EVIDENCE: Fixtures demonstrate that enabled actions have an exact safe dispatch target, disabled actions include a reason, approval-required actions fail closed without owner approval, unknown actions are rejected, stale revision/idempotency replay is rejected, and the frontend parser can consume the additive response without legacy guessing.
