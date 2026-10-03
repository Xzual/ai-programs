import { Router, type Request } from 'express';
import {
  REALTIME_EVENT_NAMES,
  parseCrossDeviceAudioHandoffV2,
  parseCrossDeviceClipboardRequestV2,
  parseCrossDeviceHandoffIntentV2,
  parseCrossDeviceQuietHoursV2,
  parseCrossDeviceTransferV2,
  parseMobileRemoteCommandResultV2,
  parseMobileRemoteCommandV2,
  type MobileRemoteCommandNameV2,
  type MobileRemoteCommandV2,
} from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import { getOwnerSession, requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { createDeviceAuth, encryptedBody, encryptedResponse, mobileContext, requireSecureMobileTransport } from '../mobile/middleware';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import type { MobileSessionContext } from '../mobile/types';

function crossDeviceError(error: unknown) {
  const errorCode = error instanceof Error ? error.message : 'CROSS_DEVICE_REQUEST_FAILED';
  const status = errorCode.includes('NOT_FOUND') || errorCode.includes('UNAVAILABLE') ? 404
    : errorCode.includes('CONFLICT') || errorCode.includes('REPLAY') || errorCode.includes('GAP') || errorCode.includes('ALREADY') ? 409
      : errorCode.includes('KILL_SWITCH') ? 423 : errorCode.includes('CONFIGURATION_REQUIRED') ? 428 : 400;
  return { status, body: { success: false, errorCode, safeMessage: 'The cross-device request was rejected.' } };
}

function activeDeviceContext(runtime: MobileRuntime, deviceId: string): MobileSessionContext {
  const device = runtime.store.getDevice(deviceId);
  const credential = runtime.store.listCredentials().find((item) => item.deviceId === deviceId && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
  if (!device || !credential) throw new Error('DEVICE_NOT_FOUND');
  return runtime.pairing.revalidateContext({ device, credential });
}

function readCommand(req: Request, runtime: MobileRuntime, purpose: string, expected: MobileRemoteCommandNameV2): MobileRemoteCommandV2 {
  const context = mobileContext(req);
  const parsed = parseMobileRemoteCommandV2(encryptedBody<MobileRemoteCommandV2>(req, runtime, purpose));
  if (parsed.success === false) throw new Error(parsed.errorCode);
  const command = parsed.value;
  if (command.command !== expected || command.deviceId !== context.credential.deviceId || command.workspaceId !== context.credential.workspaceId || command.sessionId !== context.credential.sessionId) throw new Error('MOBILE_REMOTE_COMMAND_BINDING_INVALID');
  runtime.pairing.acceptCommand(context, expected, command.sequence);
  return command;
}

function requireOperational(killSwitchActive: () => boolean): void {
  if (killSwitchActive()) throw new Error('KILL_SWITCH_ACTIVE');
}

export function createMobileCrossDeviceRouter(options: { runtime?: MobileRuntime; killSwitchActive?: () => boolean } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const killSwitchActive = options.killSwitchActive ?? (() => killSwitchService.status().active);
  const deviceAuth = createDeviceAuth(runtime);
  router.use('/api/mobile', requireSecureMobileTransport);

  router.get('/api/mobile/cross-device/capabilities', deviceAuth, (req, res) => {
    res.json(encryptedResponse(req, runtime, 'cross_device.capabilities', {
      clipboard: 'available', offlineQueue: 'available', smartHandoff: 'available', resultCards: 'available', audioHandoff: 'available',
      mobileToPcTransfer: 'available', pcToMobileTransfer: 'configuration_required', liveView: 'configuration_required', wakeOnLan: 'configuration_required', pcStatus: 'configuration_required',
      quietHours: 'metadata_only', persistence: 'memory_only',
    }));
  });

  router.post('/api/mobile/cross-device/clipboard', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      const command = readCommand(req, runtime, 'cross_device.clipboard.publish', 'clipboard.publish');
      const parsed = parseCrossDeviceClipboardRequestV2(command.payload?.request);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const metadata = runtime.crossDevice.offerClipboard(mobileContext(req), parsed.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_CLIPBOARD_STATUS, metadata);
      res.status(201).json(encryptedResponse(req, runtime, 'cross_device.clipboard.published', { metadata }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/clipboard/:clipboardId/consume', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      readCommand(req, runtime, 'cross_device.clipboard.consume', 'clipboard.consume');
      const result = runtime.crossDevice.consumeClipboard(mobileContext(req), req.params.clipboardId);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_CLIPBOARD_STATUS, result.metadata);
      res.json(encryptedResponse(req, runtime, 'cross_device.clipboard.consumed', result));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/offline-queue', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      const command = readCommand(req, runtime, 'cross_device.offline_queue.enqueue', 'offline_queue.manage');
      const queued = parseMobileRemoteCommandV2(command.payload?.command);
      if (queued.success === false) throw new Error(queued.errorCode);
      const item = runtime.crossDevice.enqueue(mobileContext(req), queued.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS, item);
      res.status(201).json(encryptedResponse(req, runtime, 'cross_device.offline_queue.enqueued', { item }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/offline-queue/:queueItemId/cancel', deviceAuth, (req, res) => {
    try {
      const command = readCommand(req, runtime, 'cross_device.offline_queue.cancel', 'offline_queue.manage');
      const item = runtime.crossDevice.cancelQueue(mobileContext(req), req.params.queueItemId);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS, item, command.commandId);
      res.json(encryptedResponse(req, runtime, 'cross_device.offline_queue.cancelled', { item }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/offline-queue/dispatch', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      readCommand(req, runtime, 'cross_device.offline_queue.dispatch', 'offline_queue.manage');
      const items = runtime.crossDevice.dispatchPending(mobileContext(req));
      for (const entry of items) runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS, entry.item);
      res.json(encryptedResponse(req, runtime, 'cross_device.offline_queue.dispatching', { items }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/offline-queue/:queueItemId/result', deviceAuth, (req, res) => {
    try {
      const command = readCommand(req, runtime, 'cross_device.offline_queue.result', 'offline_queue.manage');
      const parsed = parseMobileRemoteCommandResultV2(command.payload?.result);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const item = runtime.crossDevice.completeQueue(mobileContext(req), req.params.queueItemId, parsed.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS, item);
      res.json(encryptedResponse(req, runtime, 'cross_device.offline_queue.completed', { item }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/handoffs', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      const command = readCommand(req, runtime, 'cross_device.handoff.create', 'handoff.manage');
      const parsed = parseCrossDeviceHandoffIntentV2(command.payload?.handoff);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const handoff = runtime.crossDevice.createHandoff(mobileContext(req), parsed.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS, handoff);
      res.status(201).json(encryptedResponse(req, runtime, 'cross_device.handoff.created', { handoff }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/handoffs/:handoffId/ack', deviceAuth, (req, res) => {
    try {
      readCommand(req, runtime, 'cross_device.handoff.ack', 'handoff.manage');
      const handoff = runtime.crossDevice.acknowledgeHandoff(mobileContext(req), req.params.handoffId);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS, handoff);
      res.json(encryptedResponse(req, runtime, 'cross_device.handoff.acknowledged', { handoff }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/cross-device/result-cards', deviceAuth, (req, res) => {
    try { res.json(encryptedResponse(req, runtime, 'cross_device.result_cards', { cards: runtime.crossDevice.listResultCards(mobileContext(req)) })); }
    catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/audio-handoffs', deviceAuth, (req, res) => {
    try {
      requireOperational(killSwitchActive);
      const command = readCommand(req, runtime, 'cross_device.audio_handoff.request', 'audio_handoff.manage');
      const parsed = parseCrossDeviceAudioHandoffV2(command.payload?.handoff);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const handoff = runtime.crossDevice.requestAudioHandoff(mobileContext(req), parsed.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS, handoff);
      res.status(201).json(encryptedResponse(req, runtime, 'cross_device.audio_handoff.requested', { handoff }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/audio-handoffs/:handoffId/ack', deviceAuth, (req, res) => {
    try {
      const command = readCommand(req, runtime, 'cross_device.audio_handoff.ack', 'audio_handoff.manage');
      const handoff = runtime.crossDevice.acknowledgeAudioHandoff(mobileContext(req), req.params.handoffId, Number(command.payload?.epoch));
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS, handoff);
      res.json(encryptedResponse(req, runtime, 'cross_device.audio_handoff.active', { handoff }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/cross-device/audio-handoffs/:handoffId/release', deviceAuth, (req, res) => {
    try {
      const command = readCommand(req, runtime, 'cross_device.audio_handoff.release', 'audio_handoff.manage');
      const handoff = runtime.crossDevice.releaseAudioHandoff(mobileContext(req), req.params.handoffId, Number(command.payload?.epoch));
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS, handoff);
      res.json(encryptedResponse(req, runtime, 'cross_device.audio_handoff.released', { handoff }));
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/cross-device/pc-status', deviceAuth, (req, res) => {
    try { res.json(encryptedResponse(req, runtime, 'cross_device.pc_status', { status: runtime.crossDevice.getPcStatus(mobileContext(req)) })); }
    catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/edith/mobile/cross-device/status', requireOwnerSession, (_req, res) => res.json({ success: true, data: runtime.crossDevice.status() }));

  router.post('/api/edith/mobile/cross-device/live-view/:deviceId/request', ...requireProtectedMutation, (req, res) => {
    try {
      const context = activeDeviceContext(runtime, req.params.deviceId);
      const liveView = runtime.crossDevice.requestLiveView(context, {});
      res.status(201).json({ success: true, data: { liveView } });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/mobile/cross-device/live-view/:liveViewId/approve', ...requireProtectedMutation, (req, res) => {
    try {
      const liveView = runtime.crossDevice.approveLiveView(getOwnerSession(req)!.bindingId, req.params.liveViewId);
      res.json({ success: true, data: { liveView } });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/mobile/cross-device/live-view/:liveViewId/stop', ...requireProtectedMutation, (req, res) => {
    try {
      const liveView = runtime.crossDevice.stopLiveViewByOwner(getOwnerSession(req)!.bindingId, req.params.liveViewId);
      res.json({ success: true, data: { liveView } });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/mobile/cross-device/wake/:deviceId', ...requireProtectedMutation, (req, res) => {
    try { res.status(428).json({ success: false, errorCode: runtime.crossDevice.requestWake(activeDeviceContext(runtime, req.params.deviceId)).errorCode, safeMessage: 'Wake-on-LAN is not configured; no wake packet was sent.' }); }
    catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/mobile/cross-device/transfers/:deviceId', ...requireProtectedMutation, (req, res) => {
    try {
      const parsed = parseCrossDeviceTransferV2(req.body);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const transfer = runtime.crossDevice.putTransfer(activeDeviceContext(runtime, req.params.deviceId), parsed.value);
      res.status(transfer.status === 'configuration_required' ? 428 : 201).json({ success: transfer.status !== 'configuration_required', data: { transfer }, errorCode: transfer.errorCode });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/mobile/cross-device/handoffs/:deviceId', ...requireProtectedMutation, (req, res) => {
    try {
      const parsed = parseCrossDeviceHandoffIntentV2(req.body);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const handoff = runtime.crossDevice.createHandoff(activeDeviceContext(runtime, req.params.deviceId), parsed.value);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS, handoff);
      res.status(201).json({ success: true, data: { handoff } });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.put('/api/edith/mobile/cross-device/quiet-hours', ...requireProtectedMutation, (req, res) => {
    try {
      const parsed = parseCrossDeviceQuietHoursV2(req.body);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      res.json({ success: true, data: { quietHours: runtime.crossDevice.setQuietHours(parsed.value, getOwnerSession(req)!.bindingId) } });
    } catch (error) { const mapped = crossDeviceError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/edith/mobile/cross-device/quiet-hours/:workspaceId', requireOwnerSession, (req, res) => {
    const quietHours = runtime.crossDevice.getQuietHours(req.params.workspaceId);
    if (!quietHours) return res.status(404).json({ success: false, errorCode: 'CROSS_DEVICE_QUIET_HOURS_NOT_FOUND', safeMessage: 'Quiet-hours metadata was not found.' });
    res.json({ success: true, data: { quietHours } });
  });

  return router;
}
