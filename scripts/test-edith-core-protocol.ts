import assert from 'node:assert/strict';
import {
  buildEdithCoreBehaviorContext,
  EDITH_CORE_BEHAVIOR_PROTOCOL,
  EDITH_CORE_PROTOCOL_VERSION,
} from '../src/edith/coreBehaviorProtocol';
import { skillExecutionEligibility, type EdithSkillPackageMetadata } from '../src/edith/skillStoreMetadata';

assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, new RegExp(`CORE BEHAVIOR PROTOCOL v${EDITH_CORE_PROTOCOL_VERSION.replaceAll('.', '\\.')}`));
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /language of the user's most recent message/i);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Low-risk, explicit user commands may execute directly/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Medium-risk actions must remain visible and auditable/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Critical actions remain blocked/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Never reveal API keys/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Never invent a skill, tool/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /Do not repeatedly capture vision/);
assert.match(EDITH_CORE_BEHAVIOR_PROTOCOL, /undo an E\.D\.I\.T\.H\. change/i);

const voice = buildEdithCoreBehaviorContext({ channel: 'voice', runtimeContext: '- Ready skills: Voice Room.' });
const text = buildEdithCoreBehaviorContext({ channel: 'text', runtimeContext: '- Ready skills: System Status.' });
assert.equal(voice.includes(`v${EDITH_CORE_PROTOCOL_VERSION}`), true);
assert.equal(text.includes(`v${EDITH_CORE_PROTOCOL_VERSION}`), true);
assert.match(voice, /Channel: voice/);
assert.match(text, /Channel: text/);

const community: EdithSkillPackageMetadata = {
  id: 'community-untrusted', name: 'Community Untrusted', version: '1.0.0', description: 'Fixture',
  distribution: 'community', trust: 'unverified_community', source: 'https://example.invalid/skill',
  signatureVerified: true, sandboxed: true, adapterBound: true, enabled: true, riskLevel: 'low',
  requiredPermissions: [], toolIds: [], updatedAt: new Date().toISOString(),
};
assert.deepEqual(skillExecutionEligibility(community), {
  executable: false,
  status: 'blocked',
  reason: 'Community skill execution is not enabled in this foundation.',
});

console.log(JSON.stringify({
  success: true,
  protocolVersion: EDITH_CORE_PROTOCOL_VERSION,
  scenarios: ['shared_text_voice_protocol', 'language_rule', 'risk_policy', 'secret_policy', 'vision_policy', 'undo_policy', 'community_execution_blocked'],
}));
