import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-rag-truth-'));
const originalCwd = process.cwd();
process.chdir(root);
process.env.EDITH_PERSISTENCE = 'json';
let close: (() => void) | undefined;
try {
  const { ragService } = await import('../src/edith/ragService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const store = getEdithPersistenceStore();
  close = () => store.close?.();
  const indexed = ragService.indexNote({ nodeId: 'note-car', notePath: 'Araçlar/özet.md', body: 'car bakım bütçesi', embeddingProvider: 'name-only', embeddingModel: 'name-only-model' });
  assert.equal(indexed.embeddingStatus, 'embedding_provider_required');
  assert.equal(indexed.retrievalMode, 'lexical');
  const saved = store.listKnowledgeChunks?.() ?? [];
  assert.equal(saved.length, 1);
  assert.equal(saved[0].vector, undefined);
  const legacy = { ...saved[0], embeddingStatus: 'ready' as const, vector: new Array(16).fill(0.25) };
  store.replaceKnowledgeChunksForNote?.(legacy.notePath, [legacy]);
  const retrieved = ragService.retrieve('car bütçesi');
  assert.equal(retrieved.retrievalMode, 'lexical');
  assert.equal(retrieved.embeddingStatus, 'embedding_provider_required');
  assert.equal(retrieved.results.length, 1);
  assert.equal(retrieved.results[0].chunk.embeddingStatus, 'embedding_provider_required');
  assert.equal(retrieved.results[0].chunk.vector, undefined);
  assert.equal(ragService.retrieve('automobile').results.length, 0);
  assert.equal(ragService.status().embeddingStatus, 'embedding_provider_required');
  assert.equal(ragService.status().retrievalMode, 'lexical');
  assert.equal((store.listKnowledgeChunks?.() ?? [])[0].embeddingStatus, 'ready', 'Read normalization must not rewrite persisted legacy data.');
  console.log(JSON.stringify({ success: true, checks: ['provider_name_not_embedding', 'no_hash_vector', 'legacy_ready_normalized_without_write', 'lexical_mode', 'unicode_lexical_retrieval'] }));
} finally {
  close?.();
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
}
