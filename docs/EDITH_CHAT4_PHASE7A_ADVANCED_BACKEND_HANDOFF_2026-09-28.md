# E.D.I.T.H. Chat 4 Phase 7A Advanced Backend Handoff

Date: 2026-09-28

OWNER: Chat 4 Backend / Shared Contracts / Runtime

STATUS: PARTIAL. The backend control plane and strict additive contracts are implemented. Native execution, durable advanced-state persistence, scheduler delivery, and UI consumption remain explicitly unconnected.

## Changed Files

- `src/edith/contracts.ts`
- `src/edith/killSwitch.ts`
- `src/edith/taskQueueService.ts`
- `server/advanced/priorityRegistry.ts`
- `server/advanced/runtime.ts`
- `server/routes/advancedExperience.ts`
- `server/routes/killSwitch.ts`
- `server.ts`
- `scripts/test-edith-phase7a-advanced-contracts.ts`
- `scripts/test-edith-phase7a-advanced-backend.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json`

No crypto, Mark-L, Tauri, Android, React UI, provider, or knowledge-producer implementation was changed.

## Contracts

Additive V2.1 DTOs and strict parsers now cover priority policy, Shadow Mode, Ghost Tasks, Mission Memory, visual bookmarks, recent context, workspace snapshots/restores, scenes, watchers, structured comparisons, communication policy, orchestration, retry, download truth, power/presence, history retention, and deterministic capsule selection.

All mutable records carry owner binding, workspace, revision, creation/update timestamps and optional expiry. Parsers reject unknown fields, prototype/secret material, private or absolute paths, raw capture fields, unbounded retries, unsafe scene/restore claims, hidden-reasoning style text fields, and inconsistent derived values. Existing TaskV2, SharedResultCardV2, CapsulePresentationV2, and mobile contracts were not renamed or replaced.

## Runtime And API

The advanced runtime is process-memory only and bounded to 256 records per resource kind. It enforces initial revision 1, exact N+1 updates, stable createdAt, increasing updatedAt, owner/workspace isolation, expiry cleanup, verified task evidence for Mission Memory, verified research/playbook evidence when those IDs are present, and configuration-required truth for native restore/scene activation.

Owner endpoints:

- `GET /api/edith/advanced/status`
- `GET /api/edith/advanced/state?workspaceId=...`
- `GET /api/edith/advanced/history/search?workspaceId=...&q=...`
- `PUT /api/edith/advanced/:resource`
- `POST /api/edith/advanced/ghosts/:ghostTaskId/pause`
- `POST /api/edith/advanced/ghosts/:ghostTaskId/cancel`
- `POST /api/edith/advanced/watchers/:watcherId/cancel`
- `POST /api/edith/advanced/capsule/select`

All reads require an owner session. All mutations require owner session, exact trusted origin and CSRF. Client-supplied power/presence and download producer records are rejected with `TRUSTED_NATIVE_PRODUCER_CONFIGURATION_REQUIRED` until a trusted producer is connected.

Mobile endpoint:

- `GET /api/mobile/advanced/state`

It requires secure transport and device authentication, returns an encrypted response bound to the paired owner/workspace, exposes only priority/ghost/watcher/download/communication/capsule projections, and offers no mutation.

## Scheduling And Revocation

`TaskQueueService.next()` now honors installed Phase 7 priority policies, incomplete dependencies, security-critical ordering, deadlines, and FIFO fallback. A running atomic or security-critical task is not preempted. Text such as "urgent" never creates a Phase 7 priority policy.

Owner logout/rotation invalidates all advanced records for that owner. A central kill-switch activation listener cancels/reverts active advanced records regardless of whether activation came from the owner route, trusted mobile emergency stop, or Computer Use stop. Existing task execution cancellation limitations remain listed below.

The legacy `schedule_reminder` branch no longer reports fake success. Without a verified scheduler it returns HTTP 428 and `REMINDER_SCHEDULER_CONFIGURATION_REQUIRED`. Existing proactive settings/signals/check mutations are now owner-session protected; mutations also require origin and CSRF.

## Master 90-122 Status Matrix

| Section | Capability | Schema | Backend runtime | Persistence | Native | UI |
|---|---|---|---|---|---|---|
| 90 | Priority | DONE | DONE for queue selection | RAM policy; tasks durable | N/A | NOT CONNECTED |
| 91 | Shadow Mode | DONE | Metadata policy only | RAM | NOT CONNECTED | NOT CONNECTED |
| 92 | Ghost Tasks | DONE | Pause/cancel projection | RAM + existing task store | NOT CONNECTED | NOT CONNECTED |
| 93 | Mission Memory | DONE | Verified evidence only | RAM | N/A | NOT CONNECTED |
| 94 | Visual Bookmark | DONE | Safe metadata/opaque handle | RAM | NOT CONNECTED | NOT CONNECTED |
| 95 | Recent Context | DONE | Expiring owner/workspace history | RAM | N/A | NOT CONNECTED |
| 96 | Snapshot/Restore | DONE | Plan only, configuration required | RAM | NOT CONNECTED | NOT CONNECTED |
| 97 | Scenes | DONE | Reversible plan only | RAM | NOT CONNECTED | NOT CONNECTED |
| 98 | Game Butler | PARTIAL via scene/download DTOs | configuration required | RAM | NOT CONNECTED | NOT CONNECTED |
| 99 | Presentation | PARTIAL via scene DTO | security notifications preserved | RAM | NOT CONNECTED | NOT CONNECTED |
| 100 | Watcher | DONE | Event metadata/cancel/expiry | RAM | Delivery NOT CONNECTED | NOT CONNECTED |
| 101 | Compare | DONE | Provenance-bearing storage | RAM | N/A | NOT CONNECTED |
| 102 | Brief | PARTIAL via communication policy | policy only | RAM | N/A | NOT CONNECTED |
| 103 | Silence | DONE policy | policy only | RAM | N/A | NOT CONNECTED |
| 104 | Voice Presence | DONE policy | policy only | RAM | Audio NOT CONNECTED | NOT CONNECTED |
| 105 | One-command Workspace | DONE plan | verified references, no shell | RAM | NOT CONNECTED | NOT CONNECTED |
| 106 | Outcome Mode | DONE plan | cannot client-claim completion | RAM | N/A | NOT CONNECTED |
| 107 | Self Repair | DONE retry plan | bounded metadata only | RAM | NOT CONNECTED | NOT CONNECTED |
| 108 | Download Butler | DONE truthful DTO | trusted producer required | RAM | NOT CONNECTED | NOT CONNECTED |
| 109 | Battery | DONE truthful DTO | trusted producer required | RAM | NOT CONNECTED | NOT CONNECTED |
| 110 | Presence | DONE no-camera DTO | trusted producer required | RAM | NOT CONNECTED | NOT CONNECTED |
| 111 | Cross-device IDs | Reuses frozen lineage | owner/workspace/device scoped read | RAM | N/A | Mobile read available |
| 112 | Summary | DONE policy | actual-state-only | RAM | N/A | NOT CONNECTED |
| 113 | Retry | DONE | max 2, reobserve/permission stop | RAM | NOT CONNECTED | NOT CONNECTED |
| 114 | History | DONE | retention/private/purge filters | RAM | N/A | NOT CONNECTED |
| 115 | Cards | Reuses SharedResultCardV2 | unchanged | existing Phase 6 semantics | existing | existing |
| 116 | Audio Handoff | Reuses frozen Phase 6 contract | unchanged | RAM | existing partial | existing partial |
| 117 | Quiet Hours | Reuses frozen Phase 6 contract | unchanged | RAM | existing partial | existing partial |
| 118 | KG Suggestions | NOT IMPLEMENTED here | owned by Chat 5 | existing | N/A | NOT CONNECTED |
| 119 | Marketplace | NOT IMPLEMENTED | configuration required | none | N/A | NOT CONNECTED |
| 120 | Sandbox | No false isolation claim | configuration required | none | NOT CONNECTED | NOT CONNECTED |
| 121 | Mini HUD | Capsule selection only | projection available | RAM | N/A | NOT CONNECTED |
| 122 | Capsule Priority | DONE | deterministic 1-5 selection | RAM | N/A | NOT CONNECTED |

## Tests

New aliases:

- `npm run test:edith-phase7a-contracts`
- `npm run test:edith-phase7a-backend`

The suites cover strict fields, secret/path/raw-data rejection, retry bounds, no-camera presence, deterministic capsule priority, owner/workspace isolation, revision conflicts, verified Mission Memory, native configuration-required behavior, watcher expiry, owner revocation, dependency-aware priority scheduling, and memory-only truth.

Backend security regression now covers advanced/proactive owner, origin and CSRF boundaries plus unauthenticated mobile advanced reads.

## Known Risks

- Advanced records intentionally disappear on restart. API status says `persistence: memory_only` and `restartRecovery: partial`; no durable recovery is claimed.
- Existing Task persistence does not provide database-level compare-and-swap across every task mutation. Advanced records enforce N+1 internally, but TaskV2 concurrent mutation remains a separate architecture risk.
- Existing task status routes can still set terminal states outside a single global transition state machine. Mission Memory protects itself by requiring persisted verification PASS; this phase did not redesign TaskV2 lifecycle.
- Existing executor work is not centrally aborted mid-tool when kill switch activates. Phase 7 advanced records are revoked, but long-running legacy execution needs a later AbortController integration.
- Watchers are metadata registrations only. No OS event source or push scheduler is connected.
- Native restore, scene activation, Steam/game, presentation control, download telemetry, battery and presence producers remain configuration required.
- Mobile receives a safe read projection only; no new remote mutation command was added.

## Downstream Coordination

Chat 5: use verified task/playbook/research evidence; do not promote indexed Obsidian text into Mission Memory as verified fact. Knowledge relationship suggestions remain Chat 5 ownership.

Chat 6: connect trusted-native download/power/presence and reversible scene/restore adapters. Supply canonical DTOs through a producer-authenticated endpoint; do not reuse the owner generic PUT route.

Chat 2: consume owner status/state and render `memory_only`, `partial`, and `configuration_required` literally. Do not show native actions as ready. Use the mobile safe projection only for read-only status.

Mobile owner: no new command allowlist entry exists. A future mutation phase requires frozen command DTOs, device-scoped authorization, sequence/replay checks, and QA before enablement.

Chat 8: verify restart loss is reported honestly, all mutation auth negatives, queue dependency/priority ordering, kill activation through owner/mobile/Computer Use paths, no client completion claims, and no secrets/paths/raw pixels/audio in advanced payloads.
