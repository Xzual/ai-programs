import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-awesome-agent-skills-test-'));
const originalCwd = process.cwd();

try {
  process.env.EDITH_AWESOME_SKILL_CATALOG_PATH = path.join(originalCwd, 'data', 'external-skills', 'awesome-agent-skills.catalog.json');
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;
  delete process.env.BRAVE_SEARCH_API_KEY;

  const { executeEdithTool, edithToolRegistry } = await import('../src/edith/serverRegistry');
  const { listExternalSkillProjects } = await import('../src/edith/skills/catalog');
  const { permissionService } = await import('../src/edith/permissionService');
  const { plannerService } = await import('../src/edith/planner');
  const { taskService } = await import('../src/edith/taskService');

  const registryToolIds = [
    'awesome_skill_catalog_search',
    'awesome_skill_status',
  ];
  const expectedToolIds = [
    'binance_market_price',
    'binance_market_24hr',
    'coinbase_ticker_lookup',
    'binance_spot_trade_guard',
    'binance_trade_signal_guard',
    'brave_news_search',
    'brave_web_search',
    'whatsapp_integrate_guard',
    'whatsapp_automation_guard',
    'whatsapp_observe_health',
    'computer_use_guard',
  ];

  for (const toolId of [...registryToolIds, ...expectedToolIds]) {
    assert.ok(edithToolRegistry.get(toolId), `Expected ${toolId} to be registered`);
  }

  const catalog = listExternalSkillProjects();
  assert.equal(expectedToolIds.every((toolId) => catalog.some((entry) => entry.id === toolId)), true);
  assert.ok(catalog.length >= 500, `Expected downloaded awesome-agent catalog to be available, got ${catalog.length}`);

  const catalogSearch = await executeEdithTool('awesome_skill_catalog_search', {
    query: 'whatsapp',
    limit: 10,
  }, { actor: 'awesome-test' });
  assert.equal(catalogSearch.success, true);
  assert.ok(Number(catalogSearch.structuredOutput?.total ?? 0) >= 500);

  const catalogStatus = await executeEdithTool('awesome_skill_status', {
    id: 'awesome_gokapso_integrate_whatsapp',
  }, { actor: 'awesome-test' });
  assert.equal(catalogStatus.success, true);

  const batchOne = await Promise.all([
    executeEdithTool('binance_market_price', { symbol: 'BTCUSDT' }, { actor: 'awesome-test', dryRun: true }),
    executeEdithTool('binance_market_24hr', { symbol: 'ETHUSDT' }, { actor: 'awesome-test', dryRun: true }),
    executeEdithTool('coinbase_ticker_lookup', { product: 'BTC-USD' }, { actor: 'awesome-test', dryRun: true }),
    executeEdithTool('brave_news_search', { query: 'bitcoin news', count: 3 }, { actor: 'awesome-test', dryRun: true }),
    executeEdithTool('brave_web_search', { query: 'agent skills', count: 3 }, { actor: 'awesome-test', dryRun: true }),
  ]);
  assert.equal(batchOne.every((result) => result.success), true);

  const defaultDeniedTrade = await executeEdithTool('binance_spot_trade_guard', {
    intent: 'buy BTC',
    symbol: 'BTCUSDT',
  }, { actor: 'awesome-test' });
  assert.equal(defaultDeniedTrade.success, false);
  assert.equal(defaultDeniedTrade.errorCode, 'PERMISSION_DENIED');

  permissionService.createGrant({
    actor: 'awesome-test',
    permissions: ['trading:execute', 'network:write', 'computer:control', 'system:exec'],
    toolIds: [
      'binance_spot_trade_guard',
      'whatsapp_integrate_guard',
      'whatsapp_automation_guard',
      'computer_use_guard',
    ],
    reason: 'Regression test scoped high-risk guards.',
    grantedBy: 'test',
    ttlMs: 60_000,
  });

  const batchTwo = await Promise.all([
    executeEdithTool('binance_spot_trade_guard', { intent: 'buy BTC', symbol: 'BTCUSDT' }, { actor: 'awesome-test' }),
    executeEdithTool('binance_trade_signal_guard', { symbol: 'BTCUSDT', timeframe: '1d' }, { actor: 'awesome-test' }),
    executeEdithTool('whatsapp_integrate_guard', { action: 'health_check' }, { actor: 'awesome-test' }),
    executeEdithTool('whatsapp_automation_guard', { workflow: 'reply to leads' }, { actor: 'awesome-test' }),
    executeEdithTool('whatsapp_observe_health', { messageId: 'msg-test' }, { actor: 'awesome-test' }),
    executeEdithTool('computer_use_guard', { instruction: 'open calculator' }, { actor: 'awesome-test' }),
  ]);
  assert.equal(batchTwo.every((result) => result.success === false), true);
  assert.equal(batchTwo.every((result) => result.errorCode === 'TOOL_ERROR'), true);
  assert.equal(batchTwo.every((result) => result.structuredOutput?.honestStatus), true);

  const newsTask = taskService.createTask({
    title: 'Awesome skills planner news test',
    objective: 'Günlük crypto haberlerine bak',
    originalUserRequest: 'Günlük crypto haberlerine bak',
    riskLevel: 1,
  });
  const newsPlan = plannerService.planTask(newsTask.id);
  assert.equal(newsPlan.plan?.requiredTools.includes('brave_news_search'), true);

  const cryptoTask = taskService.createTask({
    title: 'Awesome skills planner crypto test',
    objective: 'BTCUSDT Binance fiyat ve market snapshot kontrol et',
    originalUserRequest: 'BTCUSDT Binance fiyat ve market snapshot kontrol et',
    riskLevel: 1,
  });
  const cryptoPlan = plannerService.planTask(cryptoTask.id);
  assert.equal(cryptoPlan.plan?.requiredTools.includes('binance_market_price'), true);
  assert.equal(cryptoPlan.plan?.requiredTools.includes('binance_market_24hr'), true);

  console.log(JSON.stringify({
    success: true,
    installedTools: expectedToolIds.length,
    downloadedCatalogEntries: catalog.length,
    batches: [
      'first_5_dry_run_schema_and_permission',
      'second_5_guard_and_configuration_required',
    ],
    planner: ['news_to_brave_news_search', 'crypto_to_binance_market_tools'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Best effort cleanup on Windows.
  }
}
