import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase2-foundation-test-'));
const originalCwd = process.cwd();

function cleanup(): void {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // JSON persistence opens files per operation; cleanup is best-effort on Windows.
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { executeEdithTool, edithToolRegistry } = await import('../src/edith/serverRegistry');
  const { computerActionService } = await import('../src/edith/computerActionService');
  const { browserWorkflowService } = await import('../src/edith/browserWorkflowService');
  const { visionObservationService } = await import('../src/edith/visionService');
  const { interruptService } = await import('../src/edith/interruptService');
  const { taskService } = await import('../src/edith/taskService');
  const { executorService } = await import('../src/edith/executor');
  const { plannerService } = await import('../src/edith/planner');
  const { sentimentContextService, confidenceService } = await import('../src/edith/contextSignals');
  const { proactiveService } = await import('../src/edith/proactiveService');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  assert.ok(edithToolRegistry.get('vision_observe'));
  assert.ok(edithToolRegistry.get('browser_workflow'));
  assert.ok(edithToolRegistry.get('computer_action'));
  assert.ok(edithToolRegistry.get('design3d_cad_foundation'));

  const vision = await executeEdithTool('vision_observe', { source: 'screen', question: 'What is on screen?' }, {
    actor: 'phase2-test',
  });
  assert.equal(vision.success, true);
  assert.equal((vision.structuredOutput?.observation as { readOnly?: boolean }).readOnly, true);

  const previousObservation = visionObservationService.createObservation({
    source: 'browser_page',
    text: 'Before',
    windowTitle: 'Docs page',
  });
  const currentObservation = visionObservationService.createObservation({
    source: 'browser_page',
    text: 'After',
    windowTitle: 'Docs page',
  });
  const comparison = visionObservationService.compare(previousObservation, currentObservation);
  assert.equal(comparison.source, 'screenshot_diff');
  assert.equal(comparison.readOnly, true);
  assert.deepEqual(comparison.metadata.changedFields, ['text']);

  const browserDryRun = await executeEdithTool('browser_workflow', {
    action: 'navigate',
    url: 'https://example.com',
    verificationGoal: 'Title is readable',
    dryRun: true,
  }, { actor: 'phase2-test' });
  assert.equal(browserDryRun.success, true);
  assert.equal(browserDryRun.structuredOutput?.verification, 'SCHEMA_ONLY');
  assert.equal((browserDryRun.structuredOutput?.capability as { action?: string })?.action, 'navigate');

  const browserCapabilities = browserWorkflowService.capabilities();
  assert.equal(browserCapabilities.some((capability) => capability.action === 'download_pdf' && capability.sideEffects === 'file_write'), true);
  assert.equal(browserCapabilities.some((capability) => capability.action === 'upload_file' && capability.requiresFilePath), true);

  const forbiddenComputerAction = computerActionService.execute({
    action: 'type_text',
    text: 'delete all files',
    reason: 'Regression forbidden action test.',
  }, 'phase2-test');
  assert.equal(forbiddenComputerAction.success, false);
  assert.equal(forbiddenComputerAction.errorCode, 'PERMISSION_DENIED');

  const deniedComputerAction = await executeEdithTool('computer_action', {
    action: 'click',
    x: 10,
    y: 10,
    reason: 'No permission should deny.',
    dryRun: true,
  }, { actor: 'phase2-test' });
  assert.equal(deniedComputerAction.success, false);
  assert.equal(deniedComputerAction.errorCode, 'PERMISSION_DENIED');

  const task = taskService.createTask({
    title: 'Interrupt regression',
    objective: 'Prepare a no-tool report',
    originalUserRequest: 'Prepare a no-tool report',
  });
  plannerService.planTask(task.id);
  const interrupt = interruptService.request({ taskId: task.id, reason: 'dur', requestedBy: 'phase2-test' });
  assert.equal(interrupt.active, true);
  const interrupted = await executorService.executeTask(task.id);
  assert.equal(interrupted.success, false);
  assert.equal(interrupted.task?.status, 'CANCELLED');

  const threeD = await executeEdithTool('design3d_cad_foundation', {
    prompt: 'Design a parametric fork',
  }, { actor: 'phase2-test' });
  assert.equal(threeD.success, false);
  assert.equal(threeD.structuredOutput?.honestStatus, 'No CAD/render/simulation operation was executed.');

  const sentiment = sentimentContextService.analyzeText('Acil, bu hata olmuyor.');
  assert.equal(sentiment.tone, 'urgent');
  assert.equal(sentiment.responseStyle, 'brief');

  const confidence = confidenceService.check({ subject: 'financial action', confidence: 0.9, riskLevel: 4 });
  assert.equal(confidence.requiresApproval, true);

  const proactiveSettings = proactiveService.updateSettings({ enabled: true });
  assert.equal(proactiveSettings.enabled, true);
  assert.equal(proactiveService.checkOnce().length, 1);

  const audits = readRecentAuditEvents(1000);
  assert.equal(audits.some((event) => event.action === 'vision.observe'), true);
  assert.equal(audits.some((event) => event.action === 'computer_action.denied_forbidden'), true);
  assert.equal(audits.some((event) => event.action === 'interrupt.request'), true);

  const repoRoot = path.resolve(originalCwd);
  const checkedFiles = [
    'src/lib/storage.ts',
    'src/components/chat/ChatPanel.tsx',
    'src/components/chat/VoiceBar.tsx',
    'src/components/views/SettingsView.tsx',
    'server.ts',
    'package.json',
  ];
  const legacyIdentityPattern = new RegExp(['AU', 'RA'].join('') + '|' + ['au', 'ra'].join(''));
  for (const file of checkedFiles) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.equal(legacyIdentityPattern.test(text), false, `${file} should not contain legacy identity literals`);
  }

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'vision_read_only_observation',
      'vision_compare_read_only',
      'browser_workflow_dry_run',
      'browser_workflow_capability_metadata',
      'forbidden_computer_action_denied',
      'computer_action_permission_denied',
      'interrupt_cancels_task',
      'design3d_foundation_reports_configuration_required',
      'sentiment_context',
      'confidence_requires_high_risk_approval',
      'proactive_settings',
      'audit_trails',
      'no_legacy_identity_literals',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  cleanup();
}
