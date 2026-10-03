import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { EDITH_CONTRACT_AMENDMENT, REALTIME_EVENT_NAMES, TASK_CONTRACT_VERSION, deriveTaskProgress, normalizeLegacyTask, parseMobileRemoteCommandResultV2, parseMobileRemoteCommandV2, projectTaskEventsV2, type MobileRemoteCommandV2 } from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import { permissionService } from '../../src/edith/permissionService';
import { taskService } from '../../src/edith/taskService';
import { taskQueueService } from '../../src/edith/taskQueueService';
import { createStoredTask } from '../../src/edith/taskStore';
import { redactSensitiveString, sanitizeSensitiveValue } from '../../src/edith/securityRedaction';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import { createDeviceAuth, encryptedBody, encryptedResponse, mobileContext, requireSecureMobileTransport } from '../mobile/middleware';
import type { MobileCapabilitiesStatus, MobileCommand } from '../mobile/types';

interface CommandPayload {
  sequence: number;
  idempotencyKey: string;
  commandId: string;
  riskLevel: 0 | 1;
  [key: string]: unknown;
}

interface CachedCommand {
  fingerprint: string;
  data: unknown;
}

function safeText(value: unknown, max = 1_000): string {
  return redactSensitiveString(String(value ?? '').normalize('NFKC').trim()).replace(/(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var)\/)[^\s`"']+/g, '[REDACTED_LOCAL_PATH]').slice(0, max);
}

function taskView(task: any) {
  const normalized = normalizeLegacyTask(task) as any;
  return sanitizeSensitiveValue({
    id: normalized.id,
    title: safeText(normalized.title, 200),
    objective: safeText(normalized.objective, 1_000),
    status: normalized.status,
    priority: normalized.priority,
    riskLevel: normalized.riskLevel,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    revision: normalized.revision,
    progress: deriveTaskProgress(normalized),
    result: normalized.result ? safeText(normalized.result, 1_000) : undefined,
  });
}

function commandError(error: unknown) {
  const errorCode = error instanceof Error ? error.message : 'MOBILE_COMMAND_FAILED';
  const status = errorCode.includes('NOT_FOUND') ? 404 : errorCode.includes('KILL_SWITCH') ? 423 : errorCode.includes('NOT_ALLOWED') || errorCode.includes('POLICY') ? 403 : errorCode.includes('REPLAY') || errorCode.includes('GAP') || errorCode.includes('IDEMPOTENCY') ? 409 : 400;
  return { status, body: { success: false, errorCode, safeMessage: 'The mobile command was rejected.' } };
}

export function createMobileTasksRouter(options: {
  runtime?: MobileRuntime;
  killSwitchActive?: () => boolean;
  ownerPolicyAllows?: () => boolean;
  activateEmergencyStop?: (reason: string, actor: string) => unknown;
} = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const deviceAuth = createDeviceAuth(runtime);
  const cache = new Map<string, CachedCommand>();
  const killSwitchActive = options.killSwitchActive ?? (() => killSwitchService.status().active);
  const ownerPolicyAllows = options.ownerPolicyAllows ?? (() => permissionService.getPolicy().mode !== 'deny');
  const activateEmergencyStop = options.activateEmergencyStop ?? ((reason, actor) => killSwitchService.activate(reason, actor));

  router.use('/api/mobile', requireSecureMobileTransport);

  const execute = <T>(req: any, command: MobileCommand, purpose: string, operation: (payload: CommandPayload) => T): T => {
    const context = mobileContext(req);
    const parsed = parseMobileRemoteCommandV2(encryptedBody<MobileRemoteCommandV2>(req, runtime, purpose));
    if (parsed.success === false) throw new Error(parsed.errorCode);
    const wire = parsed.value;
    if (wire.command !== command || wire.deviceId !== context.credential.deviceId || wire.workspaceId !== context.credential.workspaceId || wire.sessionId !== context.credential.sessionId) throw new Error('MOBILE_REMOTE_COMMAND_BINDING_INVALID');
    const payload: CommandPayload = { ...(wire.payload ?? {}), sequence: wire.sequence, idempotencyKey: wire.idempotencyKey, commandId: wire.commandId, riskLevel: wire.riskLevel };
    const fingerprintPayload = { ...wire };
    delete fingerprintPayload.sequence;
    delete fingerprintPayload.idempotencyKey;
    const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');
    const cacheKey = `${context.device.device.deviceId}:${command}:${wire.idempotencyKey}`;
    const prior = cache.get(cacheKey);
    runtime.pairing.acceptCommand(context, command, wire.sequence);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error('DEVICE_IDEMPOTENCY_CONFLICT');
      return prior.data as T;
    }
    if (command !== 'emergency_stop') {
      if (killSwitchActive()) throw new Error('KILL_SWITCH_ACTIVE');
      if (!ownerPolicyAllows()) throw new Error('OWNER_POLICY_DENIED');
    }
    const operationData = operation(payload);
    const commandResult = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, commandId: wire.commandId, deviceId: wire.deviceId, workspaceId: wire.workspaceId, sessionId: wire.sessionId, status: 'completed' as const, completedAt: new Date().toISOString(), result: { accepted: true } };
    const parsedResult = parseMobileRemoteCommandResultV2(commandResult);
    if (parsedResult.success === false) throw new Error(parsedResult.errorCode);
    const data = typeof operationData === 'object' && operationData !== null ? { ...operationData, commandResult: parsedResult.value } as T : operationData;
    cache.set(cacheKey, { fingerprint, data });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return data;
  };

  router.get('/api/mobile/capabilities', deviceAuth, (req, res) => {
    const capabilities: MobileCapabilitiesStatus = {
      pairing: true,
      realtime: true,
      encryptedEnvelope: true,
      resumableFileTransfer: true,
      remoteTaskControl: 'low_risk_allowlist',
      remoteView: 'disabled',
      wakeOnLan: 'configuration_required',
      pushNotifications: 'configuration_required',
      destructiveDeviceControl: 'disabled',
      tlsRequiredForRemoteTransport: true,
      crossDevice: { clipboard: 'available', offlineQueue: 'available', smartHandoff: 'available', resultCards: 'available', audioHandoff: 'available', mobileToPcTransfer: 'available', pcToMobileTransfer: 'configuration_required', liveView: 'configuration_required', wakeOnLan: 'configuration_required', pcStatus: 'configuration_required' },
    };
    res.json(encryptedResponse(req, runtime, 'capabilities.status', capabilities));
  });

  router.get('/api/mobile/tasks', deviceAuth, (req, res) => {
    try {
      const context = mobileContext(req);
      if (!context.device.allowedCommands.includes('task.list')) throw new Error('DEVICE_COMMAND_NOT_ALLOWED');
      const bounded = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      res.json(encryptedResponse(req, runtime, 'task.list.result', { tasks: taskService.listTasks().slice(0, bounded).map(taskView), limit: bounded }));
    } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/tasks/:taskId', deviceAuth, (req, res) => {
    try {
      const context = mobileContext(req);
      if (!context.device.allowedCommands.includes('task.detail')) throw new Error('DEVICE_COMMAND_NOT_ALLOWED');
      const task = taskService.getTask(req.params.taskId);
      if (!task) throw new Error('TASK_NOT_FOUND');
      res.json(encryptedResponse(req, runtime, 'task.detail.result', { task: taskView(task) }));
    } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/tasks/:taskId/activity', deviceAuth, (req, res) => {
    try {
      const context = mobileContext(req);
      if (!context.device.allowedCommands.includes('task.activity')) throw new Error('DEVICE_COMMAND_NOT_ALLOWED');
      const task = taskService.getTask(req.params.taskId);
      if (!task) throw new Error('TASK_NOT_FOUND');
      const normalized = normalizeLegacyTask(task) as any;
      const projection = projectTaskEventsV2(normalized);
      res.json(encryptedResponse(req, runtime, 'task.activity.result', {
        task: taskView(normalized),
        events: projection.events,
        eventDiagnostics: projection.diagnostics,
        timeline: (normalized.timeline ?? []).slice(-100).map((item: any) => ({ ...item, message: safeText(item.message, 500) })),
      }));
    } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/tasks', deviceAuth, (req, res) => {
    try {
      const data = execute(req, 'task.create_low_risk', 'task.create', (payload) => {
        const title = safeText(payload.title, 160);
        const objective = safeText(payload.objective, 1_000);
        const originalUserRequest = safeText(payload.originalUserRequest ?? objective, 1_000);
        const riskLevel = Number(payload.riskLevel ?? 0);
        if (!title || !objective || ![0, 1].includes(riskLevel)) throw new Error('REMOTE_TASK_LOW_RISK_REQUIRED');
        if (payload.toolsRequired !== undefined || payload.permissionsRequired !== undefined) throw new Error('REMOTE_TASK_CAPABILITY_ESCALATION_FORBIDDEN');
        const task = createStoredTask({ title, objective, originalUserRequest, toolsRequired: [], permissionsRequired: [], riskLevel: riskLevel as 0 | 1 });
        runtime.realtime.publishTaskCreated(task.id, task.status, task.revision);
        return { task: taskView(task) };
      });
      res.status(201).json(encryptedResponse(req, runtime, 'task.create.result', data));
    } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
  });

  const stateCommand = (route: string, command: Extract<MobileCommand, 'task.pause' | 'task.resume' | 'task.cancel'>, purpose: string) => {
    router.post(route, deviceAuth, (req, res) => {
      try {
        const data = execute(req, command, purpose, (payload) => {
          const before = taskService.getTask(req.params.taskId);
          if (!before) throw new Error('TASK_NOT_FOUND');
          const task = command === 'task.pause'
            ? taskQueueService.pause(req.params.taskId, safeText(payload.reason ?? 'Paused from trusted mobile device.', 300))
            : command === 'task.resume'
              ? taskQueueService.resume(req.params.taskId)
              : taskQueueService.cancel(req.params.taskId, safeText(payload.reason ?? 'Cancelled from trusted mobile device.', 300), `mobile:${mobileContext(req).device.device.deviceId}`);
          if (!task) throw new Error('TASK_NOT_FOUND');
          runtime.realtime.publishTaskStatus(task.id, before.status, task.status, task.revision, `MOBILE_${command.split('.')[1].toUpperCase()}`);
          return { task: taskView(task) };
        });
        res.json(encryptedResponse(req, runtime, `${purpose}.result`, data));
      } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
    });
  };
  stateCommand('/api/mobile/tasks/:taskId/pause', 'task.pause', 'task.pause');
  stateCommand('/api/mobile/tasks/:taskId/resume', 'task.resume', 'task.resume');
  stateCommand('/api/mobile/tasks/:taskId/cancel', 'task.cancel', 'task.cancel');

  router.post('/api/mobile/emergency-stop', deviceAuth, (req, res) => {
    try {
      const data = execute(req, 'emergency_stop', 'emergency_stop.activate', (payload) => {
        const context = mobileContext(req);
        const state = activateEmergencyStop(safeText(payload.reason ?? 'Emergency stop from trusted mobile device.', 300), `mobile:${context.device.device.deviceId}`);
        runtime.realtime.publish(REALTIME_EVENT_NAMES.EMERGENCY_STOP_ACTIVATED, {
          contractVersion: TASK_CONTRACT_VERSION,
          amendment: EDITH_CONTRACT_AMENDMENT,
          eventId: `emergency-${randomUUID()}`,
          deviceId: context.device.device.deviceId,
          workspaceId: context.credential.workspaceId,
          sessionId: context.credential.sessionId,
          activatedAt: new Date().toISOString(),
          reasonCode: 'MOBILE_EMERGENCY_STOP',
          killSwitchActive: true,
        });
        return { state };
      });
      res.json(encryptedResponse(req, runtime, 'emergency_stop.result', data));
    } catch (error) { const mapped = commandError(error); res.status(mapped.status).json(mapped.body); }
  });

  return router;
}
