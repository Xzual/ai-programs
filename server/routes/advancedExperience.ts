import { Router, type Request } from 'express';
import {
  parseCapsuleContextCandidateV2,
  parseCommunicationPolicyV2,
  parseCompareChangeV2,
  parseDownloadButlerStatusV2,
  parseGhostTaskV2,
  parseHistoryRetentionPolicyV2,
  parseMissionMemoryV2,
  parseOrchestrationPlanV2,
  parsePowerPresenceSnapshotV2,
  parsePriorityTaskPolicyV2,
  parseRecentContextEventV2,
  parseSceneProfileV2,
  parseShadowModeV2,
  parseSmartRetryPlanV2,
  parseVisualBookmarkV2,
  parseWatcherV2,
  parseWorkspaceRestorePlanV2,
  parseWorkspaceSnapshotV2,
  type ParseResult,
} from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import { getAdvancedExperienceRuntime, type AdvancedExperienceRuntime, type AdvancedResource, type AdvancedResourceKind } from '../advanced/runtime';
import { getOwnerSession, requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { createDeviceAuth, encryptedResponse, mobileContext, requireSecureMobileTransport } from '../mobile/middleware';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import { getAdvancedProducerComposition, type AdvancedProducerComposition } from '../advanced/producerComposition';

type Parser = (value: unknown) => ParseResult<unknown>;
const parsers: Partial<Record<AdvancedResourceKind, Parser>> = {
  priority: parsePriorityTaskPolicyV2,
  shadow: parseShadowModeV2,
  ghosts: parseGhostTaskV2,
  'mission-memories': parseMissionMemoryV2,
  bookmarks: parseVisualBookmarkV2,
  'recent-context': parseRecentContextEventV2,
  snapshots: parseWorkspaceSnapshotV2,
  'restore-plans': parseWorkspaceRestorePlanV2,
  scenes: parseSceneProfileV2,
  watchers: parseWatcherV2,
  comparisons: parseCompareChangeV2,
  communication: parseCommunicationPolicyV2,
  orchestration: parseOrchestrationPlanV2,
  retries: parseSmartRetryPlanV2,
  downloads: parseDownloadButlerStatusV2,
  'power-presence': parsePowerPresenceSnapshotV2,
  'history-policy': parseHistoryRetentionPolicyV2,
};

function workspaceId(req: Request): string {
  const value = String(req.query.workspaceId ?? req.body?.workspaceId ?? '');
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw new Error('WORKSPACE_ID_INVALID');
  return value;
}

function mappedError(error: unknown) {
  const errorCode = error instanceof Error ? error.message : 'ADVANCED_RUNTIME_REJECTED';
  const status = errorCode.includes('NOT_FOUND') ? 404
    : errorCode.includes('REVISION') || errorCode.includes('CONFLICT') || errorCode.includes('MISMATCH') ? 409
      : errorCode.includes('CONFIGURATION_REQUIRED') ? 428 : errorCode.includes('KILL_SWITCH') ? 423 : 400;
  return { status, body: { success: false, errorCode, safeMessage: 'The advanced runtime request was rejected.' } };
}

export function createAdvancedExperienceRouter(options: { advancedRuntime?: AdvancedExperienceRuntime; mobileRuntime?: MobileRuntime; producer?: AdvancedProducerComposition } = {}): Router {
  const router = Router();
  const runtime = options.advancedRuntime ?? getAdvancedExperienceRuntime();
  const mobileRuntime = options.mobileRuntime ?? getMobileRuntime();
  const deviceAuth = createDeviceAuth(mobileRuntime);
  const producer = options.producer ?? getAdvancedProducerComposition();

  const producerKeys: Record<string, string[]> = {
    'mission-memory': ['workspaceId', 'sourceTaskId', 'sourcePlaybookRunId', 'sourceResearchRunId', 'avoidRouteCodes'],
    'recent-context': ['workspaceId', 'retentionDays', 'searchableKinds'],
    outcome: ['workspaceId', 'taskIds', 'researchRunIds', 'playbookRunIds', 'generatedKnowledgeNodeIds', 'skillIds'],
    workspace: ['workspaceId', 'taskIds', 'skillIds'],
    retry: ['workspaceId', 'taskId', 'failureClass', 'attempts'],
    watcher: ['workspaceId', 'watcherId', 'sourceRef', 'kind', 'trigger'],
    communication: ['workspaceId', 'autoBrief', 'maxSentences', 'voicePresence'],
    ghost: ['workspaceId', 'taskId'],
  };

  router.get('/api/mobile/advanced/state', requireSecureMobileTransport, deviceAuth, (req, res) => {
    const context = mobileContext(req);
    const state = runtime.state(context.device.ownerBinding.ownerSessionId, context.credential.workspaceId);
    const safeState = {
      priority: state.priority,
      ghosts: state.ghosts,
      watchers: state.watchers,
      downloads: state.downloads,
      communication: state.communication,
      capsuleSelection: state['capsule-selection'],
    };
    res.json(encryptedResponse(req, mobileRuntime, 'advanced.state.read', {
      status: runtime.capabilityStatus(),
      state: safeState,
      deviceScoped: true,
      mutationAvailable: false,
    }));
  });

  router.get('/api/edith/advanced/status', requireOwnerSession, (_req, res) => {
    res.json({ success: true, status: runtime.capabilityStatus() });
  });

  router.get('/api/edith/advanced/state', requireOwnerSession, (req, res) => {
    try {
      const owner = getOwnerSession(req)!;
      res.json({ success: true, status: runtime.capabilityStatus(), state: runtime.state(owner.bindingId, workspaceId(req)) });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/edith/advanced/history/search', requireOwnerSession, (req, res) => {
    try {
      const owner = getOwnerSession(req)!;
      const results = runtime.searchHistory(owner.bindingId, workspaceId(req), String(req.query.q ?? '').slice(0, 200));
      res.json({ success: true, results, privateHistoryIncluded: false });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/advanced/produce/:operation', ...requireProtectedMutation, async (req, res) => {
    try {
      if (killSwitchService.status().active) throw new Error('KILL_SWITCH_ACTIVE');
      const allowed = producerKeys[req.params.operation];
      if (!allowed || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => !allowed.includes(key))) throw new Error('ADVANCED_PRODUCER_INPUT_INVALID');
      const owner = getOwnerSession(req)!;
      const result = await producer.invoke(owner.bindingId, workspaceId(req), req.params.operation as Parameters<typeof producer.invoke>[2], req.body);
      if (result.status === 'configuration_required') return res.status(428).json({ success: false, ...result });
      if (result.status === 'not_found') return res.status(404).json({ success: false, ...result });
      if (result.status === 'unverified' || result.status === 'rejected') return res.status(409).json({ success: false, ...result });
      res.status(result.status === 'partial' ? 207 : 201).json({ success: result.status === 'published', ...result, persistence: 'memory_only' });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.put('/api/edith/advanced/:resource', ...requireProtectedMutation, (req, res) => {
    try {
      if (killSwitchService.status().active) throw new Error('KILL_SWITCH_ACTIVE');
      const kind = req.params.resource as AdvancedResourceKind;
      if (kind === 'downloads' || kind === 'power-presence') throw new Error('TRUSTED_NATIVE_PRODUCER_CONFIGURATION_REQUIRED');
      const parser = parsers[kind];
      if (!parser) throw new Error('ADVANCED_RESOURCE_NOT_FOUND');
      const parsed = parser(req.body);
      if (parsed.success === false) return res.status(400).json({ success: false, errorCode: parsed.errorCode, safeMessage: parsed.message });
      const owner = getOwnerSession(req)!;
      const record = parsed.value as AdvancedResource;
      if (record.ownerSessionBindingId !== owner.bindingId) throw new Error('OWNER_BINDING_MISMATCH');
      const saved = runtime.put(kind, record);
      res.json({ success: true, record: saved, persistence: 'memory_only' });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/advanced/ghosts/:ghostTaskId/pause', ...requireProtectedMutation, (req, res) => {
    try {
      const owner = getOwnerSession(req)!;
      res.json({ success: true, record: runtime.pauseGhost(owner.bindingId, workspaceId(req), req.params.ghostTaskId) });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/advanced/ghosts/:ghostTaskId/cancel', ...requireProtectedMutation, (req, res) => {
    try {
      const owner = getOwnerSession(req)!;
      res.json({ success: true, record: runtime.cancelGhost(owner.bindingId, workspaceId(req), req.params.ghostTaskId) });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/advanced/watchers/:watcherId/cancel', ...requireProtectedMutation, (req, res) => {
    try {
      const owner = getOwnerSession(req)!;
      res.json({ success: true, record: runtime.cancelWatcher(owner.bindingId, workspaceId(req), req.params.watcherId) });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/edith/advanced/capsule/select', ...requireProtectedMutation, (req, res) => {
    try {
      if (!Array.isArray(req.body?.candidates) || req.body.candidates.length > 32) throw new Error('CAPSULE_CANDIDATES_INVALID');
      const candidates = req.body.candidates.map((candidate: unknown) => {
        const parsed = parseCapsuleContextCandidateV2(candidate);
        if (parsed.success === false) throw new Error(parsed.errorCode);
        return parsed.value;
      });
      const owner = getOwnerSession(req)!;
      res.json({ success: true, selection: runtime.selectCapsule(owner.bindingId, workspaceId(req), candidates) });
    } catch (error) { const mapped = mappedError(error); res.status(mapped.status).json(mapped.body); }
  });

  return router;
}
