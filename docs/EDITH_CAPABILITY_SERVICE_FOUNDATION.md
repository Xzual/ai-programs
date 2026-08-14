# E.D.I.T.H CapabilityService Foundation

**Date:** 2026-08-14
**Status:** Foundation implemented

## Purpose

CapabilityService is the first central capability assessment layer for EDITH Core. It does not execute tools. It answers whether an objective has suitable tools, permissions, and agent routes before Planner/Executor work proceeds.

This keeps planning decisions from scattering tool-health, permission, and agent-routing logic across unrelated modules.

## Added Files

| File | Purpose |
|---|---|
| `src/edith/capabilityService.ts` | Produces structured capability assessments |
| `scripts/test-edith-capabilities.ts` | Regression coverage for readiness, permission waits, grants, planner integration, and audit |
| `docs/EDITH_CAPABILITY_SERVICE_FOUNDATION.md` | This implementation note |

## API

```text
POST /api/edith/capabilities/assess
```

Input:

```json
{
  "objective": "Create a local system health report",
  "actor": "aura-dashboard",
  "toolsRequired": ["system_monitor"],
  "permissionsRequired": [],
  "riskLevel": 1
}
```

Output includes:

- assessment ID
- status: `READY`, `WAITING_PERMISSION`, `DEGRADED`, or `NO_MATCH`
- requested tools
- runnable tools
- blocked tools
- missing permissions
- high-risk blocked tools
- tool decisions
- agent routes
- summary

## Planner Integration

Planner now calls CapabilityService while creating a plan. The resulting assessment:

- determines required permissions from backend tool metadata
- feeds agent route selection
- adds a validation criterion noting the assessment result
- emits audit through CapabilityService

## Security Notes

- CapabilityService does not weaken backend enforcement.
- Tool execution still goes through PermissionService and `executeEdithTool`.
- High-risk tools remain blocked unless the permission model grants them for the actor/tool scope.
- Assessments are advisory and auditable, not execution authority.

## Verification

```bash
npm run test:edith-capabilities
npm run test:edith-planner
npm run lint
npm run build
```

Runtime coverage verifies:

- low-risk system monitor capability is ready
- high-risk computer control waits for permission by default
- scoped permission grant makes the same high-risk tool authorized/runnable for the actor while dependency-limited adapters may remain `DEGRADED`
- Planner records capability assessment criteria
- audit events are emitted

## Remaining Work

1. Use CapabilityService directly in Executor preflight checks.
2. Add EDITH Ops capability assessment panel.
3. Store assessment IDs on tasks/plans once task metadata has a dedicated field.
4. Add capability scoring for model modality, latency, and provider health.
5. Add adapter-specific capability probes for Mark-L, browser, computer, and crypto adapters.
