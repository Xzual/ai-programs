import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-memory-v2-test-'));
const originalCwd = process.cwd();

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

  const { memoryService } = await import('../src/edith/memoryService');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const preference = memoryService.upsert({
    type: 'preference',
    scope: 'user',
    key: 'editor.theme',
    content: 'User prefers dark high-contrast interfaces.',
    importance: 0.8,
    confidence: 0.9,
    sensitivity: 'internal',
    source: 'test',
    provenance: 'regression',
    relatedEntityIds: ['project:edith'],
  });
  const semantic = memoryService.upsert({
    type: 'semantic',
    scope: 'project',
    key: 'edith.architecture',
    content: 'EDITH uses Planner, Executor, Verifier, and Recovery services.',
    importance: 0.9,
    confidence: 0.95,
    sensitivity: 'internal',
    source: 'test',
    provenance: 'regression',
  });
  const sensitive = memoryService.upsert({
    type: 'episodic',
    scope: 'user',
    key: 'private.note',
    content: 'Sensitive private note should not enter default context.',
    sensitivity: 'sensitive',
  });
  const source = memoryService.upsert({
    type: 'semantic',
    scope: 'project',
    key: 'edith.architecture.source',
    content: 'Recovery replans retryable verification failures.',
    importance: 0.7,
    confidence: 0.8,
  });

  const search = memoryService.search({ query: 'Verifier Recovery EDITH', limit: 5 });
  const context = memoryService.context('private EDITH recovery', 10);
  const conflicts = memoryService.conflicts({
    key: 'editor.theme',
    content: 'User prefers bright theme.',
  });
  const merged = memoryService.merge(semantic.id, [source.id]);
  const deleted = memoryService.delete(preference.id);
  const exported = memoryService.exportSnapshot();
  const auditEvents = readRecentAuditEvents(1000);

  assert.equal(preference.type, 'preference');
  assert.equal(preference.category, 'user_pref');
  assert.equal(memoryService.list({ includeSensitive: true }).length, 2);
  assert.equal(search.some((memory) => memory.id === semantic.id), true);
  assert.equal(context.some((memory) => memory.id === sensitive.id), false);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].existingIds.includes(preference.id), true);
  assert.equal(merged?.mergeOf?.includes(source.id), true);
  assert.equal(memoryService.find(source.id), undefined);
  assert.equal(deleted, true);
  assert.equal(memoryService.find(preference.id), undefined);
  assert.equal(exported.memories.some((memory) => memory.id === sensitive.id), true);
  assert.equal(auditEvents.some((event) => event.action === 'memory.upsert'), true);
  assert.equal(auditEvents.some((event) => event.action === 'memory.merge'), true);
  assert.equal(auditEvents.some((event) => event.action === 'memory.delete'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    memories: exported.memories.length,
    search: search.map((memory) => memory.key),
    conflicts: conflicts.length,
    merged: merged?.id,
    scenarios: ['upsert', 'search', 'context_redaction', 'conflict_detection', 'merge', 'delete', 'export', 'audit'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
