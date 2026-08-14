# E.D.I.T.H Permission Service Foundation

Date: 2026-08-14

## Purpose

This document records the first PermissionService foundation. EDITH now has a dedicated backend service that produces structured permission decisions for tool execution.

The existing safety behavior is preserved:

- normal low-risk tools run with default local permissions
- high-risk browser/computer/system execution permissions stay unavailable by default
- `EDITH_ENABLE_HIGH_RISK_TOOLS=true` still enables the expanded local permission set
- frontend tool metadata cannot weaken backend execution checks

## Added Component

| File | Role |
|---|---|
| `src/edith/permissionService.ts` | Central permission/risk decision service |
| `scripts/test-edith-permission-service.ts` | Regression coverage for allow/deny/high-risk/default/explicit permission decisions |

## Decision Shape

Permission decisions include:

- status: `ALLOW` or `DENY`
- tool id
- actor
- risk level
- required permissions
- authorized permissions
- missing permissions
- high-risk flag
- rationale

Denied tool runs now include the permission decision in `structuredOutput.permissionDecision`.

## Permission Grants

PermissionService now supports persistent, scoped, time-limited grants.

Grant fields:

- id
- actor
- permissions
- optional toolIds scope
- reason
- grantedBy
- createdAt
- expiresAt
- revokedAt / revokedBy

Active grants are added to the effective permission set only when:

- the grant is not expired
- the grant is not revoked
- actor is either exact-match or `*`
- tool scope is empty or includes the target tool

## Enforcement Points

| Point | Behavior |
|---|---|
| `EdithToolRegistry.assertPermission()` | Uses `permissionService.decideToolExecution()` |
| `executeEdithTool()` | Uses `permissionService.defaultAuthorizedPermissions()` |
| `getEdithToolHealth()` | Uses PermissionService decisions for enabled/missing-permission state |

## Backend Endpoint

```text
GET /api/edith/permissions/policy
GET /api/edith/permissions/grants
POST /api/edith/permissions/grants
DELETE /api/edith/permissions/grants/:id
```

The endpoint returns the current high-risk gate state, default local permissions, high-risk permission set, and effective default authorized permissions.

Grant endpoints create, list, and revoke temporary permission grants.

## Persistence

Permission grants are stored beside EDITH local persistence data:

```text
.edith/permission-grants.json
```

## Verification

Commands:

```bash
npm run test:edith-permission-service
npm run test:edith-registry
npm run test:edith-kill-switch
npm run lint
npm run build
```

Regression scenarios:

- local permission allow
- high-risk permission deny
- denied tool includes structured permission decision
- tool health uses PermissionService
- env high-risk allow
- explicit permission allow
- scoped permission grant
- grant revoke
- grant audit

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3116` | Started successfully |
| `GET /api/edith/permissions/policy` | Returned default local permissions and `highRiskEnabled=false` |
| `POST /api/tools/execute` for `playwright_browser_agent` | HTTP `403`, `PERMISSION_DENIED`, `permissionDecision.status=DENY` |
| Missing permission | `browser:control` |
| Production server on `PORT=3117` | Grant create/list/revoke flow passed |
| Scoped grant for `computer_control_agent` | Permission gate passed and reached adapter `CONFIGURATION_REQUIRED` result |

## Remaining Work

1. Add EDITH Ops permission review UI for high-risk requests.
2. Add role/authorization checks before permission elevation.
3. Add one-click grant creation from denied tool results.
4. Add adapter-specific checks for browser/computer/trading/proactive capabilities.
5. Add periodic pruning or archival of expired/revoked grants.
