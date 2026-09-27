import { taskDigest } from './policy.mjs';
import { secretTypes } from './safety-scan.mjs';

export function parseQaDecision(raw) {
  const leaked = secretTypes(raw);
  if (leaked.length) throw new Error(`Secret-like content in QA response: ${leaked.join(', ')}`);
  const blocks = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (!blocks.length) throw new Error('QA structured report missing');
  const decision = JSON.parse(blocks.at(-1)[1]);
  if (!decision || typeof decision !== 'object' || Array.isArray(decision) ||
      !['accepted', 'needs_fix', 'blocked'].includes(decision.qa_status) ||
      !Array.isArray(decision.findings) || decision.findings.some(x => typeof x !== 'string') ||
      typeof decision.next_step !== 'string' ||
      Object.keys(decision).some(k => !['qa_status', 'findings', 'next_step'].includes(k))) throw new Error('Invalid QA decision');
  if (decision.qa_status === 'needs_fix' && !decision.findings.length) throw new Error('QA fix findings missing');
  return decision;
}

export function draftFixTask(task, attempt, decision) {
  if (decision.qa_status !== 'needs_fix' || !Number.isInteger(attempt) || attempt < 1 || attempt > task.retry_limit) return null;
  const fixId = `${task.task_id.slice(0, 45)}-FIX-${attempt}-${taskDigest(task).slice(0, 6).toUpperCase()}`;
  const promptFile = `automation/n8n/prompts/chat${task.owner_chat}/${fixId}.txt`;
  const fixTask = {
    task_id: fixId, title: `Address QA findings for ${task.task_id}`, owner_chat: task.owner_chat,
    prompt_file: promptFile, dependencies: [], priority: task.priority, risk_level: task.risk_level,
    expected_files: task.expected_files || [], protected_files: task.protected_files || [], tests: task.tests,
    success_conditions: [...task.success_conditions, 'Chat 8 QA findings resolved'],
    qa_required: true, git_commit: task.git_commit, git_push: task.git_push,
    timeout_minutes: task.timeout_minutes, retry_limit: 0, status: 'queued',
  };
  const prompt = `TASK-ID: ${fixId}\nOriginal task: ${task.task_id}\n\nQA findings:\n${decision.findings.map(x => `- ${x}`).join('\n')}\n\nQA next step:\n${decision.next_step}\n\nRequired tests:\n${task.tests.map(x => `- ${x}`).join('\n')}\n\nReview this draft before dispatch. Preserve the original work and report a structured final result.\n`;
  return { task: fixTask, prompt, original_task: task.task_id, qa_findings: decision.findings, status: 'review_required' };
}
