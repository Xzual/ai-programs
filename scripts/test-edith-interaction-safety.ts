import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-interaction-safety-test-'));
const originalCwd = process.cwd();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
      if (attempt === 4) {
        console.warn(`Temp cleanup skipped because Windows still holds a handle: ${tempRoot}`);
        return;
      }
      await sleep(200 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { browserWorkflowService } = await import('../src/edith/browserWorkflowService');
  const { computerActionService } = await import('../src/edith/computerActionService');
  const { interactionSafetyService } = await import('../src/edith/interactionSafetyService');
  const { markLAdapterService } = await import('../src/edith/markLAdapter');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');

  const snapshot = interactionSafetyService.snapshot();
  assert.equal(snapshot.defaultRule, 'READ_ONLY');
  assert.equal(snapshot.computer.mode, 'READ_ONLY');
  assert.equal(snapshot.computer.runtimeBound, false);
  assert.equal(snapshot.browser.mode, 'READ_ONLY');
  assert.equal(snapshot.voice.mode, 'DISABLED');
  assert.equal(snapshot.voice.wakeWord, 'BLOCKED');
  assert.equal(snapshot.desktopPackaging.commandsAfterCargoAvailable.includes('npm run tauri:build'), true);
  assert.equal(
    snapshot.desktopPackaging.warning === undefined ||
      snapshot.desktopPackaging.warning === 'Tauri package build unavailable: Cargo not found in PATH',
    true
  );
  assert.equal(snapshot.loop.includes('REQUEST_APPROVAL_IF_NEEDED'), true);
  assert.equal(snapshot.classifications.some((item) => item.id === 'computer_action' && item.status === 'blocked'), true);
  assert.equal(snapshot.classifications.some((item) => item.area === 'mark-l' && item.mode === 'BLOCKED'), true);
  assert.equal(snapshot.classifications.some((item) => item.id === 'vision_observe' && item.notes.includes('Screenshot/OCR providers are not bound')), true);
  assert.equal(snapshot.classifications.some((item) => item.id === 'voice_pipeline' && item.notes.includes('Wake word is blocked')), true);

  const capabilities = browserWorkflowService.capabilities();
  assert.equal(capabilities.find((item) => item.action === 'fill_form')?.runtimeStatus, 'BLOCKED');
  assert.equal(capabilities.find((item) => item.action === 'download_pdf')?.requiredPermissions.includes('file:write'), true);
  assert.equal(capabilities.every((item) => item.requiresApproval), true);

  const invalid = await browserWorkflowService.run({
    action: 'launch_app' as any,
    verificationGoal: 'Invalid action should fail closed.',
  }, 'interaction-safety-test');
  assert.equal(invalid.success, false);
  assert.equal(invalid.errorCode, 'VALIDATION_ERROR');
  assert.equal(invalid.structuredOutput?.safetyMode, 'READ_ONLY');

  const unapprovedSearch = await browserWorkflowService.run({
    action: 'search',
    query: 'edith browser safety',
    verificationGoal: 'Search requires approval.',
  }, 'interaction-safety-test');
  assert.equal(unapprovedSearch.success, false);
  assert.equal(unapprovedSearch.errorCode, 'PERMISSION_DENIED');
  assert.match(String(unapprovedSearch.error), /APPROVAL_REQUIRED/);

  const approvedNavigate = await browserWorkflowService.run({
    action: 'navigate',
    url: 'https://example.com',
    verificationGoal: 'Permission service still blocks browser control by default.',
    approvalGranted: true,
  }, 'interaction-safety-test');
  assert.equal(approvedNavigate.success, false);
  assert.equal(approvedNavigate.errorCode, 'PERMISSION_DENIED');

  const approvedExtract = await browserWorkflowService.run({
    action: 'extract',
    url: 'https://example.com',
    verificationGoal: 'Extraction has no bound runtime.',
    approvalGranted: true,
  }, 'interaction-safety-test');
  assert.equal(approvedExtract.success, false);
  assert.equal(approvedExtract.errorCode, 'TOOL_ERROR');
  assert.equal(approvedExtract.structuredOutput?.honestStatus, 'No browser action, form action, upload, download, OCR, or extraction was executed.');

  const computerPhases = computerActionService.phases();
  assert.equal(computerPhases.some((phase) => phase.name === 'ACT' && phase.status === 'configuration_required'), true);

  const computerDryRun = await executeEdithTool('computer_action', {
    action: 'click',
    x: 1,
    y: 1,
    reason: 'Approval should be required even for dry-run through registry.',
    dryRun: true,
  }, { actor: 'interaction-safety-test' });
  assert.equal(computerDryRun.success, false);
  assert.equal(computerDryRun.errorCode, 'PERMISSION_DENIED');

  const markL = markLAdapterService.snapshot();
  assert.equal(markL.capabilities.every((capability) => capability.enabledByDefault === false), true);
  assert.equal(markL.capabilities.some((capability) => capability.adapterMode === 'high_risk_blocked'), true);

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'interaction_snapshot_default_read_only',
      'computer_runtime_unbound',
      'browser_read_only_default',
      'voice_disabled_backend_default',
      'desktop_packaging_reports_cargo_status',
      'screenshot_ocr_not_enabled',
      'wake_word_not_enabled',
      'browser_capabilities_require_approval',
      'browser_invalid_action_fails_closed',
      'browser_unapproved_action_denied',
      'browser_permission_service_still_blocks_navigation',
      'browser_unbound_extract_reports_configuration_required',
      'mark_l_adapter_only',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await cleanup();
}
