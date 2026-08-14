import assert from 'node:assert/strict';
import { IntentService } from '../src/edith/intent';

const service = new IntentService();

const task = service.understand('bunu görev olarak takibe al: Playwright browser adapter test edilecek');
assert.equal(task.kind, 'task_objective');
assert.equal(task.route?.toolId, 'task_create');
assert.equal(task.requiresTask, true);
assert.equal(task.requiresPlanning, true);
assert.equal(task.route?.args.originalUserRequest, 'bunu görev olarak takibe al: Playwright browser adapter test edilecek');

const system = service.understand('bilgisayar ram cpu durumunu göster');
assert.equal(system.kind, 'tool_execution');
assert.equal(system.route?.toolId, 'system_monitor');

const catalog = service.understand('hangi araçlar var listele');
assert.equal(catalog.kind, 'tool_execution');
assert.equal(catalog.route?.toolId, 'ai_skill_catalog');

const open = service.understand('chrome ile example.com sitesini aç');
assert.equal(open.kind, 'tool_execution');
assert.equal(open.route?.toolId, 'browser_open');
assert.deepEqual(open.route?.args, { url: 'example.com' });

const search = service.understand('internette browser-use hakkında ara');
assert.equal(search.kind, 'tool_execution');
assert.equal(search.route?.toolId, 'browser_search');
assert.equal(search.route?.args.query, 'browser-use');

const conversation = service.understand('merhaba nasılsın');
assert.equal(conversation.kind, 'conversation');
assert.equal(conversation.route, undefined);

console.log(JSON.stringify({
  success: true,
  scenarios: ['task_objective', 'system_tool', 'catalog_tool', 'browser_open', 'browser_search', 'conversation'],
}, null, 2));
