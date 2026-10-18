import { Router, type Request, type RequestHandler } from 'express';
import { parsePlaybookDefinitionV2, type PlaybookDefinitionV2 } from '../../src/edith/contracts';
import { requireOwnerSession, requireProtectedMutation, getOwnerSession } from '../security/ownerSession';
import { appendSecurityAudit } from '../security/auditLog';
import { TaskContinuationAdapter } from '../../src/edith/taskContinuationAdapter';
import { getAdvancedExperienceRuntime } from '../advanced/runtime';
import {
  errorEnvelope,
  executeIdempotent,
  getPhase4ApiRuntime,
  successEnvelope,
  validatePublicPayload,
  type Phase4ApiRuntime,
} from './phase4Api';

function limit(value: unknown, fallback = 25): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : fallback;
}

function definitionVersion(req: Request): string | undefined {
  const value = req.params.version ?? req.query.version ?? req.body?.version;
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

function parseDefinition(value: unknown): { success: true; value: PlaybookDefinitionV2 } | { success: false; errorCode: string; safeMessage: string } {
  const publicPayload = validatePublicPayload(value);
  if (publicPayload.success === false) return publicPayload;
  const parsed = parsePlaybookDefinitionV2(value);
  return parsed.success === true ? parsed : { success: false, errorCode: parsed.errorCode, safeMessage: parsed.message };
}

function resultStatus(outcome: string): number {
  if (outcome === 'completed') return 201;
  if (outcome === 'waiting_for_approval') return 409;
  if (outcome === 'configuration_required') return 503;
  return 422;
}

export function createPlaybooksRouter(options: { runtime?: Phase4ApiRuntime; protectedMutation?: RequestHandler[] } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getPhase4ApiRuntime();
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;
  const continuation = new TaskContinuationAdapter();
  router.post('/api/edith/mission-memories/:memoryId/rebind', ...protectedMutation, async (req, res) => {
    const valid = validatePublicPayload(req.body);
    if (valid.success === false) return res.status(400).json(errorEnvelope(req, valid.errorCode, valid.safeMessage));
    if (typeof req.body.workspaceId !== 'string' || req.body.workspaceId.length > 160) return res.status(400).json(errorEnvelope(req, 'WORKSPACE_ID_REQUIRED', 'A bounded workspace ID is required.'));
    const executed = await executeIdempotent(req, runtime, `mission.rebind:${req.params.memoryId}`, async () => {
    try {
      const record = getAdvancedExperienceRuntime().rebindMissionMemory(req.params.memoryId, getOwnerSession(req)!.bindingId, req.body.workspaceId);
      return { status: 200, body: successEnvelope(req, record) };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'MISSION_MEMORY_REBIND_BLOCKED';
      return { status: 409, body: errorEnvelope(req, code, 'Mission memory requires current verified task evidence and an authenticated owner.') };
    }
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });
  router.post('/api/edith/tasks/:taskId/continue', ...protectedMutation, async (req, res) => {
    const valid = validatePublicPayload(req.body);
    if (valid.success === false) return res.status(400).json(errorEnvelope(req, valid.errorCode, valid.safeMessage));
    const executed = await executeIdempotent(req, runtime, `task.continue:${req.params.taskId}`, async () => {
      try {
        const result = await continuation.resume(req.params.taskId, getOwnerSession(req)!.bindingId);
        return { status: 200, body: successEnvelope(req, result) };
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CONTINUATION_BLOCKED';
        return { status: 409, body: errorEnvelope(req, code, 'Continuation requires current owner binding and an unambiguous ready task.') };
      }
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.get('/api/edith/playbooks', requireOwnerSession, (req, res) => {
    const bounded = limit(req.query.limit);
    res.json(successEnvelope(req, { definitions: runtime.persistence.listPlaybookDefinitions().slice(0, bounded), limit: bounded }));
  });

  router.get('/api/edith/playbooks/history', requireOwnerSession, (req, res) => {
    const bounded = limit(req.query.limit);
    res.json(successEnvelope(req, { runs: runtime.persistence.listPlaybookRuns().slice(0, bounded), limit: bounded }));
  });

  router.get('/api/edith/playbooks/runs/:runId', requireOwnerSession, (req, res) => {
    const run = runtime.persistence.getPlaybookRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_RUN_NOT_FOUND', 'Playbook run not found.'));
    res.json(successEnvelope(req, { run }));
  });

  router.post('/api/edith/playbooks', ...protectedMutation, async (req, res) => {
    const parsed = parseDefinition(req.body);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const executed = await executeIdempotent(req, runtime, `playbook.create:${parsed.value.playbookId}@${parsed.value.version}`, async () => {
      try {
        const definition = runtime.playbooks.register(parsed.value);
        appendSecurityAudit(req, { action: 'phase4.playbook.register', authorization: 'allowed', result: 'success', message: 'Playbook definition registered.', riskLevel: 3 });
        return { status: 201, body: successEnvelope(req, { definition }) };
      } catch (error) {
        return { status: 400, body: errorEnvelope(req, 'PLAYBOOK_DEFINITION_INVALID', error instanceof Error ? error.message : 'Playbook definition is invalid.') };
      }
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.put('/api/edith/playbooks/:playbookId/:version', ...protectedMutation, async (req, res) => {
    const parsed = parseDefinition(req.body);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    if (parsed.value.playbookId !== req.params.playbookId || parsed.value.version !== req.params.version) return res.status(409).json(errorEnvelope(req, 'PLAYBOOK_IDENTITY_MISMATCH', 'Path and payload playbook identity must match.'));
    const executed = await executeIdempotent(req, runtime, `playbook.update:${req.params.playbookId}@${req.params.version}`, async () => {
      try {
        return { status: 200, body: successEnvelope(req, { definition: runtime.playbooks.register(parsed.value) }) };
      } catch (error) {
        return { status: 400, body: errorEnvelope(req, 'PLAYBOOK_DEFINITION_INVALID', error instanceof Error ? error.message : 'Playbook definition is invalid.') };
      }
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/playbooks/:playbookId/dry-run', ...protectedMutation, (req, res) => {
    if (req.body?.approvedStepIds !== undefined) return res.status(400).json(errorEnvelope(req, 'CLIENT_APPROVAL_EVIDENCE_FORBIDDEN', 'Client supplied step IDs are not accepted as approval evidence.'));
    const version = definitionVersion(req);
    if (!version) return res.status(400).json(errorEnvelope(req, 'PLAYBOOK_VERSION_REQUIRED', 'A bounded playbook version is required.'));
    const definition = runtime.persistence.getPlaybookDefinition(req.params.playbookId, version);
    if (!definition) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_DEFINITION_NOT_FOUND', 'Playbook definition not found.'));
    const dryRun = runtime.playbooks.dryRun(definition);
    res.status(dryRun.outcome === 'ready' ? 200 : dryRun.outcome === 'invalid' ? 400 : dryRun.outcome === 'waiting_for_approval' ? 409 : 503)
      .json(dryRun.outcome === 'ready' ? successEnvelope(req, { dryRun }) : errorEnvelope(req, dryRun.outcome.toUpperCase(), 'Playbook is not ready to execute.', { data: { dryRun } }));
  });

  router.post('/api/edith/playbooks/:playbookId/run', ...protectedMutation, async (req, res) => {
    const payloadCheck = validatePublicPayload(req.body ?? {});
    if (payloadCheck.success === false) return res.status(400).json(errorEnvelope(req, payloadCheck.errorCode, payloadCheck.safeMessage));
    if (req.body?.approvedStepIds !== undefined) return res.status(400).json(errorEnvelope(req, 'CLIENT_APPROVAL_EVIDENCE_FORBIDDEN', 'Client supplied step IDs are not accepted as approval evidence.'));
    const version = definitionVersion(req);
    if (!version) return res.status(400).json(errorEnvelope(req, 'PLAYBOOK_VERSION_REQUIRED', 'A bounded playbook version is required.'));
    const definition = runtime.persistence.getPlaybookDefinition(req.params.playbookId, version);
    if (!definition) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_DEFINITION_NOT_FOUND', 'Playbook definition not found.'));
    const executed = await executeIdempotent(req, runtime, `playbook.run:${definition.playbookId}@${definition.version}`, async () => {
      const input = req.body?.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input) ? req.body.input : {};
      const result = await runtime.playbooks.run(definition.playbookId, { version: definition.version, taskId: typeof req.body?.taskId === 'string' ? req.body.taskId : undefined, input, ownerSessionBindingId: getOwnerSession(req)?.bindingId });
      appendSecurityAudit(req, { action: 'phase4.playbook.run', authorization: 'allowed', result: result.outcome === 'completed' ? 'success' : 'error', message: `Playbook run finished with ${result.outcome}.`, riskLevel: 3 });
      const status = resultStatus(result.outcome);
      return { status, body: result.outcome === 'completed' ? successEnvelope(req, result, { outcome: result.outcome }) : errorEnvelope(req, result.outcome.toUpperCase(), 'Playbook could not execute with the configured backend capabilities.', { outcome: result.outcome, data: result }) };
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/playbooks/runs/:runId/undo', ...protectedMutation, async (req, res) => {
    const run = runtime.persistence.getPlaybookRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_RUN_NOT_FOUND', 'Playbook run not found.'));
    const executed = await executeIdempotent(req, runtime, `playbook.undo:${run.runId}`, async () => {
      const result = await runtime.playbooks.undo(run.runId);
      const status = resultStatus(result.outcome);
      return { status, body: result.outcome === 'completed' ? successEnvelope(req, result, { outcome: result.outcome }) : errorEnvelope(req, result.outcome.toUpperCase(), 'Playbook undo could not execute with the configured backend capabilities.', { outcome: result.outcome, data: result }) };
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/playbooks/runs/:runId/resume', ...protectedMutation, (req, res) => {
    const run = runtime.persistence.getPlaybookRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_RUN_NOT_FOUND', 'Playbook run not found.'));
    res.status(501).json(errorEnvelope(req, 'PLAYBOOK_RESUME_NOT_SUPPORTED', 'The current playbook service has no resumable execution contract; no state was changed.', { data: { run } }));
  });

  router.post('/api/edith/playbooks/runs/:runId/cancel', ...protectedMutation, (req, res) => {
    const run = runtime.persistence.getPlaybookRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_RUN_NOT_FOUND', 'Playbook run not found.'));
    res.status(501).json(errorEnvelope(req, 'PLAYBOOK_CANCELLATION_NOT_SUPPORTED', 'The current playbook service has no cooperative cancellation contract; no state was changed.', { data: { run } }));
  });

  router.get('/api/edith/playbooks/:playbookId', requireOwnerSession, (req, res) => {
    const version = definitionVersion(req);
    if (!version) return res.status(400).json(errorEnvelope(req, 'PLAYBOOK_VERSION_REQUIRED', 'A bounded playbook version query is required.'));
    const definition = runtime.persistence.getPlaybookDefinition(req.params.playbookId, version);
    if (!definition) return res.status(404).json(errorEnvelope(req, 'PLAYBOOK_DEFINITION_NOT_FOUND', 'Playbook definition not found.'));
    res.json(successEnvelope(req, { definition }));
  });

  return router;
}
