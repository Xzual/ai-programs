# Safety rules and current boundary

- The local bridge binds to `127.0.0.1` and currently accepts only the fixed SAFE read-only dry-run task. It has no code-changing dispatch path enabled.
- Do not commit or print credentials, API keys, passwords, `.env` contents, private keys, local databases, logs, backups, `.venv`, or screenshots unless a reviewed task explicitly calls for a tracked artifact.
- Do not force push, run destructive Git clean/reset operations, delete user data, disable the kill switch, enable live trading, or install community nodes without review and approval.
- The bridge does not contain GitHub credentials. A later GitHub credential must be entered manually into n8n Credentials or a secure local configuration, never into a workflow JSON or chat.
- `MANUAL_APPROVAL` work must pause for explicit user approval. A high-risk task cannot become SAFE through a prompt label alone.
- Missing test data remains missing; the report normalizer does not turn absence into a pass.
- A local HTTP request by another process could reach the loopback bridge. This first version is safe only because its sole dispatchable task is read-only and fixed. Add authenticated requests before enabling any code-changing endpoint.
- The specialist chat runs in the user's existing dirty checkout. The bridge compares Git status before and after the dry-run and blocks completion on a change, but that comparison cannot prevent an edit before it occurs. Keep code-changing execution disabled until isolated branches/worktrees and Git gates are fully implemented and verified.
- The code-task Git gate scans staged, unstaged, and untracked paths and checks changed file contents for secret patterns. It blocks user-data paths, deletions, missing protected-file locks, and sensitive control/trading paths without manual approval. Isolated fixtures prove key denial paths; the live code-task branch remains disabled and untested.
- `codex exec resume` cannot write to an existing desktop-owned task because of an active-writer lock. `codex queue` is the verified local transport for those tasks. The rollout reader expects exactly one local session file per mapped task.

The workflow is not an autonomous development loop. It remains unpublished after the SAFE proof run.
