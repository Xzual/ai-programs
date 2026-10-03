import { createHash } from 'node:crypto';
import { Router } from 'express';
import { EDITH_CONTRACT_AMENDMENT, REALTIME_EVENT_NAMES, TASK_CONTRACT_VERSION, parseEncryptedFileChunkV2, parseMobileRemoteCommandResultV2, parseMobileRemoteCommandV2, type MobileRemoteCommandV2 } from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import { createDeviceAuth, encryptedBody, encryptedResponse, mobileContext, requireSecureMobileTransport } from '../mobile/middleware';
import type { FileChunkManifestV2 } from '../../src/edith/contracts';

function transferError(error: unknown) {
  const errorCode = error instanceof Error ? error.message : 'TRANSFER_FAILED';
  const status = errorCode.includes('NOT_FOUND') ? 404 : errorCode.includes('REPLAY') || errorCode.includes('GAP') || errorCode.includes('ALREADY') || errorCode.includes('IDEMPOTENCY') ? 409 : errorCode.includes('KILL_SWITCH') ? 423 : 400;
  return { status, body: { success: false, errorCode, safeMessage: 'The encrypted file transfer request was rejected.' } };
}

interface CreatedTransfer {
  transferId: string;
  fingerprint: string;
}

export function createMobileTransfersRouter(options: { runtime?: MobileRuntime; killSwitchActive?: () => boolean } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const deviceAuth = createDeviceAuth(runtime);
  const killSwitchActive = options.killSwitchActive ?? (() => killSwitchService.status().active);
  const created = new Map<string, CreatedTransfer>();

  router.use('/api/mobile', requireSecureMobileTransport);

  router.post('/api/mobile/transfers', deviceAuth, (req, res) => {
    try {
      const context = mobileContext(req);
      const parsedCommand = parseMobileRemoteCommandV2(encryptedBody<MobileRemoteCommandV2>(req, runtime, 'file.transfer.create', 'transfer'));
      if (parsedCommand.success === false) throw new Error(parsedCommand.errorCode);
      const command = parsedCommand.value;
      if (command.command !== 'file.upload' || command.deviceId !== context.credential.deviceId || command.workspaceId !== context.credential.workspaceId || command.sessionId !== context.credential.sessionId) throw new Error('MOBILE_REMOTE_COMMAND_BINDING_INVALID');
      const payload = command.payload as {
        fileName: string;
        mediaType: string;
        sizeBytes: number;
        sha256: string;
        manifest: FileChunkManifestV2;
      };
      runtime.pairing.acceptCommand(context, 'file.upload', command.sequence);
      if (killSwitchActive()) throw new Error('KILL_SWITCH_ACTIVE');
      const idempotencyPayload = { ...command, sequence: undefined, idempotencyKey: undefined };
      const fingerprint = createHash('sha256').update(JSON.stringify(idempotencyPayload)).digest('hex');
      const key = `${context.device.device.deviceId}:${command.idempotencyKey}`;
      const prior = created.get(key);
      if (prior && prior.fingerprint !== fingerprint) throw new Error('DEVICE_IDEMPOTENCY_CONFLICT');
      const descriptor = prior
        ? runtime.transfers.status(context, prior.transferId)
        : runtime.transfers.create(context, {
          fileName: payload.fileName,
          mediaType: payload.mediaType,
          sizeBytes: payload.sizeBytes,
          sha256: payload.sha256,
          manifest: payload.manifest,
          keyFingerprint: runtime.crypto.sessionKeyFingerprint(context.credential.sessionId) ?? (() => { throw new Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED'); })(),
        });
      created.set(key, { transferId: descriptor.transferId, fingerprint });
      if (created.size > 2_000) created.delete(created.keys().next().value!);
      const crossDeviceTransfer = runtime.crossDevice.syncMobileTransfer(context, descriptor);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS, crossDeviceTransfer);
      const commandResult = parseMobileRemoteCommandResultV2({ contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, commandId: command.commandId, deviceId: command.deviceId, workspaceId: command.workspaceId, sessionId: command.sessionId, status: 'completed', completedAt: new Date().toISOString(), result: { transferId: descriptor.transferId } });
      if (commandResult.success === false) throw new Error(commandResult.errorCode);
      res.status(prior ? 200 : 201).json(encryptedResponse(req, runtime, 'file.transfer.created', { descriptor, crossDeviceTransfer, idempotentReplay: Boolean(prior), commandResult: commandResult.value }, 'transfer'));
    } catch (error) { const mapped = transferError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.put('/api/mobile/transfers/:transferId/chunks/:index', deviceAuth, (req, res) => {
    try {
      const context = mobileContext(req);
      const index = Number(req.params.index);
      if (!Number.isSafeInteger(index) || index < 0) throw new Error('TRANSFER_CHUNK_INDEX_INVALID');
      const purpose = `file.transfer.chunk:${req.params.transferId}:${index}`;
      const parsedCommand = parseMobileRemoteCommandV2(encryptedBody<MobileRemoteCommandV2>(req, runtime, purpose, 'transfer'));
      if (parsedCommand.success === false) throw new Error(parsedCommand.errorCode);
      const command = parsedCommand.value;
      const chunk = parseEncryptedFileChunkV2(command.payload?.chunk);
      if (chunk.success === false) throw new Error(chunk.errorCode);
      if (command.command !== 'file.upload' || command.deviceId !== context.credential.deviceId || command.workspaceId !== context.credential.workspaceId || command.sessionId !== context.credential.sessionId || chunk.value.transferId !== req.params.transferId || chunk.value.index !== index || chunk.value.deviceId !== command.deviceId || chunk.value.sessionId !== command.sessionId || chunk.value.aadPurpose !== purpose) throw new Error('MOBILE_REMOTE_COMMAND_BINDING_INVALID');
      runtime.pairing.acceptCommand(context, 'file.upload', command.sequence);
      if (killSwitchActive()) throw new Error('KILL_SWITCH_ACTIVE');
      const data = String(command.payload?.data ?? '');
      const decoded = Buffer.from(data, 'base64');
      if (decoded.length !== chunk.value.plaintextSizeBytes || createHash('sha256').update(decoded).digest('hex') !== chunk.value.plaintextSha256) throw new Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH');
      const descriptor = runtime.transfers.acceptChunk(context, req.params.transferId, index, data);
      runtime.realtime.publish('file_transfer.status.v2', { transferId: descriptor.transferId, status: descriptor.status });
      const crossDeviceTransfer = runtime.crossDevice.syncMobileTransfer(context, descriptor);
      runtime.realtime.publish(REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS, crossDeviceTransfer);
      const commandResult = parseMobileRemoteCommandResultV2({ contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, commandId: command.commandId, deviceId: command.deviceId, workspaceId: command.workspaceId, sessionId: command.sessionId, status: 'completed', completedAt: new Date().toISOString(), result: { transferId: descriptor.transferId, chunkIndex: index } });
      if (commandResult.success === false) throw new Error(commandResult.errorCode);
      res.json(encryptedResponse(req, runtime, `${purpose}.result`, { descriptor, crossDeviceTransfer, commandResult: commandResult.value }, 'transfer'));
    } catch (error) { const mapped = transferError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/transfers/:transferId', deviceAuth, (req, res) => {
    try {
      const descriptor = runtime.transfers.status(mobileContext(req), req.params.transferId);
      res.json(encryptedResponse(req, runtime, 'file.transfer.status', { descriptor }, 'transfer'));
    } catch (error) { const mapped = transferError(error); res.status(mapped.status).json(mapped.body); }
  });

  return router;
}
