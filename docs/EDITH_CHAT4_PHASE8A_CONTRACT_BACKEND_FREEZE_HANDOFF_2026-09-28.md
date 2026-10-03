# E.D.I.T.H. Chat 4 Phase 8A Contract / Backend Freeze Handoff

Date: 2026-09-28

OWNER: Chat 4 Backend / Shared Contract Integration

SCOPE: Phase 1-7 canonical contract reconciliation, backend route and runtime freeze, owner/device/native trust-boundary audit, and backend/contract regression verification. No new product capability was added.

STATUS: COMPLETE WITH DOCUMENTED RELEASE LIMITATIONS. The audited backend and shared-contract paths are internally consistent after one capability-truth correction. The full local backend/contract matrix passes.

COMMITS: None. Work remains in the shared dirty workspace. Pre-existing and concurrent changes from other owners were preserved.

FILES_CHANGED:

- `server/advanced/runtime.ts`
- `scripts/test-edith-phase7a-advanced-backend.ts`
- `scripts/test-edith-phase7f-advanced-ui.ts`
- `package.json`
- `docs/EDITH_CHAT4_PHASE8A_CONTRACT_BACKEND_FREEZE_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED:

- No canonical type, parser, event name, field name, or wire version changed.
- `AdvancedExperienceRuntime.capabilityStatus().mobileRead` now reports `available`, matching the implemented device-authenticated, encrypted, read-only `GET /api/mobile/advanced/state` route.
- The status correction does not grant a mobile mutation capability. Responses still carry `deviceScoped:true` and `mutationAvailable:false`.

APIS_ADDED_OR_CHANGED:

- No endpoint was added, removed, renamed, or given a new request/response shape.
- The existing advanced status embedded in owner/mobile responses now truthfully reports `mobileRead:"available"`.
- `test:edith-phase6b-native-contract` was registered as the stable npm alias for the already-existing test script.

## Contract Reconciliation

| Area | Canonical source / route | Freeze result |
|---|---|---|
| Task/event/progress | `src/edith/contracts.ts`, task routes/services | PASS. V2/V2.1 identity, monotonic sequence/revision and deterministic progress remain covered. |
| Pairing/device/owner | `/api/mobile/pairing/*`, registry and pairing runtime | PASS. P-256 negotiation, owner binding, expiry, rotation/revocation and secret-free registry remain fail-closed. |
| File transfer | `/api/mobile/transfers/*`, cross-device service | PASS. Bounded chunks, checksum, resume, safe filename/destination and no-overwrite rules remain enforced. |
| Realtime | `/api/mobile/realtime`, canonical payload registry | PASS. Every frozen event name has a payload validator; authenticated replay is bounded and process-memory only. |
| Capsule/Mission | canonical presentation parsers and desktop consumers | PASS. Existing frozen shapes and deterministic selection remain unchanged. |
| Phase 4 research/playbooks/search | owner-protected API routes | PASS. Origin/CSRF, SSRF, provenance, idempotency and no-fake-execution boundaries remain intact. |
| Phase 6 cross-device | `/api/mobile/cross-device/*`, desktop producer routes | PASS. Device envelopes, exact-next command sequence, owner/workspace isolation and honest capability states remain covered. |
| Desktop producer | `/api/edith/mobile/desktop-producer/*` | PASS. Bootstrap requires owner+CSRF, loopback and native bearer; ingest also requires RAM-only producer token and exact-next sequence. |
| Phase 7 producers | `/api/edith/advanced/produce/:operation` | PASS. Server re-reads source IDs; owner bodies cannot assert verification/completion. |
| Phase 7 native publication | eight fixed `/advanced/*` producer routes | PASS. Strict parser, dual auth, lineage, sequence, HTTP 202-only acceptance and forbidden-data rejection remain covered. |
| Phase 7 owner state | `/api/edith/advanced/*` | PASS. Owner reads and origin/CSRF mutations remain isolated by owner/workspace and exact revision rules. |
| Phase 7 mobile projection | `GET /api/mobile/advanced/state` | PASS after status correction. Device-authenticated AES-GCM response is read-only and scoped to the paired owner/workspace. |

## Security And Lifecycle Freeze

- API keys, bridge bearer, producer token, owner cookie, CSRF value, device credential, private/session keys, plaintext clipboard, frame pixels, audio bytes and private paths are not public metadata.
- Owner logout, rotation and observed expiry invalidate owner-bound mobile and advanced authority. Device revoke disconnects active device realtime state.
- Emergency Stop remains dominant: it revokes desktop producer authority and cancels/reverts the bounded advanced runtime state. Mobile Emergency Stop remains outside the offline queue.
- Exact-next sequence, replay rejection, stale-session rejection, owner/workspace/device/session lineage and idempotency conflict behavior passed regression.
- Advanced state, producer authority, session keys, transient payloads and realtime history remain explicitly RAM-only. Status continues to report `persistence:"memory_only"` and `restartRecovery:"partial"`.
- Mobile Phase 7 remains a read projection. No advanced mobile command or mutation allowlist entry was introduced.

TESTS_PASS:

- Initial full matrix: 31 commands passed, including `npm run lint`, `npm run build`, canonical V2/V2.1 contracts, task service/queue/recovery, Phase 4 API/research, Obsidian/knowledge, providers/model routing/chat context, mobile backend/reconciliation, Phase 6 cross-device/native/result-card/backend/desktop-bridge suites, backend security, interaction safety, and Phase 7 A/B/D/E/F suites.
- Post-fix focused rerun passed: `npm run lint`.
- Post-fix focused rerun passed: `npm run test:edith-phase6b-native-contract`.
- Post-fix focused rerun passed: `npm run test:edith-phase7a-backend`, including `mobile_read_capability_truth`.
- Post-fix focused rerun passed: `npm run test:edith-phase7d-native`.
- Post-fix focused rerun passed: `npm run test:edith-phase7f-ui`.
- Post-fix focused rerun passed: `npm run build`.
- Build retains the existing Vite warning for the 852.40 kB main JavaScript chunk; compilation and server bundling succeeded.

KNOWN_LIMITATIONS:

- No physical Android device, API 33/API 35 emulator, signed Android release, signed desktop package, or real paired-device packaged bootstrap was exercised in this freeze.
- Session encryption keys, producer sessions, advanced records, cross-device orchestration state and realtime replay history are process-memory only; restart requires re-pair/bootstrap where documented.
- Event-based watcher delivery, push scheduler, configured Wake-on-LAN, audio bytes, remote control, continuous Live View and general restore/shell execution remain unavailable or configuration-required.
- Existing global Task mutation does not provide database-wide compare-and-swap, and legacy in-flight tool work is not centrally aborted mid-operation by one global AbortController.
- Browser startup/status latency and the large frontend bundle remain performance risks outside this backend contract freeze.
- Real owner-approved capture/transfer/audio/WOL runtime evidence remains a release QA responsibility; harness success must not be described as production runtime proof.

EXTERNAL_BLOCKERS:

- Release QA needs signed/package and real paired-device evidence.
- Mobile QA needs API 33/API 35 and physical-device coverage.
- Durable keystore-backed reconnect, durable advanced persistence, push delivery and event-based watcher observation require separately approved designs.

DOWNSTREAM_DEPENDENCIES:

- Chat 8 Integration QA should consume this freeze report and rerun the release acceptance matrix without changing canonical contracts.
- Chat 2 may rely on `mobileRead:"available"` only as read-route availability; UI must continue to honor `mutationAvailable:false`, `memory_only`, `partial`, and per-feature configuration-required state.
- Chat 6 must keep native bearer/session/sequence values outside WebView JavaScript and preserve the fixed endpoint allowlist.

NEXT_OWNER: Chat 8 Independent Integration / Release QA.

DO_NOT_TOUCH: Frozen `src/edith/contracts.ts` without shared-contract-owner acknowledgement; crypto trading behavior; `Mark-L-main`; provider secrets; desktop/mobile safety defaults; real computer/browser control; unrelated dirty-worktree changes.

NOTES_FOR_NEXT_AGENT: Phase 7C's former publication blocker is resolved by Phase 7D backend routes and Phase 7E native mappings. The old Phase 7D sentence saying Chat 6 still must add mappings is historical handoff state, not the current runtime state. Treat `available` as proven only for the encrypted mobile read route; it does not imply a paired device is online or that mutations are allowed.

## CROSS_CHAT_REQUEST

- REQUEST_ID: `edith-phase8a-independent-freeze-rerun-2026-09-28`
- FROM_OWNER: Chat 4 Backend / Shared Contract Integration
- TO_OWNER: Chat 8 Independent Integration / Release QA
- REQUEST: Independently rerun the registered backend/contract matrix and verify that advanced mobile status reports `mobileRead:"available"` while the encrypted payload remains device-scoped and `mutationAvailable:false`.
- SECURITY_INVARIANTS: Preserve owner/workspace/device/session lineage, exact-next sequence, replay/stale rejection, logout/revoke/kill-switch invalidation, RAM-only truth, no secret reflection and mobile read-only behavior.
- BLOCKING: No for continued integration. Yes for a production-ready release claim until signed/package and real paired-device evidence is collected.
