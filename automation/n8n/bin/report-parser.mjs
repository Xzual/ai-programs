import { secretTypes } from './safety-scan.mjs';

export function parseSpecialistReport(raw, task, { startingCommit = null } = {}) {
  const leaked = secretTypes(raw);
  if (leaked.length) throw new Error(`Secret-like content in specialist response: ${leaked.join(', ')}`);
  const blocks = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (!blocks.length) throw new Error('Structured JSON report missing');
  const report = JSON.parse(blocks.at(-1)[1]);
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Invalid report object');
  if (report.status === 'passed') report.status = 'completed';
  const fields = ['task_id', 'chat', 'status', 'summary', 'files_changed', 'tests_run', 'tests_passed', 'tests_failed', 'known_risks', 'blockers', 'next_step', 'commit_hash', 'push_status'];
  if (fields.some(k => !(k in report)) || report.task_id !== task.task_id || report.chat !== task.owner_chat || !['completed', 'failed', 'blocked', 'needs_fix'].includes(report.status)) throw new Error('Invalid report identity or fields');
  if (Object.keys(report).some(k => !fields.includes(k)) || typeof report.summary !== 'string' || typeof report.next_step !== 'string' || !['not_started', 'skipped'].includes(report.push_status)) throw new Error('Unauthorized push or invalid report fields');
  if (report.commit_hash !== null) {
    if (task.task_id !== 'QA-DRYRUN-001' || !/^[0-9a-f]{40}$/i.test(report.commit_hash) || report.commit_hash !== startingCommit) throw new Error('Unauthorized specialist commit reported');
    report.reported_commit_reference = report.commit_hash;
    report.commit_hash = null;
  }
  for (const k of ['files_changed', 'tests_run', 'tests_passed', 'tests_failed', 'known_risks', 'blockers']) if (!Array.isArray(report[k]) || report[k].some(x => typeof x !== 'string')) throw new Error(`Invalid report array: ${k}`);
  return report;
}
