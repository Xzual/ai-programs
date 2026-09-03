import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-obsidian-knowledge-test-'));
const originalCwd = process.cwd();
const vaultPath = path.join(tempRoot, 'EDİTH', 'EDİTH');

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
  process.env.OBSIDIAN_VAULT_PATH = vaultPath;
  process.env.EDITH_OBSIDIAN_ENABLED = 'true';
  process.env.EDITH_OBSIDIAN_MODE = 'read_write_safe';
  process.env.EDITH_KNOWLEDGE_MAP_OBSIDIAN = 'true';

  fs.mkdirSync(path.join(vaultPath, '.obsidian'), { recursive: true });
  for (const folder of ['Projects', 'People', 'Organizations', 'Research', 'Tasks', 'Meetings', 'Trading', 'Memory', 'Conversations', 'Attachments']) {
    fs.mkdirSync(path.join(vaultPath, folder), { recursive: true });
  }

  const { parseMarkdownDocument, parseCanvasDocument } = await import('../src/edith/obsidianParser');
  const { obsidianVaultService } = await import('../src/edith/obsidianVaultService');
  const { knowledgeGraphService } = await import('../src/edith/knowledgeGraphService');
  const { ragService } = await import('../src/edith/ragService');
  const { memoryService } = await import('../src/edith/memoryService');
  const { executeEdithTool, edithToolRegistry } = await import('../src/edith/serverRegistry');
  const { taskService } = await import('../src/edith/taskService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const markdown = `---
title: Water Literacy
aliases: ["KA210-YOU"]
tags: [project, water]
budget: 12000
---

# Water Literacy

Partners include [[Apostolos]] and [[KA210-YOU]].

## Partners
- [[Apostolos]]

## Activities
- Workshop

## Budget
- 12000 EUR

## Meetings
- Kickoff

## Emails
- partner@example.test

## Tasks
- Draft agenda

## Documents
- ![[brief.pdf]]

#water-literacy
`;

  const parsed = parseMarkdownDocument(markdown, 'Projects/Water Literacy.md');
  assert.equal(parsed.title, 'Water Literacy');
  assert.equal(parsed.nodeType, 'Project');
  assert.deepEqual(parsed.wikilinks.sort(), ['Apostolos', 'KA210-YOU', 'brief.pdf'].sort());
  assert.equal(parsed.tags.includes('project'), true);
  assert.equal(parsed.attachments.includes('brief.pdf'), true);

  fs.writeFileSync(path.join(vaultPath, 'Projects', 'Water Literacy.md'), markdown, 'utf8');
  fs.writeFileSync(path.join(vaultPath, 'People', 'Apostolos.md'), '# Apostolos\n\nWorks with [[Water Literacy]].\n', 'utf8');
  fs.writeFileSync(path.join(vaultPath, 'Attachments', 'brief.pdf'), 'fake-pdf-bytes', 'utf8');
  fs.writeFileSync(path.join(vaultPath, 'Research', 'Water.canvas'), JSON.stringify({
    nodes: [
      { id: 'a', text: 'Water Literacy' },
      { id: 'b', file: 'Projects/Water Literacy.md' },
    ],
    edges: [{ fromNode: 'a', toNode: 'b', label: 'references' }],
  }), 'utf8');

  const canvas = parseCanvasDocument(fs.readFileSync(path.join(vaultPath, 'Research', 'Water.canvas'), 'utf8'), 'Research/Water.canvas');
  assert.equal(canvas.relationships.length, 1);

  const reindex = obsidianVaultService.reindex();
  assert.equal(reindex.success, true);
  assert.equal(reindex.indexed >= 4, true);
  assert.equal(obsidianVaultService.getSettings().vaultPath, vaultPath);
  assert.equal(obsidianVaultService.getSettings().vaultPath.includes('EDİTH'), true);
  assert.equal(fs.existsSync(path.join(vaultPath, 'E.D.I.T.H. Index.md')), true);

  const graph = knowledgeGraphService.snapshot({ limit: 100 });
  const titles = new Set(graph.nodes.map((node) => node.title));
  assert.equal(titles.has('Water Literacy'), true);
  assert.equal(titles.has('Apostolos'), true);
  assert.equal(titles.has('Obsidian Vault'), true);
  assert.equal(titles.has('Projects'), true);
  assert.equal(titles.has('#project'), true);
  assert.equal(graph.relationships.some((edge) => edge.type === 'references'), true);
  assert.equal(graph.relationships.some((edge) => edge.type === 'belongsTo'), true);
  assert.equal(graph.relationships.some((edge) => edge.type === 'inside_folder'), true);
  assert.equal(graph.relationships.some((edge) => edge.type === 'tagged_with'), true);

  const retrieval = ragService.retrieve('budget workshop Apostolos');
  assert.equal(retrieval.embeddingStatus, 'embedding_provider_required');
  assert.equal(retrieval.results.length > 0, true);
  assert.equal(retrieval.results[0].chunk.notePath.includes('Water Literacy'), true);

  const memory = memoryService.upsert({
    key: 'Obsidian sync memory',
    content: 'This memory must become an Obsidian note.',
    type: 'semantic',
    scope: 'global',
  });
  const memoryNote = obsidianVaultService.writeMemoryNote(memory);
  assert.equal(fs.existsSync(path.join(vaultPath, memoryNote)), true);
  assert.equal(memoryNote.startsWith('Memory/'), true);
  assert.equal(fs.readFileSync(path.join(vaultPath, memoryNote), 'utf8').includes('api_key='), false);

  const task = taskService.createTask({
    title: 'Obsidian sync task',
    objective: 'Write task note into vault.',
    originalUserRequest: 'sync task',
  });
  const taskNote = obsidianVaultService.writeTaskNote(task);
  assert.equal(fs.existsSync(path.join(vaultPath, taskNote)), true);
  assert.equal(taskNote.startsWith('Tasks/'), true);

  const agentNoteResult = await executeEdithTool('obsidian_save_note', {
    agentId: 'research',
    kind: 'research',
    title: 'Research result',
    body: 'Research result about [[Water Literacy]].',
  }, { actor: 'obsidian-test', authorizedPermissions: ['system:read', 'memory:write'] });
  assert.equal(agentNoteResult.success, true);
  assert.ok(edithToolRegistry.get('obsidian_save_note'));

  const secretExport = obsidianVaultService.writeResearchNote({
    topic: 'Secret redaction regression',
    summary: 'Never store api_key=AIza123456789012345678901234567890 or password=supersecretvaluehere.',
  });
  assert.equal(secretExport.exported, true);
  assert.equal(secretExport.redacted, true);
  assert.equal(secretExport.errorCode, 'SECRET_DETECTED');
  assert.equal(fs.readFileSync(path.join(vaultPath, secretExport.notePath ?? ''), 'utf8').includes('supersecretvaluehere'), false);

  fs.renameSync(path.join(vaultPath, 'People', 'Apostolos.md'), path.join(vaultPath, 'People', 'Apostolos Renamed.md'));
  obsidianVaultService.syncPath('People/Apostolos.md', 'manual');
  obsidianVaultService.syncPath('People/Apostolos Renamed.md', 'manual');
  const indexed = getEdithPersistenceStore().listObsidianNoteIndex?.() ?? [];
  assert.equal(indexed.some((record) => record.path === 'People/Apostolos.md' && record.deletedAt), true);
  assert.equal(indexed.some((record) => record.path === 'People/Apostolos Renamed.md' && !record.deletedAt), true);

  fs.unlinkSync(path.join(vaultPath, 'Projects', 'Water Literacy.md'));
  obsidianVaultService.syncPath('Projects/Water Literacy.md', 'manual');
  const afterDelete = getEdithPersistenceStore().listObsidianNoteIndex?.() ?? [];
  assert.equal(afterDelete.some((record) => record.path === 'Projects/Water Literacy.md' && record.deletedAt), true);

  const status = obsidianVaultService.status();
  assert.equal(status.vaultExists, true);
  assert.equal(status.connectionStatus === 'connected' || status.connectionStatus === 'synced' || status.connectionStatus === 'partial', true);
  assert.equal(status.vaultPathConfigured, true);
  assert.equal(status.vaultFound, true);
  assert.equal(status.readable, true);
  assert.equal(status.writable, true);
  assert.equal(status.obsidianConfigExists, true);
  assert.equal(status.chunks > 0, true);

  console.log(JSON.stringify({
    success: true,
    indexed: reindex.indexed,
    nodes: graph.nodes.length,
    relationships: graph.relationships.length,
    scenarios: [
      'markdown_wikilinks_tags_properties_attachments',
      'canvas_relationships',
      'vault_reindex',
      'turkish_uppercase_i_path',
      'edith_index_note',
      'vault_folder_tag_nodes',
      'project_sections',
      'secret_redaction',
      'rag_chunks_and_lexical_retrieval',
      'memory_writes_obsidian_note',
      'task_writes_obsidian_note',
      'agent_tool_writes_obsidian_note',
      'rename_move_soft_delete_index',
      'delete_soft_deletes_index',
    ],
  }, null, 2));
} finally {
  getSafeClose();
  process.chdir(originalCwd);
  await removeTempRoot();
}

function getSafeClose(): void {
  try {
    // Imported store instances are closed in tests that use SQLite; JSON does not hold handles.
  } catch {
    // No-op.
  }
}
