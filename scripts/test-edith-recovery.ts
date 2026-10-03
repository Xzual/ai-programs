import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-recovery-test-'));
const originalCwd = process.cwd();
let closePersistence: (() => void) | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
      if (attempt === 4) {
        console.warn(`Temp cleanup skipped because Windows still holds a SQLite handle: ${tempRoot}`);
        return;
      }
      await sleep(200 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'sqlite';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { verificationService } = await import('../src/edith/verifier');
  const { recoveryService } = await import('../src/edith/recovery');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  closePersistence = () => { getEdithPersistenceStore().close?.(); };

  const task = taskService.createTask({
    title: 'Recovery regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.success, true);
  assert.ok(planned.plan);
  for (const step of planned.plan.steps) {
    taskService.updatePlanStepStatus(task.id, step.id, 'COMPLETED', `Recorded terminal step ${step.id} without execution evidence.`);
  }
  taskService.updateStatus(task.id, 'RUNNING', 'Reached a valid verifier boundary without tool execution evidence.');

  const verified = verificationService.verifyTask(task.id);
  const blockedAfterVerification = taskService.getTask(task.id);
  const verificationAudits = readRecentAuditEvents(1000).filter((event) => event.taskId === task.id && event.action === 'task.verify');
  assert.equal(verified.success, false);
  assert.equal(verified.status, 'RETRYABLE');
  assert.equal(blockedAfterVerification?.status, 'BLOCKED');
  assert.equal(blockedAfterVerification?.verification?.status, 'RETRYABLE');
  assert.equal(blockedAfterVerification?.plan?.steps.every((step) => step.status === 'COMPLETED'), true);
  assert.equal(blockedAfterVerification?.verification?.checks.some((check) => check.required && check.id.startsWith('tool-') && check.status === 'RETRYABLE'), true);
  assert.equal(verificationAudits.length, 1);

  const recovered = recoveryService.recoverTask(task.id);
  const reloaded = taskService.getTask(task.id);
  const auditEvents = readRecentAuditEvents(1000);

  assert.equal(recovered.success, true);
  assert.equal(recovered.action, 'REPLAN');
  assert.equal(recovered.classification, 'VERIFICATION_RETRYABLE');
  assert.equal(recovered.attempt, 1);
  assert.equal(reloaded?.status, 'QUEUED');
  assert.notEqual(reloaded?.plan?.id, planned.plan?.id);
  assert.equal(reloaded?.plan?.status, 'READY');
  assert.equal(reloaded?.plan?.steps[0]?.status, 'READY');
  assert.equal(reloaded?.verification, undefined);
  assert.equal(reloaded?.recoveryEvents?.length, 1);
  assert.equal(reloaded?.recoveryEvents?.[0]?.previousPlanId, planned.plan?.id);
  assert.equal(reloaded?.recoveryEvents?.[0]?.newPlanId, reloaded?.plan?.id);
  assert.equal(auditEvents.some((event) => event.taskId === task.id && event.action === 'task.recover'), true);

  const permissionTask = taskService.createTask({
    title: 'Permission recovery regression',
    objective: 'Open a high risk desktop controller',
    originalUserRequest: 'Use computer control.',
    toolsRequired: ['computer_control_agent'],
    riskLevel: 5,
  });
  taskService.updateStatus(permissionTask.id, 'WAITING_FOR_APPROVAL', 'Permission denied.');
  const permissionRecovery = recoveryService.recoverTask(permissionTask.id);
  const permissionReloaded = taskService.getTask(permissionTask.id);

  assert.equal(permissionRecovery.success, false);
  assert.equal(permissionRecovery.action, 'WAIT_PERMISSION');
  assert.equal(permissionRecovery.classification, 'PERMISSION_DENIED');
  assert.equal(permissionReloaded?.status, 'WAITING_FOR_APPROVAL');
  assert.equal(permissionReloaded?.recoveryEvents?.length, 1);
  assert.equal(Boolean(permissionReloaded?.recoveryEvents?.[0]?.capabilityAssessmentId), true);
  assert.equal(permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.actor, 'edith-executor');
  assert.equal(permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.toolIds.includes('computer_control_agent'), true);
  assert.equal(permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions.includes('computer:control'), true);
  assert.equal(permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions.includes('system:exec'), true);
  assert.equal(permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.highRiskToolIds.includes('computer_control_agent'), true);

  const sensitivePermissionTask = taskService.createTask({
    title: 'Sensitive permission recovery regression',
    objective: 'IoT ışık feedback ve finance trading live order',
    originalUserRequest: 'Akıllı ev ve trading işlemlerini güvenlik kapısından geçir.',
    toolsRequired: ['iot_feedback_stub', 'finance_trading_guard'],
    riskLevel: 5,
  });
  taskService.updateStatus(sensitivePermissionTask.id, 'WAITING_FOR_APPROVAL', 'Sensitive permission denied.');
  const sensitiveRecovery = recoveryService.recoverTask(sensitivePermissionTask.id);
  const sensitiveReloaded = taskService.getTask(sensitivePermissionTask.id);

  assert.equal(sensitiveRecovery.action, 'WAIT_PERMISSION');
  assert.equal(sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.toolIds.includes('iot_feedback_stub'), true);
  assert.equal(sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.toolIds.includes('finance_trading_guard'), true);
  assert.equal(sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions.includes('iot:control'), true);
  assert.equal(sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions.includes('trading:execute'), true);
  assert.equal(sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.highRiskToolIds.includes('finance_trading_guard'), true);

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    status: reloaded?.status,
    action: recovered.action,
    classification: recovered.classification,
    recoveryEvents: reloaded?.recoveryEvents?.length,
    permissionAction: permissionRecovery.action,
    permissionRequest: permissionReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions,
    sensitivePermissionRequest: sensitiveReloaded?.recoveryEvents?.[0]?.permissionRequest?.permissions,
    scenarios: ['valid_verifier_boundary', 'retryable_verification_blocks', 'replan', 'persist_recovery', 'verification_and_recovery_audit', 'permission_wait', 'permission_request_details', 'sensitive_permission_request_details'],
  }, null, 2));
} finally {
  closePersistence?.();
  process.chdir(originalCwd);
  await removeTempRoot();
}
