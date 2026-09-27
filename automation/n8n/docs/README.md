# EDITH Development Orchestrator

This is the local n8n coordination layer for prepared EDITH development tasks. Planning, prompts, dependencies, tests, and acceptance criteria come from the task queue. The first enabled run is the read-only `QA-DRYRUN-001`; code-changing tasks are deliberately blocked until the workflow is proven and a separate reviewed enablement is implemented.

## Start

1. Start the installed local n8n instance and open `http://localhost:5678` in the existing browser.
2. From this repository, start `node automation/n8n/bin/bridge.mjs` in a separate terminal. It listens only on `127.0.0.1:8765`. `GET /health` reports its mode without exposing secrets.
3. In n8n, import `automation/n8n/workflows/edith-development-orchestrator.json` into a **new blank workflow**, then save it. Importing into a populated editor appends nodes.
4. Run the workflow manually. Keep it unpublished during the proof run. The verified local workflow is currently at `http://localhost:5678/workflow/ItkLy2D4eYL3ZZgh`.

The bridge uses the installed `codex queue` command to submit a prepared prompt to the mapped existing Codex task, then reads that task's local rollout to capture its final report. Mapping is fixed in `bin/bridge.mjs` for Chats 0, 2, 4, 5, 6, 7, and 8. The transport is isolated in `queueMessage` and `runCodex` so a future browser or app-server adapter can replace it. n8n routes through preparation, specialist report, conditional QA, Git safety, finalization, and summary stages.

## Files

- `tasks/tasks.json`: live queue. `tasks/example-tasks.json` is illustrative and never loaded by the bridge.
- `schemas/task.schema.json`, `report.schema.json`, `summary.schema.json`: contracts.
- `prompts/chatN/TASK-ID.txt`: complete specialist prompts.
- `state/orchestrator-state.json`: runtime task status, approvals, incidents, starting commit.
- `state/locks.json`: runtime file ownership locks.
- `reports/<run-id>/chatN-TASK-ID.md`: raw final response.
- `reports/<run-id>/chatN-TASK-ID.json`: normalized response.
- `reports/<run-id>/summary.md` and `summary.json`: consolidated outcome.

Runtime state and reports are ignored by Git. Do not store credentials or `.env` contents here.

## Policy

`SAFE`, `REVIEW`, and `MANUAL_APPROVAL` are accepted risk levels. Dependencies must be completed before dispatch. File locks cover declared expected and protected files. The current SAFE proof skips a second QA review, commit, and push. Future `REVIEW` work must pass a separate Chat 8 QA gate and Git checks before any integration. `MANUAL_APPROVAL` tasks return `approval_required` and stop at the n8n summary path until approval is explicitly recorded.

The intended Git path for later code tasks is `agent/<task-id>` → `dev/integration`; no automatic push to `main`. An isolated implementation and local Git fixture test are described in [GIT_INTEGRATION.md](GIT_INTEGRATION.md). That path is **not connected to the live workflow**. The existing working tree is dirty, so code task branch and merge operations remain blocked until those changes are reviewed and isolated.

See [OPERATIONS.md](OPERATIONS.md) for recovery and [SAFETY.md](SAFETY.md) for gates and limitations.
