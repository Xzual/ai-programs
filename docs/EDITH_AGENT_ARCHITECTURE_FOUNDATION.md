# E.D.I.T.H Agent Architecture Foundation

Date: 2026-08-14

## Purpose

This document records the first compact Agent Architecture foundation. EDITH now has a backend agent registry and router that describe agent responsibilities, capabilities, allowed tools, permissions, schemas, timeouts, health, and metrics.

This does not create many autonomous agents. It creates the contract layer that lets Planner, Executor, Verifier, and future handoff logic talk about agents consistently.

## Added Component

| File | Role |
|---|---|
| `src/edith/agentRegistry.ts` | Static compact agent registry and route selection |
| `scripts/test-edith-agents.ts` | Regression coverage for agent list, routing, and planner integration |

## Registered Agents

| Agent ID | Responsibility |
|---|---|
| `orchestrator` | Owns objective flow, task lifecycle coordination, and handoff decisions |
| `planning` | Decomposes objectives into structured plans, dependencies, validation criteria, and budgets |
| `research` | Gathers web and external knowledge using read-only research tools |
| `browser-computer` | Controls high-risk browser or desktop adapters only after explicit backend permission |
| `coding` | Handles code-oriented planning, local code assistance, and controlled interpreter handoffs |
| `vision` | Owns future screen/image understanding and visual verification handoffs |
| `security` | Reviews high-risk plans, permissions, and external-action safety boundaries |

Important distinction:

```text
Playwright is a tool/runtime.
browser-computer is an agent boundary that decides whether browser/computer tools are appropriate.
```

## Agent Metadata

Each agent exposes:

- ID
- name
- version
- responsibility
- capabilities
- allowed tools
- required permissions
- input schema
- output schema
- timeout
- health
- metrics

## Planner Integration

Planner no longer hardcodes informal agent names. It now calls:

```text
agentRegistryService.routeTask(...)
```

The returned routes populate:

```text
plan.requiredAgents
task.candidateAgents
```

Every durable task currently receives `orchestrator` and `planning`. Additional agents are selected from tools, objective signals, and risk level.

## New Backend Endpoints

```text
GET /api/edith/agents
POST /api/edith/agents/route
```

`GET /api/edith/agents` lists registered agent metadata.

`POST /api/edith/agents/route` previews agent selection for an objective, risk level, tools, and permissions.

## Verification

Commands:

```bash
npm run test:edith-agents
npm run test:edith-planner
npm run test:edith-recovery
npm run test:edith-verifier
npm run test:edith-executor
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- all 7 compact agents are registered
- high-risk browser/computer route selects `browser-computer` and `security`
- web objective route selects `research`
- planner stores registry-selected agents on the plan and task

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3107` | Started successfully |
| `GET /api/edith/agents` | Returned 7 agents, including `orchestrator` and `security` |
| `POST /api/edith/agents/route` | High-risk browser route returned `orchestrator`, `planning`, `browser-computer`, `research`, and `security` |
| `POST /api/edith/tasks` + `POST /api/edith/tasks/:id/plan` | Plan was `READY` and included registry-selected `orchestrator`, `planning` agents |

## Remaining Agent Work

1. Add persisted `agent_runs`.
2. Add structured `AgentRequest`, `AgentResponse`, `AgentError`, `AgentProgress`, `AgentArtifact`, and `AgentHandoff`.
3. Let Executor call agent adapters, not only tools.
4. Add agent health from actual adapter dependencies.
5. Surface agent health and route previews in EDITH Ops.
6. Add policy review before any high-risk agent can run external actions.
