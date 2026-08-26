import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-proactive-service-test-'));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';

  const { proactiveService } = await import('../src/edith/proactiveService');
  const { presenceContextService, sentimentContextService } = await import('../src/edith/contextSignals');
  const { killSwitchService } = await import('../src/edith/killSwitch');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  killSwitchService.deactivate('proactive-test-setup');

  const settings = proactiveService.updateSettings({
    enabled: true,
    intervalMinutes: 5,
    categories: {
      calendar: false,
      mail: false,
      system: true,
      logs: true,
      iot: true,
    },
    delivery: {
      text: true,
      voice: false,
    },
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.categories.iot, true);

  const sentiment = sentimentContextService.analyzeText('Acil, hemen kontrol et.');
  const presence = presenceContextService.snapshot({
    inferredState: 'busy',
    activeApplication: 'EDITH',
  });
  const generated = proactiveService.checkOnce({ sentiment, presence }, 'proactive-test');
  assert.equal(generated.length, 4);
  assert.equal(generated.some((signal) => signal.source === 'sentiment' && signal.requiresApproval), true);
  assert.equal(generated.some((signal) => signal.category === 'iot' && signal.requiresApproval), true);

  const activeSignals = proactiveService.listSignals();
  assert.equal(activeSignals.length, 4);

  const dismissed = proactiveService.dismissSignal(activeSignals[0].id, 'proactive-test');
  assert.ok(dismissed?.dismissedAt);
  assert.equal(proactiveService.listSignals().length, 3);
  assert.equal(proactiveService.listSignals({ includeDismissed: true }).length, 4);

  killSwitchService.activate('Block proactive background checks.', 'proactive-test');
  const blocked = proactiveService.checkOnce({ sentiment, presence }, 'proactive-test');
  assert.equal(blocked.length, 0);
  killSwitchService.deactivate('proactive-test');

  const audits = readRecentAuditEvents(1000);
  assert.equal(audits.some((event) => event.action === 'proactive.settings_update'), true);
  assert.equal(audits.some((event) => event.action === 'proactive.check'), true);
  assert.equal(audits.some((event) => event.action === 'proactive.signal_dismiss'), true);
  assert.equal(audits.some((event) => event.action === 'proactive.check_blocked'), true);

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'settings_persist',
      'presence_sentiment_signals',
      'iot_configuration_required_signal',
      'dismiss_signal',
      'kill_switch_blocks_proactive_checks',
      'audit_trails',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort on Windows.
  }
}
