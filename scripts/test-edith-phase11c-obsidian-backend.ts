import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseObsidianProviderLocalConfigV1,
  parseObsidianProviderPublicStatusV1,
  type ResearchRunV2,
  type TrustedNativeVaultSelectionV1,
} from '../src/edith/contracts';
import { readRecentAuditEvents } from '../src/edith/audit';
import { ObsidianProviderConfigService } from '../src/edith/obsidianProviderService';
import { ObsidianVaultService } from '../src/edith/obsidianVaultService';
import { ResearchJournalService } from '../src/edith/researchJournalService';
import { MobileCryptoService } from '../server/mobile/crypto';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import { DesktopProducerService } from '../server/mobile/desktopProducerService';
import { MobilePairingService } from '../server/mobile/pairingService';
import { MobileRealtimeService } from '../server/mobile/realtime';
import { MobileRegistryStore } from '../server/mobile/registryStore';
import type { MobileRuntime } from '../server/mobile/runtime';
import { MobileTransferService } from '../server/mobile/transferService';
import type { MobilePairingRequest } from '../server/mobile/types';
import { createDesktopProducerRouter } from '../server/routes/desktopProducer';
import { createKnowledgeRouter } from '../server/routes/knowledge';
import { createObsidianProviderRouter, NativeSelectionReplayStore } from '../server/routes/obsidianProvider';
import { createOwnerSessionRouter, getOwnerSession, requireOwnerSession } from '../server/security/ownerSession';

const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase11c-'));
const appRoot = path.join(root, 'application-root');
const dataRoot = path.join(root, 'mobile-data');
const configFile = path.join(root, 'provider-config', 'obsidian-provider.json');
const replayFile = path.join(root, 'provider-config', 'obsidian-native-selection-replay.json');
const firstVault = path.join(root, 'Kullanıcı Alanı', 'E.D.I.T.H Vault');
const secondVault = path.join(root, 'Türkçe Alan', 'İkinci Vault');
const unavailableVault = `${secondVault}-unavailable`;
for (const directory of [appRoot, dataRoot, firstVault, secondVault]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(firstVault, 'Görev Notu.md'), '# Existing user note\n', 'utf8');
fs.writeFileSync(path.join(secondVault, 'Araştırma.md'), '# Existing second vault note\n', 'utf8');
const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
assert.match(serverSource, /EDITH_OBSIDIAN_SYNC_REGISTRY_ON_STARTUP\s*===\s*["']true["'][\s\S]{0,500}writeSkillRegistryNotes/,
  'Startup registry writes must remain behind an explicit opt-in environment gate.');

const previous = {
  ownerToken: process.env.EDITH_OWNER_TOKEN,
  ownerOneTime: process.env.EDITH_OWNER_TOKEN_ONE_TIME,
  bridgeToken: process.env.EDITH_DESKTOP_BRIDGE_TOKEN,
  nodeEnv: process.env.NODE_ENV,
};
process.env.EDITH_OWNER_TOKEN = 'phase11c-owner-secret';
process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
process.env.EDITH_DESKTOP_BRIDGE_TOKEN = 'phase11c-desktop-bridge-secret';

const productionEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
delete productionEnv.EDITH_TEST_MODE;
delete productionEnv.EDITH_TEST_OBSIDIAN_SANDBOX_ROOT;
let clockMs = Date.parse('2026-09-29T09:00:00.000Z');
const now = () => new Date(clockMs);
const providerConfig = new ObsidianProviderConfigService({ appRoot, configFile, env: productionEnv, now });
const vaultService = new ObsidianVaultService(providerConfig);
const replayStore = new NativeSelectionReplayStore(replayFile, () => clockMs, 8);

const store = new MobileRegistryStore(dataRoot);
store.initialize();
const crypto = new MobileCryptoService();
const pairing = new MobilePairingService(store, crypto);
const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
const runtime: MobileRuntime = {
  store,
  crypto,
  pairing,
  realtime,
  transfers: new MobileTransferService(store, dataRoot),
  crossDevice: new CrossDeviceService(store.serverId()),
};
const producerService = new DesktopProducerService();
let killSwitchActive = false;
let permissionAllowed = true;

const app = express();
app.use(express.json());
app.use(createOwnerSessionRouter());
app.get('/test-owner-binding', requireOwnerSession, (req, res) => res.json({ bindingId: getOwnerSession(req)!.bindingId }));
app.use(createDesktopProducerRouter({ runtime, service: producerService, killSwitchActive: () => false }));
app.use(createObsidianProviderRouter({
  runtime,
  producerService,
  providerConfig,
  vaultService,
  replayStore,
  nativeLoopback: (req) => req.get('x-test-non-loopback') !== 'true',
  ownerLoopback: (req) => req.get('x-test-non-loopback') !== 'true',
  killSwitchActive: () => killSwitchActive,
  permissionAllows: () => permissionAllowed,
  now,
}));
app.use(createKnowledgeRouter());
const server = createServer(app);

function signature(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
}

function treeDigest(target: string): string {
  const entries: string[] = [];
  const visit = (directory: string, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        entries.push(`d:${relative}`);
        visit(absolute, relative);
      } else {
        entries.push(`f:${relative}:${createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`);
      }
    }
  };
  visit(target);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

async function listen(): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return address.port;
}

function selection(selectionId: string, selectedPath: string, deviceId: string, overrides: Partial<TrustedNativeVaultSelectionV1> = {}): TrustedNativeVaultSelectionV1 {
  return {
    ...v21,
    selectionId,
    deviceId,
    source: 'trusted_native_picker',
    selectedPath,
    userConfirmed: true,
    selectedAt: new Date(clockMs - 1_000).toISOString(),
    expiresAt: new Date(clockMs + 4 * 60_000).toISOString(),
    ...overrides,
  };
}

try {
  const port = await listen();
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/security/session`, { method: 'POST', headers: { origin, authorization: 'Bearer phase11c-owner-secret' } });
  assert.equal(login.status, 201);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const loginBody = await login.json() as { session: { csrfToken: string } };
  const ownerHeaders = {
    origin,
    cookie,
    'x-edith-csrf-token': loginBody.session.csrfToken,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  };
  const bindingResponse = await fetch(`${origin}/test-owner-binding`, { headers: { cookie } });
  const ownerBindingId = ((await bindingResponse.json()) as { bindingId: string }).bindingId;

  let nativeSessionResponse = await fetch(`${origin}/api/edith/obsidian/native-session`, {
    method: 'POST', headers: ownerHeaders, body: '{}',
  });
  assert.equal(nativeSessionResponse.status, 403, 'Owner credentials without the native bridge token must be denied.');
  nativeSessionResponse = await fetch(`${origin}/api/edith/obsidian/native-session`, {
    method: 'POST', headers: { authorization: 'Bearer phase11c-desktop-bridge-secret', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(nativeSessionResponse.status, 201);
  const nativeSessionBody = await nativeSessionResponse.json() as any;
  assert.equal(nativeSessionBody.data.session.ownerSessionBindingId, ownerBindingId);
  assert.equal(nativeSessionBody.data.session.targetDeviceId, 'desktop-native');
  assert.equal(typeof nativeSessionBody.data.producerSessionToken, 'string');
  assert.equal(JSON.stringify(nativeSessionBody).includes(root), false);

  const signingKeys = generateKeyPairSync('ed25519');
  const agreementKeys = generateKeyPairSync('x25519');
  const deviceId = 'phase11c-native-device';
  const pairingRequest: MobilePairingRequest = {
    device: { deviceId, displayName: 'Phase 11C Native Device', platform: 'windows', capabilities: { ...v21, realtime: true, fileTransfer: true, fileTransferEncryption: true, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } },
    signingPublicKeyJwk: signingKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    agreementPublicKeyJwk: agreementKeys.publicKey.export({ format: 'jwk' }) as JsonWebKey,
    requestedCommands: ['result_card.read'],
  };
  const requested = pairing.request(pairingRequest);
  pairing.submitProof(requested.pairing.pairingId, signature(signingKeys.privateKey, requested.proofPayload));
  pairing.approve(requested.pairing.pairingId, requested.code, undefined, { bindingId: ownerBindingId, expiresAt: new Date(clockMs + 60 * 60_000).toISOString() });
  const consumed = pairing.consume(requested.pairing.pairingId, signature(signingKeys.privateKey, `${requested.proofPayload}\nconsume`));
  const context = pairing.authenticate(consumed.credential.token);

  const serviceGeneric = producerService.create(context, runtime.store.serverId());
  assert.throws(
    () => producerService.authorizeNativeSelection(serviceGeneric.token, 1),
    (error: unknown) => error instanceof Error && error.message === 'OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED',
  );
  assert.equal(producerService.authorize(serviceGeneric.token, 1).targetDeviceId, deviceId,
    'Rejected generic credentials must remain usable by the normal desktop producer flow.');

  const issueGenericProducer = async () => {
    const response = await fetch(`${origin}/api/edith/mobile/desktop-producer/session/${deviceId}`, {
      method: 'POST',
      headers: { ...ownerHeaders, authorization: 'Bearer phase11c-desktop-bridge-secret' },
      body: '{}',
    });
    assert.equal(response.status, 201);
    return (await response.json() as { data: { producerSessionToken: string } }).data.producerSessionToken;
  };
  type NativeProducer = {
    producerSessionToken: string;
    session: {
      ownerSessionBindingId: string;
      workspaceId: string;
      sessionId: string;
      targetDeviceId: string;
      expiresAt: string;
    };
  };
  const issueNativeProducer = async (): Promise<NativeProducer> => {
    const issuedAfter = Date.now();
    const response = await fetch(`${origin}/api/edith/obsidian/native-session`, {
      method: 'POST',
      headers: { authorization: 'Bearer phase11c-desktop-bridge-secret', 'content-type': 'application/json' },
      body: '{}',
    });
    const receivedAt = Date.now();
    assert.equal(response.status, 201);
    const issued = (await response.json() as { data: NativeProducer }).data;
    const expiresAt = Date.parse(issued.session.expiresAt);
    const ttlMs = expiresAt - receivedAt;
    assert.ok(expiresAt > issuedAfter && ttlMs <= 5 * 60_000, `Native selection producer TTL must not exceed five minutes (observed ${ttlMs}ms after receipt).`);
    return issued;
  };
  const genericEnvelope = (nativeSelection: TrustedNativeVaultSelectionV1) => ({
    ...v21,
    ownerSessionBindingId: ownerBindingId,
    workspaceId: context.credential.workspaceId,
    sessionId: context.credential.sessionId,
    selection: nativeSelection,
  });
  const nativeEnvelope = (producer: NativeProducer, nativeSelection: TrustedNativeVaultSelectionV1) => ({
    ...v21,
    ownerSessionBindingId: producer.session.ownerSessionBindingId,
    workspaceId: producer.session.workspaceId,
    sessionId: producer.session.sessionId,
    selection: nativeSelection,
  });
  const nativeHeaders = (producer: NativeProducer, extra: Record<string, string> = {}) => ({
    authorization: 'Bearer phase11c-desktop-bridge-secret',
    'content-type': 'application/json',
    'x-edith-producer-session': producer.producerSessionToken,
    'x-edith-native-selection-sequence': '1',
    'x-edith-owner-session-binding': producer.session.ownerSessionBindingId,
    'x-edith-device-session': producer.session.sessionId,
    ...extra,
  });
  const publishNative = (producer: NativeProducer, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/edith/obsidian/native-selection`, {
    method: 'POST',
    headers: { ...nativeHeaders(producer), ...headers },
    body: JSON.stringify(body),
  });

  let response = await fetch(`${origin}/api/edith/obsidian/provider/status`, { headers: { origin, cookie, 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 200);
  let body = await response.json() as any;
  assert.equal(parseObsidianProviderPublicStatusV1(body.status).success, true);
  assert.equal(body.status.state, 'FIRST_RUN_REQUIRED');
  assert.equal(JSON.stringify(body).includes(root), false);
  response = await fetch(`${origin}/api/edith/obsidian/provider/status`, { headers: { cookie, referer: `${origin}/`, 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 200, 'Browser-like same-origin GET without Origin must use verified Referer and Fetch Metadata.');
  response = await fetch(`${origin}/api/edith/obsidian/provider/status`, { headers: { cookie, 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 403, 'Missing Origin and Referer must fail closed.');
  assert.throws(() => vaultService.configureVaultParent(firstVault), /TRUSTED_NATIVE_PICKER_REQUIRED/);

  const preActivationJournal = new ResearchJournalService(() => {
    const status = providerConfig.status();
    return status.state === 'READY' && status.writable ? providerConfig.provider() : undefined;
  });
  assert.equal(preActivationJournal.write({ runId: 'pre-activation', query: 'No provider yet', mode: 'FAST', status: 'completed', sourceIds: [], artifactIds: [], startedAt: now().toISOString(), completedAt: now().toISOString() } as ResearchRunV2).status, 'configuration_required');

  response = await fetch(`${origin}/api/edith/obsidian/provider/status`, { headers: { origin: 'https://attacker.invalid', cookie, 'sec-fetch-site': 'cross-site' } });
  assert.equal(response.status, 403);
  response = await fetch(`${origin}/api/edith/obsidian/provider/status`, { headers: { origin, cookie, 'sec-fetch-site': 'same-origin', 'x-test-non-loopback': 'true' } });
  assert.equal(response.status, 403);
  response = await fetch(`${origin}/api/edith/obsidian/provider/activate`, { method: 'POST', headers: { ...ownerHeaders, 'x-idempotency-key': 'phase11c-activate-1' }, body: JSON.stringify({ selectedPath: firstVault }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as any).errorCode, 'OBSIDIAN_PROVIDER_MUTATION_BODY_FORBIDDEN');
  response = await fetch(`${origin}/api/edith/obsidian/provider/activate`, { method: 'POST', headers: { ...ownerHeaders, 'x-idempotency-key': 'phase11c-activate-2' }, body: '{}' });
  assert.equal(response.status, 428);
  body = await response.json();
  assert.equal(body.errorCode, 'NATIVE_SELECTION_REQUIRED');
  assert.equal(JSON.stringify(body).includes(root), false);

  const genericSelection = selection('phase11c-generic-selection', firstVault, deviceId);
  const genericBody = genericEnvelope(genericSelection);
  response = await fetch(`${origin}/api/edith/obsidian/native-selection`, { method: 'POST', headers: { ...ownerHeaders }, body: JSON.stringify(genericBody) });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as any).errorCode, 'OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED');
  response = await fetch(`${origin}/api/edith/obsidian/native-selection`, { method: 'POST', headers: { authorization: `Device ${consumed.credential.token}`, 'content-type': 'application/json' }, body: JSON.stringify(genericBody) });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as any).errorCode, 'OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED');

  const genericProducerToken = await issueGenericProducer();
  response = await fetch(`${origin}/api/edith/obsidian/native-selection`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer phase11c-desktop-bridge-secret',
      'content-type': 'application/json',
      'x-edith-producer-session': genericProducerToken,
      'x-edith-native-selection-sequence': '1',
      'x-edith-owner-session-binding': ownerBindingId,
      'x-edith-device-session': context.credential.sessionId,
    },
    body: JSON.stringify(genericBody),
  });
  assert.equal(response.status, 401);
  const genericDenied = await response.text();
  assert.equal(JSON.parse(genericDenied).errorCode, 'OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED');
  for (const sensitive of [genericProducerToken, context.credential.sessionId, deviceId, genericSelection.selectionId, firstVault]) {
    assert.equal(genericDenied.includes(sensitive), false, `Generic producer denial leaked sensitive material: ${sensitive}`);
  }

  let producer = await issueNativeProducer();
  let candidate = selection('phase11c-preflight-selection', firstVault, producer.session.targetDeviceId);
  response = await publishNative(producer, nativeEnvelope(producer, candidate), { authorization: 'Bearer wrong-bridge-token' });
  assert.equal(response.status, 403);
  assert.equal(JSON.stringify(await response.json()).includes('wrong-bridge-token'), false);
  response = await publishNative(producer, nativeEnvelope(producer, candidate), { 'x-test-non-loopback': 'true' });
  assert.equal(response.status, 403);
  response = await publishNative(producer, nativeEnvelope(producer, candidate), { 'x-edith-native-selection-sequence': '2' });
  assert.equal(response.status, 409);
  response = await publishNative(producer, { ...nativeEnvelope(producer, candidate), unexpected: true });
  assert.equal(response.status, 400);
  response = await publishNative(producer, nativeEnvelope(producer, { ...candidate, source: 'forged' as any }));
  assert.equal(response.status, 400);
  response = await publishNative(producer, nativeEnvelope(producer, { ...candidate, userConfirmed: false as true }));
  assert.equal(response.status, 400);
  response = await publishNative(producer, nativeEnvelope(producer, selection('phase11c-selection-too-long', firstVault, producer.session.targetDeviceId, { selectedAt: new Date(clockMs).toISOString(), expiresAt: new Date(clockMs + 5 * 60_000 + 1).toISOString() })));
  assert.equal(response.status, 400);
  const expired = selection('phase11c-selection-expired', firstVault, producer.session.targetDeviceId, { selectedAt: new Date(clockMs - 6 * 60_000).toISOString(), expiresAt: new Date(clockMs - 1).toISOString() });
  response = await publishNative(producer, nativeEnvelope(producer, expired));
  assert.equal(response.status, 400);

  for (const mismatch of [
    (value: ReturnType<typeof nativeEnvelope>) => ({ ...value, ownerSessionBindingId: 'wrong-owner' }),
    (value: ReturnType<typeof nativeEnvelope>) => ({ ...value, workspaceId: 'wrong-workspace' }),
    (value: ReturnType<typeof nativeEnvelope>) => ({ ...value, sessionId: 'wrong-session' }),
    (value: ReturnType<typeof nativeEnvelope>) => ({ ...value, selection: { ...value.selection, deviceId: 'wrong-device' } }),
  ]) {
    producer = await issueNativeProducer();
    candidate = selection(`phase11c-mismatch-${producer.session.sessionId}`, firstVault, producer.session.targetDeviceId);
    response = await publishNative(producer, mismatch(nativeEnvelope(producer, candidate)));
    assert.equal(response.status, 403);
    assert.equal((await response.json() as any).errorCode, 'OBSIDIAN_NATIVE_SELECTION_LINEAGE_MISMATCH');
  }
  producer = await issueNativeProducer();
  candidate = selection('phase11c-permission-selection', firstVault, producer.session.targetDeviceId);
  permissionAllowed = false;
  response = await publishNative(producer, nativeEnvelope(producer, candidate));
  assert.equal(response.status, 403);
  permissionAllowed = true;
  producer = await issueNativeProducer();
  candidate = selection('phase11c-kill-selection', firstVault, producer.session.targetDeviceId);
  killSwitchActive = true;
  response = await publishNative(producer, nativeEnvelope(producer, candidate));
  assert.equal(response.status, 423);
  killSwitchActive = false;

  const firstVaultBefore = treeDigest(firstVault);
  producer = await issueNativeProducer();
  const first = selection('phase11c-selection-one', firstVault, producer.session.targetDeviceId);
  response = await publishNative(producer, nativeEnvelope(producer, first));
  const acceptedText = await response.text();
  assert.equal(response.status, 202, acceptedText);
  assert.deepEqual(JSON.parse(acceptedText), { success: true });
  assert.equal(acceptedText.includes(firstVault), false);
  assert.equal(acceptedText.includes(first.selectionId), false);
  assert.equal(acceptedText.includes(deviceId), false);
  assert.equal(treeDigest(firstVault), firstVaultBefore, 'Provider activation must not mutate the selected vault.');
  assert.equal(providerConfig.status().state, 'READY');
  assert.equal(providerConfig.status().writable, true);
  const localConfig = parseObsidianProviderLocalConfigV1(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  assert.equal(localConfig.success, true);
  assert.equal(localConfig.success && localConfig.value.selectedPath, fs.realpathSync(firstVault));
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(replayFile, 'utf8'))).includes(first.selectionId), false);
  const restartedReplayStore = new NativeSelectionReplayStore(replayFile, () => clockMs, 8);
  assert.throws(() => restartedReplayStore.claim(first.selectionId, first.expiresAt), /OBSIDIAN_NATIVE_SELECTION_REPLAYED/);

  const boundedReplayFile = path.join(root, 'bounded-replay.json');
  const boundedReplay = new NativeSelectionReplayStore(boundedReplayFile, () => clockMs, 2);
  boundedReplay.claim('bounded-one', new Date(clockMs + 60_000).toISOString());
  boundedReplay.claim('bounded-two', new Date(clockMs + 60_000).toISOString());
  assert.throws(() => boundedReplay.claim('bounded-three', new Date(clockMs + 60_000).toISOString()), /OBSIDIAN_NATIVE_REPLAY_STORE_CAPACITY/);
  const boundedReplayPayload = JSON.parse(fs.readFileSync(boundedReplayFile, 'utf8')) as { entries: unknown[] };
  assert.equal(boundedReplayPayload.entries.length, 2);
  assert.equal(JSON.stringify(boundedReplayPayload).includes('bounded-three'), false);

  producer = await issueNativeProducer();
  response = await publishNative(producer, nativeEnvelope(producer, first));
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).errorCode, 'OBSIDIAN_NATIVE_SELECTION_REPLAYED');

  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const journal = new ResearchJournalService(() => {
    const status = providerConfig.status();
    return status.state === 'READY' && status.writable ? providerConfig.provider() : undefined;
  });
  const journalResult = journal.write({
    runId: 'phase11c-research', query: 'Provider composition', mode: 'FAST', status: 'completed',
    sourceIds: [], artifactIds: [], startedAt: now().toISOString(), completedAt: now().toISOString(),
  } as ResearchRunV2);
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
  assert.equal(journalResult.status, 'written');
  assert.equal(fs.existsSync(path.join(firstVault, journalResult.relativePath!)), true);

  response = await fetch(`${origin}/api/edith/obsidian/provider/change`, { method: 'POST', headers: { ...ownerHeaders, 'x-idempotency-key': 'phase11c-change-1' }, body: '{}' });
  assert.equal(response.status, 428);
  const secondVaultBefore = treeDigest(secondVault);
  producer = await issueNativeProducer();
  const second = selection('phase11c-selection-two', secondVault, producer.session.targetDeviceId);
  response = await publishNative(producer, nativeEnvelope(producer, second));
  assert.equal(response.status, 202);
  assert.equal(treeDigest(secondVault), secondVaultBefore, 'Provider change must not mutate the selected vault.');
  assert.equal(providerConfig.status().configRevision, 2);

  const restart = new ObsidianProviderConfigService({ appRoot, configFile, env: productionEnv, now });
  assert.equal(restart.status().state, 'READY');
  assert.equal(restart.status().selectionAction, 'none');
  vaultService.stopWatcher();
  fs.renameSync(secondVault, unavailableVault);
  assert.equal(restart.status().state, 'DEGRADED');
  assert.equal(restart.status().reasonCode, 'VAULT_UNAVAILABLE');
  assert.equal(restart.status().selectionAction, 'none');

  response = await fetch(`${origin}/api/edith/obsidian/provider/revoke`, { method: 'POST', headers: { ...ownerHeaders, 'x-idempotency-key': 'phase11c-revoke-1' }, body: '{}' });
  assert.equal(response.status, 200);
  const revoked = await response.json() as any;
  assert.equal(revoked.status.state, 'FIRST_RUN_REQUIRED');
  assert.equal(revoked.status.reasonCode, 'VAULT_SELECTION_REVOKED');
  assert.equal(JSON.stringify(revoked).includes(root), false);
  response = await fetch(`${origin}/api/edith/obsidian/provider/revoke`, { method: 'POST', headers: { ...ownerHeaders, 'x-idempotency-key': 'phase11c-revoke-1' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).idempotentReplay, true);
  const revokedConfig = parseObsidianProviderLocalConfigV1(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  assert.equal(revokedConfig.success, true);
  assert.equal(revokedConfig.success && 'selectedPath' in revokedConfig.value, false);

  response = await fetch(`${origin}/api/edith/obsidian/vault`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ parentPath: firstVault }),
  });
  assert.equal(response.status, 410);
  const legacyDenied = await response.text();
  assert.equal(legacyDenied.includes(firstVault), false);
  assert.equal(legacyDenied.includes('TRUSTED_NATIVE_PICKER_REQUIRED'), true);

  producer = await issueNativeProducer();
  const logout = await fetch(`${origin}/api/security/session`, { method: 'DELETE', headers: ownerHeaders });
  assert.equal(logout.status, 200);
  response = await publishNative(producer, nativeEnvelope(producer, selection('phase11c-after-logout', firstVault, producer.session.targetDeviceId)));
  assert.equal(response.status, 401);

  const obsidianAudits = readRecentAuditEvents(200).filter((event) => event.action.startsWith('obsidian.'));
  const serializedAudits = JSON.stringify(obsidianAudits);
  for (const sensitive of [
    firstVault,
    secondVault,
    first.selectionId,
    second.selectionId,
    genericSelection.selectionId,
    deviceId,
    context.credential.sessionId,
    'phase11c-desktop-bridge-secret',
    genericProducerToken,
    producer.producerSessionToken,
  ]) {
    assert.equal(serializedAudits.includes(sensitive), false, `Audit leaked sensitive native selection material: ${sensitive}`);
  }
  assert.equal(obsidianAudits.some((event) => event.action === 'obsidian.native_selection.activate'), true);
  assert.equal(obsidianAudits.some((event) => event.action === 'obsidian.native_selection.change'), true);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'loopback_bridge_and_active_producer_required',
      'loopback_active_owner_bridge_native_selection_session',
      'generic_producer_rejected_for_native_selection_service_and_route',
      'generic_producer_normal_authorization_preserved',
      'strict_unknown_field_and_forgery_denial',
      'exact_owner_workspace_session_device_binding',
      'five_minute_expiry_and_exact_sequence',
      'bounded_persisted_hash_only_replay_denial',
      'kill_switch_and_permission_denial',
      'unicode_path_preserved_without_activation_mutation',
      'path_free_response_and_audit',
      'protected_status_activate_change_revoke',
      'owner_origin_csrf_idempotency',
      'restart_ready_then_degraded_without_popup',
      'revoke_path_free_tombstone',
      'production_research_journal_ready_provider',
      'legacy_direct_path_fail_closed',
      'owner_logout_invalidates_native_publication',
      'startup_registry_write_requires_explicit_opt_in',
    ],
  }, null, 2));
} finally {
  vaultService.stopWatcher();
  realtime.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  if (previous.ownerToken === undefined) delete process.env.EDITH_OWNER_TOKEN; else process.env.EDITH_OWNER_TOKEN = previous.ownerToken;
  if (previous.ownerOneTime === undefined) delete process.env.EDITH_OWNER_TOKEN_ONE_TIME; else process.env.EDITH_OWNER_TOKEN_ONE_TIME = previous.ownerOneTime;
  if (previous.bridgeToken === undefined) delete process.env.EDITH_DESKTOP_BRIDGE_TOKEN; else process.env.EDITH_DESKTOP_BRIDGE_TOKEN = previous.bridgeToken;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
}
