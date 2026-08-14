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

## Enforcement Points

| Point | Behavior |
|---|---|
| `EdithToolRegistry.assertPermission()` | Uses `permissionService.decideToolExecution()` |
| `executeEdithTool()` | Uses `permissionService.defaultAuthorizedPermissions()` |
| `getEdithToolHealth()` | Uses PermissionService decisions for enabled/missing-permission state |

## Backend Endpoint

```text
GET /api/edith/permissions/policy
```

The endpoint returns the current high-risk gate state, default local permissions, high-risk permission set, and effective default authorized permissions.

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

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3116` | Started successfully |
| `GET /api/edith/permissions/policy` | Returned default local permissions and `highRiskEnabled=false` |
| `POST /api/tools/execute` for `playwright_browser_agent` | HTTP `403`, `PERMISSION_DENIED`, `permissionDecision.status=DENY` |
| Missing permission | `browser:control` |

## Remaining Work

1. Persist explicit user/session permission grants.
2. Add expiry and scope to elevated grants.
3. Add EDITH Ops permission review UI for high-risk requests.
4. Add role/authorization checks before permission elevation.
5. Add adapter-specific checks for browser/computer/trading/proactive capabilities.
