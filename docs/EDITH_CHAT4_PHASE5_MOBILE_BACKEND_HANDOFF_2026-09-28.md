# E.D.I.T.H. Chat 4 Phase 5 Mobile Backend Handoff

Date: 2026-09-28

OWNER: Chat 4 Backend / Mobile Runtime

SCOPE: Secure desktop-side mobile pairing, trusted-device sessions, encrypted transport envelopes, authenticated realtime replay, low-risk remote task controls, emergency stop, and encrypted resumable upload foundation.

STATUS: Implemented and verified. The backend foundation is ready for the Mobile Client Owner to consume; it does not claim that an Android client, push service, remote view, or Wake-on-LAN exists.

COMMITS: None. Work is present in the shared dirty workspace and intentionally leaves other owners' changes untouched.

FILES_CHANGED:

- `server/mobile/types.ts`
- `server/mobile/registryStore.ts`
- `server/mobile/crypto.ts`
- `server/mobile/pairingService.ts`
- `server/mobile/transferService.ts`
- `server/mobile/realtime.ts`
- `server/mobile/runtime.ts`
- `server/mobile/middleware.ts`
- `server/routes/mobilePairing.ts`
- `server/routes/mobileTasks.ts`
- `server/routes/mobileTransfers.ts`
- `server.ts` (registration and shutdown only)
- `scripts/test-edith-mobile-backend.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json` (test command only)
- `docs/EDITH_CHAT4_PHASE5_MOBILE_BACKEND_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED: No canonical contract was modified. Backend-private DTOs add pairing proof, credentials, app encryption envelope, command allowlist, and persistence records under `server/mobile/types.ts`. The envelope binds contract, server-mediated session, device, workspace, sequence, purpose, nonce, ciphertext, and authentication tag.

APIS_ADDED_OR_CHANGED:

- Public pairing over loopback HTTP or remote HTTPS: request, submit proof, inspect status, consume approved one-time challenge.
- Owner-session protected pairing/device administration: list, approve, reject, revoke.
- Trusted-device session: encrypted status and credential rotation.
- Trusted-device tasks: list/detail/activity, create low-risk task, pause/resume/cancel, emergency stop.
- Trusted-device transfers: create, upload checksummed chunks, resume/status.
- WebSocket `/api/mobile/realtime`: device-authenticated WSS/loopback WS, encrypted canonical V2.1 event replay by cursor.
- Capability status honestly reports remote view disabled, Wake-on-LAN configuration required, push notifications configuration required, and destructive device control disabled.

TESTS_PASS:

- `npm run lint`
- `npm run test:edith-mobile-backend`
- `npm run test:edith-backend-security`
- `npm run test:edith-contracts-v2-1`
- `npm run build`

KNOWN_LIMITATIONS:

- Session encryption keys are memory-only. A desktop process restart intentionally invalidates reconnect credentials with `DEVICE_REPAIR_REQUIRED`; durable OS-keystore-backed key wrapping is not implemented.
- Realtime history is memory-only and bounded to 500 events. It does not provide restart-surviving replay.
- Credentials expire after 15 minutes and must be rotated while the current session is alive.
- Uploads are limited to 25 MiB, 64 KiB chunks, 512 chunks, and a strict text/JSON/PNG/JPEG/PDF allowlist.
- TLS termination/configuration is deployment-owned. The backend permits plaintext only from loopback and rejects non-loopback HTTP/WS.
- No remote screen view, Wake-on-LAN execution, push notification delivery, clipboard handoff, camera, microphone, browser control, or computer control was enabled.

EXTERNAL_BLOCKERS: A production reconnect flow needs a platform keystore design and an additive shared contract for device session/envelope/command semantics. Push delivery needs a provider and server-side credential lifecycle. Remote view and Wake-on-LAN require separate security designs and explicit owner approval.

DOWNSTREAM_DEPENDENCIES: Android client must generate and protect Ed25519/X25519 keys, display/confirm the pairing code, sign both proof payloads, enforce certificate validation, implement envelope counters and nonce uniqueness, rotate credentials, persist only secure-keystore material, and handle replay-window/repair-required states honestly.

NEXT_OWNER: Mobile Client Owner, followed by Mobile Security Auditor and Chat 8 independent QA.

DO_NOT_TOUCH: `src/edith/contracts.ts` without Shared Contracts Owner acknowledgement; crypto trading behavior; Mark-L-main; desktop capability defaults; real computer/browser control; secrets in frontend or logs.

NOTES_FOR_NEXT_AGENT: Pairing requires Ed25519 proof of possession and X25519 agreement. The owner approval code is hashed at rest. Access secrets and private/session keys are never persisted. Remote task creation accepts risk 0/1 only, strips tools/permissions, honors owner policy and kill switch, and emits actual task events. Emergency stop remains callable while the kill switch is active. Fallback or unsupported capabilities are never reported as available.

## Security behavior

1. Pairing challenges expire after five minutes, are one-time, and require owner approval plus two signed proof steps.
2. X25519 shared material is expanded with HKDF-SHA256 and used by AES-256-GCM. AAD binds the V2.1 contract, device, workspace, session, purpose, and monotonic envelope sequence.
3. Credential records contain only hashes/fingerprints. Rotation revokes the prior credential; device revocation invalidates all device credentials and active sockets.
4. The authoritative registry is an atomic local JSON store with restrictive file mode and is separate from Supabase.
5. Mobile mutation idempotency rejects key reuse with a different payload. Command sequences and encrypted envelope sequences reject replay.
6. Transfer destinations are opaque handles. Client responses never expose filesystem paths.

## CROSS_CHAT_REQUEST

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-v2.1-mobile-runtime-contracts-2026-09-28`
- FROM_OWNER: `Chat 4 Backend / Mobile Runtime`
- TO_OWNER: `Shared Contracts Owner`
- REQUEST: Add additive canonical V2.1 contracts and strict parsers for mobile pairing proof submission/consumption, PC/server identity and capability advertisement, device session lifecycle and credential rotation/revocation metadata, authenticated encrypted app envelopes, remote command/result envelopes with idempotency and sequence metadata, emergency-stop realtime events, and encrypted file chunk payload metadata. Tighten canonical file-name validation so path separators, traversal syntax, and Windows reserved names are rejected consistently.
- SECURITY_INVARIANTS: Never include raw challenge proof, signatures, access secrets, private keys, symmetric keys, owner tokens, filesystem paths, or API keys. Preserve owner-session binding, device/workspace/session identity, kill switch, risk allowlist, replay protection, expiry, revocation, and secret-recursive rejection.
- MIGRATION_ORDER: `additive types -> strict parsers/fixtures -> backend adapter -> Android consumer -> security audit -> independent QA`
- ACK_REQUIRED: Confirm field names, status lifecycle, emergency-stop event identity, encrypted envelope AAD fields, command result/error semantics, and filename constraints before the Android client freezes its wire model.
- STATUS: `pending`
