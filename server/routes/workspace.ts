import { Router, type Request } from 'express';
import { appendAuditEvent, createAuditEvent } from '../../src/edith/audit';
import { obsidianVaultService } from '../../src/edith/obsidianVaultService';
import {
  workspaceManager,
  type WorkspaceConfig,
  type WorkspaceConfigInput,
} from '../../src/edith/workspaceManager';

function isLoopback(req: Request): boolean {
  const address = req.socket.remoteAddress ?? req.ip ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireLoopback(req: Request): void {
  if (!isLoopback(req)) throw new Error('Workspace configuration can only be changed from this computer.');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function inputFromBody(body: Record<string, unknown>, current?: WorkspaceConfig): WorkspaceConfigInput {
  const workspaceRoot = optionalString(body.workspaceRoot) ?? current?.workspaceRoot;
  if (!workspaceRoot?.trim()) throw new Error('workspaceRoot is required.');
  return {
    workspaceRoot,
    obsidianVaultPath: optionalString(body.obsidianVaultPath) ?? current?.obsidianVaultPath,
    chatHistoryPath: optionalString(body.chatHistoryPath) ?? current?.chatHistoryPath,
    logsPath: optionalString(body.logsPath) ?? current?.logsPath,
    dataPath: optionalString(body.dataPath) ?? current?.dataPath,
    backupPath: optionalString(body.backupPath) ?? current?.backupPath,
    exportsPath: optionalString(body.exportsPath) ?? current?.exportsPath,
    portableMode: typeof body.portableMode === 'boolean' ? body.portableMode : current?.portableMode,
    userId: optionalString(body.userId) ?? current?.userId,
    deviceId: optionalString(body.deviceId) ?? current?.deviceId,
  };
}

function audit(action: string, result: 'success' | 'error', message: string, workspaceId?: string): void {
  try {
    appendAuditEvent(createAuditEvent({
      actor: 'edith-workspace-api',
      action,
      toolId: 'workspace_manager',
      target: workspaceId,
      authorization: 'allowed',
      riskLevel: 2,
      result,
      message,
    }));
  } catch (error) {
    console.warn('[Workspace API] Audit write failed:', error);
  }
}

function payload() {
  const status = workspaceManager.status();
  return {
    configured: status.configured,
    workspaceRoot: status.workspaceRoot,
    obsidianVaultPath: status.obsidianVaultPath,
    readable: status.readable,
    writable: status.writable,
    portableMode: status.portableMode,
    lastValidated: status.lastValidated,
    safeMessage: status.safeMessage,
    status,
    config: workspaceManager.getConfig(),
    cloudMetadata: workspaceManager.getCloudMetadata(),
    obsidian: obsidianVaultService.status(),
  };
}

export function createWorkspaceRouter(): Router {
  const router = Router();

  router.get('/api/workspace/status', (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ success: false, error: 'Workspace status is local-only.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...payload() });
  });

  router.get('/api/workspace/config', (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ success: false, error: 'Workspace configuration is local-only.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...payload() });
  });

  router.post('/api/workspace/validate', (req, res) => {
    try {
      requireLoopback(req);
      const input = inputFromBody(req.body ?? {}, workspaceManager.getConfig());
      const status = workspaceManager.validate(input, { allowMissingRoot: req.body?.allowMissingRoot === true });
      res.json({ success: true, valid: status.state === 'ready' || status.state === 'degraded', status });
    } catch (error) {
      res.status(400).json({ success: false, valid: false, error: error instanceof Error ? error.message : 'Workspace validation failed.' });
    }
  });

  router.put('/api/workspace/config', async (req, res) => {
    try {
      requireLoopback(req);
      const config = workspaceManager.configure(inputFromBody(req.body ?? {}, workspaceManager.getConfig()));
      obsidianVaultService.applyWorkspaceConfig();
      const metadataSync = await workspaceManager.syncLocalMetadata();
      audit('workspace.configure', 'success', metadataSync.ok
        ? 'Workspace configuration and local metadata updated without moving existing files.'
        : `Workspace configuration updated; local metadata sync is degraded: ${metadataSync.error}`,
      config.workspaceId);
      res.json({ success: true, metadataSync, ...payload() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace configuration failed.';
      audit('workspace.configure', 'error', message, workspaceManager.getConfig()?.workspaceId);
      res.status(400).json({ success: false, error: message });
    }
  });

  router.post('/api/workspace/create', async (req, res) => {
    try {
      requireLoopback(req);
      const current = workspaceManager.getConfig();
      const config = workspaceManager.createWorkspace({
        ...inputFromBody(req.body ?? {}),
        userId: optionalString(req.body?.userId) ?? current?.userId,
        deviceId: optionalString(req.body?.deviceId) ?? current?.deviceId,
        createLocalObsidianVault: req.body?.createLocalObsidianVault === true,
      });
      obsidianVaultService.applyWorkspaceConfig();
      const metadataSync = await workspaceManager.syncLocalMetadata();
      audit('workspace.create', 'success', metadataSync.ok
        ? 'Workspace directories and local metadata created. Existing files were not moved.'
        : `Workspace directories created; local metadata sync is degraded: ${metadataSync.error}`,
      config.workspaceId);
      res.status(201).json({ success: true, metadataSync, ...payload() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace creation failed.';
      audit('workspace.create', 'error', message, workspaceManager.getConfig()?.workspaceId);
      res.status(400).json({ success: false, error: message });
    }
  });

  return router;
}
