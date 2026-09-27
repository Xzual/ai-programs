# Operations

## Start and stop

Start n8n with the existing local installation. Start the bridge with `node automation/n8n/bin/bridge.mjs`; `Ctrl+C` stops a foreground bridge. If launched in the background, identify its exact process and stop only that process. Do not stop unrelated n8n or EDITH services.

Open the saved `EDITH Development Orchestrator` workflow at `http://localhost:5678` and run it manually. The workflow is intentionally unpublished. Check its execution view and `reports/<run-id>/summary.json` after every run.

## Resume and stuck tasks

`prepare` is restart-aware: an already running task is not dispatched again. A task beyond `timeout_minutes` becomes blocked. Inspect its Codex task and local rollout first; a prompt may have run even if a network request failed. Do not blindly resend code-changing prompts.

For `QA-DRYRUN-001`, inspect `state/orchestrator-state.json`, `state/locks.json`, and the matching report directory. If an infrastructure fault occurred before dispatch, archive the state files under a run-specific name, increment `run_id` in `tasks/tasks.json`, and rerun. Keep the failed summary as evidence. Do not reset state merely to hide a failed audit.

## Locks

One resource may have one owner. A failed task retains its lock until an operator checks the task's actual file changes and performs explicit cleanup. Remove an abandoned lock only after confirming the owner task is idle, no work is in progress, and the working tree is preserved. Record the cleanup reason in state.

## Approval and QA

`MANUAL_APPROVAL` yields `approval_required` with the task, reason, risks, expected/protected files, planned commands, and a task SHA-256 digest. The final n8n node returns the request, and both summaries show it with overall status `approval_required`. Continue only after explicit user approval; record `{ "approved": true, "task_sha256": "<digest from approval request>", "approved_at": "<timestamp>" }` under `approvals.<task-id>` in `state/orchestrator-state.json` before rerunning. A changed task invalidates the old digest. No approval can be inferred from silence or a passing test. Code-changing dispatch remains disabled even with this record in the SAFE proof version.

For a QA rejection, keep the specialist report and Chat 8 findings. Within the retry limit, the bridge writes a draft fix prompt for the original owner and records a full draft task under `pending_fixes` in state with `review_required`. Review the findings and task scope before adding that draft to `tasks/tasks.json`; the SAFE proof version does not dispatch it. Do not mark the original task completed or push it. Malformed or unsafe QA output blocks the task and records an incident.

## Browser, Codex, and Git failures

If n8n or the browser is unreachable, keep the queue and working tree intact and verify `http://localhost:5678` in the existing browser. If Codex report polling times out, inspect the existing specialist task before retrying. The bridge treats missing structured JSON as blocked; it never assumes tests passed.

If Git validation fails, do not reset, clean, force push, or rewrite history. Inspect branch, diff, staged paths, test results, QA result, and any incident note. Resolve the cause, then run a fresh verified gate. Use a normal revert commit if a later integration must be undone.
