import fs from 'fs';
import path from 'path';
import type { FSWatcher } from 'fs';
import type {
  EdithTask,
  KnowledgeGraphNodeType,
  KnowledgeSyncEvent,
  ObsidianNoteIndexRecord,
} from './core';
import type { MemoryItem } from '../types';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';
import { knowledgeGraphService } from './knowledgeGraphService';
import {
  hashContent,
  inferNodeType,
  normalizeKnowledgeTitle,
  parseCanvasDocument,
  parseFrontmatter,
  parseMarkdownDocument,
  requiredObsidianFolders,
  serializeFrontmatter,
  slugifyKnowledgeId,
} from './obsidianParser';
import { ragService } from './ragService';

const DEFAULT_VAULT_PATH = 'D:\\EDİTH\\EDİTH';
const NOTE_EXTENSIONS = new Set(['.md', '.canvas']);
const RECENT_EDITH_WRITES = new Map<string, number>();

export interface ObsidianSettings {
  vaultPath: string;
  locked: true;
  syncEnabled: boolean;
  watchEnabled: boolean;
  debounceMs: number;
}

export interface ObsidianStatus {
  settings: ObsidianSettings;
  vaultExists: boolean;
  obsidianConfigExists: boolean;
  watcherActive: boolean;
  lastSyncAt?: string;
  indexedNotes: number;
  chunks: number;
  recentEvents: KnowledgeSyncEvent[];
  folders: Array<{ name: string; exists: boolean }>;
}

function now(): string {
  return new Date().toISOString();
}

function syncEvent(action: KnowledgeSyncEvent['action'], pathValue: string, source: KnowledgeSyncEvent['source'], status: KnowledgeSyncEvent['status'], message: string, previousPath?: string): KnowledgeSyncEvent {
  return {
    id: `ksync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    path: pathValue,
    previousPath,
    source,
    status,
    message,
    createdAt: now(),
  };
}

export class ObsidianVaultService {
  private settings: ObsidianSettings = {
    vaultPath: process.env.EDITH_OBSIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH,
    locked: true,
    syncEnabled: true,
    watchEnabled: true,
    debounceMs: 250,
  };
  private watcher?: FSWatcher;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastSyncAt?: string;

  getSettings(): ObsidianSettings {
    return { ...this.settings };
  }

  updateSettings(input: Partial<Pick<ObsidianSettings, 'syncEnabled' | 'watchEnabled' | 'debounceMs'>>): ObsidianSettings {
    this.settings = {
      ...this.settings,
      syncEnabled: typeof input.syncEnabled === 'boolean' ? input.syncEnabled : this.settings.syncEnabled,
      watchEnabled: typeof input.watchEnabled === 'boolean' ? input.watchEnabled : this.settings.watchEnabled,
      debounceMs: Number.isFinite(input.debounceMs) ? Math.max(50, Number(input.debounceMs)) : this.settings.debounceMs,
    };
    if (this.settings.watchEnabled) this.startWatcher();
    else this.stopWatcher();
    return this.getSettings();
  }

  status(): ObsidianStatus {
    const vaultExists = fs.existsSync(this.settings.vaultPath);
    const obsidianConfigExists = fs.existsSync(path.join(this.settings.vaultPath, '.obsidian'));
    const index = getEdithPersistenceStore().listObsidianNoteIndex?.() ?? [];
    return {
      settings: this.getSettings(),
      vaultExists,
      obsidianConfigExists,
      watcherActive: Boolean(this.watcher),
      lastSyncAt: this.lastSyncAt,
      indexedNotes: index.filter((record) => !record.deletedAt).length,
      chunks: ragService.status().chunks,
      recentEvents: getEdithPersistenceStore().listKnowledgeSyncEvents?.(20) ?? [],
      folders: requiredObsidianFolders().map((name) => ({
        name,
        exists: fs.existsSync(path.join(this.settings.vaultPath, name)),
      })),
    };
  }

  startWatcher(): ObsidianStatus {
    if (!this.settings.syncEnabled || !this.settings.watchEnabled || this.watcher) return this.status();
    if (!fs.existsSync(this.settings.vaultPath)) {
      this.recordEvent(syncEvent('reindex', this.settings.vaultPath, 'watcher', 'error', 'Vault path does not exist.'));
      return this.status();
    }
    try {
      this.watcher = fs.watch(this.settings.vaultPath, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const relativePath = this.normalizeRelativePath(String(filename));
        if (this.shouldIgnore(relativePath)) return;
        this.debounce(relativePath, () => this.syncPath(relativePath, 'watcher'));
      });
      this.recordEvent(syncEvent('reindex', this.settings.vaultPath, 'watcher', 'success', 'Obsidian watcher started.'));
    } catch (error) {
      this.watcher = undefined;
      this.recordEvent(syncEvent('reindex', this.settings.vaultPath, 'watcher', 'error', error instanceof Error ? error.message : String(error)));
    }
    return this.status();
  }

  stopWatcher(): ObsidianStatus {
    this.watcher?.close();
    this.watcher = undefined;
    return this.status();
  }

  reindex(): { success: boolean; indexed: number; errors: string[]; status: ObsidianStatus } {
    this.ensureVaultStructure();
    const files = this.walkVault();
    const errors: string[] = [];
    let indexed = 0;
    for (const file of files) {
      try {
        this.syncPath(file, 'manual');
        indexed += 1;
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.lastSyncAt = now();
    this.recordEvent(syncEvent('reindex', this.settings.vaultPath, 'manual', errors.length ? 'error' : 'success', `Reindexed ${indexed} vault item(s).`));
    return { success: errors.length === 0, indexed, errors, status: this.status() };
  }

  syncPath(relativePath: string, source: KnowledgeSyncEvent['source'] = 'obsidian'): void {
    const safeRelative = this.normalizeRelativePath(relativePath);
    if (this.shouldIgnore(safeRelative)) return;
    const absolutePath = this.absolutePathFor(safeRelative);
    const writeStamp = RECENT_EDITH_WRITES.get(safeRelative);
    if (writeStamp && Date.now() - writeStamp < 1000 && source === 'watcher') {
      this.recordEvent(syncEvent('edit', safeRelative, source, 'ignored', 'Ignored EDITH write echo.'));
      return;
    }
    if (!fs.existsSync(absolutePath)) {
      const deletedAt = now();
      getEdithPersistenceStore().deleteObsidianNoteIndex?.(safeRelative, deletedAt);
      this.recordEvent(syncEvent('delete', safeRelative, source, 'success', 'Vault file soft-deleted in EDITH index.'));
      return;
    }
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) return;
    const extension = path.extname(absolutePath).toLocaleLowerCase('en-US');
    if (extension === '.md') this.ingestMarkdown(safeRelative, absolutePath, stat);
    else if (extension === '.canvas') this.ingestCanvas(safeRelative, absolutePath, stat);
    else this.ingestAttachment(safeRelative, absolutePath, stat);
  }

  writeMemoryNote(memory: MemoryItem): string {
    const title = normalizeKnowledgeTitle(memory.key);
    const relativePath = `Memory/${slugifyKnowledgeId(`${memory.id}-${title}`)}.md`;
    const body = memory.content ?? memory.value;
    return this.writeEntityNote(relativePath, {
      edith_entity_id: `memory:${memory.id}`,
      edith_type: 'Memory',
      edith_source: 'memory',
      title,
      tags: ['edith/memory', memory.category],
      aliases: [memory.key],
      edith_sync_marker: `edith-${Date.now()}`,
    }, `# ${title}\n\n${body}\n`);
  }

  writeTaskNote(task: EdithTask): string {
    const title = normalizeKnowledgeTitle(task.title);
    const relativePath = `Tasks/${slugifyKnowledgeId(`${task.id}-${title}`)}.md`;
    const body = [
      `# ${title}`,
      '',
      `Objective: ${task.objective}`,
      '',
      `Status: ${task.status}`,
      `Risk: ${task.riskLevel}`,
      '',
      '## Checkpoints',
      ...task.checkpoints.map((checkpoint) => `- ${checkpoint}`),
      '',
      '## Artifacts',
      ...task.artifacts.map((artifact) => `- ${artifact}`),
      '',
    ].join('\n');
    return this.writeEntityNote(relativePath, {
      edith_entity_id: `task:${task.id}`,
      edith_type: 'Task',
      edith_source: 'task',
      title,
      status: task.status,
      tags: ['edith/task'],
      edith_sync_marker: `edith-${Date.now()}`,
    }, body);
  }

  writeAgentNote(input: { agentId: string; title: string; body: string; kind: 'research' | 'coding' | 'meeting' | 'trading' }): string {
    const folderByKind: Record<'research' | 'coding' | 'meeting' | 'trading', string> = {
      research: 'Research',
      coding: 'Research/Technical',
      meeting: 'Meetings',
      trading: 'Trading',
    };
    const relativePath = `${folderByKind[input.kind]}/${slugifyKnowledgeId(`${Date.now()}-${input.title}`)}.md`;
    return this.writeEntityNote(relativePath, {
      edith_entity_id: `agent-output:${input.agentId}:${Date.now()}`,
      edith_type: input.kind === 'trading' ? 'Trade' : 'Note',
      edith_source: 'agent',
      title: input.title,
      tags: [`edith/agent/${input.kind}`],
      edith_agent_id: input.agentId,
      edith_sync_marker: `edith-${Date.now()}`,
    }, `# ${input.title}\n\n${input.body}\n`);
  }

  private ingestMarkdown(relativePath: string, absolutePath: string, stat: fs.Stats): void {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const parsed = parseMarkdownDocument(content, relativePath);
    const entityId = String(parsed.properties.edith_entity_id ?? this.entityIdFor(relativePath, parsed.nodeType, parsed.title));
    const folder = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
    const node = knowledgeGraphService.upsertNode({
      id: entityId,
      title: parsed.title,
      type: parsed.nodeType,
      aliases: parsed.aliases,
      tags: parsed.tags,
      path: relativePath,
      folder,
      source: 'obsidian',
      importance: this.importanceFor(parsed),
      recentActivityAt: new Date(stat.mtimeMs).toISOString(),
      properties: parsed.properties,
    });
    this.indexRecord(relativePath, absolutePath, stat, entityId, parsed.title, folder, '.md', content, parsed.tags, parsed.wikilinks, parsed.attachments, parsed.properties);
    for (const relationship of parsed.relationships) {
      const target = knowledgeGraphService.upsertNode({
        id: this.entityIdFor('', this.inferLinkedType(relationship.targetTitle), relationship.targetTitle),
        title: relationship.targetTitle,
        type: this.inferLinkedType(relationship.targetTitle),
        source: 'obsidian',
        importance: 0.45,
      });
      knowledgeGraphService.upsertRelationship({
        from: node.id,
        to: target.id,
        type: relationship.type,
        strength: 0.72,
        source: 'obsidian',
        evidence: relationship.evidence,
      });
    }
    this.indexProjectSections(node.id, parsed.body, parsed.title);
    ragService.indexNote({ nodeId: node.id, notePath: relativePath, body: parsed.body });
    this.maybeUpsertMemory(relativePath, entityId, parsed);
    this.recordEvent(syncEvent('edit', relativePath, 'obsidian', 'success', 'Markdown note indexed.'));
  }

  private ingestCanvas(relativePath: string, absolutePath: string, stat: fs.Stats): void {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const parsed = parseCanvasDocument(content, relativePath);
    const entityId = this.entityIdFor(relativePath, 'Note', parsed.title);
    const folder = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
    const node = knowledgeGraphService.upsertNode({
      id: entityId,
      title: parsed.title,
      type: 'Note',
      aliases: [],
      tags: ['canvas'],
      path: relativePath,
      folder,
      source: 'obsidian',
      importance: 0.6,
      recentActivityAt: new Date(stat.mtimeMs).toISOString(),
      properties: parsed.properties,
    });
    this.indexRecord(relativePath, absolutePath, stat, entityId, parsed.title, folder, '.canvas', content, ['canvas'], parsed.wikilinks, [], parsed.properties);
    for (const relationship of parsed.relationships) {
      const target = knowledgeGraphService.upsertNode({
        id: this.entityIdFor('', this.inferLinkedType(relationship.targetTitle), relationship.targetTitle),
        title: relationship.targetTitle,
        type: this.inferLinkedType(relationship.targetTitle),
        source: 'obsidian',
        importance: 0.45,
      });
      knowledgeGraphService.upsertRelationship({
        from: node.id,
        to: target.id,
        type: 'relatedTo',
        strength: 0.65,
        source: 'obsidian',
        evidence: relationship.evidence,
      });
    }
    ragService.indexNote({ nodeId: node.id, notePath: relativePath, body: content });
    this.recordEvent(syncEvent('edit', relativePath, 'obsidian', 'success', 'Canvas indexed.'));
  }

  private ingestAttachment(relativePath: string, absolutePath: string, stat: fs.Stats): void {
    const title = normalizeKnowledgeTitle(path.basename(relativePath));
    const folder = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : '';
    const entityId = this.entityIdFor(relativePath, 'File', title);
    knowledgeGraphService.upsertNode({
      id: entityId,
      title,
      type: 'File',
      path: relativePath,
      folder,
      source: 'obsidian',
      importance: 0.35,
      recentActivityAt: new Date(stat.mtimeMs).toISOString(),
      properties: { extension: path.extname(relativePath), attachment: true },
    });
    this.indexRecord(relativePath, absolutePath, stat, entityId, title, folder, 'attachment', '', [], [], [], { attachment: true });
    this.recordEvent(syncEvent('edit', relativePath, 'obsidian', 'success', 'Attachment indexed without modification.'));
  }

  private writeEntityNote(relativePath: string, frontmatter: Record<string, unknown>, body: string): string {
    this.ensureVaultStructure();
    const safeRelative = this.normalizeRelativePath(relativePath);
    const absolutePath = this.absolutePathFor(safeRelative);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    let existingBody = body;
    let existingProperties: Record<string, unknown> = {};
    if (fs.existsSync(absolutePath)) {
      const parsed = parseFrontmatter(fs.readFileSync(absolutePath, 'utf8'));
      existingProperties = parsed.properties;
      existingBody = parsed.body.trim() ? parsed.body : body;
    }
    const mergedProperties = { ...existingProperties, ...frontmatter, edith_updated_at: now() };
    const content = `${serializeFrontmatter(mergedProperties)}${existingBody.trimEnd()}\n`;
    fs.writeFileSync(absolutePath, content, 'utf8');
    RECENT_EDITH_WRITES.set(safeRelative, Date.now());
    this.syncPath(safeRelative, 'edith');
    this.recordEvent(syncEvent('write', safeRelative, 'edith', 'success', 'EDITH wrote Obsidian note.'));
    this.audit('obsidian.write', safeRelative, 'success');
    return safeRelative;
  }

  private maybeUpsertMemory(relativePath: string, entityId: string, parsed: ReturnType<typeof parseMarkdownDocument>): void {
    if (!relativePath.startsWith('Memory/')) return;
    getEdithPersistenceStore().upsertMemory?.({
      id: entityId.startsWith('memory:') ? entityId.slice(7) : entityId,
      category: 'custom',
      key: parsed.title,
      value: parsed.body.slice(0, 2000),
      content: parsed.body,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      type: 'semantic',
      scope: 'global',
      source: 'obsidian',
      confidence: 0.8,
      importance: 0.55,
      sensitivity: 'internal',
    });
  }

  private indexProjectSections(projectNodeId: string, body: string, projectTitle: string): void {
    const sections = ['Partners', 'Activities', 'Budget', 'Meetings', 'Emails', 'Tasks', 'Documents'];
    for (const section of sections) {
      const hasSection = new RegExp(`^#{1,4}\\s+${section}\\b`, 'im').test(body);
      if (!hasSection && !new RegExp(`\\b${section}\\b`, 'i').test(body)) continue;
      const node = knowledgeGraphService.upsertNode({
        id: `note:${slugifyKnowledgeId(`${projectTitle}-${section}`)}`,
        title: `${projectTitle} ${section}`,
        type: section === 'Tasks' ? 'Task' : section === 'Documents' ? 'File' : 'Note',
        source: 'obsidian',
        importance: 0.52,
        properties: { projectSection: section },
      });
      knowledgeGraphService.upsertRelationship({
        from: projectNodeId,
        to: node.id,
        type: 'belongsTo',
        source: 'obsidian',
        strength: 0.7,
        evidence: `Project memory section ${section}.`,
      });
    }
  }

  private indexRecord(
    relativePath: string,
    absolutePath: string,
    stat: fs.Stats,
    entityId: string,
    title: string,
    folder: string,
    extension: ObsidianNoteIndexRecord['extension'],
    content: string,
    tags: string[],
    links: string[],
    attachments: string[],
    properties: Record<string, unknown>
  ): void {
    getEdithPersistenceStore().upsertObsidianNoteIndex?.({
      path: relativePath,
      absolutePath,
      entityId,
      title,
      folder,
      extension,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: hashContent(content || `${relativePath}:${stat.size}:${stat.mtimeMs}`),
      tags,
      links,
      attachments,
      properties,
      indexedAt: now(),
    });
  }

  private ensureVaultStructure(): void {
    fs.mkdirSync(this.settings.vaultPath, { recursive: true });
    for (const folder of requiredObsidianFolders()) {
      fs.mkdirSync(path.join(this.settings.vaultPath, folder), { recursive: true });
    }
  }

  private walkVault(dir = this.settings.vaultPath, prefix = ''): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === '.obsidian') return [];
      const relativePath = this.normalizeRelativePath(path.join(prefix, entry.name));
      const absolutePath = path.join(this.settings.vaultPath, relativePath);
      if (entry.isDirectory()) return this.walkVault(absolutePath, relativePath);
      return [relativePath];
    });
  }

  private absolutePathFor(relativePath: string): string {
    const absolutePath = path.resolve(this.settings.vaultPath, relativePath);
    const vaultRoot = path.resolve(this.settings.vaultPath);
    if (!absolutePath.startsWith(vaultRoot)) throw new Error(`Path escapes Obsidian vault: ${relativePath}`);
    return absolutePath;
  }

  private normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private shouldIgnore(relativePath: string): boolean {
    return !relativePath || relativePath.startsWith('.obsidian/') || relativePath.includes('/.trash/');
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      try {
        fn();
      } catch (error) {
        this.recordEvent(syncEvent('edit', key, 'watcher', 'error', error instanceof Error ? error.message : String(error)));
      }
    }, this.settings.debounceMs));
  }

  private entityIdFor(relativePath: string, type: KnowledgeGraphNodeType, title: string): string {
    if (relativePath) return `${type.toLocaleLowerCase('en-US')}:${slugifyKnowledgeId(relativePath)}`;
    return knowledgeGraphService.nodeIdForTitle(type, title);
  }

  private inferLinkedType(title: string): KnowledgeGraphNodeType {
    const lower = title.toLocaleLowerCase('tr-TR');
    if (/(project|ka210|literacy|proje)/i.test(lower)) return 'Project';
    if (/(ltd|inc|org|foundation|association|dernek|vakıf)/i.test(lower)) return 'Organization';
    return 'Note';
  }

  private importanceFor(parsed: { nodeType: KnowledgeGraphNodeType; wikilinks: string[]; tags: string[] }): number {
    const base = parsed.nodeType === 'Project' ? 0.78 : parsed.nodeType === 'Person' || parsed.nodeType === 'Organization' ? 0.68 : 0.5;
    return Math.min(1, base + parsed.wikilinks.length * 0.025 + parsed.tags.length * 0.015);
  }

  private recordEvent(event: KnowledgeSyncEvent): void {
    getEdithPersistenceStore().appendKnowledgeSyncEvent?.(event);
  }

  private audit(action: string, target: string, result: 'success' | 'error'): void {
    appendAuditEvent(createAuditEvent({
      actor: 'edith-obsidian-service',
      action,
      toolId: 'obsidian_vault_service',
      target,
      authorization: 'allowed',
      riskLevel: 2,
      result,
      message: `Obsidian sync ${result}: ${target}`,
    }));
  }
}

export const obsidianVaultService = new ObsidianVaultService();
