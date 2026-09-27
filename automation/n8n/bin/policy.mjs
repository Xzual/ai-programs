import { createHash } from 'node:crypto';

export function taskDigest(task) {
  return createHash('sha256').update(JSON.stringify(task)).digest('hex');
}

export function approvalGranted(task, approval) {
  return task.risk_level !== 'MANUAL_APPROVAL' || (
    approval?.approved === true && approval.task_sha256 === taskDigest(task) &&
    typeof approval.approved_at === 'string' && Number.isFinite(Date.parse(approval.approved_at))
  );
}

export function approvalRequest(task) {
  const reason = task.manual_approval_reason || 'MANUAL_APPROVAL task';
  return {
    task_id: task.task_id, title: task.title, owner_chat: task.owner_chat,
    reason, risks: [reason, ...(task.notes ? [task.notes] : [])],
    expected_files: task.expected_files || [], protected_files: task.protected_files || [],
    risk_level: task.risk_level, planned_commands: task.tests, task_sha256: taskDigest(task),
  };
}

export function resourcesOverlap(a, b) {
  const left = a.replace(/\/$/, '');
  const right = b.replace(/\/$/, '');
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
