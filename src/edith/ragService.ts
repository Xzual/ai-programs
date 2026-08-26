import type { KnowledgeChunk, KnowledgeGraphNode } from './core';
import { getEdithPersistenceStore } from './persistence';
import { hashContent } from './obsidianParser';

export interface RagIndexResult {
  notePath: string;
  nodeId: string;
  chunks: number;
  embeddingStatus: KnowledgeChunk['embeddingStatus'];
}

export interface RagRetrievalResult {
  query: string;
  embeddingStatus: KnowledgeChunk['embeddingStatus'];
  results: Array<{
    chunk: KnowledgeChunk;
    score: number;
    node?: KnowledgeGraphNode;
  }>;
}

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase('tr-TR')
    .split(/[^a-z0-9ğüşıöçİĞÜŞÖÇ]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function chunkText(text: string, maxChars = 1200): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > maxChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)].filter(Boolean);
}

export class RagService {
  indexNote(input: {
    nodeId: string;
    notePath: string;
    body: string;
    embeddingProvider?: string;
    embeddingModel?: string;
  }): RagIndexResult {
    const embeddingStatus: KnowledgeChunk['embeddingStatus'] = input.embeddingProvider ? 'ready' : 'embedding_provider_required';
    const indexedAt = new Date().toISOString();
    const chunks = chunkText(input.body).map((content, ordinal): KnowledgeChunk => ({
      id: `chunk:${input.nodeId}:${ordinal}:${hashContent(content).slice(0, 10)}`,
      nodeId: input.nodeId,
      notePath: input.notePath,
      content,
      ordinal,
      tokensApprox: Math.ceil(tokenize(content).length * 1.35),
      hash: hashContent(content),
      embeddingStatus,
      embeddingProvider: input.embeddingProvider,
      embeddingModel: input.embeddingModel,
      vector: input.embeddingProvider ? this.deterministicVector(content) : undefined,
      indexedAt,
    }));
    getEdithPersistenceStore().replaceKnowledgeChunksForNote?.(input.notePath, chunks);
    return {
      notePath: input.notePath,
      nodeId: input.nodeId,
      chunks: chunks.length,
      embeddingStatus,
    };
  }

  retrieve(query: string, limit = 8): RagRetrievalResult {
    const queryTokens = tokenize(query);
    const nodes = new Map((getEdithPersistenceStore().listKnowledgeNodes?.() ?? []).map((node) => [node.id, node]));
    const scored = (getEdithPersistenceStore().listKnowledgeChunks?.(5000) ?? [])
      .map((chunk) => ({
        chunk,
        score: this.lexicalScore(queryTokens, chunk.content),
        node: nodes.get(chunk.nodeId),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      query,
      embeddingStatus: scored.some((item) => item.chunk.embeddingStatus === 'ready') ? 'ready' : 'embedding_provider_required',
      results: scored,
    };
  }

  status(): { chunks: number; embeddingStatus: KnowledgeChunk['embeddingStatus']; backend: 'sqlite' | 'json' } {
    const chunks = getEdithPersistenceStore().listKnowledgeChunks?.(5000) ?? [];
    return {
      chunks: chunks.length,
      embeddingStatus: chunks.some((chunk) => chunk.embeddingStatus === 'ready') ? 'ready' : 'embedding_provider_required',
      backend: getEdithPersistenceStore().kind,
    };
  }

  private lexicalScore(queryTokens: string[], content: string): number {
    const haystack = new Set(tokenize(content));
    return queryTokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
  }

  private deterministicVector(content: string): number[] {
    const tokens = tokenize(content);
    const vector = new Array(16).fill(0);
    for (const token of tokens) {
      const hash = hashContent(token);
      const index = Number.parseInt(hash.slice(0, 2), 16) % vector.length;
      vector[index] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => Number((value / magnitude).toFixed(6)));
  }
}

export const ragService = new RagService();
