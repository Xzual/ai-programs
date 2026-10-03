# E.D.I.T.H. Phase 6A Cross-device Contracts and Backend Handoff

Date: 2026-09-28

OWNER: Chat 4 Shared Contracts / Backend Runtime

SCOPE: Additive canonical cross-device V2.1 contracts, strict parsers, authenticated backend orchestration, owner-session lifecycle invalidation, encrypted transient payload stores, realtime filtering, endpoint security, and regression evidence.

STATUS: Backend foundation COMPLETE and verified. End-to-end Phase 6 product capability is PARTIAL. Native desktop adapters, Android consumers, physical-device interoperability, and knowledge/artifact producers remain external work. Live View, Wake-on-LAN, PC-to-mobile bytes, and PC telemetry remain honestly `configuration_required`.

COMMITS: None. Work remains in the shared dirty workspace; unrelated owner changes were preserved.

FILES_CHANGED:

- `src/edith/contracts.ts`
- `server/security/ownerSession.ts`
- `server/mobile/crossDeviceService.ts`
- `server/mobile/runtime.ts`
- `server/mobile/pairingService.ts`
- `server/mobile/realtime.ts`
- `server/mobile/registryStore.ts`
- `server/mobile/transferService.ts`
- `server/mobile/types.ts`
- `server/routes/mobileCrossDevice.ts`
- `server/routes/mobilePairing.ts`
- `server/routes/mobileTasks.ts`
- `server/routes/mobileTransfers.ts`
- `server.ts`
- `scripts/test-edith-cross-device-phase6.ts`
- `scripts/test-edith-mobile-backend.ts`
- `scripts/test-edith-mobile-contract-reconciliation.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json`
- `docs/EDITH_CHAT4_PHASE6A_CROSS_DEVICE_BACKEND_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED:

- Added strict `CrossDeviceLineageV2` and exact-key parsers for transfer, clipboard, live-view session/frame metadata, wake-ready result, offline queue metadata, smart handoff, shared result cards/artifacts, audio handoff, PC status, and quiet hours.
- Every operational cross-device record binds owner session, workspace, device/session lineage and rejects recursive secret fields; quiet-hours policy binds owner session and workspace. Nested policy, preview, artifact, command, metric, overlay, and destination objects reject unknown fields.
- File transfer carries real byte progress, checksum/integrity, resume state, opaque destination handles, explicit collision/no-overwrite policy, candidate evidence, expiry, and honest action capabilities.
- Clipboard requires explicit consent, `persistHistory:false`, bounded MIME/size/TTL, value-based secret detection, one-time consume, and secrets-free metadata.
- Live View is control-plane only. `CrossDeviceLiveViewFrameMetadataV2` is pixels-free, bounded to 5 FPS policy and 1920x1080, and supports normalized cursor/click/target/operator overlays without control authority.
- Offline queue metadata omits payload and sequence. Payloads are process-memory AES-256-GCM encrypted; exact-next sequence is assigned at reconnect dispatch. Emergency Stop cannot be queued.
- `SharedResultCardV2` is the portable canonical card. Legacy Phase 3 `ResultCardV2` remains unchanged and uses explicit adapters. `SharedArtifactRefV2` adds MIME/checksum/provenance/retention/owner/download-handle evidence without altering `src/edith/core.ts`.
- Quiet hours now has owner binding and monotonic revision. Audio leases optionally bind the active quiet-hours revision and prohibit simultaneous capture.
- Added strict cross-device realtime event names and payload dispatch for all Phase 6 metadata families.

APIS_ADDED_OR_CHANGED:

- `GET /api/mobile/cross-device/capabilities`
- `POST /api/mobile/cross-device/clipboard`
- `POST /api/mobile/cross-device/clipboard/:clipboardId/consume`
- `POST /api/mobile/cross-device/offline-queue`
- `POST /api/mobile/cross-device/offline-queue/:queueItemId/cancel`
- `POST /api/mobile/cross-device/offline-queue/dispatch`
- `POST /api/mobile/cross-device/offline-queue/:queueItemId/result`
- `POST /api/mobile/cross-device/handoffs`
- `POST /api/mobile/cross-device/handoffs/:handoffId/ack`
- `GET /api/mobile/cross-device/result-cards`
- `POST /api/mobile/cross-device/audio-handoffs`
- `POST /api/mobile/cross-device/audio-handoffs/:handoffId/ack`
- `POST /api/mobile/cross-device/audio-handoffs/:handoffId/release`
- `GET /api/mobile/cross-device/pc-status`
- `GET /api/edith/mobile/cross-device/status`
- Owner-protected Live View request/approve/stop, honest WOL request, PC-to-mobile transfer intent, desktop-to-mobile handoff, result-card publish, and quiet-hours GET/PUT routes under `/api/edith/mobile/cross-device/*`.
- Existing `/api/mobile/transfers` now returns and publishes a canonical cross-device view derived from actual acknowledged bytes/checksums.
- Server capability metadata distinguishes available backend orchestration from missing native adapters. Unsupported Phase 6 commands are removed from pairing approval even if requested.
- Owner session logout, login rotation, and observed expiry publish an opaque lifecycle event. Mobile credentials/crypto sessions, realtime sockets, clipboard payloads, queue items, live-view state, audio leases, transfers, and status authority are invalidated by owner binding.

SECURITY_AND_STORAGE:

- Device mutations retain Device authentication, AES-GCM envelopes, exact-next command sequence, allowlist, expiry, idempotency, kill switch, workspace/device/session checks, and bounded responses.
- Owner mutations retain owner cookie, same-origin, and CSRF protection.
- Clipboard and queued command payloads are encrypted with an ephemeral process key and never persisted. Frame pixels and voice audio are never accepted or stored.
- Mobile registry no longer stores `internalDirectory` or another private filesystem path. Legacy path fields are stripped during normalization.
- Completed mobile-to-PC payload remains in the private opaque inbox as the intended transferred artifact; registry metadata contains only its opaque handle and checksum.
- Realtime histories remain per-device, allowlist filtered, maximum 500 events, and memory-only. Open sockets revalidate credential/trust/owner expiry before messages and sends.

TESTS_PASS:

- `npm run lint`
- `npm run build`
- `npm run test:edith-contracts-v2-1`
- `npm run test:edith-mobile-backend`
- `npm run test:edith-mobile-contract-reconciliation`
- `npm run test:edith-backend-security`
- `npm run test:edith-cross-device-phase6`

The Phase 6 suite proves strict/secret rejection, lineage mismatch, transfer traversal/collision/no-overwrite and byte progress, clipboard TTL/no-persist/one-time consume, no-auto-stream, honest WOL, encrypted queue/idempotency/cancel/reconnect/verified result/emergency exclusion, handoff identity/target ACK, result-card redaction/provenance/revision/adapters, audio single lease/epoch/quiet-hours, stale PC status rejection, strict realtime payloads, and real owner logout invalidation. The mobile backend suite additionally proves a real encrypted Express clipboard endpoint and owner-binding credential revocation.

KNOWN_LIMITATIONS:

- PC-to-mobile byte execution is `configuration_required`; only validated intent/control metadata exists.
- Live View does not capture, encode, or stream frames. Owner approval produces `configuration_required`; no continuous auto-stream or control authority exists.
- Wake-on-LAN never sends a packet and returns HTTP 428 plus `WAKE_ON_LAN_CONFIGURATION_REQUIRED`.
- PC status has no public producer route. A future trusted native adapter must call the internal validator; mobile clients cannot submit PC telemetry.
- Offline reconnect dispatch returns freshly sequenced commands and accepts identity-bound results, but task/native executors must consume the dispatch and report the verified result.
- Cross-device orchestrator payloads, result cards, handoffs, queue state, leases, PC status, and realtime history are memory-only. Backend restart discards them explicitly.
- Completed mobile-to-PC inbox artifacts do not yet have an automatic retention cleanup job. They are bounded to 25 MiB per transfer and opaque inbox destinations, but release policy still needs an owner/native cleanup adapter.
- Push provider/registration is absent. Quiet hours is policy metadata only and does not claim notification delivery.
- API 33/35, physical-device, adverse-network, process-death, and full desktop-native/Android interoperability tests remain pending.

EXTERNAL_BLOCKERS: Chat 6 native adapters are required for frame capture/encoding, trusted PC telemetry, destination picker/open-location/export, WOL, and PC-to-mobile byte sources. Chat 2 must consume the new contracts and encrypted routes. Chat 5 must emit verified artifact/provenance/result-card records from research and knowledge flows.

DOWNSTREAM_DEPENDENCIES: Chat 6 Desktop Native, Chat 2 Android Mobile Client, Chat 5 Knowledge/Artifact producers, then independent security and release QA.

NEXT_OWNER: Chat 6 Desktop Native and Chat 2 Android Mobile Client in parallel; Chat 5 for artifact/provenance integration.

DO_NOT_TOUCH: Crypto trading, Mark-L-main, provider secrets, desktop React UI, Android source, Tauri code, or real computer/browser/device actions from this backend handoff.

NOTES_FOR_NEXT_AGENT: Treat `src/edith/contracts.ts` as canonical. Do not copy enums. Keep unavailable native capabilities `configuration_required`; never turn metadata acknowledgement into execution success. Preserve opaque handles and never place private paths, clipboard plaintext, frame pixels, audio, credentials, or queued payloads in logs/registry.

## Cross-chat handoff: Chat 6

CROSS_CHAT_REQUEST:

FROM_OWNER: Chat 4 Shared Contracts / Backend Runtime

TO_OWNER: Chat 6 Desktop Native

REASON: Phase 6A backend now has strict control-plane contracts but deliberately has no native execution adapters.

REQUESTED_CHANGE: Implement native adapters for explicitly approved low-FPS frame capture/encode, trusted PC-status observations, approved destination handles and open/export/open-location actions, WOL attempt receipts, PC-to-mobile byte sources, and artifact retention cleanup. Do not grant remote control authority or continuous auto-stream. Emit only canonical metadata and verified attempt/result evidence.

FILES_OR_CONTRACTS: `CrossDeviceLiveViewSessionV2`, `CrossDeviceLiveViewFrameMetadataV2`, `CrossDeviceWakeReadyV2`, `CrossDevicePcStatusV2`, `CrossDeviceTransferV2`, and `/api/edith/mobile/cross-device/*`.

BLOCKING: Yes for real Live View, Wake & Ready, PC telemetry, PC-to-mobile bytes, destination actions, and retention cleanup.

ACCEPTANCE_EVIDENCE: Native unit/integration tests; owner approval/start/stop/expiry/logout; no auto-stream; frame bounds/FPS/pixels outside metadata; honest WOL unsupported/attempt/result; fresh measured PC metrics; opaque destination/no-overwrite; checksum/resume; cleanup and no private path logging.

## Cross-chat handoff: Chat 2

CROSS_CHAT_REQUEST:

FROM_OWNER: Chat 4 Shared Contracts / Backend Runtime

TO_OWNER: Chat 2 Android Mobile Client

REASON: Canonical Phase 6A contracts, encrypted routes, capability truth, and negative fixtures are ready for Android consumption.

REQUESTED_CHANGE: Consume canonical types without copied enums; implement explicit clipboard offer/consume UI, mobile-to-PC transfer progress, offline queue/cancel/reconnect/result, desktop-to-mobile handoff acknowledgement, portable result cards, audio lease handoff, quiet-hours metadata, and honest configuration-required states. Keep Emergency Stop outside the queue and never display metadata acknowledgement as delivery/execution success.

FILES_OR_CONTRACTS: `src/edith/contracts.ts`, `/api/mobile/cross-device/*`, cross-device realtime events, and `scripts/test-edith-cross-device-phase6.ts` fixtures.

BLOCKING: Yes for Phase 6 Android UX and end-to-end interoperability; no backend contract blocker remains.

ACCEPTANCE_EVIDENCE: API 33/34/35 and physical-device tests; envelope replay/gap; clipboard secret/TTL/no-history; transfer resume/checksum/no-overwrite; offline cancel/reconnect/emergency exclusion; handoff identity; result-card redaction; audio single capture; logout/expiry/revoke; configuration-required honesty.

## Cross-chat handoff: Chat 5

CROSS_CHAT_REQUEST:

FROM_OWNER: Chat 4 Shared Contracts / Backend Runtime

TO_OWNER: Chat 5 Knowledge / Artifact Producers

REASON: Portable result cards and artifact references now require verified provenance, retention, ownership, redaction, and optional checksum/download handles.

REQUESTED_CHANGE: Adapt research, file, screenshot, download, task, and error-attention producers to emit `SharedResultCardV2` plus `SharedArtifactRefV2`. Keep legacy Phase 3 `ResultCardV2` consumers on the provided adapter. Do not invent checksums, verification, provenance, download handles, or action availability.

FILES_OR_CONTRACTS: `SharedResultCardV2`, `SharedArtifactRefV2`, `adaptLegacyResultCardToSharedV2`, `adaptSharedResultCardToLegacyV2`, and the owner-protected result-card publish route.

BLOCKING: Yes for real research/knowledge/artifact cards; no UI migration is required before producer integration.

ACCEPTANCE_EVIDENCE: Producer tests for verified/unavailable checksum, provenance source, redacted preview, revision monotonicity, owner/workspace lineage, retention, opaque download handle, action truth, and lossless legacy display adapter behavior.
