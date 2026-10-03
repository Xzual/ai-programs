import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { authenticateEdithUser, EDITH_ADMIN_USERS } = await import('../src/lib/storage');
const { applyAssistantResponseMetadata, createAssistantReply } = await import('../src/edith/chatMessageCorrelation');
const assistantProfiles = (await import('../src/config/assistantProfiles.json', { with: { type: 'json' } })).default;

const can = authenticateEdithUser('Can İpkin', 'typed_name');
const arda = authenticateEdithUser('arda yorulmazel', 'spoken_name');
const denied = authenticateEdithUser('guest user', 'typed_name');

assert.equal(EDITH_ADMIN_USERS.length, 2);
assert.equal(can?.authenticated, true);
assert.equal(can?.user.role, 'admin');
assert.equal(can?.user.securitySettings.biometricVerified, false);
assert.equal(arda?.authenticated, true);
assert.equal(arda?.method, 'spoken_name');
assert.equal(denied, undefined);

for (const profile of assistantProfiles) {
  assert.equal(typeof profile.systemPrompt, 'string');
  assert.equal(profile.systemPrompt.length > 20, true);
  assert.equal(typeof profile.greetingStyle, 'string');
  assert.equal(typeof profile.memoryNamespace, 'string');
  assert.equal(profile.preferredModel, 'auto');
}

const source = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const app = source('src/App.tsx');
const login = source('src/components/auth/LoginScreen.tsx');
const header = source('src/components/layout/Header.tsx');
const chatPanel = source('src/components/chat/ChatPanel.tsx');
const transmissionCard = source('src/components/ui/edithOS.tsx');
const storage = source('src/lib/storage.ts');

assert.match(app, /useState<EdithAuthSession \| null>\(loadAuthSession\(\)\)/, 'App must own the authenticated session');
assert.match(app, /getAssistantProfile\(settings\.assistantPersona\)/, 'App must resolve persona separately from auth');
assert.match(login, /authenticateEdithUser\(name, method\)/, 'LoginScreen must delegate authentication to storage policy');
assert.match(storage, /export function authenticateEdithUser/, 'storage must own the local auth policy');
assert.match(storage, /delete safeSettings\.claudeVoiceApiKey/, 'settings persistence must redact legacy voice secrets');
assert.match(header, /authSession\.user\.name/, 'Header must render the authenticated owner identity');
assert.match(header, /onUpdateSettings\(\{ assistantPersona:/, 'Header persona changes must update settings, not auth');

assert.match(chatPanel, /key=\{msg\.id\}/, 'ChatPanel must key transmissions by immutable message id');
assert.match(chatPanel, /message=\{msg\}/, 'ChatPanel must pass the message snapshot to TransmissionCard');
assert.doesNotMatch(chatPanel, /assistantName=\{msg\.assistantName \?\? assistantProfile\.name\}/, 'legacy messages must not inherit the current assistant identity');
assert.match(transmissionCard, /message\.assistantName \?\? message\.assistantProfileId\?\.toUpperCase\(\) \?\? 'LEGACY ASSISTANT'/, 'TransmissionCard must use frozen message persona attribution');
assert.match(transmissionCard, /message\.providerUsed \?\? message\.requestedProvider/, 'TransmissionCard must use frozen provider attribution');
assert.match(transmissionCard, /message\.modelUsed \?\? message\.requestedModel/, 'TransmissionCard must use frozen model attribution');
assert.doesNotMatch(transmissionCard, /message\.providerUsed \?\? message\.requestedProvider \?\? settings\.aiProvider/, 'message provider must not fall back to current settings');

const frozenReply = createAssistantReply('user-message', 'session-auth-test', {
  assistantProfileId: 'jarvis',
  assistantName: 'JARVIS',
  requestedProvider: 'gemini',
  requestedModel: 'gemini-2.5-flash',
  providerStatus: 'available',
});
const resolvedReply = applyAssistantResponseMetadata(frozenReply, {
  assistantProfileId: 'ultron',
  assistantName: 'ULTRON',
  requestedProvider: 'ollama',
  requestedModel: 'llama3.2',
  providerUsed: 'ollama',
  modelUsed: 'llama3.2',
});
assert.equal(frozenReply.replyToMessageId, 'user-message');
assert.equal(frozenReply.sessionId, 'session-auth-test');
assert.ok(frozenReply.correlationId);
assert.equal(resolvedReply.assistantProfileId, 'jarvis', 'runtime metadata cannot rewrite frozen persona');
assert.equal(resolvedReply.assistantName, 'JARVIS', 'runtime metadata cannot rewrite frozen assistant name');
assert.equal(resolvedReply.requestedProvider, 'gemini', 'runtime metadata cannot rewrite requested provider');
assert.equal(resolvedReply.providerUsed, 'ollama', 'resolved provider remains recordable');

console.log(JSON.stringify({
  success: true,
  admins: EDITH_ADMIN_USERS.map((user) => user.name),
  personas: assistantProfiles.map((profile) => profile.id),
  scenarios: [
    'typed_admin_login',
    'spoken_name_admin_login',
    'reject_unknown_user',
    'name_check_not_biometric',
    'rich_persona_config',
    'single_assistant_persona_state',
    'header_auth_persona_separation',
    'frozen_chat_attribution',
    'immutable_reply_correlation',
  ],
}, null, 2));
