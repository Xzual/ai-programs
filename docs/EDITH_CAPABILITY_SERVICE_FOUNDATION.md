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

## Executor Integration

Executor now runs a CapabilityService preflight before executing tool-backed plan steps.

If the assessment is `WAITING_PERMISSION`, Executor:

- marks the step failed at the preflight boundary
- records a task observation with the assessment summary
- returns task status `WAITING_PERMISSION`
- avoids calling the blocked tool

This keeps denied high-risk operations from reaching adapter execution just to discover missing authorization.

## Security Notes

- CapabilityService does not weaken backend enforcement.
- Tool execution still goes through PermissionService and `executeEdithTool`.
- High-risk tools remain blocked unless the permission model grants them for the actor/tool scope.
- Assessments are advisory and auditable, not execution authority.

## Verification

```bash
npm run test:edith-capabilities
npm run test:edith-planner
npm run test:edith-executor
npm run lint
npm run build
```

Runtime coverage verifies:

- low-risk system monitor capability is ready
- high-risk computer control waits for permission by default
- scoped permission grant makes the same high-risk tool authorized/runnable for the actor while dependency-limited adapters may remain `DEGRADED`
- Planner records capability assessment criteria
- Executor preflight stops missing-permission steps before tool execution
- audit events are emitted

## Remaining Work

1. Add EDITH Ops capability assessment panel.
2. Store assessment IDs on tasks/plans once task metadata has a dedicated field.
3. Add capability scoring for model modality, latency, and provider health.
4. Add adapter-specific capability probes for Mark-L, browser, computer, and crypto adapters.
5. Add automatic task resume after recovery permission grant approval.
