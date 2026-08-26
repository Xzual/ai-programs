import { contextService } from './contextService';
import type { EdithContextSnapshot } from './core';
import type { MemoryItem } from '../types';

export interface BuildChatSystemPromptInput {
  systemPrompt: string;
  userName: string;
  memories?: Array<Partial<MemoryItem>>;
  memoryEnabled?: boolean;
  lastUserMessage?: string;
}

export interface BuildChatSystemPromptResult {
  fullSystem: string;
  contextSnapshot?: EdithContextSnapshot;
}

function safeText(value: unknown, maxLength: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatClientMemories(memories: Array<Partial<MemoryItem>>, maxMemories = 8): string {
  const lines = memories
    .filter((memory) => !memory.isSensitive && memory.sensitivity !== 'sensitive')
    .slice(0, maxMemories)
    .flatMap((memory) => {
      const key = safeText(memory.key, 80);
      const value = safeText(memory.value ?? memory.content, 220);
      if (!key || !value) return [];
      return `- [${safeText(memory.category ?? memory.type ?? 'memory', 32)}] ${key}: ${value}`;
    });
  if (lines.length === 0) return '';
  return `Kullanıcı Hakkında Bilinen Bellek Kayıtları:\n${lines.join('\n')}`;
}

export function buildChatSystemPrompt(input: BuildChatSystemPromptInput): BuildChatSystemPromptResult {
  const memoryEnabled = input.memoryEnabled !== false;
  const lastUserMessage = input.lastUserMessage?.trim() ?? '';
  const sections = [
    `${input.systemPrompt}\nKullanıcı Adı: ${safeText(input.userName, 80) || 'Kullanıcı'}.`,
  ];

  if (memoryEnabled && input.memories && input.memories.length > 0) {
    const memorySection = formatClientMemories(input.memories);
    if (memorySection) sections.push(memorySection);
  }

  let contextSnapshot: EdithContextSnapshot | undefined;
  if (memoryEnabled && lastUserMessage) {
    try {
      contextSnapshot = contextService.build({
        query: lastUserMessage,
        actor: 'edith-chat-context',
        memoryLimit: 5,
        taskLimit: 3,
        toolLimit: 5,
        toolRunLimit: 3,
        auditLimit: 3,
      });
      const promptContext = contextService.formatForPrompt(contextSnapshot, 1800);
      if (promptContext) sections.push(promptContext);
    } catch (error) {
      console.warn('[EDITH Context] Chat context skipped:', error instanceof Error ? error.message : error);
    }
  }

  return {
    fullSystem: sections.join('\n\n'),
    contextSnapshot,
  };
}
