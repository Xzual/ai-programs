import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-skills-test-'));
const previousCwd = process.cwd();
const vaultPath = path.join(root, 'vault');
const secretMarker = 'test-secret-do-not-return';

try {
  process.chdir(root);
  process.env.EDITH_PERSISTENCE = 'json';
  process.env.EDITH_TEST_MODE = 'true';
  process.env.EDITH_TEST_DATA_DIR = path.join(root, 'test-data');
  process.env.EDITH_OBSIDIAN_PROVIDER_APP_ROOT = previousCwd;
  process.env.EDITH_TEST_OBSIDIAN_SANDBOX_ROOT = vaultPath;
  process.env.OBSIDIAN_VAULT_PATH = vaultPath;
  process.env.GEMINI_API_KEY = `AIza-fake-${secretMarker}`;
  process.env.EDITH_OBSIDIAN_ENABLED = 'true';
  delete process.env.JEV_API_KEY;

  const registryModule = await import('../src/edith/skillRegistry');
  const {
    EDITH_SKILL_RISKS,
    EDITH_SKILL_STATUSES,
    buildCapabilitySummary,
    formatCapabilityAnswer,
    formatCapabilityContext,
    getSkillRegistry,
    isCapabilityQuestion,
    mapComputerUseSkillStatus,
    mapCryptoDemoSkillStatus,
    mapJevSkillStatus,
  } = registryModule;
  const { buildCapabilityToolRegistry } = await import('../src/edith/toolRegistry');
  const { edithToolRegistry, getEdithToolHealth, getEdithToolRegistrySnapshot } = await import('../src/edith/serverRegistry');
  const { builtInSkillMetadata, skillExecutionEligibility, validateSkillPackageMetadata } = await import('../src/edith/skillStoreMetadata');
  const { obsidianVaultService } = await import('../src/edith/obsidianVaultService');
  const { createSkillsRouter } = await import('../server/routes/skills');
  const { createChatRouter } = await import('../server/routes/chat');
  const { computerUseStatus } = await import('../server/routes/computerUse');

  const expectedIds = [
    'gemini_text_chat', 'voice_room', 'computer_use', 'crypto_demo_exchange', 'jev_decision_model',
    'obsidian_memory', 'supabase_registry', 'workspace_manager', 'skill_store', 'file_organizer',
    'browser_research', 'system_status', 'control_center', 'release_builder',
  ];

  const initial = await getSkillRegistry({ forceRefresh: true });
  assert.equal(initial.skills.length, 14);
  assert.deepEqual(initial.skills.map((skill) => skill.id), expectedIds);
  for (const skill of initial.skills) {
    assert.equal(EDITH_SKILL_STATUSES.includes(skill.status), true, `${skill.id} status`);
    assert.equal(EDITH_SKILL_RISKS.includes(skill.riskLevel), true, `${skill.id} risk`);
    assert.equal(skill.readiness.ready, skill.status === 'ready', `${skill.id} readiness`);
    assert.equal(Boolean(skill.description), true, `${skill.id} description`);
    assert.equal(Array.isArray(skill.capabilities), true, `${skill.id} capabilities`);
    assert.equal(Array.isArray(skill.limitations), true, `${skill.id} limitations`);
    assert.equal(Array.isArray(skill.requiredPermissions), true, `${skill.id} permissions`);
    assert.equal(Array.isArray(skill.requiredConfig), true, `${skill.id} config`);
    assert.equal(Array.isArray(skill.relatedEndpoints), true, `${skill.id} endpoints`);
    assert.equal(Array.isArray(skill.relatedScreens), true, `${skill.id} screens`);
    assert.equal(Array.isArray(skill.safetyNotes), true, `${skill.id} safety`);
    assert.equal(Array.isArray(skill.examples), true, `${skill.id} examples`);
    assert.equal(Array.isArray(skill.sourceOfTruth), true, `${skill.id} source`);
    assert.equal(Number.isNaN(Date.parse(skill.lastChecked)), false, `${skill.id} lastChecked`);
  }

  for (const id of ['skill_store', 'file_organizer', 'release_builder']) {
    const skill = initial.skills.find((entry) => entry.id === id);
    assert.equal(skill?.status, 'planned', `${id} must remain planned`);
    assert.equal(skill?.readiness.ready, false, `${id} must not claim readiness`);
  }
  const supabase = initial.skills.find((entry) => entry.id === 'supabase_registry');
  assert.equal(['config_required', 'degraded'].includes(supabase?.status ?? ''), true, 'supabase_registry must report configuration truthfully');
  assert.equal(supabase?.readiness.ready, false, 'supabase_registry must not claim readiness without a verified adapter');
  const builtInMetadata = builtInSkillMetadata(initial.skills[0]);
  assert.equal(validateSkillPackageMetadata(builtInMetadata).length, 0);
  const communityMetadata = {
    ...builtInMetadata,
    id: 'community-example',
    distribution: 'community' as const,
    trust: 'unverified_community' as const,
    source: 'https://example.invalid/community-skill',
    signatureVerified: false,
    sandboxed: false,
    adapterBound: false,
    enabled: false,
  };
  assert.equal(skillExecutionEligibility(communityMetadata).status, 'blocked');
  assert.equal(skillExecutionEligibility(communityMetadata).executable, false);
  assert.notEqual(initial.skills.find((skill) => skill.id === 'voice_room')?.status, 'ready');
  assert.notEqual(initial.skills.find((skill) => skill.id === 'gemini_text_chat')?.status, 'ready');
  assert.equal(initial.skills.find((skill) => skill.id === 'gemini_text_chat')?.details?.model, 'gemini-3.6-flash');
  assert.equal(initial.skills.find((skill) => skill.id === 'voice_room')?.details?.model, 'gemini-3.1-flash-live-preview');
  const initialJev = initial.skills.find((skill) => skill.id === 'jev_decision_model');
  assert.ok(initialJev);
  assert.equal(['config_required', 'degraded'].includes(initialJev.status), true);
  assert.notEqual(initialJev.status, 'ready');
  assert.equal(initialJev.readiness.ready, false);
  assert.equal(initialJev.details?.available, false);
  if (initialJev.status === 'degraded') {
    assert.equal(initialJev.details?.configured, true);
    assert.equal(initialJev.readiness.level, 'limited');
  } else {
    assert.equal(initialJev.details?.configured, false);
    assert.equal(initialJev.readiness.level, 'setup_required');
  }
  assert.equal(initial.skills.find((skill) => skill.id === 'obsidian_memory')?.status, 'config_required');
  assert.equal(
    initial.skills.find((skill) => skill.id === 'computer_use')?.status,
    mapComputerUseSkillStatus(computerUseStatus()),
  );

  assert.equal(mapComputerUseSkillStatus({ status: 'ready' }), 'ready');
  assert.equal(mapComputerUseSkillStatus({ status: 'blocked' }), 'disabled');
  assert.equal(mapComputerUseSkillStatus({ status: 'configuration_required' }), 'config_required');

  const cryptoScript = path.join(root, 'crypto-agent.py');
  fs.writeFileSync(cryptoScript, '# fixture\n', 'utf8');
  const safeCrypto = {
    demoMode: true,
    demoTradingEnabled: true,
    realMoneyUsed: false,
    liveExecutionEnabled: false,
    realOrderEndpointsAvailable: false,
    demoInitialBalance: 10_000,
    portfolio: { initialBalance: 10_000 },
  };
  assert.equal(mapCryptoDemoSkillStatus({ healthy: true, managedProcessRunning: true, scriptPath: cryptoScript }, safeCrypto), 'ready');
  assert.equal(mapCryptoDemoSkillStatus({ healthy: true, managedProcessRunning: true, scriptPath: cryptoScript }, { ...safeCrypto, liveExecutionEnabled: true }), 'degraded');
  assert.equal(mapCryptoDemoSkillStatus({ healthy: false, managedProcessRunning: false, scriptPath: cryptoScript }), 'offline');
  assert.equal(mapJevSkillStatus(undefined, false, true), 'config_required');
  assert.equal(mapJevSkillStatus({ configured: true, available: true }, true, true), 'ready');
  assert.equal(mapJevSkillStatus({
    configured: true,
    status: 'stale',
    lastProviderContact: new Date().toISOString(),
  }, true, true), 'degraded', 'Historical provider contact must not imply current Jev readiness.');

  const tools = buildCapabilityToolRegistry(initial);
  assert.equal(tools.length >= 25, true);
  assert.equal(tools.every((tool) => expectedIds.includes(tool.skillId)), true);
  assert.equal(tools.find((tool) => tool.id === 'clickMouse')?.requiresApproval, true);
  assert.equal(tools.find((tool) => tool.id === 'demoBuy')?.requiresApproval, true);
  assert.equal(tools.find((tool) => tool.id === 'stopComputerUse')?.enabled, true);
  assert.equal(tools.find((tool) => tool.id === 'runJevDecision')?.enabled, false);
  assert.equal(tools.every((tool) => tool.kind === 'planning_abstraction' && tool.executable === false), true);
  const canonicalTools = getEdithToolRegistrySnapshot();
  assert.equal(canonicalTools.authority, 'edithToolRegistry');
  assert.equal(canonicalTools.counts.total, canonicalTools.tools.length);
  assert.equal(canonicalTools.health.length, canonicalTools.tools.length);
  assert.equal(canonicalTools.counts.enabled + canonicalTools.counts.blocked, canonicalTools.counts.total);

  const serialized = JSON.stringify({ initial, tools });
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(serialized.includes(root), false, 'Capability registry must not expose absolute workspace or vault paths.');
  for (const sensitiveKey of ['vaultPath', 'workspacePath', 'persistencePath', 'logsPath', 'backupPath', 'exportsPath']) {
    assert.equal(serialized.includes(`\"${sensitiveKey}\"`), false, `Capability registry must not expose ${sensitiveKey}.`);
  }
  assert.equal(JSON.stringify(edithToolRegistry.list()).includes(secretMarker), false);
  const summary = buildCapabilitySummary(initial);
  const compactContext = formatCapabilityContext(summary);
  assert.equal(JSON.stringify(summary).length < 6_000, true, 'Capability summary must stay compact.');
  assert.equal(compactContext.includes(secretMarker), false);

  for (const question of [
    'Hangi skillerin var?', 'Neler yapabiliyorsun?', 'What can you do?', 'Computer Use çalışıyor mu?',
    'Obsidian bağlı mı?', 'Voice hazır mı?', 'Ses hazır mı?', 'Crypto modülü ne durumda?', 'Supabase hazır mı?',
    'Bana aktif özelliklerini say.', 'Crypto gerçek işlem yapıyor mu?',
  ]) {
    assert.equal(isCapabilityQuestion(question), true, question);
  }
  assert.match(formatCapabilityAnswer(initial, 'Hangi skillerin var?'), /Planlanan:/);
  assert.match(formatCapabilityAnswer(initial, 'Computer Use çalışıyor mu?'), /Computer Use \/ Desktop Operator:/);
  assert.match(formatCapabilityAnswer(initial, 'Ses hazır mı?'), /Voice Room \/ Gemini Live:/);
  const cryptoAnswer = formatCapabilityAnswer(initial, 'Crypto gerçek işlem yapıyor mu?');
  assert.match(cryptoAnswer, /Crypto Demo Exchange:/);
  assert.match(cryptoAnswer, /Gerçek (alım satım|para|emir)/);

  assert.deepEqual(obsidianVaultService.writeSkillRegistryNotes(initial.skills), []);
  assert.equal(fs.existsSync(vaultPath), false, 'Registry reads must not create a missing vault.');

  fs.mkdirSync(vaultPath);
  const available = await getSkillRegistry({ forceRefresh: true });
  assert.equal(available.skills.find((skill) => skill.id === 'obsidian_memory')?.status, 'ready');
  const registeredTools = edithToolRegistry.list();
  const toolHealth = getEdithToolHealth();
  const noteResults = obsidianVaultService.writeSkillRegistryNotes(available.skills, registeredTools, toolHealth);
  assert.equal(noteResults.length > available.skills.length + registeredTools.length, true);
  assert.equal(noteResults.every((result) => result.exported), true);
  const computerNote = path.join(vaultPath, 'E.D.I.T.H', 'Skills', 'Computer Use Skill.md');
  const noteContent = fs.readFileSync(computerNote, 'utf8');
  assert.match(noteContent, /\[\[E\.D\.I\.T\.H\. Index\]\]/);
  assert.match(noteContent, /\[\[Skills Index\]\]/);
  assert.match(noteContent, /\[\[Tools Index\]\]/);
  assert.match(noteContent, /## Source Of Truth/);
  assert.equal(noteContent.includes(secretMarker), false);
  const tool = registeredTools[0];
  const toolNoteTitle = `${tool.metadata.name.replace(/[<>:"/\\|?*]/g, '-')} Tool`;
  const toolNote = path.join(vaultPath, 'E.D.I.T.H', 'Tools', `${toolNoteTitle}.md`);
  const toolNoteContent = fs.readFileSync(toolNote, 'utf8');
  assert.match(toolNoteContent, /\[\[Tools Index\]\]/);
  assert.match(toolNoteContent, /Runtime status:/);
  assert.match(toolNoteContent, /edith_generated: ["']?tool_registry["']?/);
  assert.equal(toolNoteContent.includes(secretMarker), false);
  for (const indexPath of [
    'E.D.I.T.H/E.D.I.T.H. Knowledge Backbone.md', 'Projects/Projects Index.md', 'Tasks/Tasks Index.md',
    'Memory/Memory Index.md', 'Conversations/Conversations Index.md', 'Decisions/Decisions Index.md',
    'Workflows/Workflows Index.md', 'Research/Research Index.md', 'Computer Use/Computer Use Index.md',
    'Voice/Voice Index.md', 'System/System Index.md', 'E.D.I.T.H/System/Core Behavior Protocol.md',
  ]) assert.equal(fs.existsSync(path.join(vaultPath, indexPath)), true, indexPath);
  fs.writeFileSync(computerNote, '# User-owned note\n', 'utf8');
  const repeated = obsidianVaultService.writeSkillRegistryNotes(available.skills, registeredTools, toolHealth);
  assert.equal(repeated.find((result) => result.notePath === 'E.D.I.T.H/Skills/Computer Use Skill.md')?.exported, false);
  assert.equal(fs.readFileSync(computerNote, 'utf8'), '# User-owned note\n');

  const app = express();
  app.use(express.json());
  app.use(createSkillsRouter({ readRegistry: async () => available }));
  app.use(createChatRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const endpoint of [
      '/api/edith/skills', '/api/edith/skills/status', '/api/edith/tools',
      '/api/edith/capabilities', '/api/edith/capabilities/summary',
    ]) {
      const response = await fetch(`${base}${endpoint}`);
      assert.equal(response.ok, true, endpoint);
      const body = await response.text();
      assert.equal(body.includes(secretMarker), false, endpoint);
      assert.equal(body.includes(root), false, `${endpoint} must not expose absolute test workspace paths.`);
      const parsed = JSON.parse(body) as Record<string, unknown>;
      assert.equal(parsed.success, true, endpoint);
      if (endpoint === '/api/edith/skills') assert.equal((parsed.skills as unknown[]).length, 14);
      if (endpoint === '/api/edith/tools') {
        assert.equal(parsed.authority, 'edithToolRegistry');
        assert.equal((parsed.tools as unknown[]).length, canonicalTools.counts.total);
        assert.equal((parsed.health as unknown[]).length, canonicalTools.counts.total);
        assert.equal((parsed.counts as { total: number }).total, canonicalTools.counts.total);
        assert.equal((parsed.planningCapabilities as Array<{ executable: boolean }>).every((item) => item.executable === false), true);
        assert.equal('registryTools' in parsed, false);
      }
      if (endpoint === '/api/edith/capabilities/summary') {
        assert.equal(Array.isArray(parsed.ready), true);
        assert.equal(body.length < 7_000, true);
      }
    }
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ sender: 'user', text: 'Hangi skillerin var?' }] }),
    });
    const events = await response.text();
    assert.match(events, /"resolvedProvider":"local"/);
    assert.match(events, /"routeKind":"registry"/);
    assert.match(events, /"finalState":"completed"/);
    assert.match(events, /Planlanan:/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  console.log(JSON.stringify({
    success: true,
    skills: initial.skills.length,
    planningCapabilities: tools.length,
    canonicalTools: canonicalTools.counts.total,
    notesWritten: noteResults.length,
    tests: [
      'schema', 'honest_statuses', 'runtime_mapping', 'demo_safety', 'secret_and_path_redaction', 'compact_summary',
      'capability_intent', 'api_endpoints', 'chat_routing', 'linked_notes', 'tool_registry_notes',
      'knowledge_backbone_indexes', 'skill_store_metadata_policy', 'user_note_preservation',
    ],
  }));
} finally {
  try {
    const { obsidianVaultService } = await import('../src/edith/obsidianVaultService');
    obsidianVaultService.stopWatcher();
  } catch {
    // Cleanup remains best-effort if imports fail before the service is created.
  }
  process.chdir(previousCwd);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) console.warn('Temporary test directory retained:', error);
      else await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}
