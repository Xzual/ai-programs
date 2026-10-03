# E.D.I.T.H. Chat 2 Phase 7F Advanced UI Handoff

Date: 2026-09-28  
Owner: Chat 2 Frontend / Android consumer team  
Status: Implemented and verified within the desktop and Android consumer scope.

## Scope Delivered

- Desktop React consumption of the authoritative Phase 7 advanced state.
- Truthful capability/status summaries in Tasks, System, and the dynamic task capsule.
- Owner-authorized priority, Ghost pause/cancel, watcher cancel, and private-history search requests.
- Browser-disabled native Shadow, restore, Game, and Presentation controls.
- Android encrypted, read-only `/api/mobile/advanced/state` consumption without expanding the mobile mutation allowlist.
- Responsive browser fixtures and screenshots at mobile, tablet, laptop, and desktop widths.

No backend route, backend provider, crypto, Mark-L, Tauri source, or frozen `src/edith/contracts.ts` implementation was changed by Phase 7F.

## Desktop Behavior

The shared `AdvancedExperienceProvider` resolves the active workspace, polls one authoritative state snapshot every 15 seconds, and clears its retained UI state on the owner-logout event. Every resource is parsed through the frozen Phase 7 contract parsers before it is rendered.

The Tasks screen now exposes:

- Priority policy with dependency, atomic-operation, and security-critical context preserved.
- Ghost task metadata with partial/configuration-required state shown literally.
- Mission-memory provenance and a mandatory current-state re-verification warning.
- Outcome orchestration steps and verified downstream result counts without client-authored completion.
- Visual bookmark screenshot policy and sensitive-app denial status without exposing pixels or private paths.
- Metadata snapshots, restore-plan status, reversible scenes, and immutable security-notification truth.
- Watcher status/cancellation and event-based expiry metadata.
- Download byte progress, measured speed, and ETA only when `etaTrustworthy` is true.
- Fresh trusted-native power/presence data; camera presence is explicitly excluded.
- Communication policy using actual state only.
- Compare provenance, retry policy, private/purged history search, and Shadow metadata.

Restore, Game, and Presentation controls are visibly disabled until native capability and owner approval exist. Shadow controls are disabled in the browser and require both a Tauri capability report and an existing server-bound Shadow record. A native result is presented separately from canonical server state.

The System screen shows literal `memory_only`, `restartRecovery: partial`, native, and watcher capability states. The task capsule only shows fresh server-selected deterministic context.

## Desktop API Consumption

- `GET /api/workspace/status`
- `GET /api/edith/advanced/state?workspaceId=...`
- `GET /api/edith/advanced/history/search?workspaceId=...&q=...`
- `PUT /api/edith/advanced/priority?workspaceId=...`
- `POST /api/edith/advanced/ghosts/:ghostTaskId/pause?workspaceId=...`
- `POST /api/edith/advanced/ghosts/:ghostTaskId/cancel?workspaceId=...`
- `POST /api/edith/advanced/watchers/:watcherId/cancel?workspaceId=...`

Mutations use the existing owner-session and CSRF client. The UI never stores or renders secrets and does not create verified/completed outcomes.

## Android Read-Only Projection

Android adds strict serializable DTOs for the safe mobile projection and fetches `/api/mobile/advanced/state` with the existing device-authenticated AES-GCM envelope, replay protection, and owner/workspace lineage checks.

The mobile surface displays:

- Literal memory-only/partial-restart status and `mutationAvailable: false`.
- Priority metadata.
- Ghost partial metadata without native execution claims.
- Watchers and download telemetry.
- Communication policy.
- Only fresh capsule/download context.

There are no Android mutation controls and no advanced mutation command was added to the mobile allowlist. Logout, authority expiry, envelope verification failure, replay/lineage failure, and local wipe clear the advanced projection from memory.

## Files Changed

- `src/App.tsx`
- `src/edith/advancedExperienceClient.ts`
- `src/components/advanced/AdvancedExperiencePanels.tsx`
- `src/components/tasks/DynamicTaskCapsule.tsx`
- `src/components/ui/edithOS.tsx`
- `mobile/app/src/main/java/com/edith/mobile/contracts/AdvancedMobileContracts.kt`
- `mobile/app/src/main/java/com/edith/mobile/data/CrossDeviceClient.kt`
- `mobile/app/src/main/java/com/edith/mobile/data/MobileRepository.kt`
- `mobile/app/src/main/java/com/edith/mobile/domain/MobileState.kt`
- `mobile/app/src/main/java/com/edith/mobile/ui/EdithViewModel.kt`
- `mobile/app/src/main/java/com/edith/mobile/ui/EdithMobileApp.kt`
- `mobile/app/src/test/java/com/edith/mobile/CrossDeviceContractTest.kt`
- `scripts/test-edith-phase7f-advanced-ui.ts`
- `scripts/test-edith-phase7f-ui.mjs`
- `package.json`

## Verification

Passed:

- `npm run lint`
- `npm run build`
- `npm run test:edith-phase7f-ui` - 12 assertions
- `npm run test:edith-phase7f-browser` - 4 viewports, no horizontal overflow or page errors
- `node scripts/test-edith-phase3-ui.mjs` - desktop/mobile/offline compatibility smoke
- Phase 7A contracts/backend, Phase 7B producers, Phase 7D producer/native-publication suites
- Phase 6 cross-device, 6D, 6E, 6F, and 6G suites
- `npx tsx scripts/test-edith-phase3-task-ui.ts`
- Android `testDebugUnitTest lintDebug assembleDebug assembleRelease --no-daemon --rerun-tasks` - 49 JVM tests, 0 failures, lint/build success
- Android `connectedDebugAndroidTest --no-daemon` on Pixel 8 Pro Android 14/API 34 - 4/4 tests, 0 failures

The web production build retains the existing Vite warning that the main JavaScript chunk is larger than 500 kB. This is a performance follow-up, not a correctness failure.

## Browser Evidence

- `artifacts/phase7f-advanced-ui/advanced-mobile.png` (`390x844`)
- `artifacts/phase7f-advanced-ui/advanced-tablet.png` (`768x1024`)
- `artifacts/phase7f-advanced-ui/advanced-laptop.png` (`1366x768`)
- `artifacts/phase7f-advanced-ui/advanced-desktop.png` (`1920x1080`)

The browser fixture intentionally leaves unrelated services at HTTP 503. Those expected network messages are excluded from the major-error assertion; React page errors remain zero.

## Honest Limitations / Follow-Up

- Advanced backend persistence remains `memory_only`; restart recovery is only `partial`.
- Scheduler, watcher observation/delivery, and native execution remain configuration-required unless the authoritative capability response says otherwise.
- Browser mode cannot execute native Shadow, restore, Game, or Presentation actions.
- The desktop UI consumes existing owner mutations only; it does not add snapshot capture, restore execution, scene activation, bookmark capture, or communication-policy mutation endpoints.
- Android is intentionally read-only for Phase 7F.
- Android runtime was verified on API 34 only. API 33 and API 35 emulator images are not installed and are not claimed as tested.
- Full end-to-end mutation evidence still requires a configured owner session, CSRF cookie, native capability, and the real backend/runtime services.
