import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyAssistantResponseMetadata, createAssistantReply, createMessageId } from '../src/edith/chatMessageCorrelation';
import { clearOwnerSessionMemory, OwnerSessionError, ownerMutationFetch } from '../src/edith/ownerMutationClient';

const root = new URL('../', import.meta.url);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function testChatCorrelation(): Promise<void> {
  const userId = createMessageId('msg');
  const secondId = createMessageId('msg');
  assert.notEqual(userId, secondId, 'message ids must remain collision resistant');

  const reply = createAssistantReply(userId, 'session-a', {
    assistantProfileId: 'jarvis',
    assistantName: 'JARVIS',
    requestedProvider: 'gemini',
    requestedModel: 'gemini-2.5-flash',
    providerStatus: 'available',
  });
  assert.equal(reply.replyToMessageId, userId);
  assert.equal(reply.sessionId, 'session-a');
  assert.ok(reply.correlationId);

  const updated = applyAssistantResponseMetadata(reply, {
    assistantName: 'ULTRON',
    assistantProfileId: 'ultron',
    requestedProvider: 'ollama',
    providerUsed: 'ollama',
    modelUsed: 'llama3.2',
    fallbackUsed: true,
  });
  assert.equal(updated.assistantName, 'JARVIS', 'stream metadata must not rewrite persona attribution');
  assert.equal(updated.requestedProvider, 'gemini', 'stream metadata must not rewrite requested provider');
  assert.equal(updated.providerUsed, 'ollama');
  assert.equal(updated.fallbackUsed, true);
}

async function testOwnerMutationClient(): Promise<void> {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'http://127.0.0.1:3000' } },
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let sequence = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    sequence += 1;
    if (sequence === 1) return jsonResponse({ session: { actor: 'owner', csrfToken: 'memory-token-1', createdAt: 'now', expiresAt: 'later' } });
    if (sequence === 2) return jsonResponse({ code: 'owner_session_expired' }, 401);
    if (sequence === 3) return jsonResponse({ session: { actor: 'owner', csrfToken: 'memory-token-2', createdAt: 'now', expiresAt: 'later' } });
    return jsonResponse({ success: true });
  }) as typeof fetch;

  clearOwnerSessionMemory();
  const response = await ownerMutationFetch('/api/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId: 'test' }),
  });
  assert.equal(response.ok, true);
  assert.equal(calls.length, 4, 'one 401 may refresh the memory-only session and retry once');
  assert.equal(new Headers(calls[1].init?.headers).get('X-EDITH-CSRF-Token'), 'memory-token-1');
  assert.equal(new Headers(calls[3].init?.headers).get('X-EDITH-CSRF-Token'), 'memory-token-2');

  clearOwnerSessionMemory();
  let mutationSent = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') mutationSent = true;
    return jsonResponse({ code: 'owner_session_required' }, 401);
  }) as typeof fetch;
  await assert.rejects(
    ownerMutationFetch('/api/edith/kill-switch/activate', { method: 'POST' }),
    (error: unknown) => error instanceof OwnerSessionError && error.code === 'owner_session_required',
  );
  assert.equal(mutationSent, false, 'mutation must fail closed when no owner session exists');
}

async function testStaticReleaseGuards(): Promise<void> {
  const [app, cryptoTerminal, cryptoApi, ownerClient, toolsUi] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/crypto/CryptoExchangeTerminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/crypto/cryptoApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/edith/ownerMutationClient.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/edithOS.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(app, /apiKey:\s*settings\.claudeVoiceApiKey/, 'TTS request must never contain a frontend API key');
  assert.match(app, /targetSessionId, assistantMsgId/, 'chat stream updates must target an immutable session/message pair');
  assert.match(cryptoApi, /ownerMutationFetch/, 'crypto mutations must use the owner mutation client');
  assert.match(cryptoTerminal, /Current Jev Health/);
  assert.match(cryptoTerminal, /Historical latest decision/);
  assert.doesNotMatch(ownerClient, /localStorage|sessionStorage|indexedDB/i, 'owner session material must remain memory-only');
  assert.match(toolsUi, /'loading' \| 'loaded' \| 'empty' \| 'error'/, 'Tools UI must expose finite loading states');
}

await testChatCorrelation();
await testOwnerMutationClient();
await testStaticReleaseGuards();
console.log('PASS: E.D.I.T.H. Wave 2 frontend release guards');

