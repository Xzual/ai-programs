import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { authenticateEdithUser, EDITH_ADMIN_USERS } = await import('../src/lib/storage');
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

const checkedFiles = [
  'src/App.tsx',
  'src/components/auth/LoginScreen.tsx',
  'src/components/layout/Header.tsx',
  'src/components/chat/ChatPanel.tsx',
  'src/lib/storage.ts',
  'server.ts',
];
for (const file of checkedFiles) {
  const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  assert.equal(/assistantPersona|authSession|authenticateEdithUser/.test(text), true, `${file} should participate in auth/persona flow`);
}

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
  ],
}, null, 2));
