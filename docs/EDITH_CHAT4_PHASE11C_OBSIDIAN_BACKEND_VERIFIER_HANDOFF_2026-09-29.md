# E.D.I.T.H. Chat 4 Phase 11C Obsidian Backend Verifier Handoff

Date: 2026-09-29

OWNER: Chat 4 Backend / Security

STATUS: COMPLETE for the backend verifier, replay protection, provider activation/revocation APIs, and production provider composition. The real Windows picker E2E remains NOT_RUN because the in-scope UI caller does not exist yet.

## 1. Scope Result

The Phase 11B native publication contract is now accepted at exactly:

`POST /api/edith/obsidian/native-selection`

The route is loopback-only and requires all of the following before the selected path reaches provider validation:

- `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>` with timing-safe comparison.
- An active, unexpired `X-Edith-Producer-Session` known only to the backend.
- `X-Edith-Native-Selection-Sequence: 1`; each producer session can publish at most one native selection.
- Active owner binding for the server-held producer session.
- Exact `X-Edith-Owner-Session-Binding` and `X-Edith-Device-Session` equality.
- Exact owner, workspace, session, and target-device equality against server-held producer state and a freshly revalidated device context.
- Inactive kill switch and a permission policy other than global deny.

The outer envelope is exact-key parsed. Its nested selection is parsed with `parseTrustedNativeVaultSelectionV1()`, so unknown fields, forged source, false confirmation, non-absolute paths, invalid timestamps, and expiry windows longer than five minutes fail closed. The backend additionally rejects future selections and already-expired selections.

Success is exactly HTTP `202` with:

```json
{"success":true}
```

No public response, provider audit event, or error response contains the selected path, bridge/producer token, selection ID, or device ID.

## 2. Replay and Restart Behavior

Native selection IDs are SHA-256 hashed before entering the replay store. The persistent store contains only hash digests and expiry timestamps at:

`.edith/obsidian-native-selection-replay.json`

The default live-entry limit is 512. Expired entries are removed. Live entries are never evicted to make room; when capacity is full, new selection publication fails closed with `OBSIDIAN_NATIVE_REPLAY_STORE_CAPACITY`. The focused test also reloads the store and proves that replay remains denied after restart.

Producer sessions remain memory-only, expire under the existing desktop producer TTL, and are revoked by owner logout/rotation, kill switch, shutdown, or restart. A server restart therefore requires a fresh producer session while preserving accepted provider config and replay evidence.

## 3. Provider APIs

The separate owner/WebView API is:

- `GET /api/edith/obsidian/provider/status`
- `POST /api/edith/obsidian/provider/activate`
- `POST /api/edith/obsidian/provider/change`
- `POST /api/edith/obsidian/provider/revoke`

All are loopback-only and require an owner session and exact same origin. Mutation endpoints additionally require CSRF and a valid `x-idempotency-key`. Mutations accept only an empty JSON object; a raw path, native envelope, handle, or any unknown field is rejected. Mutations and denied attempts use path-free security audit records.

`activate` and `change` never accept or manufacture a path. When a native selection is needed they honestly return HTTP `428` with `NATIVE_SELECTION_REQUIRED`; Chat 2 must then invoke the Phase 11B Tauri picker. The native publication route performs the actual trusted activate/change operation. `revoke` persists a path-free tombstone and supports idempotent replay.

The legacy direct-path route remains present for compatibility discovery but is permanently fail-closed:

`POST /api/edith/obsidian/vault` -> HTTP `410`, `TRUSTED_NATIVE_PICKER_REQUIRED`

The direct production methods in `ObsidianVaultService` remain fail-closed as well. Test-only sandbox methods still require explicit test mode and an OS-temp sandbox root.

## 4. Provider Composition

Accepted native selections call `ObsidianProviderConfigService.activateTrustedSelection()` or `changeTrustedSelection()` with a request-scoped verifier bound to the exact parsed selection. The service default verifier still denies; no generic or browser route can bypass the verifier.

The local provider config remains versioned and atomic at:

`.edith/obsidian-provider.json`

This trusted local-only file may contain the selected path and native selection metadata as frozen by Phase 11A. Those values never enter public provider status, HTTP responses, audit events, or logs.

`ObsidianVaultService` now refreshes only from `ObsidianProviderConfigService`. Successful activation/change updates the provider-backed vault and watcher without synchronously rewriting or restructuring the selected vault. The test snapshots Unicode fixtures before and after activation/change and proves zero vault mutation.

The production Phase 4 `ResearchJournalService` resolves the provider dynamically. It writes only when provider status is `READY` and `writable:true`; before activation or while degraded it returns `configuration_required`. Development/test user-vault writes remain blocked unless the explicit sandbox provider is used.

## 5. State Semantics

- Fresh install: `FIRST_RUN_REQUIRED / VAULT_SELECTION_REQUIRED`.
- Accepted, readable vault: `READY / VAULT_READY`.
- Persisted but unavailable vault: `DEGRADED / VAULT_UNAVAILABLE`, `selectionAction:none`; no popup loop and unrelated services remain available.
- Revoked selection: frozen Phase 11A representation `FIRST_RUN_REQUIRED / VAULT_SELECTION_REVOKED`; the persisted tombstone has no path, device ID, or selection ID.

`REVOKED` is a semantic condition represented by the frozen public contract above, not a newly invented state enum.

## 6. Files Changed

- `server/routes/obsidianProvider.ts`
- `server/mobile/desktopProducerService.ts`
- `server/routes/desktopProducer.ts`
- `src/edith/obsidianProviderService.ts`
- `src/edith/obsidianVaultService.ts`
- `src/edith/researchJournalService.ts`
- `server/routes/phase4Api.ts`
- `server/routes/knowledge.ts`
- `server.ts`
- `scripts/test-edith-phase11c-obsidian-backend.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json`
- `docs/EDITH_CHAT4_PHASE11C_OBSIDIAN_BACKEND_VERIFIER_HANDOFF_2026-09-29.md`

No UI, crypto, Mark-L, or native picker source was changed. No commit, reset, checkout, cleanup, or unrelated revert was performed.

## 7. Test and Runtime Evidence

The final 19-command matrix passed:

- `npm run test:edith-phase11c-obsidian-backend`
- `npm run test:edith-obsidian-provider`
- `npm run test:edith-obsidian-knowledge`
- `npm run test:edith-skills`
- `npm run test:edith-registry`
- `npm run test:edith-workspace`
- `npm run test:edith-knowledge-map`
- `npm run test:edith-memory-v2`
- `npm run test:edith-permission-service`
- `npm run test:edith-backend-security`
- `npm run test:edith-contracts-v2-1`
- `npm run test:edith-phase6e-backend-integration`
- `npm run test:edith-phase6g-native-ingest`
- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npx tsx scripts/test-edith-phase4-api.ts`
- `npm run test:edith-interaction-safety`
- `npm run lint`
- `npm run build`

The focused integration test uses only explicit OS-temp fixtures with Unicode, Turkish characters, and spaces. It proves dual auth, active producer requirement, exact lineage, unknown-field denial, source/confirmation forgery denial, five-minute expiry, exact sequence, persistent replay denial, bounded fail-closed capacity, kill/permission denial, path-free response/audit, owner origin/CSRF/idempotency, restart reuse, degraded no-popup behavior, path-free revoke, production journal composition, direct-path denial, and logout invalidation.

The complete real project `.edith` inventory was captured before and after all 19 commands. All 39 files retained identical relative path, SHA-256, length, and UTC mtime.

- Runtime inventory unchanged: `true`
- `edith.db` SHA-256: `3EE2E2DCF762A4DDB91B48891AF4B690ACF94C59E69D15C13E3396E7D368DCFF`
- `edith.db` length: `53,260,288` bytes
- `edith.db` UTC mtime ticks: `639262252175863204`

No real user vault or runtime database was modified.

## 8. Remaining Work / Exact Downstream Contract

### Chat 2 Desktop UI

1. Read only `GET /api/edith/obsidian/provider/status`; never read, store, infer, or render an absolute path.
2. On explicit user action, call protected `activate` or `change` with `{}` and a unique `x-idempotency-key`.
3. Treat HTTP `428 / NATIVE_SELECTION_REQUIRED` as the signal to invoke `obsidian_request_vault_folder` through Tauri.
4. After native reports `submitted`, refetch provider status. Show connected only for `READY`; show a passive reconnect/change action for `DEGRADED`; never auto-open the picker.
5. Revoke through the protected revoke endpoint with `{}` and a unique idempotency key.

### Chat 6 Native Desktop

The Phase 11B wire mapping is accepted unchanged. Consume a pending native selection only for exact HTTP `202` plus `{ "success": true }`. Keep the existing no-retry, five-minute expiry, one-shot sequence, bridge bearer, producer token, and owner/session headers. No native code change is required by Phase 11C.

### Chat 8 Independent QA

Run the packaged Windows flow after Chat 2 adds the explicit caller: fresh first run, cancel, activate, restart reuse, change, unavailable/degraded, reconnect, revoke, logout, kill switch, and replay attempt. Inspect network payloads, logs, audits, provider status, local config permissions, and vault tree hashes. A real Windows folder-picker E2E is **NOT_RUN** in this phase and must not be inferred from the deterministic harness.

## 9. Honest Limits

- The UI does not yet invoke the Tauri picker, so packaged first-run E2E is pending.
- No real Windows picker was opened and no real user vault was selected.
- The backend cannot make a browser-only session into a trusted selection; activate/change remain configuration-required until native publication succeeds.
- Native producer and owner sessions are intentionally memory-only and must be re-established after restart.

