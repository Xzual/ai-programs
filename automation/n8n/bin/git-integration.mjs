import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { reportWarnings } from './report-gate.mjs';
import { scanChangeMetadata, secretTypes } from './safety-scan.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 5_000_000 });
  if (result.status !== 0) throw new Error(`Git ${args[0]} failed (exit ${result.status}); preserve worktrees for inspection`);
  return result.stdout.trim();
}

function clean(cwd) {
  if (git(cwd, 'status', '--porcelain=v1')) throw new Error('Git worktree is dirty');
}

function safeTaskId(taskId) {
  if (typeof taskId !== 'string' || !/^[A-Z][A-Z0-9-]{2,63}$/.test(taskId)) throw new Error('Unsafe task ID');
}

function within(root, target) {
  const base = path.resolve(root);
  const selected = path.resolve(target);
  if (!selected.startsWith(base + path.sep)) throw new Error('Worktree path escapes its root');
  return selected;
}

function paths(cwd) {
  return [...new Set([
    ...git(cwd, 'diff', '--name-only', '-z').split('\0').filter(Boolean),
    ...git(cwd, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean),
    ...git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
  ])];
}

export function createTaskGitContext({ repository, worktreeRoot, taskId }) {
  safeTaskId(taskId);
  const repo = path.resolve(repository);
  const root = path.resolve(worktreeRoot);
  if (root === repo || root.startsWith(repo + path.sep)) throw new Error('Worktree root must be outside the repository');
  if (path.resolve(git(repo, 'rev-parse', '--show-toplevel')) !== repo) throw new Error('Repository root mismatch');
  clean(repo);
  const startingCommit = git(repo, 'rev-parse', 'HEAD');
  const taskBranch = `agent/${taskId}`;
  const integrationBranch = 'dev/integration';
  const taskWorktree = within(root, path.join(root, taskId.toLowerCase()));
  const integrationWorktree = within(root, path.join(root, 'integration'));
  if (git(repo, 'branch', '--list', taskBranch)) throw new Error('Task branch already exists');
  if (git(repo, 'branch', '--list', integrationBranch)) {
    git(repo, 'worktree', 'add', integrationWorktree, integrationBranch);
  } else {
    git(repo, 'worktree', 'add', '-b', integrationBranch, integrationWorktree, startingCommit);
  }
  git(repo, 'worktree', 'add', '-b', taskBranch, taskWorktree, startingCommit);
  return { repository: repo, worktreeRoot: root, taskId, taskBranch, taskWorktree, integrationBranch, integrationWorktree, startingCommit };
}

export function commitVerifiedTask({ context, task, report, qaStatus, gateStatus, heldLocks = [] }) {
  if (context.taskId !== task.task_id || gateStatus !== 'passed') throw new Error('Task identity or Git gate not verified');
  if (reportWarnings(task, report).length) throw new Error('Specialist report or required tests not verified');
  if (task.qa_required && qaStatus !== 'accepted') throw new Error('QA not accepted');
  if (!task.git_commit) return { status: 'skipped', taskCommit: null };
  const cwd = context.taskWorktree;
  if (git(cwd, 'branch', '--show-current') !== context.taskBranch) throw new Error('Task branch mismatch');
  if (git(cwd, 'rev-parse', 'HEAD') !== context.startingCommit) throw new Error('Task starting commit changed');
  const changed = paths(cwd);
  if (!changed.length) throw new Error('No task changes to commit');
  const allowed = new Set([...(task.expected_files || []), ...(task.protected_files || [])]);
  const staged = git(cwd, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  const deleted = [git(cwd, 'diff', '--name-status'), git(cwd, 'diff', '--cached', '--name-status')].join('\n').split(/\r?\n/).filter(x => x.startsWith('D\t')).map(x => x.slice(2));
  const metadata = scanChangeMetadata({ changedPaths: changed, stagedPaths: staged, deletedPaths: deleted, deletionCounts: {}, task, heldLocks });
  if (metadata.length) throw new Error(`Task scope blocked: ${metadata[0]}`);
  if (changed.some(p => !allowed.has(p) || path.isAbsolute(p) || p.includes('..') || p.includes('\\'))) throw new Error('Unsafe task file path');
  for (const p of changed) {
    const file = path.join(cwd, p);
    if (statSync(file).size > 5_000_000) throw new Error(`Changed file too large for secret scan: ${p}`);
    const types = secretTypes(readFileSync(file, 'utf8'));
    if (types.length) throw new Error(`Secret-like ${types[0]} in ${p}`);
  }
  git(cwd, 'add', '--', ...changed);
  git(cwd, 'diff', '--cached', '--check');
  const stagedAfter = git(cwd, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  if (stagedAfter.length !== changed.length || stagedAfter.some(p => !allowed.has(p))) throw new Error('Staged scope mismatch');
  git(cwd, 'commit', '-m', `task(${task.task_id}): ${task.title.replace(/[\r\n]+/g, ' ').slice(0, 160)}`);
  const taskCommit = git(cwd, 'rev-parse', 'HEAD');
  clean(cwd);
  return { status: 'committed', taskCommit };
}

export async function mergeVerifiedTask({ context, taskCommit, verifyIntegration }) {
  if (!/^[0-9a-f]{40}$/.test(taskCommit)) throw new Error('Task commit missing');
  if (typeof verifyIntegration !== 'function') throw new Error('Integration verifier missing');
  if (git(context.taskWorktree, 'rev-parse', 'HEAD') !== taskCommit) throw new Error('Task branch HEAD mismatch');
  const cwd = context.integrationWorktree;
  if (git(cwd, 'branch', '--show-current') !== context.integrationBranch) throw new Error('Integration branch mismatch');
  clean(cwd);
  const rollbackReference = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'merge', '--no-ff', '--no-edit', context.taskBranch);
  const integrationCommit = git(cwd, 'rev-parse', 'HEAD');
  if (integrationCommit === rollbackReference) throw new Error('Integration merge produced no commit');
  clean(cwd);
  const integrationChecksPassed = await verifyIntegration(cwd);
  if (integrationChecksPassed !== true) return { status: 'blocked', taskCommit, integrationCommit, rollbackReference, integrationChecksPassed: false };
  return { status: 'integrated', taskCommit, integrationCommit, rollbackReference, integrationChecksPassed: true };
}

export function pushVerifiedIntegration({ context, task, mergeResult }) {
  if (!task.git_push) return { status: 'skipped', pushResult: 'skipped' };
  if (mergeResult.status !== 'integrated' || mergeResult.integrationChecksPassed !== true) throw new Error('Integration checks not accepted');
  if (git(context.integrationWorktree, 'branch', '--show-current') !== 'dev/integration') throw new Error('Integration branch mismatch');
  if (git(context.integrationWorktree, 'rev-parse', 'HEAD') !== mergeResult.integrationCommit) throw new Error('Integration HEAD changed after checks');
  clean(context.integrationWorktree);
  git(context.integrationWorktree, 'push', 'origin', 'refs/heads/dev/integration:refs/heads/dev/integration');
  return { status: 'pushed', pushResult: 'pushed', integrationCommit: mergeResult.integrationCommit, rollbackReference: mergeResult.rollbackReference };
}
