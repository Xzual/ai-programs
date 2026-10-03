import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler } from 'express';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseTrustedNativeVaultSelectionV1,
  type TrustedNativeVaultSelectionV1,
} from '../../src/edith/contracts';
import { killSwitchService } from '../../src/edith/killSwitch';
import {
  obsidianProviderConfigService,
  type ObsidianProviderConfigService,
  type TrustedNativeVaultSelectionVerifier,
} from '../../src/edith/obsidianProviderService';
import { ObsidianVaultService, obsidianVaultService } from '../../src/edith/obsidianVaultService';
import { permissionService } from '../../src/edith/permissionService';
import { DesktopProducerService } from '../mobile/desktopProducerService';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import { appendSecurityAudit } from '../security/auditLog';
import {
  getOwnerSession,
  getSoleActiveOwnerSession,
  ownerSessionBindingActive,
  requireOwnerSession,
  requireProtectedMutation,
  requireSameOrigin,
} from '../security/ownerSession';
import { desktopProducerService } from './desktopProducer';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const REPLAY_STORE_VERSION = 1;
const DEFAULT_REPLAY_LIMIT = 512;

interface ReplayEntry {
  digest: string;
  expiresAt: string;
}

interface NativeSelectionEnvelope {
  contractVersion: typeof TASK_CONTRACT_VERSION;
  amendment: typeof EDITH_CONTRACT_AMENDMENT;
  ownerSessionBindingId: string;
  workspaceId: string;
  sessionId: string;
  selection: TrustedNativeVaultSelectionV1;
}

interface StoredHttpResult {
  status: number;
  body: Record<string, unknown>;
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

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseEnvelope(value: unknown): NativeSelectionEnvelope {
  const keys = ['contractVersion', 'amendment', 'ownerSessionBindingId', 'workspaceId', 'sessionId', 'selection'] as const;
  if (!exactObject(value, keys)) throw new Error('OBSIDIAN_NATIVE_ENVELOPE_INVALID');
  const row = value as Record<string, unknown>;
  if (row.contractVersion !== TASK_CONTRACT_VERSION || row.amendment !== EDITH_CONTRACT_AMENDMENT
    || ![row.ownerSessionBindingId, row.workspaceId, row.sessionId].every((item) => typeof item === 'string' && SAFE_ID.test(item))) {
    throw new Error('OBSIDIAN_NATIVE_ENVELOPE_INVALID');
  }
  const parsed = parseTrustedNativeVaultSelectionV1(row.selection);
  if (parsed.success === false) throw new Error(parsed.errorCode);
  return { ...row, selection: parsed.value } as NativeSelectionEnvelope;
}

function safeErrorCode(error: unknown, fallback = 'OBSIDIAN_PROVIDER_REQUEST_FAILED'): string {
  const candidate = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,95}$/.test(candidate) ? candidate : fallback;
}

function errorStatus(errorCode: string): number {
  if (errorCode.includes('KILL_SWITCH')) return 423;
  if (errorCode.includes('CONFIGURATION_REQUIRED')) return 428;
  if (errorCode.includes('SESSION_REQUIRED') || errorCode.includes('SESSION_INVALID')) return 401;
  if (errorCode.includes('UNAUTHORIZED') || errorCode.includes('MISMATCH') || errorCode.includes('PERMISSION')) return 403;
  if (errorCode.includes('CAPACITY')) return 429;
  if (errorCode.includes('REPLAY') || errorCode.includes('SEQUENCE') || errorCode.includes('ALREADY_ACTIVE')) return 409;
  return 400;
}

function selectionBinding(selection: TrustedNativeVaultSelectionV1): string {
  return createHash('sha256').update(JSON.stringify({
    contractVersion: selection.contractVersion,
    amendment: selection.amendment,
    selectionId: selection.selectionId,
    deviceId: selection.deviceId,
    source: selection.source,
    selectedPath: selection.selectedPath,
    userConfirmed: selection.userConfirmed,
    selectedAt: selection.selectedAt,
    expiresAt: selection.expiresAt,
  })).digest('hex');
}

export class NativeSelectionReplayStore {
  private readonly entries = new Map<string, ReplayEntry>();
  private readonly limit: number;
  private loadError = false;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    limit = DEFAULT_REPLAY_LIMIT,
  ) {
    this.limit = Math.min(2_000, Math.max(1, Math.floor(limit)));
    this.load();
  }

  claim(selectionId: string, expiresAt: string): void {
    if (this.loadError) throw new Error('OBSIDIAN_NATIVE_REPLAY_STORE_INVALID');
    this.cleanup();
    const digest = createHash('sha256').update(selectionId).digest('hex');
    if (this.entries.has(digest)) throw new Error('OBSIDIAN_NATIVE_SELECTION_REPLAYED');
    if (this.entries.size >= this.limit) throw new Error('OBSIDIAN_NATIVE_REPLAY_STORE_CAPACITY');
    this.entries.set(digest, { digest, expiresAt });
    this.persist();
  }

  private cleanup(): void {
    const now = this.now();
    for (const [digest, entry] of this.entries) {
      if (Date.parse(entry.expiresAt) <= now) this.entries.delete(digest);
    }
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      const row = value as Record<string, unknown>;
      if (row.version !== REPLAY_STORE_VERSION || !Array.isArray(row.entries)) throw new Error('invalid');
      for (const item of row.entries) {
        if (!exactObject(item, ['digest', 'expiresAt'])) throw new Error('invalid');
        const entry = item as unknown as ReplayEntry;
        if (!/^[a-f0-9]{64}$/.test(entry.digest) || !Number.isFinite(Date.parse(entry.expiresAt))) throw new Error('invalid');
        this.entries.set(entry.digest, entry);
      }
      this.cleanup();
      if (this.entries.size > this.limit) throw new Error('invalid');
    } catch {
      this.entries.clear();
      this.loadError = true;
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      const backup = `${this.file}.${process.pid}.${randomUUID()}.bak`;
      const existed = fs.existsSync(this.file);
      fs.writeFileSync(temporary, `${JSON.stringify({ version: REPLAY_STORE_VERSION, entries: [...this.entries.values()] }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      try {
        if (existed) fs.renameSync(this.file, backup);
        fs.renameSync(temporary, this.file);
        if (existed && fs.existsSync(backup)) fs.rmSync(backup);
      } catch (error) {
        if (fs.existsSync(temporary)) fs.rmSync(temporary);
        if (existed && fs.existsSync(backup) && !fs.existsSync(this.file)) fs.renameSync(backup, this.file);
        throw error;
      }
    } catch {
      throw new Error('OBSIDIAN_NATIVE_REPLAY_STORE_WRITE_FAILED');
    }
  }
}

class OwnerMutationIdempotencyStore {
  private readonly entries = new Map<string, { fingerprint: string; result: StoredHttpResult }>();

  execute(scope: string, key: string, body: unknown, operation: () => StoredHttpResult): { replayed: boolean; result: StoredHttpResult } | undefined {
    const compound = `${scope}:${key}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const existing = this.entries.get(compound);
    if (existing) return existing.fingerprint === fingerprint ? { replayed: true, result: existing.result } : undefined;
    const result = operation();
    this.entries.set(compound, { fingerprint, result });
    while (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value!);
    return { replayed: false, result };
  }
}

export function createObsidianProviderRouter(options: {
  runtime?: MobileRuntime;
  producerService?: DesktopProducerService;
  providerConfig?: ObsidianProviderConfigService;
  vaultService?: ObsidianVaultService;
  replayStore?: NativeSelectionReplayStore;
  nativeLoopback?: (req: Request) => boolean;
  ownerLoopback?: (req: Request) => boolean;
  killSwitchActive?: () => boolean;
  permissionAllows?: () => boolean;
  now?: () => Date;
  protectedMutation?: RequestHandler[];
} = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const producerService = options.producerService ?? desktopProducerService;
  const providerConfig = options.providerConfig ?? obsidianProviderConfigService;
  const vaultService = options.vaultService ?? obsidianVaultService;
  const now = options.now ?? (() => new Date());
  const replayStore = options.replayStore ?? new NativeSelectionReplayStore(path.join(path.dirname(providerConfig.configFile), 'obsidian-native-selection-replay.json'), () => now().getTime());
  const nativeLoopback = options.nativeLoopback ?? loopback;
  const ownerLoopback = options.ownerLoopback ?? loopback;
  const killSwitchActive = options.killSwitchActive ?? (() => killSwitchService.status().active);
  const permissionAllows = options.permissionAllows ?? (() => permissionService.getPolicy().mode !== 'deny');
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;
  const idempotency = new OwnerMutationIdempotencyStore();

  const assertKillSwitch = (): void => {
    if (killSwitchActive()) {
      producerService.revokeAll();
      throw new Error('KILL_SWITCH_ACTIVE');
    }
  };

  const assertPermission = (): void => {
    if (!permissionAllows()) throw new Error('OBSIDIAN_PROVIDER_PERMISSION_DENIED');
  };

  router.post('/api/edith/obsidian/native-session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      assertKillSwitch();
      const configuredBridge = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
      const suppliedBridge = bearer(req);
      if (!nativeLoopback(req) || !configuredBridge || !suppliedBridge || !safeEqual(configuredBridge, suppliedBridge)) {
        throw new Error('OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED');
      }
      assertPermission();
      const owner = getSoleActiveOwnerSession();
      if (!owner) throw new Error('OWNER_SESSION_REQUIRED');
      const issued = producerService.createNativeSelection(owner.bindingId, runtime.store.serverId());
      appendSecurityAudit(req, {
        action: 'obsidian.native_selection.session_created',
        actor: owner.actor,
        authorization: 'allowed',
        result: 'success',
        message: 'Single-use native Obsidian selection session created.',
        riskLevel: 3,
      });
      res.status(201).json({ success: true, data: { producerSessionToken: issued.token, session: issued.session } });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      appendSecurityAudit(req, {
        action: 'obsidian.native_selection.session_denied',
        actor: getOwnerSession(req)?.actor,
        authorization: 'denied',
        result: 'denied',
        message: `Native Obsidian selection session rejected: ${errorCode}.`,
        riskLevel: 3,
      });
      res.status(errorStatus(errorCode)).json({ success: false, errorCode, safeMessage: 'Native Obsidian selection session was rejected.' });
    }
  });

  router.post('/api/edith/obsidian/native-selection', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      assertKillSwitch();
      const configuredBridge = process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
      const suppliedBridge = bearer(req);
      if (!nativeLoopback(req) || !configuredBridge || !suppliedBridge || !safeEqual(configuredBridge, suppliedBridge)) {
        throw new Error('OBSIDIAN_NATIVE_SELECTION_UNAUTHORIZED');
      }
      const envelope = parseEnvelope(req.body);
      const selectedAt = Date.parse(envelope.selection.selectedAt);
      const expiresAt = Date.parse(envelope.selection.expiresAt);
      const currentTime = now().getTime();
      if (selectedAt > currentTime || expiresAt <= currentTime || expiresAt - selectedAt > 5 * 60_000) {
        throw new Error('OBSIDIAN_NATIVE_SELECTION_EXPIRED');
      }
      const sequence = Number(req.get('x-edith-native-selection-sequence'));
      const session = producerService.authorizeNativeSelection(req.get('x-edith-producer-session'), sequence);
      if (!ownerSessionBindingActive(session.ownerSessionBindingId)) throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
      const context = producerService.isNativeSelectionOnly(session)
        ? undefined
        : runtime.pairing.revalidateContext(producerService.sessionContext(session));
      const ownerHeader = req.get('x-edith-owner-session-binding');
      const deviceSessionHeader = req.get('x-edith-device-session');
      if (!ownerHeader || !deviceSessionHeader
        || envelope.ownerSessionBindingId !== session.ownerSessionBindingId
        || envelope.workspaceId !== session.workspaceId
        || envelope.sessionId !== session.sessionId
        || envelope.selection.deviceId !== session.targetDeviceId
        || ownerHeader !== session.ownerSessionBindingId
        || deviceSessionHeader !== session.sessionId
        || context && (context.credential.deviceId !== session.targetDeviceId
          || context.credential.workspaceId !== session.workspaceId
          || context.credential.sessionId !== session.sessionId)) {
        throw new Error('OBSIDIAN_NATIVE_SELECTION_LINEAGE_MISMATCH');
      }
      assertPermission();
      replayStore.claim(envelope.selection.selectionId, envelope.selection.expiresAt);
      const expectedBinding = selectionBinding(envelope.selection);
      const verifier: TrustedNativeVaultSelectionVerifier = {
        verify: (candidate) => selectionBinding(candidate) === expectedBinding
          ? { trusted: true }
          : { trusted: false, reasonCode: 'OBSIDIAN_NATIVE_SELECTION_LINEAGE_MISMATCH' },
      };
      const current = providerConfig.status();
      const operation = current.provider === 'user_vault' && current.configured ? 'change' : 'activate';
      vaultService.configureTrustedSelection(envelope.selection, verifier, operation);
      appendSecurityAudit(req, {
        action: `obsidian.native_selection.${operation}`,
        actor: 'trusted_native_producer',
        authorization: 'allowed',
        result: 'success',
        message: 'Trusted native vault selection accepted.',
        riskLevel: 3,
      });
      res.status(202).json({ success: true });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      appendSecurityAudit(req, {
        action: 'obsidian.native_selection.denied',
        actor: 'trusted_native_producer',
        authorization: 'denied',
        result: 'denied',
        message: `Trusted native vault selection rejected: ${errorCode}.`,
        riskLevel: 3,
      });
      res.status(errorStatus(errorCode)).json({ success: false, errorCode, safeMessage: 'Trusted native vault selection was rejected.' });
    }
  });

  const requireOwnerLoopback: RequestHandler = (req, res, next) => {
    if (!ownerLoopback(req)) {
      appendSecurityAudit(req, { action: 'obsidian.provider.loopback_denied', actor: getOwnerSession(req)?.actor, authorization: 'denied', result: 'denied', message: 'Non-loopback Obsidian provider request rejected.', riskLevel: 3 });
      return res.status(403).json({ success: false, errorCode: 'LOOPBACK_REQUIRED', safeMessage: 'This operation is available only on the local device.' });
    }
    next();
  };

  router.get('/api/edith/obsidian/provider/status', requireOwnerSession, requireSameOrigin, requireOwnerLoopback, (req, res) => {
    const status = providerConfig.status();
    appendSecurityAudit(req, { action: 'obsidian.provider.status', actor: getOwnerSession(req)!.actor, authorization: 'allowed', result: 'success', message: 'Obsidian provider status read.', riskLevel: 1 });
    res.json({ success: true, status });
  });

  const ownerMutation = (scope: 'activate' | 'change' | 'revoke', operation: () => StoredHttpResult) => [
    ...protectedMutation,
    requireOwnerLoopback,
    (req: Request, res: any) => {
      if (!exactObject(req.body ?? {}, [])) {
        appendSecurityAudit(req, { action: `obsidian.provider.${scope}.body_denied`, actor: getOwnerSession(req)!.actor, authorization: 'denied', result: 'denied', message: 'Obsidian provider mutation body rejected.', riskLevel: 3 });
        return res.status(400).json({ success: false, errorCode: 'OBSIDIAN_PROVIDER_MUTATION_BODY_FORBIDDEN', safeMessage: 'Vault paths and selection data are accepted only from the trusted native picker.' });
      }
      const key = req.get('x-idempotency-key');
      if (!key || !IDEMPOTENCY_KEY.test(key)) {
        appendSecurityAudit(req, { action: `obsidian.provider.${scope}.idempotency_denied`, actor: getOwnerSession(req)!.actor, authorization: 'denied', result: 'denied', message: 'Obsidian provider mutation idempotency rejected.', riskLevel: 2 });
        return res.status(400).json({ success: false, errorCode: 'IDEMPOTENCY_KEY_REQUIRED', safeMessage: 'A valid idempotency key is required.' });
      }
      try {
        assertKillSwitch();
        assertPermission();
        const executed = idempotency.execute(`obsidian.provider.${scope}`, key, req.body, operation);
        if (!executed) {
          appendSecurityAudit(req, { action: `obsidian.provider.${scope}.idempotency_conflict`, actor: getOwnerSession(req)!.actor, authorization: 'denied', result: 'denied', message: 'Obsidian provider mutation idempotency conflict.', riskLevel: 2 });
          return res.status(409).json({ success: false, errorCode: 'IDEMPOTENCY_KEY_REUSED', safeMessage: 'The idempotency key was already used with another request.' });
        }
        if (!executed.replayed) appendSecurityAudit(req, {
          action: `obsidian.provider.${scope}`,
          actor: getOwnerSession(req)!.actor,
          authorization: 'allowed',
          result: executed.result.status < 400 ? 'success' : 'error',
          message: scope === 'revoke' ? 'Obsidian provider selection revoked.' : 'Trusted native vault selection is required.',
          riskLevel: scope === 'revoke' ? 3 : 2,
        });
        res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
      } catch (error) {
        const errorCode = safeErrorCode(error);
        appendSecurityAudit(req, { action: `obsidian.provider.${scope}.denied`, actor: getOwnerSession(req)!.actor, authorization: 'denied', result: 'denied', message: `Obsidian provider mutation rejected: ${errorCode}.`, riskLevel: 3 });
        res.status(errorStatus(errorCode)).json({ success: false, errorCode, safeMessage: 'Obsidian provider mutation was rejected.' });
      }
    },
  ] satisfies RequestHandler[];

  router.post('/api/edith/obsidian/provider/activate', ...ownerMutation('activate', () => {
    const status = providerConfig.status();
    return status.state === 'READY'
      ? { status: 200, body: { success: true, status } }
      : { status: 428, body: { success: false, errorCode: 'NATIVE_SELECTION_REQUIRED', safeMessage: 'Use the trusted native folder picker to activate Obsidian.', status } };
  }));

  router.post('/api/edith/obsidian/provider/change', ...ownerMutation('change', () => {
    const status = providerConfig.status();
    return status.provider === 'user_vault' && status.configured
      ? { status: 428, body: { success: false, errorCode: 'NATIVE_SELECTION_REQUIRED', safeMessage: 'Use the trusted native folder picker to change the vault.', status } }
      : { status: 409, body: { success: false, errorCode: 'OBSIDIAN_PROVIDER_NOT_ACTIVE', safeMessage: 'No active Obsidian provider can be changed.', status } };
  }));

  router.post('/api/edith/obsidian/provider/revoke', ...ownerMutation('revoke', () => {
    vaultService.revokeVaultSelection();
    return { status: 200, body: { success: true, status: providerConfig.status() } };
  }));

  return router;
}
