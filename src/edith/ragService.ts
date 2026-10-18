import type { KnowledgeChunk, KnowledgeGraphNode } from './core';
import { getEdithPersistenceStore } from './persistence';
import { hashContent } from './obsidianParser';

export interface RagIndexResult {
  notePath: string;
  nodeId: string;
  chunks: number;
  embeddingStatus: KnowledgeChunk['embeddingStatus'];
  retrievalMode: 'lexical';
}

export interface RagRetrievalResult {
  query: string;
  embeddingStatus: KnowledgeChunk['embeddingStatus'];
  retrievalMode: 'lexical';
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
    // Provider names are configuration hints, not evidence of an embedding call.
    const embeddingStatus = 'embedding_provider_required' as const;
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
      indexedAt,
    }));
    getEdithPersistenceStore().replaceKnowledgeChunksForNote?.(input.notePath, chunks);
    return {
      notePath: input.notePath,
      nodeId: input.nodeId,
      chunks: chunks.length,
      embeddingStatus,
      retrievalMode: 'lexical',
    };
  }

  retrieve(query: string, limit = 8): RagRetrievalResult {
    const queryTokens = tokenize(query);
    const nodes = new Map((getEdithPersistenceStore().listKnowledgeNodes?.() ?? []).map((node) => [node.id, node]));
    const scored = (getEdithPersistenceStore().listKnowledgeChunks?.(5000) ?? [])
      .map((chunk) => ({
        // Legacy persisted hash vectors were labelled ready without a semantic adapter.
        // Normalize the response without rewriting the user's stored data.
        chunk: { ...chunk, embeddingStatus: 'embedding_provider_required' as const, vector: undefined },
        score: this.lexicalScore(queryTokens, chunk.content),
        node: nodes.get(chunk.nodeId),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      query,
      embeddingStatus: 'embedding_provider_required',
      retrievalMode: 'lexical',
      results: scored,
    };
  }

  status(): { chunks: number; embeddingStatus: KnowledgeChunk['embeddingStatus']; backend: 'sqlite' | 'json'; retrievalMode: 'lexical' } {
    const chunks = getEdithPersistenceStore().listKnowledgeChunks?.(5000) ?? [];
    return {
      chunks: chunks.length,
      embeddingStatus: 'embedding_provider_required',
      retrievalMode: 'lexical',
      backend: getEdithPersistenceStore().kind,
    };
  }

  private lexicalScore(queryTokens: string[], content: string): number {
    const haystack = new Set(tokenize(content));
    return queryTokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
  }

}

export const ragService = new RagService();
