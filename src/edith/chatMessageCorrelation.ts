import type { AiProvider, AssistantPersona, ChatMessage, ProviderRuntimeStatus } from '../types';

export interface AssistantReplySnapshot {
  assistantProfileId: AssistantPersona;
  assistantName: string;
  requestedProvider: AiProvider;
  requestedModel: string;
  providerStatus: ProviderRuntimeStatus;
}

export function createMessageId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function createAssistantReply(
  userMessageId: string,
  sessionId: string,
  snapshot: AssistantReplySnapshot,
): ChatMessage {
  return {
    id: createMessageId('msg-ast'),
    correlationId: createMessageId('chat'),
    replyToMessageId: userMessageId,
    sessionId,
    sender: 'assistant',
    assistantProfileId: snapshot.assistantProfileId,
    assistantName: snapshot.assistantName,
    requestedProvider: snapshot.requestedProvider,
    requestedModel: snapshot.requestedModel,
    providerUsed: snapshot.requestedProvider,
    modelUsed: snapshot.requestedModel,
    providerStatus: snapshot.providerStatus,
    text: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
}

const MUTABLE_RESPONSE_FIELDS: Array<keyof ChatMessage> = [
  'providerUsed', 'modelUsed', 'fallbackUsed', 'fallbackProvider', 'fallbackModel',
  'providerStatus', 'errorCode', 'audioUrl', 'toolsUsed', 'error',
];

export function applyAssistantResponseMetadata(message: ChatMessage, metadata: Partial<ChatMessage>): ChatMessage {
  const safe: Partial<ChatMessage> = {};
  for (const field of MUTABLE_RESPONSE_FIELDS) {
    if (metadata[field] !== undefined) Object.assign(safe, { [field]: metadata[field] });
  }
  return { ...message, ...safe };
}
