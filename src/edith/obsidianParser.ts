import crypto from 'crypto';
import path from 'path';
import type { KnowledgeGraphNodeType, KnowledgeGraphRelationshipType } from './core';

export interface ParsedObsidianDocument {
  title: string;
  body: string;
  properties: Record<string, unknown>;
  tags: string[];
  aliases: string[];
  wikilinks: string[];
  attachments: string[];
  nodeType: KnowledgeGraphNodeType;
  relationships: Array<{ targetTitle: string; type: KnowledgeGraphRelationshipType; evidence: string }>;
}

const REQUIRED_FOLDERS = [
  'Projects',
  'People',
  'Organizations',
  'Research',
  'Tasks',
  'Meetings',
  'Trading',
  'Memory',
  'Conversations',
  'Attachments',
];

export function requiredObsidianFolders(): string[] {
  return [...REQUIRED_FOLDERS];
}

export function normalizeKnowledgeTitle(value: string): string {
  return value
    .replace(/\.md$/i, '')
    .replace(/\.canvas$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugifyKnowledgeId(value: string): string {
  return normalizeKnowledgeTitle(value)
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function inferNodeType(relativePath: string, properties: Record<string, unknown>): KnowledgeGraphNodeType {
  const explicit = String(properties.edith_type ?? properties.type ?? '').trim();
  if (isKnowledgeGraphNodeType(explicit)) return explicit;
  const folder = relativePath.split(/[\\/]/)[0];
  if (folder === 'People') return 'Person';
  if (folder === 'Organizations') return 'Organization';
  if (folder === 'Projects') return 'Project';
  if (folder === 'Tasks') return 'Task';
  if (folder === 'Conversations') return 'Conversation';
  if (folder === 'Trading') return 'Trade';
  if (folder === 'Memory') return 'Memory';
  if (folder === 'Attachments') return 'File';
  return 'Note';
}

function isKnowledgeGraphNodeType(value: string): value is KnowledgeGraphNodeType {
  return [
    'Person',
    'Organization',
    'Project',
    'Task',
    'Note',
    'Conversation',
    'Website',
    'File',
    'Agent',
    'Memory',
    'Tool',
    'Vault',
    'Folder',
    'Tag',
    'Model',
    'Provider',
    'Decision',
    'System',
    'Concept',
    'Automation',
    'SecurityEvent',
    'Event',
    'Trade',
  ].includes(value);
}

export function parseFrontmatter(markdown: string): { properties: Record<string, unknown>; body: string } {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return { properties: {}, body: markdown };
  }
  const normalized = markdown.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { properties: {}, body: markdown };
  const raw = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const properties: Record<string, unknown> = {};
  let currentArrayKey: string | undefined;
  for (const line of raw.split('\n')) {
    if (/^\s*-\s+/.test(line) && currentArrayKey) {
      const list = Array.isArray(properties[currentArrayKey]) ? properties[currentArrayKey] as string[] : [];
      list.push(line.replace(/^\s*-\s+/, '').trim());
      properties[currentArrayKey] = list;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      currentArrayKey = undefined;
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    currentArrayKey = key;
    if (!value) {
      properties[key] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      properties[key] = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      properties[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { properties, body };
}

export function serializeFrontmatter(properties: Record<string, unknown>): string {
  const lines = Object.entries(properties).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
    if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${value}`;
    return `${key}: ${JSON.stringify(String(value ?? ''))}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n`;
}

export function parseMarkdownDocument(markdown: string, relativePath: string): ParsedObsidianDocument {
  const { properties, body } = parseFrontmatter(markdown);
  const fallbackTitle = normalizeKnowledgeTitle(path.basename(relativePath));
  const title = normalizeKnowledgeTitle(String(properties.title ?? properties.edith_title ?? fallbackTitle));
  const tags = Array.from(new Set([
    ...extractTags(body),
    ...arrayProperty(properties.tags),
    ...arrayProperty(properties.tag),
  ]));
  const aliases = Array.from(new Set([
    ...arrayProperty(properties.aliases),
    ...arrayProperty(properties.alias),
  ]));
  const wikilinks = extractWikilinks(body);
  const attachments = extractAttachments(body);
  const relationships = wikilinks.map((targetTitle) => ({
    targetTitle,
    type: 'references' as const,
    evidence: `Wikilink [[${targetTitle}]] in ${relativePath}`,
  }));
  return {
    title,
    body,
    properties,
    tags,
    aliases,
    wikilinks,
    attachments,
    nodeType: inferNodeType(relativePath, properties),
    relationships,
  };
}

export function parseCanvasDocument(content: string, relativePath: string): ParsedObsidianDocument {
  const parsed = JSON.parse(content) as {
    nodes?: Array<{ id: string; text?: string; file?: string; url?: string }>;
    edges?: Array<{ fromNode?: string; toNode?: string; label?: string }>;
  };
  const title = normalizeKnowledgeTitle(path.basename(relativePath));
  const nodeById = new Map((parsed.nodes ?? []).map((node) => [node.id, node]));
  const relationships = (parsed.edges ?? []).flatMap((edge) => {
    const to = edge.toNode ? nodeById.get(edge.toNode) : undefined;
    const targetTitle = normalizeKnowledgeTitle(to?.file ?? to?.text ?? to?.url ?? '');
    return targetTitle ? [{
      targetTitle,
      type: 'relatedTo' as const,
      evidence: `Canvas edge ${edge.label ?? ''} in ${relativePath}`.trim(),
    }] : [];
  });
  const wikilinks = Array.from(new Set((parsed.nodes ?? []).flatMap((node) =>
    node.file ? [normalizeKnowledgeTitle(node.file)] : []
  )));
  return {
    title,
    body: content,
    properties: { edith_type: 'Note', canvas: true },
    tags: [],
    aliases: [],
    wikilinks,
    attachments: [],
    nodeType: 'Note',
    relationships,
  };
}

function extractWikilinks(text: string): string[] {
  const matches = text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g);
  return Array.from(new Set(Array.from(matches).map((match) => normalizeKnowledgeTitle(match[1]))));
}

function extractTags(text: string): string[] {
  const matches = text.matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g);
  return Array.from(new Set(Array.from(matches).map((match) => match[2])));
}

function extractAttachments(text: string): string[] {
  const markdown = Array.from(text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)).map((match) => match[1]);
  const embeds = Array.from(text.matchAll(/!\[\[([^\]]+)\]\]/g)).map((match) => match[1]);
  return Array.from(new Set([...markdown, ...embeds]));
}

function arrayProperty(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.includes(',')) return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}
