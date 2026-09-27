import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskGitContext, commitVerifiedTask, mergeVerifiedTask, pushVerifiedIntegration } from './git-integration.mjs';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Fixture Git ${args[0]} failed`);
  return result.stdout.trim();
}

test('isolated task branch commits, merges, checks, and pushes only integration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'edith-git-'));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  try {
    await mkdir(path.join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.name', 'EDITH Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(repo, 'src', 'example.txt'), 'before\n');
    git(repo, 'add', '--', 'src/example.txt');
    git(repo, 'commit', '-q', '-m', 'baseline');
    const mainCommit = git(repo, 'rev-parse', 'HEAD');
    git(root, 'init', '--bare', '-q', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    const task = {
      task_id: 'TEST-001', title: 'Fixture update', expected_files: ['src/example.txt'], protected_files: ['src/example.txt'],
      tests: ['fixture check'], qa_required: true, git_commit: true, git_push: true, risk_level: 'REVIEW',
    };
    const context = createTaskGitContext({ repository: repo, worktreeRoot: path.join(root, 'worktrees'), taskId: task.task_id });
    assert.equal(context.startingCommit, mainCommit);
    assert.equal(git(context.taskWorktree, 'branch', '--show-current'), 'agent/TEST-001');
    await writeFile(path.join(context.taskWorktree, 'src', 'example.txt'), 'after\n');
    const report = { status: 'completed', tests_run: ['fixture check'], tests_passed: ['fixture check passed'], tests_failed: [], blockers: [] };
    assert.throws(() => commitVerifiedTask({ context, task, report, qaStatus: 'blocked', gateStatus: 'passed' }), /QA not accepted/);
    assert.throws(() => commitVerifiedTask({ context, task, report, qaStatus: 'accepted', gateStatus: 'passed' }), /without lock/);
    const token = 'ghp_' + 'A'.repeat(30);
    await writeFile(path.join(context.taskWorktree, 'src', 'example.txt'), `token = "${token}"\n`);
    assert.throws(() => commitVerifiedTask({ context, task, report, qaStatus: 'accepted', gateStatus: 'passed', heldLocks: ['src/example.txt'] }), /Secret-like GitHub token/);
    await writeFile(path.join(context.taskWorktree, 'src', 'example.txt'), 'after\n');
    await writeFile(path.join(context.taskWorktree, 'src', 'unexpected.txt'), 'out of scope\n');
    assert.throws(() => commitVerifiedTask({ context, task, report, qaStatus: 'accepted', gateStatus: 'passed', heldLocks: ['src/example.txt'] }), /Unexpected modified file/);
    await unlink(path.join(context.taskWorktree, 'src', 'unexpected.txt'));
    const committed = commitVerifiedTask({ context, task, report, qaStatus: 'accepted', gateStatus: 'passed', heldLocks: ['src/example.txt'] });
    assert.equal(committed.status, 'committed');
    const merged = await mergeVerifiedTask({ context, taskCommit: committed.taskCommit, verifyIntegration: async cwd => (await readFile(path.join(cwd, 'src', 'example.txt'), 'utf8')).trim() === 'after' });
    assert.equal(merged.status, 'integrated');
    assert.throws(() => pushVerifiedIntegration({ context, task, mergeResult: { ...merged, integrationChecksPassed: false } }), /checks not accepted/);
    const pushed = pushVerifiedIntegration({ context, task, mergeResult: merged });
    assert.equal(pushed.status, 'pushed');
    assert.equal(git(remote, 'rev-parse', 'refs/heads/dev/integration'), merged.integrationCommit);
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), mainCommit);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), mainCommit);
  } finally {
    const tempRoot = path.resolve(tmpdir()) + path.sep;
    if (!path.resolve(root).startsWith(tempRoot)) throw new Error('Unsafe fixture cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
