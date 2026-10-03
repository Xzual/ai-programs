# E.D.I.T.H. Chat 6 Phase 11B Obsidian Native Picker Handoff

Date: 2026-09-29

OWNER: Chat 6 Native Desktop

STATUS: COMPLETE for the native picker and native attestation producer boundary. Backend verification, provider activation, and UI invocation remain configuration required and are not claimed as complete.

## Scope Result

The Phase 11A frozen `TrustedNativeVaultSelectionV1` contract is now produced only by a user-initiated Tauri command. The command accepts no path, selection, device, owner, session, or attestation input from JavaScript. It opens a directory-only native picker and returns only a path-free status plus a random opaque handle.

The picker:

- preserves the path returned by the operating system, including Unicode, Turkish characters, and spaces;
- does not canonicalize the stored value, enumerate the directory, index content, create directories, restructure the vault, or probe-write;
- checks only absolute-directory metadata and rejects filesystem roots, symlinks, and Windows reparse points as defense in depth;
- binds the selection to the active authenticated native producer owner, workspace, session, and target device;
- emits contract version `2`, amendment `2.1`, `source: trusted_native_picker`, and `userConfirmed: true`;
- expires after exactly five minutes at most;
- clears native pending state on replacement, expiry, successful publication, owner logout/rotation/expiry, kill-switch or safety-check failure, shutdown, and app exit;
- consumes a published selection once. Replay, wrong sequence, expiry, and owner/session/device mismatch fail closed.

Cancel returns `status: cancelled`, `selectionHandle: null`, `publication: none`, and changes no config. It also leaves no pending native selection.

## WebView Boundary

Registered command:

`obsidian_request_vault_folder(window, native_state, cross_device_state, computer_state)`

All arguments are Tauri-injected. There is no WebView-authored request body. The response is limited to:

```json
{
  "status": "cancelled | selected | selected_pending_verifier",
  "selectionHandle": "opaque-or-null",
  "publication": "none | submitted | configuration_required",
  "safeMessage": "path-free message"
}
```

The response contains no selected path, selection ID, device ID, owner binding, workspace ID, session ID, producer token, bridge token, or attestation envelope. `dialog:allow-open` was removed from the WebView capability set, so JavaScript cannot bypass the command and open an arbitrary native picker directly.

## Native Publication Wire Mapping

The native-only publisher sends one request to the fixed loopback route:

`POST /api/edith/obsidian/native-selection`

Headers:

- `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>`
- `Content-Type: application/json`
- `X-Edith-Producer-Session: <authenticated native producer session token>`
- `X-Edith-Native-Selection-Sequence: 1`
- `X-Edith-Owner-Session-Binding: <current producer owner binding>`
- `X-Edith-Device-Session: <current producer session ID>`

Body:

```json
{
  "contractVersion": 2,
  "amendment": "2.1",
  "ownerSessionBindingId": "<current owner binding>",
  "workspaceId": "<current workspace>",
  "sessionId": "<current producer session>",
  "selection": {
    "contractVersion": 2,
    "amendment": "2.1",
    "selectionId": "<native random ID>",
    "deviceId": "<current authenticated target device>",
    "source": "trusted_native_picker",
    "selectedPath": "<native-only absolute path>",
    "userConfirmed": true,
    "selectedAt": "<ISO-8601>",
    "expiresAt": "<ISO-8601, no more than five minutes later>"
  }
}
```

Native consumes the pending selection only for HTTP `202` with exact body field `success: true`. Any unavailable route, network error, non-202 response, malformed response, or safe backend rejection leaves the selection untrusted and pending only until native expiry/revocation. No retry loop exists.

## Exact Chat 4 Request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-phase11b-native-vault-verifier-2026-09-29`
- FROM_OWNER: Chat 6 Native Desktop
- TO_OWNER: Chat 4 Backend / Security
- REQUEST: Implement the fixed loopback-only `POST /api/edith/obsidian/native-selection` route using the exact headers and body above. Require the existing desktop bridge bearer plus an active, unexpired native producer session. Resolve owner/workspace/session/device from server-held producer state and require exact equality with the envelope. Parse `selection` with `parseTrustedNativeVaultSelectionV1`; reject unknown fields, forged source/confirmation, expiry over five minutes, already-expired records, duplicate `selectionId`, any sequence other than exact first sequence `1`, owner/session/device mismatch, and replay. Never accept a raw path from an owner/WebView route. On acceptance, pass the verified selection directly to `ObsidianProviderConfigService` trusted activation/change flow and return only HTTP `202` plus `{ "success": true }`; never return or audit the path, token, selection ID, or device ID.
- AUTHORIZATION: loopback source + desktop bridge bearer + active native producer token + active owner binding + exact session/device match + kill switch/permission checks. Mobile credentials, browser owner credentials alone, and generic provider mutation routes must be denied.
- IDEMPOTENCY: `selectionId` is single-use. A duplicate is a replay denial, not a second success. Native sequence for this one-shot publication is exactly `1`.
- REDACTION: Public response, logs, audit records, metrics, and exceptions must omit `selectedPath`, producer/bridge tokens, selection ID, and device ID. Audit may record path-free outcome/reason, owner/workspace references under existing policy, and contract version.
- PROVIDER_RESULT: Return only `ObsidianProviderPublicStatusV1` from separate protected status/mutation APIs. Do not expose the native envelope to the UI.
- ACCEPTANCE: valid native publication returns 202; missing/wrong bridge or producer auth denied; non-loopback denied; forged/browser-authored/raw-path denied; expired/replayed/wrong owner/workspace/session/device denied; cancel sends no request; Unicode/space path reaches the verifier unchanged; config is written only after backend validation; public/log/audit output remains path-free.
- ACK_REQUIRED: implemented route path, exact authorization checks, producer-state binding, replay store lifetime, activation/change mapping, response schema, redaction evidence, and kill/logout/restart behavior.

Until this request is implemented, a real selection reports `selected_pending_verifier / configuration_required`; E.D.I.T.H. must not show Obsidian as connected or configured.

## Test Evidence

Native unit tests use only an OS temporary fixture named with `Türkçe Alan` and `Görev Notu.md`. A SHA-256 snapshot of fixture content is identical before and after selection construction. Tests cover path preservation, five-minute expiry, single use, replay denial, owner/session/device mismatch denial, owner revocation, cancel behavior, and path-free WebView serialization. No real user vault is accessed.

Commands passed:

- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-targets` (`40 passed` after the final root-guard test)
- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts`
- `npm run test:edith-phase6b-native-contract`
- `npm run test:edith-phase6g-native-ingest`
- `npx tsx scripts/test-edith-phase7c-advanced-native.ts`
- `npx tsx scripts/test-edith-phase7e-native-publication.ts`
- `npx tsx scripts/test-edith-phase8c-native-freeze.ts`
- `npm run lint`
- `npm run build`

The build passed with the existing Vite large-chunk warning. Before and after implementation, the complete real `.edith` file/hash/length inventory was identical: `9578fcc7b619590c55b9d1bc43285c1e82ba5bdd91b0925af82b37376390055b`.

## Files Changed

- `src-tauri/src/obsidian_picker.rs`
- `src-tauri/src/cross_device.rs`
- `src-tauri/src/computer.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `scripts/test-edith-phase11b-native-vault-picker.ts`
- `docs/EDITH_CHAT6_PHASE11B_OBSIDIAN_NATIVE_PICKER_HANDOFF_2026-09-29.md`

## Remaining Limits

- Chat 4 verifier/activation route is not implemented in this scope.
- Chat 2 has not yet wired the explicit first-run action to the native command.
- No real vault, config, backend route, or provider state was changed.
- The deterministic native harness verifies the selection and cancel state machine. The real Windows picker was not launched because no in-scope UI caller exists yet; claiming a real end-to-end selection would be false.
- Packaged Tauri first-run, restart, change, revoke, and visual E2E remain downstream acceptance work after Chat 4 and Chat 2 integration.

COMMITS: None

GIT_OPERATIONS: No commit, reset, checkout, cleanup, or unrelated revert.

NEXT_OWNER: Chat 4 Backend/Security, then Chat 2 Desktop UI, then Chat 8 independent acceptance.
