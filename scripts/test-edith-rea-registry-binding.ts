import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReaAnalysisResult } from '../src/edith/reaAnalysisService';
import type { ReaReceiptCorrelationV1 } from '../src/edith/reaIntegrationContract';

// The unchanged isolated runner installs owned JSON persistence and confinement before imports.
const registry = await import('../src/edith/serverRegistry');
const { getEdithPersistenceStore } = await import('../src/edith/persistence');

test('public REA execution denies without writing a tool run or audit', async () => {
  const store = getEdithPersistenceStore();
  const before = [store.listToolRuns!().length, store.readRecentAuditEvents().length];
  const result = await registry.executeEdithTool('rea_analysis', { selectionRef: 'forged' });
  assert.equal(result.errorCode, 'PERMISSION_DENIED');
  assert.equal(result.success, false);
  const tool = registry.edithToolRegistry.get('rea_analysis');
  assert.ok(tool);
  const direct = await tool.handler({}, { actor: 'owner', authorizedPermissions: [] });
  assert.equal(direct.errorCode, 'PERMISSION_DENIED');
  assert.deepEqual([store.listToolRuns!().length, store.readRecentAuditEvents().length], before);
});

test('private producer rejects a structurally forged capability before dispatch or persistence', async () => {
  const { createReaIntegrationService } = await import('../src/edith/reaIntegrationService');
  const integration = createReaIntegrationService({
    serverBootId: 'fixture_boot', files: { resolveReaTarget: async () => { throw Error('UNREACHABLE'); }, assertReaTargetCurrent() {} },
    readOwner: () => undefined, currentWorkspace: () => undefined, isKillSwitchActive: () => false,
    readQualification: () => ({ ready: false, reasons: [{ kind: 'qualification_failed', code: 'FIXTURE_UNQUALIFIED' }] }),
  });
  const port = registry.createReaRegistryExecution({ integration,
    bindReceipt() { throw Error('UNREACHABLE'); }, readExpected: () => undefined });
  assert.throws(() => registry.bindReaRegistryExecution({ ...port }), /REA_REGISTRY_BINDING_INVALID/);
  const forged = { assertTaskCurrent() {}, execute: async () => { throw Error('UNREACHABLE'); } } as never;
  await assert.rejects(port.execute(forged), /REA_CAPABILITY_REQUIRED/);
  assert.equal(port.status('static-javascript').runtimeReady, false);
});

test('unqualified REA health remains unavailable despite registered metadata', () => {
  const health = registry.getEdithToolHealth().find(row => row.toolId === 'rea_analysis');
  assert.equal(health?.state, 'UNAVAILABLE');
  assert.equal(health?.enabled, false);
  assert.match(health!.message, /REA_REGISTRY_NOT_BOUND/);
});

test('REA skill exposes configuration requirements rather than claiming registered means ready', async () => {
  const { buildSkillRegistry } = await import('../src/edith/skillRegistry');
  const sources = {
    checkedAt: '2026-10-18T00:00:00.000Z', toolIds: new Set(['rea_analysis']), applicationPath: process.env.EDITH_WORKSPACE_ROOT!,
    releaseArtifactsPresent: false, voice: { configured: false, runtimeStatus: 'configuration_required' },
    computer: { status: 'configuration_required', limitations: [], requiredPermissions: [], endpoints: [], runtime: 'web', safeMessage: 'Fixture unavailable' },
    cryptoAgent: { healthy: false, managedProcessRunning: false, scriptPath: process.env.EDITH_WORKSPACE_ROOT! + '/absent-fixture.py' },
    obsidian: { obsidianEnabled: false, vaultExists: false, readable: false, writable: false, connectionStatus: 'disabled', provider: { state: 'disabled', reasonCode: 'DISABLED' } },
    workspace: { configured: false, state: 'configuration_required', limitations: [], errors: [], configFile: 'fixture' },
  } as unknown as Parameters<typeof buildSkillRegistry>[0];
  const skill = buildSkillRegistry(sources).skills.find(row => row.id === 'rea_analysis');
  assert.ok(skill);
  assert.equal(skill.status, 'config_required');
  assert.equal(skill.readiness.ready, false);
  assert.equal(skill.details?.runtimeReady, false);
});

async function genuineCapability(run: () => Promise<ReaAnalysisResult>) {
  const { FileService } = await import('../server/files/fileService');
  const { createReaIntegrationService } = await import('../src/edith/reaIntegrationService');
  const { createReaAnalysisService } = await import('../src/edith/reaAnalysisService');
  const workspace = await fs.mkdtemp(path.join(process.env.EDITH_WORKSPACE_ROOT!, 'registry-fixture-'));
  await fs.writeFile(path.join(workspace, 'fixture.dll'), 'synthetic selected bytes');
  const files = new FileService(() => [{ id: 'workspace', path: workspace }]);
  const fileId = files.search('fixture.dll').files[0].id;
  const identity = { taskId: path.basename(workspace), planId: 'plan_1', stepId: 'step_1', runId: 'run_1', attempt: 1 };
  let record: import('../src/edith/reaIntegrationService').ReaCanonicalExecutionRecord = {
    identity, ownerSessionBindingId: 'owner_1', ownerId: 'owner', workspaceId: 'workspace_1', serverBootId: 'boot_1',
    providerTaskSessionId: 'provider_1', expiresAt: Date.now() + 100000, taskStatus: 'QUEUED',
  };
  const integration = createReaIntegrationService({ files, serverBootId: 'boot_1',
    readOwner: owner => owner === 'owner_1' ? { ownerId: 'owner' } : undefined,
    currentWorkspace: () => ({ workspaceId: 'workspace_1', workspaceRoot: workspace }), isKillSwitchActive: () => false,
    readExecutionRecord: () => record, readQualification: () => ({ ready: true, qualificationRef: 'synthetic_only' }),
    runtimeOptions: { launch: { command: process.execPath, args: [], cwd: workspace, env: {}, expectedServerName: 'rea', expectedServerVersion: '6.5.0', protocolVersion: '2025-11-25' },
      expectedCatalogDigest: 'a'.repeat(64), expectedServerPath: path.join(workspace, 'never-run.js'), stagingRoot: path.join(workspace, 'never-stage') },
    // External runtime boundary only. Real factory selection, admission, plan/capability membership remain intact.
    runtimeFactory: options => ({ admission: createReaAnalysisService(options).admission, service: { run } }),
  });
  const selected = await integration.select('owner_1', { locator: { id: fileId, kind: 'file' }, profile: 'static-managed' });
  assert.equal(selected.outcome, 'selected');
  if (selected.outcome !== 'selected') throw Error('FIXTURE_SELECTION_FAILED');
  const prepared = await integration.prepare('owner_1', selected.selection.selectionRef, identity, { profile: 'static-managed', objective: 'Inspect selected artifact' });
  record = { ...record, call: prepared.call };
  const cap = integration.issue(prepared);
  let expected: ReaReceiptCorrelationV1 | undefined;
  let capturedLocator: import('../src/edith/serverRegistry').ReaReceiptLocator | undefined;
  const port = registry.createReaRegistryExecution({ integration,
    bindReceipt(actual, locator) {
      assert.strictEqual(actual, cap);
      capturedLocator = locator;
      expected = { identity, toolRunId: locator.toolRunId, auditEventId: locator.auditEventId,
        selectionRef: prepared.selection.selectionRef, selectionRevision: prepared.selection.revision, inputDigest: prepared.inputDigest };
    }, readExpected: (task, audit) => task === identity.taskId && audit === expected?.auditEventId ? expected : undefined });
  return { cap, port, integration, prepared, readLocator: () => capturedLocator };
}

test('genuine capability preserves failed outcome and stores exact correlated receipt once on replay', async () => {
  let dispatched = 0;
  const setup = await genuineCapability(async () => { dispatched++; return { outcome: 'unknown_effect', reasonCode: 'REA_SYNTHETIC_EFFECT', cleanup: { closed: true, unknownEffect: true } }; });
  const actual = await setup.port.execute(setup.cap);
  assert.equal(actual.toolResult.success, false);
  assert.equal(actual.receipt.outcome, 'unknown_effect');
  assert.equal(actual.receipt.report, undefined);
  const store = getEdithPersistenceStore();
  const log = store.listToolRuns!().find(row => row.id === actual.receipt.toolRunId)!;
  assert.deepEqual(JSON.parse(log.result), actual.receipt);
  const { reaProjectionDigest } = await import('../src/edith/reaIntegrationContract');
  assert.equal(setup.readLocator()!.receiptDigest, reaProjectionDigest(actual.receipt));
  assert.equal(setup.readLocator()!.receiptObservedAt, actual.receipt.receiptObservedAt);
  assert.deepEqual(log.args, { schemaVersion: 1, toolId: 'rea_analysis' });
  assert.equal(log.status, 'error');
  assert.equal(store.readRecentAuditEvents().filter(row => row.id === actual.receipt.auditEventId).length, 1);
  assert.strictEqual(await setup.port.execute(setup.cap), actual);
  assert.equal(dispatched, 1);
  setup.port.revoke(setup.cap);
  await assert.rejects(setup.port.execute(setup.cap), /REA_AUTHORITY_REVOKED/);
});

test('forged report from runtime boundary cannot be persisted as a genuine safe projection', async () => {
  const setup = await genuineCapability(async () => ({ outcome: 'completed', reasonCode: 'REA_SYNTHETIC', cleanup: { closed: true, unknownEffect: false }, report: {} as never }));
  const store = getEdithPersistenceStore(), before = store.listToolRuns!().length;
  await assert.rejects(setup.port.execute(setup.cap), /REA_REPORT_UNTRUSTED/);
  assert.equal(store.listToolRuns!().length, before);
});

test('revocation while runtime awaits prevents late log and audit publication', async () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const setup = await genuineCapability(async () => {
    started(); await new Promise<void>(resolve => { release = resolve; });
    return { outcome: 'blocked', reasonCode: 'REA_SYNTHETIC', cleanup: { closed: true, unknownEffect: false } };
  });
  const store = getEdithPersistenceStore(), before = [store.listToolRuns!().length, store.readRecentAuditEvents().length];
  const pending = setup.port.execute(setup.cap); await entered;
  setup.port.revoke(setup.cap); release();
  await assert.rejects(pending, /REA_AUTHORITY_REVOKED/);
  assert.deepEqual([store.listToolRuns!().length, store.readRecentAuditEvents().length], before);
});
