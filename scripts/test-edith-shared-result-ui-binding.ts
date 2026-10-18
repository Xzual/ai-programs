import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchCardPublicationGate, ResearchPublishedCard, ResearchSharedResultPanel, researchCardPublicationScope } from '../src/components/cross-device/CrossDeviceBridgePanel';
import { CrossDeviceDesktopBridge } from '../src/edith/crossDeviceDesktopBridge';
import type { SharedResultCardV2 } from '../src/edith/contracts';

// Synthetic HTTP DTO fixtures, actual helper/controller/React render. No producer,
// phone delivery, native execution or browser interaction is claimed here.
let checks = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const now = Date.now();
const stamp = new Date(now).toISOString();
let devices = ['phone-a', 'phone-b'];
let kill = false;
let authorized = true;
let posts = 0;
let status = 201;
let ack = true;
let projection: (card: SharedResultCardV2) => SharedResultCardV2 = card => card;
let wait: Promise<void> | undefined;
const fixtureCard = (cardId: string, sourceId: string, target: string): SharedResultCardV2 => ({
  contractVersion: 2, amendment: '2.1', ownerSessionBindingId: 'owner-fixture', workspaceId: 'workspace-fixture', sessionId: 'session-fixture', sourceDeviceId: 'desktop-fixture', targetDeviceId: target,
  cardId, kind: 'research', title: 'Actual fixture returned title', summary: '<script>untrusted display</script>', outcome: 'failure',
  provenance: { sourceType: 'research', sourceId, observedAt: stamp, verified: false }, preview: { redacted: true }, artifactRefs: [],
  actions: [{ action: 'open', available: true, requiresApproval: false }, { action: 'dismiss', available: true, requiresApproval: false }, { action: 'retry', available: true, requiresApproval: true }], revision: 1, createdAt: stamp, updatedAt: stamp,
});
const bridge = new CrossDeviceDesktopBridge({
  tauriAvailable: () => false, now: () => now,
  fetcher: async input => {
    const path = String(input);
    if (path.endsWith('/kill-switch')) return json({ state: { active: kill } });
    if (!authorized) return json({ errorCode: 'OWNER_SESSION_REQUIRED' }, 401);
    if (path.endsWith('/devices')) return json({ success: true, data: { devices: devices.map(deviceId => ({ device: { deviceId, displayName: deviceId, platform: 'android' }, trust: { status: 'trusted' }, ownerBinding: { ownerSessionId: 'owner-fixture', workspaceId: 'workspace-fixture', expiresAt: new Date(now + 60000).toISOString() } })) } });
    if (path.endsWith('/desktop-producer/status')) return json({ success: true, data: { configured: false } });
    if (path.endsWith('/cross-device/status')) return json({ success: true, data: {} });
    throw Error('UNEXPECTED_FIXTURE_READ');
  },
  ownerFetch: async (input, init) => {
    posts++;
    check(init?.method, 'POST');
    const reference = JSON.parse(String(init?.body));
    check(Object.keys(reference).sort(), ['cardId', 'source']);
    check(reference.source.type, 'research');
    await wait;
    const target = decodeURIComponent(String(input).split('/').at(-1)!);
    return json({ success: ack, data: { card: projection(fixtureCard(reference.cardId, reference.source.id, target)) }, errorCode: status >= 400 ? 'DEVICE_NOT_FOUND' : undefined }, status);
  },
});

const gate = new ResearchCardPublicationGate();
const snapshot = await bridge.refresh();
check(researchCardPublicationScope(snapshot, '', 'run-a', now), '');
check(researchCardPublicationScope({ ...snapshot, devices: [] }, 'phone-a', 'run-a', now), '');
check(researchCardPublicationScope({ ...snapshot, ownerAuthorized: false }, 'phone-a', 'run-a', now), '');
check(researchCardPublicationScope({ ...snapshot, killSwitchActive: null }, 'phone-a', 'run-a', now), '');
check(researchCardPublicationScope({ ...snapshot, killSwitchActive: true }, 'phone-a', 'run-a', now), '');
check(researchCardPublicationScope(snapshot, 'phone-a', 'run-a', now + 60001), '');
check(Boolean(researchCardPublicationScope(snapshot, 'phone-a', 'run-a', now)), true);
check(researchCardPublicationScope(snapshot, 'phone-a', 'run-a', now) === researchCardPublicationScope(snapshot, 'phone-b', 'run-a', now), false);
check(researchCardPublicationScope(snapshot, 'phone-a', 'run-a', now) === researchCardPublicationScope({ ...snapshot, devices: snapshot.devices.map(row => ({ ...row, ownerSessionBindingId: 'rotated-owner' })) }, 'phone-a', 'run-a', now), false);
await assert.rejects(() => gate.publish(bridge, '', 'run-a')); checks++;
check(posts, 0);
gate.setScope('run-a/phone-a/owner-fixture');
check(await gate.publish(bridge, 'phone-a', 'run-a'), 'accepted');
check(gate.card?.outcome, 'failure');
check(gate.card?.provenance.verified, false);
const rendered = renderToStaticMarkup(React.createElement(ResearchPublishedCard, { card: gate.card!, onOpen: () => undefined, onDismiss: () => undefined }));
check(rendered.includes('Backend publication accepted (201). Phone delivery is unverified.'), true);
check(rendered.includes('&lt;script&gt;untrusted display&lt;/script&gt;'), true);
check(rendered.includes('<script>'), false);
check(rendered.includes('Retry'), false);
check(rendered.includes('href='), false);
const noLocalOpen = renderToStaticMarkup(React.createElement(ResearchPublishedCard, { card: gate.card!, onDismiss: () => undefined }));
check(/<button[^>]+disabled=""[^>]*>Open local research/.test(noLocalOpen), true);
const needsApproval = renderToStaticMarkup(React.createElement(ResearchPublishedCard, { card: { ...gate.card!, actions: [{ action: 'open', available: true, requiresApproval: true }] }, onOpen: () => undefined, onDismiss: () => undefined }));
check(/<button[^>]+disabled=""[^>]*>Open local research/.test(needsApproval), true);
const initial = renderToStaticMarkup(React.createElement(ResearchSharedResultPanel, { sourceReference: { type: 'research', id: 'run-a' } }));
check(initial.includes('No device available'), true);
check(/<button[^>]+disabled=""[^>]*>Publish research card/.test(initial), true);
check(initial.includes('Start Live View'), false);
gate.setScope('run-b/phone-a/owner-fixture'); check(gate.card, null);
let release!: () => void;
wait = new Promise<void>(resolve => { release = resolve; });
const pending = gate.publish(bridge, 'phone-a', 'run-b');
check(await gate.publish(bridge, 'phone-a', 'run-b'), 'busy');
gate.setScope('run-b/phone-b/owner-fixture');
release(); check(await pending, 'stale'); check(gate.card, null); check(gate.busy, false);
wait = undefined;
for (const change of [
  (card: SharedResultCardV2) => ({ ...card, targetDeviceId: 'other-device' }),
  (card: SharedResultCardV2) => ({ ...card, cardId: 'other-card' }),
  (card: SharedResultCardV2) => ({ ...card, provenance: { ...card.provenance, sourceId: 'other-run' } }),
  (card: SharedResultCardV2) => ({ ...card, provenance: { ...card.provenance, sourceType: 'task' } }),
]) {
  projection = change;
  await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++;
  check(gate.card, null);
}
projection = card => card;
status = 404; await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++; check(gate.card, null);
for (const wrongAcknowledgment of [200, 202]) {
  status = wrongAcknowledgment;
  await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++;
  check(gate.card, null);
}
status = 201;
ack = false; await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++; check(gate.card, null); ack = true;
projection = card => ({ ...card, ownerSessionBindingId: 'other-owner' });
await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b', { ownerSessionBindingId: 'owner-fixture', workspaceId: 'workspace-fixture' })); checks++; check(gate.card, null);
projection = card => card;
for (const reason of ['unmount', 'logout', 'kill', 'owner-rotation', 'scope-expiry']) {
  gate.setScope(reason);
  wait = new Promise<void>(resolve => { release = resolve; });
  const delayed = gate.publish(bridge, 'phone-b', 'run-b');
  gate.clear(); release(); check(await delayed, 'stale'); check(gate.card, null);
}
wait = undefined;
gate.setScope('late-rejected-owner');
let rejectLate!: (error: Error) => void;
const lateFailure = gate.publish({ publishResultCard: () => new Promise((_resolve, reject) => { rejectLate = reject; }) }, 'phone-b', 'run-b');
gate.setScope('new-owner'); rejectLate(new Error('old-owner-failure'));
check(await lateFailure, 'stale'); check(gate.card, null);
authorized = false; const beforeUnauthorized = posts;
await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++; check(posts, beforeUnauthorized);
authorized = true; kill = true;
await assert.rejects(() => gate.publish(bridge, 'phone-b', 'run-b')); checks++; check(posts, beforeUnauthorized);
kill = false; devices = [];
check((await bridge.refresh()).devices.length, 0);
console.log(JSON.stringify({ status: 'PASS', checks, posts, scope: 'SIM HTTP fixtures; actual helper/controller and React static rendering; no live producer/phone/native/browser acceptance' }));
