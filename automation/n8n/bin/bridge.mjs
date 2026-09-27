import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { scanChangeMetadata, secretTypes } from './safety-scan.mjs';
import { approvalGranted, approvalRequest, resourcesOverlap } from './policy.mjs';
import { reportWarnings } from './report-gate.mjs';
import { parseSpecialistReport } from './report-parser.mjs';
import { draftFixTask, parseQaDecision } from './qa-policy.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(base, '../..');
const queuePath = path.join(base, 'tasks', 'tasks.json');
const statePath = path.join(base, 'state', 'orchestrator-state.json');
const locksPath = path.join(base, 'state', 'locks.json');
const port = Number(process.env.EDITH_N8N_BRIDGE_PORT || 8765);
const roles = Object.freeze({
  '0': '01a03f15-eb5d-7eb2-904b-c1607e2a8b5e',
  '2': '01a03f18-3215-7090-8bbf-7552030db0b7',
  '4': '01a03f21-5c27-74b3-b98b-cc36f5dbb2eb',
  '5': '01a04f0b-046c-7a41-acc3-538042e8cfae',
  '6': '01a04f0d-5c4f-7a70-a5e2-86ed74f56253',
  '7': '01a04f0d-7a3d-7de0-b829-5a771fbaaefb',
  '8': '01a04f0d-939a-7671-8862-001815b861bc',
});
const conflictFiles = ['src/App.tsx', 'src/components/ui/edithOS.tsx', 'server.ts', 'package.json', 'package-lock.json', 'src/types.ts'];
const required = ['task_id', 'title', 'owner_chat', 'prompt_file', 'dependencies', 'priority', 'risk_level', 'tests', 'success_conditions', 'qa_required', 'git_commit', 'git_push', 'timeout_minutes', 'retry_limit', 'status'];
const severity = { critical: 4, high: 3, normal: 2, low: 1 };
const now = () => new Date().toISOString();

function git(...args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed (exit ${result.status})`);
  return result.stdout.trim();
}
async function sourceSnapshot() {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const untrackedApp = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(p => /^(?:src|server|scripts|crypto|src-tauri)\//.test(p));
  const result = {};
  for (const p of [...new Set([...tracked, ...untrackedApp])].sort()) {
    if (!relativeSafe(p)) throw new Error('Unsafe path in Git source snapshot');
    try { result[p] = createHash('sha256').update(await readFile(path.join(repo, p))).digest('hex'); }
    catch (e) { if (e.code === 'ENOENT') result[p] = 'MISSING'; else throw e; }
  }
  return result;
}
async function dryRunWarning(taskState) {
  if (git('rev-parse', 'HEAD') !== taskState.starting_commit) return 'Commit changed during read-only audit';
  if (git('status', '--porcelain=v1') !== taskState.starting_status) return 'Working tree changed during read-only audit';
  if (!taskState.source_hashes || JSON.stringify(await sourceSnapshot()) !== JSON.stringify(taskState.source_hashes)) return 'Application source contents changed during read-only audit';
  return null;
}
async function codeInFlightWarning(task, locks) {
  const stagedPaths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  const changedPaths = [...new Set([
    ...git('diff', '--name-only', '-z').split('\0').filter(Boolean),
    ...stagedPaths,
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
  ])];
  const nameStatus = [git('diff', '--name-status'), git('diff', '--cached', '--name-status')].join('\n');
  const numstat = [git('diff', '--numstat'), git('diff', '--cached', '--numstat')].join('\n');
  const deletedPaths = nameStatus.split(/\r?\n/).filter(line => line.startsWith('D\t')).map(line => line.slice(2));
  const deletionCounts = {};
  for (const line of numstat.split(/\r?\n/)) {
    const [added, deleted, ...pathParts] = line.split('\t');
    if (/^\d+$/.test(deleted) && pathParts.length) deletionCounts[pathParts.join('\t')] = Math.max(deletionCounts[pathParts.join('\t')] || 0, Number(deleted));
  }
  const heldLocks = locks.locks.filter(l => l.task_id === task.task_id && l.status === 'locked').map(l => l.resource);
  const warnings = scanChangeMetadata({ changedPaths, stagedPaths, deletedPaths, deletionCounts, task, heldLocks });
  if (warnings.length) return warnings[0];
  for (const p of changedPaths) {
    if (!relativeSafe(p)) return `Unsafe changed path: ${p}`;
    if (conflictFiles.includes(p) && !heldLocks.includes(p)) return `High-conflict file changed without lock: ${p}`;
    try {
      const file = path.join(repo, p);
      if ((await stat(file)).size > 5_000_000) return `Changed file too large for secret scan: ${p}`;
      const types = secretTypes(await readFile(file, 'utf8'));
      if (types.length) return `Working-tree ${types[0]}: ${p}`;
    } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw e; }
  }
  for (const p of stagedPaths) {
    if (!relativeSafe(p)) return `Unsafe staged path: ${p}`;
    try {
      const types = secretTypes(git('show', `:${p}`));
      if (types.length) return `Staged ${types[0]}: ${p}`;
    } catch { return `Unable to scan staged path: ${p}`; }
  }
  return null;
}
function relativeSafe(p) {
  if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.includes('..') || p.includes('\\') || p.startsWith('/')) return false;
  return path.resolve(repo, p).startsWith(repo + path.sep);
}
async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function atomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
}
function validate(queue) {
  if (!queue || typeof queue.run_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(queue.run_id) || !Array.isArray(queue.tasks)) throw new Error('Invalid queue envelope');
  if (Object.keys(queue).some(k => !['run_id', 'tasks'].includes(k))) throw new Error('Unexpected queue field');
  const ids = new Set();
  for (const t of queue.tasks) {
    for (const k of required) if (!(k in t)) throw new Error(`Task missing ${k}`);
    if (Object.keys(t).some(k => ![...required, 'expected_files', 'protected_files', 'notes', 'manual_approval_reason'].includes(k))) throw new Error(`Unexpected task field: ${t.task_id}`);
    if (!/^[A-Z][A-Z0-9-]{2,63}$/.test(t.task_id) || ids.has(t.task_id)) throw new Error('Invalid or duplicate task ID');
    ids.add(t.task_id);
    if (typeof t.title !== 'string' || !t.title.trim()) throw new Error(`Invalid title: ${t.task_id}`);
    if (!(t.owner_chat in roles) || !['SAFE', 'REVIEW', 'MANUAL_APPROVAL'].includes(t.risk_level) || !(t.priority in severity)) throw new Error(`Invalid routing or risk: ${t.task_id}`);
    if (!Array.isArray(t.dependencies) || !Array.isArray(t.tests) || !Array.isArray(t.success_conditions) || !Array.isArray(t.expected_files || []) || !Array.isArray(t.protected_files || [])) throw new Error(`Invalid arrays: ${t.task_id}`);
    for (const key of ['dependencies', 'tests', 'success_conditions', 'expected_files', 'protected_files']) if ((t[key] || []).some(x => typeof x !== 'string')) throw new Error(`Invalid ${key} values: ${t.task_id}`);
    if (!t.success_conditions.length || new Set(t.dependencies).size !== t.dependencies.length || new Set(t.expected_files || []).size !== (t.expected_files || []).length || new Set(t.protected_files || []).size !== (t.protected_files || []).length) throw new Error(`Invalid task lists: ${t.task_id}`);
    for (const key of ['notes', 'manual_approval_reason']) if (t[key] !== undefined && typeof t[key] !== 'string') throw new Error(`Invalid ${key}: ${t.task_id}`);
    if (![t.qa_required, t.git_commit, t.git_push].every(x => typeof x === 'boolean') || !Number.isInteger(t.timeout_minutes) || t.timeout_minutes < 1 || t.timeout_minutes > 480 || !Number.isInteger(t.retry_limit) || t.retry_limit < 0 || t.retry_limit > 3) throw new Error(`Invalid policy: ${t.task_id}`);
    if (!['queued', 'running', 'completed', 'failed', 'blocked', 'needs_fix'].includes(t.status)) throw new Error(`Invalid status: ${t.task_id}`);
    if (!relativeSafe(t.prompt_file) || t.prompt_file !== `automation/n8n/prompts/chat${t.owner_chat}/${t.task_id}.txt`) throw new Error(`Invalid prompt path: ${t.task_id}`);
    for (const p of [...(t.expected_files || []), ...(t.protected_files || [])]) if (!relativeSafe(p)) throw new Error(`Unsafe file path: ${t.task_id}`);
  }
  for (const t of queue.tasks) for (const d of t.dependencies) if (!ids.has(d) || d === t.task_id) throw new Error(`Invalid dependency: ${t.task_id}`);
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Dependency cycle');
    if (done.has(id)) return;
    visiting.add(id);
    for (const d of queue.tasks.find(t => t.task_id === id).dependencies) visit(d);
    visiting.delete(id); done.add(id);
  }
  for (const id of ids) visit(id);
}
function resources(t) { return [...new Set([...(t.expected_files || []), ...(t.protected_files || [])])]; }
async function load() {
  const queue = await json(queuePath, null); validate(queue);
  const state = await json(statePath, { run_id: queue.run_id, tasks: {}, approvals: {}, incidents: [], errors: {}, created_at: now() });
  const locks = await json(locksPath, { locks: [] });
  if (state.run_id !== queue.run_id) throw new Error('Run ID changed; archive state before starting another run');
  if (!Array.isArray(locks.locks)) throw new Error('Invalid locks state');
  return { queue, state, locks };
}
async function save(state, locks) { await atomic(statePath, state); await atomic(locksPath, locks); }
function taskState(state, t) { return state.tasks[t.task_id] || { status: t.status, attempts: 0 }; }
function incident(state, taskId, reason) {
  state.incidents.push({ task_id: taskId, at: now(), reason });
  state.errors[reason] = (state.errors[reason] || 0) + 1;
}
async function prepare() {
  const { queue, state, locks } = await load();
  state.starting_commit ||= git('rev-parse', 'HEAD');
  state.integration_branch ||= git('branch', '--show-current');
  for (const t of queue.tasks) {
    const s = taskState(state, t);
    if (s.status === 'completed') {
      let reportPresent = false;
      if (s.report && relativeSafe(s.report)) {
        try { await stat(path.join(repo, s.report)); reportPresent = true; } catch { /* Missing report blocks a completed task. */ }
      }
      if (!reportPresent) {
        s.status = 'blocked'; s.reason = 'Completed task report missing'; state.tasks[t.task_id] = s;
        incident(state, t.task_id, s.reason); await save(state, locks);
        return { action: 'blocked', task_id: t.task_id, reason: s.reason };
      }
    }
    if (s.status === 'running') {
      const age = Date.now() - Date.parse(s.started_at || 0);
      if (age > t.timeout_minutes * 60000) { s.status = 'blocked'; s.reason = 'Watchdog timeout'; state.tasks[t.task_id] = s; incident(state, t.task_id, s.reason); await save(state, locks); return { action: 'blocked', task_id: t.task_id, reason: s.reason }; }
      return { action: 'blocked', task_id: t.task_id, reason: 'Task already running; inspect before resume' };
    }
  }
  const candidates = queue.tasks.filter(t => taskState(state, t).status === 'queued').sort((a, b) => severity[b.priority] - severity[a.priority]);
  for (const t of candidates) {
    const depStatuses = t.dependencies.map(id => taskState(state, queue.tasks.find(x => x.task_id === id)).status);
    if (depStatuses.some(x => ['failed', 'blocked', 'needs_fix'].includes(x))) { state.tasks[t.task_id] = { ...taskState(state, t), status: 'blocked', reason: 'Dependency failed or blocked' }; continue; }
    if (depStatuses.some(x => x !== 'completed')) continue;
    if (!approvalGranted(t, state.approvals[t.task_id])) {
      const request = approvalRequest(t);
      state.approval_requests ||= {};
      state.approval_requests[t.task_id] = request;
      await save(state, locks);
      return { action: 'approval_required', ...request };
    }
    // The first version is intentionally restricted to SAFE, read-only work.
    if (t.task_id !== 'QA-DRYRUN-001' || t.risk_level !== 'SAFE' || t.git_commit || t.git_push || t.qa_required) { state.tasks[t.task_id] = { ...taskState(state, t), status: 'blocked', reason: 'Code-changing dispatch disabled until the read-only proof and a reviewed enablement' }; continue; }
    const held = resources(t).find(r => locks.locks.some(l => l.status === 'locked' && resourcesOverlap(l.resource, r)));
    if (held) continue;
    for (const resource of resources(t)) locks.locks.push({ resource, task_id: t.task_id, owner_chat: t.owner_chat, acquired_at: now(), status: 'locked' });
    state.tasks[t.task_id] = { status: 'running', attempts: taskState(state, t).attempts + 1, started_at: now(), starting_commit: git('rev-parse', 'HEAD'), starting_status: git('status', '--porcelain=v1'), source_hashes: t.task_id === 'QA-DRYRUN-001' ? await sourceSnapshot() : null };
    await save(state, locks);
    return { action: 'dispatch', task_id: t.task_id, owner_chat: t.owner_chat, thread_id: roles[t.owner_chat] };
  }
  await save(state, locks);
  return { action: 'summarize', reason: 'No eligible queued task' };
}
async function rolloutPath(threadId) {
  const root = path.join(homedir(), '.codex', 'sessions');
  const files = (await readdir(root, { recursive: true })).filter(p => p.endsWith(`${threadId}.jsonl`));
  if (files.length !== 1) throw new Error(`Expected one local rollout for Chat ${threadId}; found ${files.length}`);
  return path.join(root, files[0]);
}
function queueMessage(threadId, prompt) {
  if (prompt.length > 20000) throw new Error('Prompt exceeds 20,000 character queue limit');
  return new Promise(resolve => {
    const child = spawn('codex.exe', ['queue', '--thread', threadId, '--message', prompt], { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-2000); });
    child.on('error', e => resolve({ ok: false, reason: `Codex queue launch failed: ${e.code || e.message}` }));
    child.on('exit', code => resolve({ ok: code === 0 && /Queued message [0-9a-f-]+/.test(output), reason: `Codex queue exit ${code}` }));
  });
}
async function runCodex(threadId, taskId, prompt, timeoutMs, guard = null) {
  const file = await rolloutPath(threadId);
  const offset = (await stat(file)).size;
  const queued = await queueMessage(threadId, prompt);
  if (!queued.ok) return queued;
  const deadline = Date.now() + timeoutMs;
  let lastGuardAt = 0;
  while (Date.now() < deadline) {
    if (guard && Date.now() - lastGuardAt >= 5000) {
      lastGuardAt = Date.now();
      try {
        const warning = await guard();
        if (warning) return { ok: false, reason: `Watchdog hard stop: ${warning}` };
      } catch { return { ok: false, reason: 'Watchdog inspection failed; inspect the task before retrying' }; }
    }
    const appended = (await readFile(file)).subarray(offset).toString('utf8');
    const records = appended.split(/\r?\n/).slice(0, -1).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    let turn = null, matched = false, finalText = null;
    for (const record of records) {
      const p = record.payload || {};
      if (record.type === 'event_msg' && p.type === 'task_started') { turn = p.turn_id; matched = false; finalText = null; }
      if (record.type === 'response_item' && p.type === 'message' && p.role === 'user') matched = p.content?.some(c => c.type === 'input_text' && c.text?.includes(taskId));
      if (matched && record.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer') finalText = p.content?.find(c => c.type === 'output_text')?.text || null;
      if (matched && record.type === 'event_msg' && p.type === 'task_complete' && p.turn_id === turn && finalText) return { ok: true, raw: finalText, turn_id: turn };
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return { ok: false, reason: 'Codex report polling timed out; inspect the chat before retrying' };
}
async function dispatch(taskId) {
  const { queue, state, locks } = await load();
  const t = queue.tasks.find(x => x.task_id === taskId);
  if (!t || taskState(state, t).status !== 'running') throw new Error('Task is not prepared');
  if (state.tasks[t.task_id].report) return { action: 'finalize', task_id: t.task_id, report_status: state.tasks[t.task_id].reported_status };
  if (state.tasks[t.task_id].dispatch_started_at) return { action: 'blocked', task_id: t.task_id, reason: 'Dispatch already started; inspect the Codex task before retrying' };
  const dir = path.join(base, 'reports', queue.run_id);
  await mkdir(dir, { recursive: true });
  const rawPath = path.join(dir, `chat${t.owner_chat}-${t.task_id}.md`);
  const reportPath = path.join(dir, `chat${t.owner_chat}-${t.task_id}.json`);
  const prompt = await readFile(path.join(repo, t.prompt_file), 'utf8');
  state.tasks[t.task_id].dispatch_started_at = now();
  await save(state, locks);
  const guard = async () => {
    if (git('branch', '--show-current') !== state.integration_branch) return 'Branch mismatch during task';
    if (t.task_id === 'QA-DRYRUN-001') return dryRunWarning(state.tasks[t.task_id]);
    return codeInFlightWarning(t, await json(locksPath, { locks: [] }));
  };
  const result = await runCodex(roles[t.owner_chat], t.task_id, prompt, t.timeout_minutes * 60000, guard);
  if (!result.ok) {
    state.tasks[t.task_id] = { ...state.tasks[t.task_id], status: 'blocked', reason: result.reason, ended_at: now() };
    incident(state, t.task_id, result.reason); await save(state, locks);
    return { action: 'blocked', task_id: t.task_id, reason: result.reason };
  }
  try {
    const raw = result.raw;
    const leaked = secretTypes(raw);
    if (leaked.length) throw new Error(`Secret-like content in ${path.relative(repo, rawPath).replaceAll('\\', '/')}: ${leaked.join(', ')}`);
    await writeFile(rawPath, raw + '\n', 'utf8');
    const report = parseSpecialistReport(raw, t, { startingCommit: state.tasks[t.task_id].starting_commit });
    await atomic(reportPath, report);
    state.tasks[t.task_id] = { ...state.tasks[t.task_id], report: path.relative(repo, reportPath).replaceAll('\\', '/'), raw_report: path.relative(repo, rawPath).replaceAll('\\', '/'), reported_status: report.status };
    await save(state, locks);
    return { action: 'finalize', task_id: t.task_id, report_status: report.status };
  } catch (e) {
    state.tasks[t.task_id] = { ...state.tasks[t.task_id], status: 'blocked', reason: e.message, ended_at: now() };
    incident(state, t.task_id, e.message); await save(state, locks);
    return { action: 'blocked', task_id: t.task_id, reason: e.message };
  }
}
async function qa(taskId) {
  const { queue, state, locks } = await load();
  const t = queue.tasks.find(x => x.task_id === taskId);
  if (!t || !state.tasks[t.task_id]?.report) throw new Error('No specialist report for QA');
  if (!t.qa_required) { state.tasks[t.task_id].qa_status = 'skipped'; await save(state, locks); return { action: 'git_gate', task_id: taskId, qa_status: 'skipped' }; }
  if (state.tasks[t.task_id].qa_status === 'accepted') return { action: 'git_gate', task_id: taskId, qa_status: 'accepted' };
  if (state.tasks[t.task_id].qa_started_at) return { action: 'summarize', task_id: taskId, qa_status: 'blocked', reason: 'QA dispatch already started; inspect Chat 8 before retrying' };
  const report = await json(path.join(repo, state.tasks[t.task_id].report), null);
  if (!report) throw new Error('Specialist report file missing for QA');
  const qaPrompt = `QA-ROUTE-ID: ${t.task_id}-QA. Read-only QA review for ${t.task_id}. Original task:\n${JSON.stringify(t)}\nSpecialist report:\n${JSON.stringify(report)}\nVerify the listed tests and changed files independently. Do not modify application code, commit, or push. End with one fenced JSON object with qa_status (accepted|needs_fix|blocked), findings (array of strings), and next_step (string). Preserve any not-tested result.`;
  state.tasks[t.task_id].qa_started_at = now();
  state.tasks[t.task_id].qa_starting_commit = git('rev-parse', 'HEAD');
  state.tasks[t.task_id].qa_starting_status = git('status', '--porcelain=v1');
  state.tasks[t.task_id].qa_source_hashes = await sourceSnapshot();
  await save(state, locks);
  const qaBaseline = { starting_commit: state.tasks[t.task_id].qa_starting_commit, starting_status: state.tasks[t.task_id].qa_starting_status, source_hashes: state.tasks[t.task_id].qa_source_hashes };
  const result = await runCodex(roles['8'], `${t.task_id}-QA`, qaPrompt, t.timeout_minutes * 60000, () => dryRunWarning(qaBaseline));
  if (!result.ok) { state.tasks[t.task_id].status = 'blocked'; state.tasks[t.task_id].reason = result.reason; incident(state, taskId, result.reason); await save(state, locks); return { action: 'summarize', task_id: taskId, qa_status: 'blocked' }; }
  try {
    const qaReport = parseQaDecision(result.raw);
    const dir = path.join(base, 'reports', queue.run_id);
    await writeFile(path.join(dir, `chat8-${t.task_id}-QA.md`), result.raw + '\n', 'utf8');
    await atomic(path.join(dir, `chat8-${t.task_id}-QA.json`), qaReport);
    state.tasks[t.task_id].qa_status = qaReport.qa_status;
    if (qaReport.qa_status !== 'accepted') {
      state.tasks[t.task_id].status = qaReport.qa_status === 'needs_fix' ? 'needs_fix' : 'blocked';
      state.pending_fixes ||= [];
      const draft = draftFixTask(t, state.tasks[t.task_id].attempts, qaReport);
      if (draft) {
        await writeFile(path.join(repo, draft.task.prompt_file), draft.prompt, 'utf8');
        const { prompt, ...record } = draft;
        state.pending_fixes.push(record);
      }
    }
    await save(state, locks);
    return { action: qaReport.qa_status === 'accepted' ? 'git_gate' : 'summarize', task_id: taskId, qa_status: qaReport.qa_status };
  } catch (e) {
    state.tasks[t.task_id].status = 'blocked';
    state.tasks[t.task_id].reason = 'QA report rejected: malformed, unsafe, or could not be saved';
    incident(state, taskId, state.tasks[t.task_id].reason);
    await save(state, locks);
    return { action: 'summarize', task_id: taskId, qa_status: 'blocked' };
  }
}
async function gitGate(taskId) {
  const { queue, state, locks } = await load();
  const t = queue.tasks.find(x => x.task_id === taskId);
  if (!t || !state.tasks[t.task_id]?.report) throw new Error('No specialist report for Git gate');
  const s = state.tasks[t.task_id];
  const report = await json(path.join(repo, s.report), null);
  const warnings = reportWarnings(t, report);
  if (git('branch', '--show-current') !== state.integration_branch) warnings.push('Branch mismatch');
  const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  if (staged.some(p => /(^|\/)\.env(?:\.|$)|\.(?:db|sqlite|sqlite3)$|(^|\/)(?:logs|backups|\.venv)\//i.test(p))) warnings.push('Protected runtime or credential path staged');
  if (staged.some(p => !relativeSafe(p))) warnings.push('Unsafe staged path');
  for (const p of staged) {
    if (!relativeSafe(p)) continue;
    try { for (const type of secretTypes(git('show', `:${p}`))) warnings.push(`Staged ${type}: ${p}`); }
    catch { warnings.push(`Unable to scan staged path: ${p}`); }
  }
  if (git('diff', '--cached', '--name-status').split(/\r?\n/).some(line => line.startsWith('D\t'))) warnings.push('Unexpected staged deletion');
  if (t.task_id === 'QA-DRYRUN-001') {
    if (git('rev-parse', 'HEAD') !== s.starting_commit) warnings.push('Commit changed during read-only audit');
    if (git('status', '--porcelain=v1') !== s.starting_status) warnings.push('Working tree changed during read-only audit');
    if (!s.source_hashes || JSON.stringify(await sourceSnapshot()) !== JSON.stringify(s.source_hashes)) warnings.push('Application source contents changed during read-only audit');
  } else {
    if (s.starting_status) warnings.push('Code task started from dirty working tree');
    if (git('rev-parse', 'HEAD') !== s.starting_commit) warnings.push('Commit changed before orchestrator integration');
    const changed = [...new Set([
      ...git('diff', '--name-only', '-z').split('\0').filter(Boolean),
      ...staged,
      ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
    ])];
    const nameStatus = [git('diff', '--name-status'), git('diff', '--cached', '--name-status')].join('\n');
    const numstat = [git('diff', '--numstat'), git('diff', '--cached', '--numstat')].join('\n');
    const deletedPaths = nameStatus.split(/\r?\n/).filter(line => line.startsWith('D\t')).map(line => line.slice(2));
    const deletionCounts = {};
    for (const line of numstat.split(/\r?\n/)) {
      const [added, deleted, ...pathParts] = line.split('\t');
      if (/^\d+$/.test(deleted) && pathParts.length) deletionCounts[pathParts.join('\t')] = Math.max(deletionCounts[pathParts.join('\t')] || 0, Number(deleted));
    }
    const heldLocks = locks.locks.filter(l => l.task_id === taskId && l.status === 'locked').map(l => l.resource);
    warnings.push(...scanChangeMetadata({ changedPaths: changed, stagedPaths: staged, deletedPaths, deletionCounts, task: t, heldLocks }));
    for (const p of changed) {
      if (!relativeSafe(p)) { warnings.push(`Unsafe changed path: ${p}`); continue; }
      if (conflictFiles.includes(p) && !heldLocks.includes(p)) warnings.push(`High-conflict file changed without lock: ${p}`);
      try {
        const file = path.join(repo, p);
        if ((await stat(file)).size > 5_000_000) { warnings.push(`Changed file too large for secret scan: ${p}`); continue; }
        for (const type of secretTypes(await readFile(file, 'utf8'))) warnings.push(`Working-tree ${type}: ${p}`);
      }
      catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw e; }
    }
    if (t.qa_required && s.qa_status !== 'accepted') warnings.push('QA not accepted');
  }
  s.git_gate = { status: warnings.length ? 'blocked' : 'passed', checked_at: now(), warnings };
  if (warnings.length) { s.status = 'blocked'; s.reason = 'Git safety gate blocked'; for (const warning of warnings) incident(state, taskId, warning); }
  await save(state, locks);
  return { action: warnings.length ? 'summarize' : 'finalize', task_id: taskId, gate_status: s.git_gate.status, warnings };
}
async function finalize(taskId) {
  const { queue, state, locks } = await load();
  const t = queue.tasks.find(x => x.task_id === taskId);
  if (!t || !state.tasks[t.task_id]?.report) throw new Error('No report to finalize');
  const s = state.tasks[t.task_id];
  if (!s.git_gate) { await gitGate(taskId); return finalize(taskId); }
  const report = await json(path.join(repo, s.report), null);
  if (s.git_gate.status === 'blocked') {
    s.status = 'blocked'; s.reason ||= 'Git safety gate blocked';
  } else if (t.qa_required && s.qa_status !== 'accepted') {
    s.status = 'blocked'; s.reason = 'QA not accepted'; incident(state, t.task_id, s.reason);
  } else if (t.task_id === 'QA-DRYRUN-001' && git('status', '--porcelain=v1') !== s.starting_status) {
    s.status = 'blocked'; s.reason = 'Working tree changed during read-only audit'; incident(state, t.task_id, s.reason);
  } else if (t.task_id === 'QA-DRYRUN-001' && report.files_changed.length > 0) {
    s.status = 'blocked'; s.reason = 'Specialist reported file changes during read-only audit'; incident(state, t.task_id, s.reason);
  } else if (t.git_commit || t.git_push) {
    s.status = 'blocked'; s.reason = 'Commit and push integration are not enabled'; incident(state, t.task_id, s.reason);
  } else {
    s.status = report.status;
  }
  s.ended_at = now(); s.ending_commit = git('rev-parse', 'HEAD');
  locks.locks = locks.locks.filter(l => l.task_id !== t.task_id);
  await save(state, locks);
  return { action: 'summarize', task_id: t.task_id, status: s.status, reason: s.reason || null };
}
async function summarize() {
  const { queue, state, locks } = await load();
  const records = queue.tasks.map(t => ({ task: t, state: taskState(state, t) }));
  const reports = {};
  for (const { task, state: s } of records) if (s.report) reports[task.task_id] = await json(path.join(repo, s.report), null);
  const byStatus = status => records.filter(x => x.state.status === status).map(x => x.task.task_id);
  const failedTests = Object.values(reports).flatMap(r => r?.tests_failed || []);
  const pendingApprovals = Object.values(state.approval_requests || {}).filter(x => {
    const task = queue.tasks.find(t => t.task_id === x.task_id);
    return !task || !approvalGranted(task, state.approvals[x.task_id]);
  });
  const summary = {
    run_id: queue.run_id,
    date: now(),
    overall_status: byStatus('blocked').length || byStatus('failed').length ? 'blocked' : pendingApprovals.length ? 'approval_required' : records.every(x => x.state.status === 'completed') ? 'completed' : 'incomplete',
    starting_commit: state.starting_commit || '',
    ending_commit: git('rev-parse', 'HEAD'),
    completed_tasks: byStatus('completed'),
    failed_tasks: byStatus('failed'),
    blocked_tasks: byStatus('blocked'),
    qa_rejections: byStatus('needs_fix'),
    manual_approvals_pending: pendingApprovals,
    conflicts: state.incidents.filter(x => /conflict|lock|working tree/i.test(x.reason)).map(x => x.reason),
    failed_tests: failedTests,
    security_warnings: state.incidents.filter(x => /secret|\.env|permission|trading/i.test(x.reason)).map(x => x.reason),
    git: { branch: state.integration_branch || git('branch', '--show-current'), push_status: 'skipped', rollback_reference: state.starting_commit || '', locks_held: locks.locks.length, source_hash_files: Object.keys(state.tasks['QA-DRYRUN-001']?.source_hashes || {}).length, source_hash_verified: state.tasks['QA-DRYRUN-001']?.git_gate?.status === 'passed' && Boolean(state.tasks['QA-DRYRUN-001']?.source_hashes) },
    orchestrator_limitations: [
      'Code-changing dispatch, task branches, integration merge, commit, and push are not enabled in this SAFE proof version.',
      'The MANUAL_APPROVAL and QA rejection/fix branches exist but have not been exercised end to end.',
      'The loopback bridge has no request authentication and must not be used for code-changing tasks.',
      'No external notification channel is configured; results appear in n8n execution output and local reports.'
    ],
    recommended_next_tasks: [...new Set([
      ...records.filter(x => x.state.status === 'blocked').map(x => `Resolve ${x.task.task_id}: ${x.state.reason || 'blocked'}`),
      ...Object.values(reports).map(r => r?.next_step).filter(Boolean),
      'Review and isolate the pre-existing working-tree changes before any code-changing task.',
      'Verify QA, approval, and Git gates with isolated fixtures before enabling code-changing dispatch.'
    ])].slice(0, 3),
  };
  const dir = path.join(base, 'reports', queue.run_id);
  await mkdir(dir, { recursive: true });
  await atomic(path.join(dir, 'summary.json'), summary);
  if (state.incidents.length) await writeFile(path.join(dir, 'incidents.md'), ['# EDITH incident notes', '', ...state.incidents.flatMap(x => [`## ${x.task_id}`, `Time: ${x.at}`, `Reason: ${x.reason}`, ''])].join('\n'), 'utf8');
  const lines = ['# EDITH TOPLU CHAT RAPORU', '', `Run ID: ${summary.run_id}`, `Date: ${summary.date}`, `Starting Commit: ${summary.starting_commit}`, `Ending Commit: ${summary.ending_commit}`, `Integration Branch: ${summary.git.branch}`, `Overall Status: ${summary.overall_status}`, ''];
  for (const role of Object.keys(roles)) {
    lines.push(`## Chat ${role}`);
    const owned = records.filter(x => x.task.owner_chat === role);
    if (!owned.length) lines.push('Task: Yok', 'Status: Çalıştırılmadı');
    for (const { task, state: s } of owned) {
      const r = reports[task.task_id];
      lines.push(`Task: ${task.task_id} — ${task.title}`, `Status: ${s.status}`, `Files: ${(r?.files_changed || []).join(', ') || 'Yok'}`, `Tests: ${(r?.tests_run || []).join(', ') || 'Çalıştırılmadı'}`, `Risks: ${(r?.known_risks || []).join(', ') || s.reason || 'Yok'}`, `Next Step: ${r?.next_step || 'Yok'}`);
    }
    lines.push('');
  }
  if (pendingApprovals.length) {
    lines.push('## Manuel Onay İstekleri', '');
    for (const request of pendingApprovals) lines.push(`### ${request.task_id} — ${request.title}`, `Gerekçe: ${request.reason}`, `Riskler: ${(request.risks || []).join('; ') || 'Belirtilmedi'}`, `Beklenen dosyalar: ${(request.expected_files || []).join(', ') || 'Yok'}`, `Korumalı dosyalar: ${(request.protected_files || []).join(', ') || 'Yok'}`, `Planlanan komutlar: ${(request.planned_commands || []).join(', ') || 'Yok'}`, `Görev özeti SHA-256: ${request.task_sha256}`, '');
  }
  lines.push('## Genel Sonuç', '', `Tamamlanan görevler: ${summary.completed_tasks.join(', ') || 'Yok'}`, `Başarısız görevler: ${summary.failed_tasks.join(', ') || 'Yok'}`, `Bloke görevler: ${summary.blocked_tasks.join(', ') || 'Yok'}`, `QA tarafından reddedilenler: ${summary.qa_rejections.join(', ') || 'Yok'}`, `Manuel onay bekleyenler: ${summary.manual_approvals_pending.map(x => x.task_id).join(', ') || 'Yok'}`, `Çakışan dosyalar: ${summary.conflicts.join(', ') || 'Yok'}`, `Başarısız testler: ${summary.failed_tests.join(', ') || 'Yok'}`, `Güvenlik uyarıları: ${summary.security_warnings.join(', ') || 'Yok'}`, `Git: başlangıç ${summary.starting_commit}, bitiş ${summary.ending_commit}, push ${summary.git.push_status}, rollback ${summary.git.rollback_reference}`, '', '## Orkestratör Sınırları', ...summary.orchestrator_limitations.map(x => `- ${x}`), '', 'Bir sonraki önerilen işler:', ...summary.recommended_next_tasks.map((x, i) => `${i + 1}. ${x}`));
  await writeFile(path.join(dir, 'summary.md'), lines.join('\n') + '\n', 'utf8');
  return { action: 'complete', run_id: queue.run_id, overall_status: summary.overall_status, manual_approvals_pending: pendingApprovals, summary_md: path.relative(repo, path.join(dir, 'summary.md')).replaceAll('\\', '/'), summary_json: path.relative(repo, path.join(dir, 'summary.json')).replaceAll('\\', '/') };
}
async function watchdog() {
  const { queue, state, locks } = await load();
  for (const t of queue.tasks) {
    const s = taskState(state, t);
    let warning = null;
    if (s.status === 'running') {
      if (Date.now() - Date.parse(s.started_at || 0) > t.timeout_minutes * 60000) warning = 'Watchdog timeout';
      else if (git('branch', '--show-current') !== state.integration_branch) warning = 'Branch mismatch during task';
      else if (s.qa_started_at && s.qa_source_hashes) warning = await dryRunWarning({ starting_commit: s.qa_starting_commit, starting_status: s.qa_starting_status, source_hashes: s.qa_source_hashes });
      else if (t.task_id === 'QA-DRYRUN-001') warning = await dryRunWarning(s);
      else warning = await codeInFlightWarning(t, locks);
      if (!warning) {
        const reasons = state.incidents.filter(x => x.task_id === t.task_id).map(x => x.reason);
        if (reasons.some(x => reasons.filter(y => y === x).length >= 3)) warning = 'Same error repeated three times';
      }
    } else if (s.status === 'completed') {
      if (!s.report || !relativeSafe(s.report)) warning = 'Completed task report missing';
      else {
        try { await stat(path.join(repo, s.report)); }
        catch { warning = 'Completed task report missing'; }
      }
    }
    if (warning) {
      s.status = 'blocked'; s.reason = warning; state.tasks[t.task_id] = s;
      incident(state, t.task_id, warning);
    }
  }
  await save(state, locks);
  return { action: 'watchdog', blocked_tasks: queue.tasks.filter(t => taskState(state, t).status === 'blocked').map(t => t.task_id) };
}
const handlers = { prepare, dispatch, qa, gitGate, finalize, summarize, watchdog };
let busy = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ ok: true, mode: 'safe-read-only', repo })); return; }
  if (req.method !== 'POST' || !/^\/(prepare|dispatch|qa|gitGate|finalize|summarize|watchdog)$/.test(req.url || '') || req.headers.origin || req.headers['sec-fetch-site']) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); return; }
  if (busy) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Another stage is running' })); return; }
  busy = true;
  try {
    let input = '';
    for await (const chunk of req) { input += chunk; if (input.length > 4096) throw new Error('Request too large'); }
    const body = input ? JSON.parse(input) : {};
    const stage = req.url.slice(1);
    const result = ['dispatch', 'qa', 'gitGate', 'finalize'].includes(stage) ? await handlers[stage](body.task_id) : await handlers[stage]();
    res.end(JSON.stringify(result));
  } catch (e) { res.statusCode = 422; res.end(JSON.stringify({ action: 'error', error: e.message })); }
  finally { busy = false; }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`EDITH bridge ready on 127.0.0.1:${server.address().port} (SAFE read-only mode)\n`));
