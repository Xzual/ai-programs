import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import {
  REALTIME_EVENT_NAMES,
  parseCrossDeviceAudioHandoffV2,
  parseCrossDeviceLiveViewFrameMetadataV2,
  parseCrossDevicePcStatusV2,
  parseCrossDeviceTransferV2,
  parseCrossDeviceWakeReadyV2,
  parseDesktopObservationV2,
  parseDownloadButlerStatusV2,
  parsePowerPresenceSnapshotV2,
  parseVisualBookmarkV2,
  parseWorkspaceSnapshotV2,
  parseSceneProfileV2,
  parseWatcherV2,
  parseShadowModeV2,
  parseSmartRetryPlanV2,
} from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import { knowledgeGraphService } from '../../src/edith/knowledgeGraphService';
import { SharedResultCardProducerService, type ArtifactEvidenceV2, type ErrorAttentionEvidenceV2 } from '../../src/edith/sharedResultCardProducer';
import { taskService } from '../../src/edith/taskService';
import { DesktopProducerService, type RetentionReceipt } from '../mobile/desktopProducerService';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import type { MobileSessionContext } from '../mobile/types';
import { getOwnerSession, onOwnerSessionInvalidated, ownerSessionBindingActive, requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { getPhase4ApiRuntime } from './phase4Api';
import { getAdvancedExperienceRuntime, type AdvancedExperienceRuntime, type AdvancedResource, type AdvancedResourceKind } from '../advanced/runtime';

const SAFE_ID = /^[A-Za-z0-9._-]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const producers = new Map<string, SharedResultCardProducerService>();
export const desktopProducerService = new DesktopProducerService();
let ownerListenerInstalled = false;

export function revokeDesktopProducerAuthority(): void {
  desktopProducerService.revokeAll();
  producers.clear();
}

function producerFor(ownerSessionBindingId: string): SharedResultCardProducerService {
  const current = producers.get(ownerSessionBindingId) ?? new SharedResultCardProducerService();
  producers.set(ownerSessionBindingId, current);
  return current;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function loopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function bearer(req: Request): string | undefined {
  return /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1]?.trim();
}

function activeDeviceContext(runtime: MobileRuntime, deviceId: string, ownerBindingId: string): MobileSessionContext {
  const device = runtime.store.getDevice(deviceId);
  const credential = runtime.store.listCredentials().find((item) => item.deviceId === deviceId && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
  if (!device || !credential || device.ownerBinding.ownerSessionId !== ownerBindingId) throw new Error('DEVICE_NOT_FOUND');
  return runtime.pairing.revalidateContext({ device, credential });
}

function errorStatus(error: unknown): { status: number; errorCode: string } {
  const errorCode = error instanceof Error ? error.message : 'DESKTOP_PRODUCER_REQUEST_FAILED';
  const status = errorCode.includes('NOT_FOUND') ? 404
    : errorCode.includes('SEQUENCE') || errorCode.includes('REVISION') || errorCode.includes('ROLLBACK') ? 409
      : errorCode.includes('KILL_SWITCH') ? 423
        : errorCode.includes('SESSION') || errorCode.includes('UNAUTHORIZED') ? 401 : 400;
  return { status, errorCode };
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).every((key) => keys.includes(key)));
}

function containsPixelPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPixelPayload);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    ['pixels', 'pixelData', 'bytesBase64', 'imageDataUrl', 'transport'].includes(key) || containsPixelPayload(child));
}

function parseArtifact(value: unknown): ArtifactEvidenceV2 | undefined {
  if (!exactObject(value, ['artifactId', 'mediaType', 'checksumSha256', 'checksumStatus', 'provenance', 'retention', 'downloadHandle'])) return undefined;
  const row = value as Record<string, unknown>;
  if (!SAFE_ID.test(String(row.artifactId ?? '')) || typeof row.mediaType !== 'string' || row.mediaType.length > 256) return undefined;
  if (row.checksumSha256 !== undefined && !SHA256.test(String(row.checksumSha256))) return undefined;
  if (row.downloadHandle !== undefined && !SAFE_ID.test(String(row.downloadHandle))) return undefined;
  return row as unknown as ArtifactEvidenceV2;
}

function parseRetentionReceipt(value: unknown): RetentionReceipt | undefined {
  if (!exactObject(value, ['receiptId', 'transferId', 'opaqueHandle', 'status', 'observedAt', 'expiresAt', 'checksumSha256'])) return undefined;
  const row = value as Record<string, unknown>;
  if (![row.receiptId, row.transferId, row.opaqueHandle].every((item) => SAFE_ID.test(String(item ?? '')))
    || !['cleaned', 'retained', 'not_found', 'failed'].includes(String(row.status))
    || !Number.isFinite(Date.parse(String(row.observedAt)))) return undefined;
  if (row.expiresAt !== undefined && !Number.isFinite(Date.parse(String(row.expiresAt)))) return undefined;
  if (row.checksumSha256 !== undefined && !SHA256.test(String(row.checksumSha256))) return undefined;
  return row as unknown as RetentionReceipt;
}

export function createDesktopProducerRouter(options: {
  runtime?: MobileRuntime;
  service?: DesktopProducerService;
  killSwitchActive?: () => boolean;
  bootstrapLoopback?: (req: Request) => boolean;
  producerLoopback?: (req: Request) => boolean;
  advancedRuntime?: AdvancedExperienceRuntime;
} = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const service = options.service ?? desktopProducerService;
  const killSwitchActive = options.killSwitchActive ?? (() => killSwitchService.status().active);
  const bootstrapLoopback = options.bootstrapLoopback ?? loopback;
  const producerLoopback = options.producerLoopback ?? loopback;
  const advancedRuntime = options.advancedRuntime ?? getAdvancedExperienceRuntime();
  if (!ownerListenerInstalled && service === desktopProducerService) {
    onOwnerSessionInvalidated((event) => {
      service.revokeOwner(event.bindingId);
      producers.delete(event.bindingId);
    });
    ownerListenerInstalled = true;
  }

  router.get('/api/edith/mobile/desktop-producer/status', requireOwnerSession, (req, res) => {
    if (killSwitchActive()) { service.revokeAll(); advancedRuntime.emergencyStop(); }
    res.json({ success: true, data: service.status(getOwnerSession(req)!.bindingId) });
  });

  router.post('/api/edith/mobile/desktop-producer/session/:deviceId', ...requireProtectedMutation, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
      if (killSwitchActive()) { service.revokeAll(); advancedRuntime.emergencyStop(); throw new Error('KILL_SWITCH_ACTIVE'); }
      const configuredBridge = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
      if (!configuredBridge) return res.status(428).json({ success: false, errorCode: 'DESKTOP_BRIDGE_CONFIGURATION_REQUIRED', safeMessage: 'The trusted desktop bridge is not configured.' });
      const suppliedBridge = bearer(req);
      if (!bootstrapLoopback(req) || !suppliedBridge || !safeEqual(configuredBridge, suppliedBridge)) {
        return res.status(403).json({ success: false, errorCode: 'DESKTOP_PRODUCER_BRIDGE_REQUIRED', safeMessage: 'Trusted desktop bridge authentication is required.' });
      }
      const owner = getOwnerSession(req)!;
      const issued = service.create(activeDeviceContext(runtime, req.params.deviceId, owner.bindingId), runtime.store.serverId());
      res.status(201).json({ success: true, data: { producerSessionToken: issued.token, session: issued.session } });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Desktop producer session was rejected.' }); }
  });

  const authenticate = (req: Request) => {
    if (killSwitchActive()) { service.revokeAll(); advancedRuntime.emergencyStop(); throw new Error('KILL_SWITCH_ACTIVE'); }
    const bridge = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
    const supplied = bearer(req);
    if (!producerLoopback(req) || !bridge || !supplied || !safeEqual(bridge, supplied)) throw new Error('DESKTOP_PRODUCER_UNAUTHORIZED');
    const sequence = Number(req.get('x-edith-producer-sequence'));
    const session = service.authorize(req.get('x-edith-producer-session'), sequence);
    if (!ownerSessionBindingActive(session.ownerSessionBindingId)) {
      service.revokeOwner(session.ownerSessionBindingId);
      throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
    }
    const context = runtime.pairing.revalidateContext(service.sessionContext(session));
    return { session, context };
  };

  const ingest = <T>(parser: (value: unknown) => { success: true; value: T } | { success: false; errorCode: string }, apply: (auth: ReturnType<typeof authenticate>, value: T) => unknown, event?: string) => (req: Request, res: any) => {
    try {
      const parsed = parser(req.body);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const auth = authenticate(req);
      service.assertLineage(auth.session, parsed.value as any);
      const value = apply(auth, parsed.value);
      if (event) runtime.realtime.publish(event as any, value as any);
      res.status(202).json({ success: true, data: value });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Trusted desktop evidence was rejected.' }); }
  };

  const advancedIngest = <T extends { ownerSessionBindingId: string; workspaceId: string }>(
    kind: AdvancedResourceKind,
    parser: (value: unknown) => { success: true; value: T } | { success: false; errorCode: string },
  ) => (req: Request, res: any) => {
    try {
      const parsed = parser(req.body);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const auth = authenticate(req);
      if (parsed.value.ownerSessionBindingId !== auth.session.ownerSessionBindingId || parsed.value.workspaceId !== auth.session.workspaceId) throw new Error('DESKTOP_PRODUCER_LINEAGE_MISMATCH');
      const record = advancedRuntime.putTrusted(kind, parsed.value as unknown as AdvancedResource, 'trusted_native');
      res.status(202).json({ success: true, data: { resource: kind, record, persistence: 'memory_only', restartRecovery: 'partial' } });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Trusted advanced desktop evidence was rejected.' }); }
  };

  router.post('/api/edith/mobile/desktop-producer/pc-status', ingest(parseCrossDevicePcStatusV2, ({ context }, value) => runtime.crossDevice.updatePcStatus(context, value), REALTIME_EVENT_NAMES.CROSS_DEVICE_PC_STATUS_UPDATED));
  router.post('/api/edith/mobile/desktop-producer/live-view/frame-metadata', ingest(parseCrossDeviceLiveViewFrameMetadataV2, ({ context }, value) => {
    const liveView = runtime.crossDevice.ingestLiveViewFrame(context, value);
    service.putFrame(value);
    runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_FRAME_METADATA, value);
    return liveView;
  }, REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_STATUS));
  router.post('/api/edith/mobile/desktop-producer/wake-result', ingest(parseCrossDeviceWakeReadyV2, ({ context }, value) => runtime.crossDevice.putWakeResult(context, value), REALTIME_EVENT_NAMES.CROSS_DEVICE_WAKE_READY_STATUS));
  router.post('/api/edith/mobile/desktop-producer/transfer', ingest(parseCrossDeviceTransferV2, ({ context }, value) => runtime.crossDevice.putTransfer(context, value), REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS));
  router.post('/api/edith/mobile/desktop-producer/audio-handoff', ingest(parseCrossDeviceAudioHandoffV2, ({ context }, value) => runtime.crossDevice.putAudioHandoffState(context, value), REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS));
  router.post('/api/edith/mobile/desktop-producer/advanced/power-presence', advancedIngest('power-presence', parsePowerPresenceSnapshotV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/downloads', advancedIngest('downloads', parseDownloadButlerStatusV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/bookmarks', advancedIngest('bookmarks', parseVisualBookmarkV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/snapshots', advancedIngest('snapshots', parseWorkspaceSnapshotV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/scenes', advancedIngest('scenes', parseSceneProfileV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/watchers', advancedIngest('watchers', parseWatcherV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/shadow', advancedIngest('shadow', parseShadowModeV2));
  router.post('/api/edith/mobile/desktop-producer/advanced/retries', advancedIngest('retries', parseSmartRetryPlanV2));

  router.post('/api/edith/mobile/desktop-producer/retention-receipt', (req, res) => {
    try {
      const receipt = parseRetentionReceipt(req.body);
      if (!receipt) throw new Error('RETENTION_RECEIPT_INVALID');
      const auth = authenticate(req);
      service.putReceipt(auth.session.ownerSessionBindingId, receipt);
      res.status(202).json({ success: true, data: receipt });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Retention receipt was rejected.' }); }
  });

  router.post('/api/edith/mobile/desktop-producer/observation', (req, res) => {
    try {
      if (!exactObject(req.body, ['observation', 'artifact'])) throw new Error('DESKTOP_OBSERVATION_RECEIPT_INVALID');
      if (containsPixelPayload(req.body)) throw new Error('DESKTOP_PIXEL_PAYLOAD_FORBIDDEN');
      const observation = parseDesktopObservationV2(req.body.observation);
      const artifact = parseArtifact(req.body.artifact);
      if (observation.success === false || !artifact) throw new Error(observation.success === false ? observation.errorCode : 'DESKTOP_ARTIFACT_INVALID');
      const auth = authenticate(req);
      service.putObservation(auth.session.ownerSessionBindingId, observation.value, artifact);
      res.status(202).json({ success: true, data: { observationId: observation.value.observationId } });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Desktop observation evidence was rejected.' }); }
  });

  router.post('/api/edith/mobile/desktop-producer/error-receipt', (req, res) => {
    try {
      if (!exactObject(req.body, ['receiptId', 'errorCode', 'safeMessage', 'sourceType', 'sourceId', 'observedAt', 'retryAvailable'])) throw new Error('ERROR_RECEIPT_INVALID');
      const row = req.body as Record<string, unknown>;
      if (![row.receiptId, row.errorCode, row.sourceType, row.sourceId].every((item) => SAFE_ID.test(String(item ?? '')))
        || typeof row.safeMessage !== 'string' || row.safeMessage.length < 1 || row.safeMessage.length > 2_000
        || !Number.isFinite(Date.parse(String(row.observedAt))) || typeof row.retryAvailable !== 'boolean') throw new Error('ERROR_RECEIPT_INVALID');
      const auth = authenticate(req);
      const evidence = row as unknown as ErrorAttentionEvidenceV2 & { receiptId: string };
      service.putError(auth.session.ownerSessionBindingId, String(row.receiptId), evidence);
      res.status(202).json({ success: true, data: { receiptId: row.receiptId } });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Error evidence was rejected.' }); }
  });

  router.post('/api/edith/mobile/cross-device/result-cards/:deviceId', ...requireProtectedMutation, (req, res) => {
    try {
      if (killSwitchActive()) { service.revokeAll(); throw new Error('KILL_SWITCH_ACTIVE'); }
      if (!exactObject(req.body, ['cardId', 'source'])) throw new Error('RESULT_CARD_SOURCE_INVALID');
      const source = req.body.source;
      if (!exactObject(source, ['type', 'id']) || !SAFE_ID.test(String(source.id ?? ''))) throw new Error('RESULT_CARD_SOURCE_INVALID');
      const owner = getOwnerSession(req)!;
      const context = activeDeviceContext(runtime, req.params.deviceId, owner.bindingId);
      const options = {
        cardId: String(req.body.cardId),
        lineage: {
          ownerSessionBindingId: owner.bindingId,
          workspaceId: context.credential.workspaceId,
          sessionId: context.credential.sessionId,
          sourceDeviceId: runtime.store.serverId(),
          targetDeviceId: context.credential.deviceId,
        },
      };
      const cardProducer = producerFor(owner.bindingId);
      let card;
      if (source.type === 'task') card = taskService.createSharedResultCard(String(source.id), cardProducer, options);
      else if (source.type === 'knowledge') card = knowledgeGraphService.createSharedResultCard(String(source.id), cardProducer, options);
      else if (source.type === 'research') {
        const run = getPhase4ApiRuntime().persistence.getResearchRun(String(source.id));
        if (run) card = cardProducer.fromResearchRun(run, options);
      } else if (source.type === 'transfer') card = cardProducer.fromTransfer(runtime.crossDevice.getTransfer(context, String(source.id)), options);
      else if (source.type === 'screenshot') {
        const evidence = service.getObservation(String(source.id), owner.bindingId);
        if (evidence) card = cardProducer.fromScreenshot(evidence.observation, evidence.artifact, options);
      } else if (source.type === 'error') {
        const evidence = service.getError(String(source.id), owner.bindingId);
        if (evidence) card = cardProducer.fromError(evidence, options);
      } else throw new Error('RESULT_CARD_SOURCE_INVALID');
      if (!card) throw new Error('RESULT_CARD_SOURCE_NOT_FOUND');
      const stored = runtime.crossDevice.putResultCard(context, card);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_RESULT_CARD_UPDATED, stored);
      res.status(201).json({ success: true, data: { card: stored } });
    } catch (error) { const mapped = errorStatus(error); res.status(mapped.status).json({ success: false, errorCode: mapped.errorCode, safeMessage: 'Result card publication was rejected.' }); }
  });

  return router;
}
