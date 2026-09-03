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
  enabled: boolean;
  mode: 'read_write_safe' | 'write_safe' | 'read_only';
  autosync: boolean;
  backlinks: boolean;
  indexEnabled: boolean;
  dailyNotes: boolean;
  knowledgeMapObsidian: boolean;
  syncEnabled: boolean;
  watchEnabled: boolean;
  debounceMs: number;
}

export type ObsidianConnectionStatus =
  | 'connected'
  | 'synced'
  | 'syncing'
  | 'configuration_required'
  | 'disabled'
  | 'read_failed'
  | 'write_failed'
  | 'partial';

export interface ObsidianStatus {
  settings: ObsidianSettings;
  connectionStatus: ObsidianConnectionStatus;
  mode: ObsidianSettings['mode'];
  obsidianEnabled: boolean;
  vaultPathConfigured: boolean;
  vaultFound: boolean;
  readable: boolean;
  writable: boolean;
  vaultExists: boolean;
  obsidianConfigExists: boolean;
  watcherActive: boolean;
  lastSyncAt?: string;
  lastError?: string;
  indexedNotes: number;
  nodeCount: number;
  edgeCount: number;
  chunks: number;
  recentEvents: KnowledgeSyncEvent[];
  folders: Array<{ name: string; exists: boolean }>;
  indexedFolders: string[];
}

export type ObsidianExportAction = 'created' | 'appended' | 'updated' | 'skipped';
export type ObsidianExportErrorCode =
  | 'OBSIDIAN_DISABLED'
  | 'VAULT_PATH_MISSING'
  | 'VAULT_NOT_FOUND'
  | 'WRITE_FAILED'
  | 'INVALID_NOTE_TYPE'
  | 'SECRET_DETECTED'
  | 'EXPORT_SUCCESS';

export interface ObsidianExportStatus {
  enabled: boolean;
  vaultPath: string;
  folder: string;
  notePath?: string;
  absolutePath?: string;
  exported: boolean;
  action: ObsidianExportAction;
  errorCode: ObsidianExportErrorCode;
  errorMessage?: string;
  redacted: boolean;
  warnings: string[];
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
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || process.env.EDITH_OBSIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH,
    locked: true,
    enabled: process.env.EDITH_OBSIDIAN_ENABLED !== 'false',
    mode: this.normalizeMode(process.env.EDITH_OBSIDIAN_MODE),
    autosync: process.env.EDITH_KNOWLEDGE_GRAPH_AUTOSYNC !== 'false' && process.env.EDITH_OBSIDIAN_AUTOSYNC !== 'false',
    backlinks: process.env.EDITH_OBSIDIAN_BACKLINKS !== 'false',
    indexEnabled: process.env.EDITH_OBSIDIAN_INDEX !== 'false',
    dailyNotes: process.env.EDITH_OBSIDIAN_DAILY_NOTES === 'true',
    knowledgeMapObsidian: process.env.EDITH_KNOWLEDGE_MAP_OBSIDIAN !== 'false',
    syncEnabled: process.env.EDITH_OBSIDIAN_AUTOSYNC !== 'false',
    watchEnabled: process.env.EDITH_KNOWLEDGE_GRAPH_AUTOSYNC !== 'false',
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
      enabled: typeof (input as Partial<ObsidianSettings>).enabled === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).enabled) : this.settings.enabled,
      mode: this.normalizeMode((input as Partial<ObsidianSettings>).mode ?? this.settings.mode),
      autosync: typeof (input as Partial<ObsidianSettings>).autosync === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).autosync) : this.settings.autosync,
      backlinks: typeof (input as Partial<ObsidianSettings>).backlinks === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).backlinks) : this.settings.backlinks,
      indexEnabled: typeof (input as Partial<ObsidianSettings>).indexEnabled === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).indexEnabled) : this.settings.indexEnabled,
      dailyNotes: typeof (input as Partial<ObsidianSettings>).dailyNotes === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).dailyNotes) : this.settings.dailyNotes,
      knowledgeMapObsidian: typeof (input as Partial<ObsidianSettings>).knowledgeMapObsidian === 'boolean' ? Boolean((input as Partial<ObsidianSettings>).knowledgeMapObsidian) : this.settings.knowledgeMapObsidian,
      syncEnabled: typeof input.syncEnabled === 'boolean' ? input.syncEnabled : this.settings.syncEnabled,
      watchEnabled: typeof input.watchEnabled === 'boolean' ? input.watchEnabled : this.settings.watchEnabled,
      debounceMs: Number.isFinite(input.debounceMs) ? Math.max(50, Number(input.debounceMs)) : this.settings.debounceMs,
    };
    if (this.settings.watchEnabled) this.startWatcher();
    else this.stopWatcher();
    return this.getSettings();
  }

  status(): ObsidianStatus {
    const vaultPathConfigured = Boolean(this.settings.vaultPath.trim());
    const vaultExists = vaultPathConfigured && fs.existsSync(this.settings.vaultPath);
    const readable = vaultExists && this.canAccess(this.settings.vaultPath, fs.constants.R_OK);
    const writable = vaultExists && this.settings.mode !== 'read_only' && this.canAccess(this.settings.vaultPath, fs.constants.W_OK);
    const obsidianConfigExists = vaultExists && fs.existsSync(path.join(this.settings.vaultPath, '.obsidian'));
    const index = getEdithPersistenceStore().listObsidianNoteIndex?.() ?? [];
    const graph = knowledgeGraphService.snapshot({ limit: 5000 });
    const recentEvents = getEdithPersistenceStore().listKnowledgeSyncEvents?.(20) ?? [];
    const lastError = recentEvents.find((event) => event.status === 'error')?.message;
    const activeIndex = index.filter((record) => !record.deletedAt);
    const connectionStatus = this.connectionStatus({
      vaultPathConfigured,
      vaultExists,
      readable,
      writable,
      recentEvents,
    });
    return {
      settings: this.getSettings(),
      connectionStatus,
      mode: this.settings.mode,
      obsidianEnabled: this.settings.enabled,
      vaultPathConfigured,
      vaultFound: vaultExists,
      readable,
      writable,
      vaultExists,
      obsidianConfigExists,
      watcherActive: Boolean(this.watcher),
      lastSyncAt: this.lastSyncAt,
      lastError,
      indexedNotes: activeIndex.length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.relationships.length,
      chunks: ragService.status().chunks,
      recentEvents,
      folders: requiredObsidianFolders().map((name) => ({
        name,
        exists: vaultExists && fs.existsSync(path.join(this.settings.vaultPath, name)),
      })),
      indexedFolders: Array.from(new Set(activeIndex.map((record) => record.folder).filter(Boolean))).sort(),
    };
  }

  startWatcher(): ObsidianStatus {
    if (!this.settings.enabled || !this.settings.syncEnabled || !this.settings.watchEnabled || this.watcher) return this.status();
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
    if (!this.settings.enabled) {
      return { success: false, indexed: 0, errors: ['Obsidian integration is disabled.'], status: this.status() };
    }
    const structure = this.ensureVaultStructure();
    if (!structure.exported && structure.errorCode !== 'EXPORT_SUCCESS') {
      return { success: false, indexed: 0, errors: [structure.errorMessage ?? structure.errorCode], status: this.status() };
    }
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
    const result = this.writeMemoryNoteResult(memory);
    if (!result.exported) throw new Error(result.errorMessage ?? result.errorCode);
    return result.notePath ?? '';
  }

  writeMemoryNoteResult(memory: MemoryItem): ObsidianExportStatus {
    const title = normalizeKnowledgeTitle(memory.key);
    const relativePath = `Memory/${slugifyKnowledgeId(`${memory.id}-${title}`)}.md`;
    const body = memory.content ?? memory.value;
    return this.writeEntityNoteStatus(relativePath, {
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
    const result = this.writeTaskNoteResult(task);
    if (!result.exported) throw new Error(result.errorMessage ?? result.errorCode);
    return result.notePath ?? '';
  }

  writeTaskNoteResult(task: EdithTask): ObsidianExportStatus {
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
    return this.writeEntityNoteStatus(relativePath, {
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
    const result = this.writeAgentNoteResult(input);
    if (!result.exported) throw new Error(result.errorMessage ?? result.errorCode);
    return result.notePath ?? '';
  }

  writeAgentNoteResult(input: { agentId: string; title: string; body: string; kind: 'research' | 'coding' | 'meeting' | 'trading' }): ObsidianExportStatus {
    const folderByKind: Record<'research' | 'coding' | 'meeting' | 'trading', string> = {
      research: 'Research',
      coding: 'Research/Technical',
      meeting: 'Meetings',
      trading: 'Trading',
    };
    const relativePath = `${folderByKind[input.kind]}/${slugifyKnowledgeId(`${Date.now()}-${input.title}`)}.md`;
    return this.writeEntityNoteStatus(relativePath, {
      edith_entity_id: `agent-output:${input.agentId}:${Date.now()}`,
      edith_type: input.kind === 'trading' ? 'Trade' : 'Note',
      edith_source: 'agent',
      title: input.title,
      tags: [`edith/agent/${input.kind}`],
      edith_agent_id: input.agentId,
      edith_sync_marker: `edith-${Date.now()}`,
    }, `# ${input.title}\n\n${input.body}\n`);
  }

  writeConversationSummary(input: { title?: string; summary: string; assistantPersona?: string; provider?: string; model?: string; tasks?: string[]; followUps?: string[] }): ObsidianExportStatus {
    const date = new Date().toISOString().slice(0, 10);
    const title = normalizeKnowledgeTitle(input.title ?? `${date} - Conversation Summary`);
    return this.writeEntityNoteStatus(`Conversations/${slugifyKnowledgeId(title)}.md`, {
      edith_entity_id: `conversation:${slugifyKnowledgeId(title)}`,
      edith_type: 'Conversation',
      edith_source: 'edith',
      title,
      tags: ['edith/conversation'],
      assistant: input.assistantPersona ?? 'E.D.I.T.H.',
      provider: input.provider,
      model: input.model,
      edith_sync_marker: `edith-${Date.now()}`,
    }, [
      `# ${title}`,
      '',
      `Date: ${date}`,
      `Assistant: ${input.assistantPersona ?? 'E.D.I.T.H.'}`,
      input.provider ? `Provider: ${input.provider}` : '',
      input.model ? `Model: ${input.model}` : '',
      '',
      '## Summary',
      input.summary,
      '',
      '## Tasks',
      ...(input.tasks?.length ? input.tasks.map((task) => `- ${task}`) : ['- None recorded']),
      '',
      '## Follow-ups',
      ...(input.followUps?.length ? input.followUps.map((item) => `- ${item}`) : ['- None recorded']),
      '',
    ].filter((line) => line !== '').join('\n'), true);
  }

  writeProjectSummary(input: { title: string; overview: string; decisions?: string[]; roadmap?: string[]; risks?: string[] }): ObsidianExportStatus {
    const title = normalizeKnowledgeTitle(input.title);
    return this.writeEntityNoteStatus(`Projects/${slugifyKnowledgeId(title)}.md`, {
      edith_entity_id: `project:${slugifyKnowledgeId(title)}`,
      edith_type: 'Project',
      edith_source: 'edith',
      title,
      tags: ['edith/project'],
      edith_sync_marker: `edith-${Date.now()}`,
    }, [
      `# ${title}`,
      '',
      '## Overview',
      input.overview,
      '',
      '## Decisions',
      ...(input.decisions?.length ? input.decisions.map((item) => `- ${item}`) : ['- None recorded']),
      '',
      '## Roadmap',
      ...(input.roadmap?.length ? input.roadmap.map((item) => `- ${item}`) : ['- None recorded']),
      '',
      '## Open Risks',
      ...(input.risks?.length ? input.risks.map((item) => `- ${item}`) : ['- None recorded']),
      '',
    ].join('\n'));
  }

  writeResearchNote(input: { topic: string; summary: string; sources?: string[]; uncertainty?: string; questions?: string[] }): ObsidianExportStatus {
    const title = normalizeKnowledgeTitle(input.topic);
    return this.writeEntityNoteStatus(`Research/${slugifyKnowledgeId(`${Date.now()}-${title}`)}.md`, {
      edith_entity_id: `research:${Date.now()}:${slugifyKnowledgeId(title)}`,
      edith_type: 'Note',
      edith_source: 'edith',
      title,
      tags: ['edith/research'],
      edith_sync_marker: `edith-${Date.now()}`,
    }, [
      `# ${title}`,
      '',
      '## Summary',
      input.summary,
      '',
      '## Sources',
      ...(input.sources?.length ? input.sources.map((item) => `- ${item}`) : ['- None recorded']),
      '',
      '## Uncertainty',
      input.uncertainty ?? 'Not recorded.',
      '',
      '## Next Questions',
      ...(input.questions?.length ? input.questions.map((item) => `- ${item}`) : ['- None recorded']),
      '',
    ].join('\n'));
  }

  writePersonOrOrganizationNote(input: { kind: 'person' | 'organization'; name: string; context: string; projects?: string[]; notes?: string[] }): ObsidianExportStatus {
    const title = normalizeKnowledgeTitle(input.name);
    const folder = input.kind === 'person' ? 'People' : 'Organizations';
    return this.writeEntityNoteStatus(`${folder}/${slugifyKnowledgeId(title)}.md`, {
      edith_entity_id: `${input.kind}:${slugifyKnowledgeId(title)}`,
      edith_type: input.kind === 'person' ? 'Person' : 'Organization',
      edith_source: 'edith',
      title,
      tags: [`edith/${input.kind}`],
      edith_sync_marker: `edith-${Date.now()}`,
    }, [
      `# ${title}`,
      '',
      '## Context',
      input.context,
      '',
      '## Projects',
      ...(input.projects?.length ? input.projects.map((item) => `- [[${item}]]`) : ['- None recorded']),
      '',
      '## Notes',
      ...(input.notes?.length ? input.notes.map((item) => `- ${item}`) : ['- None recorded']),
      '',
    ].join('\n'));
  }

  writeCryptoLearningNote(input: { title?: string; symbol?: string; lesson: string; observations?: string[] }): ObsidianExportStatus {
    const date = new Date().toISOString().slice(0, 10);
    const title = normalizeKnowledgeTitle(input.title ?? `${date} - Crypto Market Learning`);
    return this.writeEntityNoteStatus(`Trading/Crypto Market Learning/${slugifyKnowledgeId(title)}.md`, {
      edith_entity_id: `crypto-learning:${slugifyKnowledgeId(title)}`,
      edith_type: 'Trade',
      edith_source: 'edith',
      title,
      tags: ['edith/trading', 'crypto-learning'],
      symbol: input.symbol,
      edith_sync_marker: `edith-${Date.now()}`,
    }, [
      `# ${title}`,
      '',
      input.symbol ? `Symbol: ${input.symbol}` : '',
      '',
      '## Lesson',
      input.lesson,
      '',
      '## Observations',
      ...(input.observations?.length ? input.observations.map((item) => `- ${item}`) : ['- None recorded']),
      '',
    ].filter((line) => line !== '').join('\n'), true);
  }

  private ingestMarkdown(relativePath: string, absolutePath: string, stat: fs.Stats): void {
    const rawContent = fs.readFileSync(absolutePath, 'utf8');
    const secretScan = this.redactSecrets(rawContent);
    const content = secretScan.content;
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
      properties: { ...parsed.properties, edith_secret_redacted: secretScan.redacted },
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
    this.recordEvent(syncEvent('edit', relativePath, 'obsidian', 'success', secretScan.redacted ? 'Markdown note indexed with secret redaction.' : 'Markdown note indexed.'));
  }

  private ingestCanvas(relativePath: string, absolutePath: string, stat: fs.Stats): void {
    const secretScan = this.redactSecrets(fs.readFileSync(absolutePath, 'utf8'));
    const content = secretScan.content;
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
      properties: { ...parsed.properties, edith_secret_redacted: secretScan.redacted },
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
    const result = this.writeEntityNoteStatus(relativePath, frontmatter, body);
    if (!result.exported) throw new Error(result.errorMessage ?? result.errorCode);
    return result.notePath ?? relativePath;
  }

  private writeEntityNoteStatus(relativePath: string, frontmatter: Record<string, unknown>, body: string, append = false): ObsidianExportStatus {
    const structure = this.ensureVaultStructure();
    const folder = this.normalizeRelativePath(relativePath).split('/').slice(0, -1).join('/') || '.';
    if (!structure.exported && structure.errorCode !== 'EXPORT_SUCCESS') {
      return { ...structure, folder, notePath: this.normalizeRelativePath(relativePath) };
    }
    const safeRelative = this.normalizeRelativePath(relativePath);
    const scan = this.redactSecrets(body);
    try {
      const absolutePath = this.absolutePathFor(safeRelative);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      let existingBody = body;
      let existingProperties: Record<string, unknown> = {};
      const existed = fs.existsSync(absolutePath);
      if (existed) {
        const parsed = parseFrontmatter(fs.readFileSync(absolutePath, 'utf8'));
        existingProperties = parsed.properties;
        existingBody = append
          ? `${parsed.body.trimEnd()}\n\n${scan.content.trim()}`
          : parsed.body.trim() ? parsed.body : scan.content;
      } else {
        existingBody = scan.content;
      }
      const mergedProperties = {
        ...existingProperties,
        ...frontmatter,
        edith_updated_at: now(),
        edith_secret_redacted: scan.redacted,
        edith_secret_warning: scan.redacted ? 'Potential secret-like content was redacted before writing.' : undefined,
      };
      const content = `${serializeFrontmatter(this.cleanFrontmatter(mergedProperties))}${existingBody.trimEnd()}\n`;
      fs.writeFileSync(absolutePath, content, 'utf8');
      RECENT_EDITH_WRITES.set(safeRelative, Date.now());
      this.syncPath(safeRelative, 'edith');
      this.recordEvent(syncEvent('write', safeRelative, 'edith', 'success', scan.redacted ? 'EDITH wrote redacted Obsidian note.' : 'EDITH wrote Obsidian note.'));
      this.audit('obsidian.write', safeRelative, 'success');
      return {
        enabled: this.settings.enabled,
        vaultPath: this.settings.vaultPath,
        folder,
        notePath: safeRelative,
        absolutePath,
        exported: true,
        action: existed ? (append ? 'appended' : 'updated') : 'created',
        errorCode: scan.redacted ? 'SECRET_DETECTED' : 'EXPORT_SUCCESS',
        errorMessage: scan.redacted ? 'Potential secret-like content was redacted before writing.' : undefined,
        redacted: scan.redacted,
        warnings: scan.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordEvent(syncEvent('write', safeRelative, 'edith', 'error', message));
      this.audit('obsidian.write', safeRelative, 'error');
      return {
        enabled: this.settings.enabled,
        vaultPath: this.settings.vaultPath,
        folder,
        notePath: safeRelative,
        exported: false,
        action: 'skipped',
        errorCode: 'WRITE_FAILED',
        errorMessage: message,
        redacted: scan.redacted,
        warnings: scan.warnings,
      };
    }
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

  private ensureVaultStructure(): ObsidianExportStatus {
    if (!this.settings.enabled) {
      return this.skippedExport('.', 'OBSIDIAN_DISABLED', 'Obsidian integration is disabled.');
    }
    if (!this.settings.vaultPath.trim()) {
      return this.skippedExport('.', 'VAULT_PATH_MISSING', 'Obsidian vault path is not configured.');
    }
    if (!fs.existsSync(this.settings.vaultPath)) {
      const message = `Obsidian vault was not found: ${this.settings.vaultPath}`;
      this.recordEvent(syncEvent('reindex', this.settings.vaultPath, 'edith', 'error', message));
      return this.skippedExport('.', 'VAULT_NOT_FOUND', message);
    }
    for (const folder of requiredObsidianFolders()) {
      fs.mkdirSync(path.join(this.settings.vaultPath, folder), { recursive: true });
    }
    if (this.settings.indexEnabled) this.writeIndexNote();
    return {
      enabled: true,
      vaultPath: this.settings.vaultPath,
      folder: '.',
      exported: true,
      action: 'updated',
      errorCode: 'EXPORT_SUCCESS',
      redacted: false,
      warnings: [],
    };
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
    const relative = path.relative(vaultRoot, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path escapes Obsidian vault: ${relativePath}`);
    return absolutePath;
  }

  private normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private shouldIgnore(relativePath: string): boolean {
    return !relativePath || relativePath.startsWith('.obsidian/') || relativePath.includes('/.trash/');
  }

  private writeIndexNote(): void {
    const relativePath = 'E.D.I.T.H. Index.md';
    const absolutePath = this.absolutePathFor(relativePath);
    const existing = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
    const body = [
      '# E.D.I.T.H. Index',
      '',
      'This note is maintained by E.D.I.T.H. as a safe index into the local Obsidian vault.',
      '',
      '## Vault',
      '- [[Memory]]',
      '- [[Projects]]',
      '- [[Tasks]]',
      '- [[Research]]',
      '- [[Conversations]]',
      '- [[Trading]]',
      '- [[People]]',
      '- [[Organizations]]',
      '- [[Meetings]]',
      '',
    ].join('\n');
    const properties = serializeFrontmatter({
      edith_entity_id: 'system:edith-index',
      edith_type: 'Note',
      edith_source: 'edith',
      title: 'E.D.I.T.H. Index',
      tags: ['edith/index', 'edith/knowledge-map'],
      edith_updated_at: now(),
    });
    const content = existing.trim()
      ? `${properties}${parseFrontmatter(existing).body.trimEnd()}\n`
      : `${properties}${body}`;
    fs.writeFileSync(absolutePath, content, 'utf8');
    RECENT_EDITH_WRITES.set(relativePath, Date.now());
  }

  private normalizeMode(value: unknown): ObsidianSettings['mode'] {
    return value === 'write_safe' || value === 'read_only' || value === 'read_write_safe'
      ? value
      : 'read_write_safe';
  }

  private canAccess(targetPath: string, mode: number): boolean {
    try {
      fs.accessSync(targetPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  private connectionStatus(input: {
    vaultPathConfigured: boolean;
    vaultExists: boolean;
    readable: boolean;
    writable: boolean;
    recentEvents: KnowledgeSyncEvent[];
  }): ObsidianConnectionStatus {
    if (!this.settings.enabled) return 'disabled';
    if (!input.vaultPathConfigured || !input.vaultExists) return 'configuration_required';
    if (!input.readable) return 'read_failed';
    if (this.settings.mode !== 'read_only' && !input.writable) return 'write_failed';
    if (input.recentEvents.some((event) => event.status === 'error')) return 'partial';
    if (this.lastSyncAt) return 'synced';
    return 'connected';
  }

  private skippedExport(folder: string, errorCode: Exclude<ObsidianExportErrorCode, 'EXPORT_SUCCESS' | 'SECRET_DETECTED'>, errorMessage: string): ObsidianExportStatus {
    return {
      enabled: this.settings.enabled,
      vaultPath: this.settings.vaultPath,
      folder,
      exported: false,
      action: 'skipped',
      errorCode,
      errorMessage,
      redacted: false,
      warnings: [],
    };
  }

  private cleanFrontmatter(properties: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
  }

  private redactSecrets(content: string): { content: string; redacted: boolean; warnings: string[] } {
    const patterns: Array<[RegExp, string]> = [
      [/\bAIza[0-9A-Za-z_-]{25,}\b/g, 'Gemini API key'],
      [/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'OpenAI-style API key'],
      [/\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?token|binance[_-]?(?:key|secret))\s*[:=]\s*["']?[^"'\s`]{8,}/gi, 'credential assignment'],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private key'],
      [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'JWT/web token'],
    ];
    let redacted = content;
    const warnings: string[] = [];
    for (const [pattern, label] of patterns) {
      if (pattern.test(redacted)) {
        warnings.push(label);
        redacted = redacted.replace(pattern, `[REDACTED ${label}]`);
      }
    }
    return {
      content: redacted,
      redacted: warnings.length > 0,
      warnings: Array.from(new Set(warnings)),
    };
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
