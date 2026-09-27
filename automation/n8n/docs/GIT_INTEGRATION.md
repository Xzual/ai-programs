# Isolated Git integration module

`bin/git-integration.mjs` is a tested future-stage implementation. It is **not connected to the live n8n workflow** and cannot be invoked by the SAFE-only bridge. No branch, worktree, commit, merge, or push from this module has been run against the user's repository.

The module requires a clean repository and places task and integration worktrees outside it. It creates `agent/<TASK-ID>` and `dev/integration` branches without changing `main`. A task commit requires a passed Git gate, a completed structured report, explicit evidence for required tests, accepted QA when required, declared file scope, and clean staged content. The merge records the previous integration commit as a rollback reference and runs a caller-provided integration verifier. A failed verifier blocks push and preserves both worktrees for inspection. Push targets only `dev/integration` and checks that its HEAD still matches the verified merge commit. There is no force push, reset, or clean operation.

The temporary Git fixture test creates its own repository and bare remote. It verifies branch creation; rejection of unaccepted QA, a missing protected-file lock, secret-like content, and an out-of-scope file; task commit; integration merge and verification; push denial when checks fail; successful push to `dev/integration`; and an unchanged `main` branch. All fixture paths are verified to be inside the system temporary directory before cleanup.

The live bridge still has no authenticated control channel, isolated Codex-chat working directory, independent integration test runner, or GitHub credential. These are required before connecting the module or enabling code-changing dispatch. The current dirty checkout is rejected by the module's clean-tree precondition.
