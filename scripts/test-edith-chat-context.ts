import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-chat-context-test-'));
const originalCwd = process.cwd();

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
        console.warn(`Temp cleanup skipped because Windows still holds a SQLite handle: ${tempRoot}`);
        return;
      }
      await sleep(200 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'sqlite';
  process.env.EDITH_CRYPTO_SERVICE_URL = 'http://127.0.0.1:9';

  const { memoryService } = await import('../src/edith/memoryService');
  const { buildChatSystemPrompt } = await import('../src/edith/chatContext');
  const { buildAssistantRuntimeContext } = await import('../src/edith/assistantContext');
  const { EDITH_CORE_PROTOCOL_VERSION } = await import('../src/edith/coreBehaviorProtocol');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const projectMemory = memoryService.upsert({
    type: 'project',
    scope: 'project',
    key: 'edith.chat.context',
    content: 'Chat answers should use bounded server-side context from Memory V2.',
    importance: 0.95,
    confidence: 0.95,
    sensitivity: 'internal',
  });
  const sensitiveServerMemory = memoryService.upsert({
    type: 'episodic',
    scope: 'user',
    key: 'private.chat.secret',
    content: 'This sensitive server memory must not enter chat prompts.',
    sensitivity: 'sensitive',
  });

  const runtimeContext = await buildAssistantRuntimeContext({
    channel: 'text',
    userName: 'Arda',
    assistantPersona: 'JARVIS',
    query: 'Chat context memory nasıl çalışıyor?',
  });

  const enabled = buildChatSystemPrompt({
    systemPrompt: 'Sen EDITH asistanısın.',
    userName: 'Arda',
    memoryEnabled: true,
    lastUserMessage: 'Chat context memory nasıl çalışıyor?',
    runtimeContext,
    memories: [
      {
        category: 'preference' as any,
        key: 'ui.language',
        value: 'Türkçe yanıtları tercih eder.',
      },
      {
        category: 'fact' as any,
        key: 'client.secret',
        value: 'Sensitive client memory must not be included.',
        isSensitive: true,
      },
    ],
  });

  const disabled = buildChatSystemPrompt({
    systemPrompt: 'Sen EDITH asistanısın.',
    userName: 'Arda',
    memoryEnabled: false,
    lastUserMessage: 'Chat context memory nasıl çalışıyor?',
    memories: [
      {
        category: 'preference' as any,
        key: 'ui.language',
        value: 'Türkçe yanıtları tercih eder.',
      },
    ],
  });
  const auditEvents = readRecentAuditEvents(100);

  assert.equal(enabled.fullSystem.includes('Kullanıcı Adı: Arda.'), true);
  assert.equal(enabled.fullSystem.includes(`CORE BEHAVIOR PROTOCOL v${EDITH_CORE_PROTOCOL_VERSION}`), true);
  assert.equal(enabled.fullSystem.includes('Low-risk, explicit user commands may execute directly'), true);
  assert.equal(enabled.fullSystem.includes('Critical actions remain blocked'), true);
  assert.equal(enabled.fullSystem.includes('E.D.I.T.H. COMPACT RUNTIME CONTEXT'), true);
  assert.equal(runtimeContext.length <= 5_000, true);
  assert.equal(runtimeContext.includes('active persona=JARVIS'), true);
  assert.equal(runtimeContext.includes(projectMemory.key), true);
  assert.equal(enabled.fullSystem.includes('ui.language'), true);
  assert.equal(enabled.fullSystem.includes(projectMemory.key), true);
  assert.equal(enabled.fullSystem.includes('EDITH Context Snapshot'), true);
  assert.equal(enabled.fullSystem.includes('Ready skills:'), true);
  assert.equal(enabled.fullSystem.includes('client.secret'), false);
  assert.equal(enabled.fullSystem.includes(sensitiveServerMemory.content ?? sensitiveServerMemory.value), false);
  assert.equal(runtimeContext.includes(sensitiveServerMemory.content ?? sensitiveServerMemory.value), false);
  assert.equal(enabled.contextSnapshot?.memoryReferences.some((reference) => reference.id === projectMemory.id), true);
  assert.equal(enabled.contextSnapshot?.memoryReferences.some((reference) => reference.id === sensitiveServerMemory.id), false);
  assert.equal(disabled.fullSystem.includes('EDITH Context Snapshot'), false);
  assert.equal(disabled.fullSystem.includes('ui.language'), false);
  assert.equal(disabled.contextSnapshot, undefined);
  assert.equal(auditEvents.some((event) => event.action === 'context.build' && event.actor === 'edith-chat-context'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    contextSnapshotId: enabled.contextSnapshot?.id,
    promptChars: enabled.fullSystem.length,
    scenarios: ['shared_core_protocol', 'compact_runtime_context', 'chat_prompt_context', 'capability_summary_context', 'client_memory_filter', 'server_sensitive_redaction', 'memory_disabled_gate', 'audit'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
