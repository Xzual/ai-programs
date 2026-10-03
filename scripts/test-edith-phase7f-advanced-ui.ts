import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AdvancedExperienceClientError, fetchAdvancedExperience, searchAdvancedHistory } from '../src/edith/advancedExperienceClient';

const workspaceId = 'workspace-1';
const emptyState = {
  priority: [], shadow: [], ghosts: [], 'mission-memories': [], bookmarks: [], 'recent-context': [], snapshots: [],
  'restore-plans': [], scenes: [], watchers: [], comparisons: [], communication: [], orchestration: [], retries: [],
  downloads: [], 'power-presence': [], 'history-policy': [], 'capsule-selection': [],
};
const status = {
  persistence: 'memory_only', restartRecovery: 'partial', nativeExecution: 'configuration_required',
  scheduler: 'configuration_required', watcherObservation: 'metadata_only', watcherDelivery: 'configuration_required',
  mobileRead: 'available', secretsStored: false,
};

let mode: 'success' | 'invalid-status' | 'history-private' | 'owner-session' = 'success';
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/workspace/status')) return new Response(JSON.stringify({ success: true, config: { workspaceId } }), { status: 200 });
  if (url.includes('/history/search')) return new Response(JSON.stringify({ success: true, results: [], privateHistoryIncluded: mode === 'history-private' }), { status: 200 });
  if (mode === 'owner-session') return new Response(JSON.stringify({ success: false, error: 'owner_session_required', safeMessage: 'A valid owner session is required.' }), { status: 401 });
  const nextStatus = mode === 'invalid-status' ? { ...status, persistence: 'durable' } : status;
  return new Response(JSON.stringify({ success: true, status: nextStatus, state: emptyState }), { status: 200 });
}) as typeof fetch;

const snapshot = await fetchAdvancedExperience();
assert.equal(snapshot.workspaceId, workspaceId);
assert.equal(snapshot.status.persistence, 'memory_only');
assert.equal(snapshot.status.restartRecovery, 'partial');
assert.equal(snapshot.state.ghosts.length, 0);

mode = 'invalid-status';
await assert.rejects(fetchAdvancedExperience(), /capability truth/i);

mode = 'history-private';
await assert.rejects(searchAdvancedHistory(workspaceId, ''), /privacy boundary/i);

mode = 'owner-session';
await assert.rejects(fetchAdvancedExperience(), (error: unknown) => error instanceof AdvancedExperienceClientError && error.code === 'OWNER_SESSION_REQUIRED');

const component = await readFile(new URL('../src/components/advanced/AdvancedExperiencePanels.tsx', import.meta.url), 'utf8');
assert.match(component, /No client-authored completion or verification/);
assert.match(component, /ETA \{download\.etaTrustworthy/);
assert.match(component, /Current state must be reverified/);
assert.match(component, /Native Shadow controls are disabled in browser mode/);
assert.match(component, /No raw screen archive/);
assert.match(component, /configuration_required/);

const mobileUi = await readFile(new URL('../mobile/app/src/main/java/com/edith/mobile/ui/EdithMobileApp.kt', import.meta.url), 'utf8');
assert.match(mobileUi, /Advanced status · read only/);
assert.match(mobileUi, /No remote mutation controls are enabled on Android/);

const mobileCommands = await readFile(new URL('../mobile/app/src/main/java/com/edith/mobile/contracts/MobileWireContracts.kt', import.meta.url), 'utf8');
assert.doesNotMatch(mobileCommands, /advanced\.(pause|cancel|priority|shadow)/);

console.log('Phase 7F advanced UI checks passed: 13 assertions');
