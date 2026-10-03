import { Router, type RequestHandler } from 'express';
import { getOwnerSession, requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { EDITH_CONTRACT_AMENDMENT, TASK_CONTRACT_VERSION, parseMobilePairingConsumeResultV2, parseMobilePairingProofSubmissionV2 } from '../../src/edith/contracts';
import { getMobileRuntime, type MobileRuntime } from '../mobile/runtime';
import { sha256 } from '../mobile/crypto';
import { createDeviceAuth, encryptedBody, encryptedResponse, mobileContext, requireSecureMobileTransport } from '../mobile/middleware';
import type { MobileCommand, MobilePairingRequest } from '../mobile/types';

function publicError(error: unknown): { status: number; body: Record<string, unknown> } {
  const errorCode = error instanceof Error ? error.message : 'MOBILE_REQUEST_FAILED';
  const status = errorCode.includes('RATE_LIMIT') || errorCode.includes('CAPACITY') ? 429 : errorCode.includes('NOT_FOUND') ? 404 : errorCode.includes('EXPIRED') ? 410 : errorCode.includes('ALREADY') || errorCode.includes('REPLAY') ? 409 : errorCode.includes('REQUIRED') ? 428 : 400;
  return { status, body: { success: false, errorCode, safeMessage: 'The mobile security request was rejected.' } };
}

function pairingView(record: ReturnType<MobileRuntime['store']['getPairing']>) {
  if (!record) return undefined;
  return {
    pairingId: record.pairingId,
    device: {
      deviceId: record.device.deviceId,
      displayName: record.device.displayName,
      platform: record.device.platform,
      capabilities: record.device.capabilities,
      fingerprint: record.device.fingerprint,
    },
    challenge: record.challenge,
    ownerApproved: Boolean(record.ownerApprovedAt),
    ownerRejected: Boolean(record.ownerRejectedAt),
    requestedCommands: record.requestedCommands,
    approvedCommands: record.approvedCommands,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function createMobilePairingRouter(options: { runtime?: MobileRuntime; protectedMutation?: RequestHandler[] } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getMobileRuntime();
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;
  const deviceAuth = createDeviceAuth(runtime);
  const pairingAttempts = new Map<string, { windowStartedAt: number; count: number }>();

  router.use('/api/mobile', requireSecureMobileTransport);

  router.post('/api/mobile/pairing/request', (req, res) => {
    try {
      const address = req.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      const current = pairingAttempts.get(address);
      const attempt = !current || now - current.windowStartedAt >= 5 * 60_000 ? { windowStartedAt: now, count: 1 } : { ...current, count: current.count + 1 };
      pairingAttempts.set(address, attempt);
      if (attempt.count > 20) throw new Error('PAIRING_RATE_LIMITED');
      if (pairingAttempts.size > 2_000) for (const [key, row] of pairingAttempts) if (now - row.windowStartedAt >= 5 * 60_000) pairingAttempts.delete(key);
      const result = runtime.pairing.request(req.body as MobilePairingRequest);
      res.status(201).json({ success: true, data: result, tlsRequiredForRemoteTransport: true });
    } catch (error) {
      const mapped = publicError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/api/mobile/pairing/:pairingId/proof', (req, res) => {
    try {
      const canonical = req.body?.contractVersion !== undefined ? parseMobilePairingProofSubmissionV2(req.body) : undefined;
      if (canonical && canonical.success === false) throw new Error(canonical.errorCode);
      if (canonical?.success && (canonical.value.pairingId !== req.params.pairingId || canonical.value.assertionType !== 'challenge' || canonical.value.payloadFingerprint !== sha256(runtime.crypto.proofPayloadForPairing(req.params.pairingId) ?? ''))) throw new Error('PAIRING_PROOF_BINDING_INVALID');
      const signature = canonical?.success ? canonical.value.assertionBase64url : typeof req.body?.signature === 'string' ? req.body.signature : '';
      if (!signature || signature.length > 512) throw new Error('PAIRING_PROOF_INVALID');
      res.json({ success: true, data: { pairing: runtime.pairing.submitProof(req.params.pairingId, signature) } });
    } catch (error) {
      const mapped = publicError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/api/mobile/pairing/:pairingId/status', (req, res) => {
    const view = pairingView(runtime.store.getPairing(req.params.pairingId));
    if (!view) return res.status(404).json({ success: false, errorCode: 'PAIRING_NOT_FOUND', safeMessage: 'Pairing request was not found.' });
    res.json({ success: true, data: view });
  });

  router.post('/api/mobile/pairing/:pairingId/consume', (req, res) => {
    try {
      const canonical = req.body?.contractVersion !== undefined ? parseMobilePairingProofSubmissionV2(req.body) : undefined;
      if (canonical && canonical.success === false) throw new Error(canonical.errorCode);
      const proofPayload = runtime.crypto.proofPayloadForPairing(req.params.pairingId) ?? '';
      if (canonical?.success && (canonical.value.pairingId !== req.params.pairingId || canonical.value.assertionType !== 'consume' || canonical.value.payloadFingerprint !== sha256(`${proofPayload}\nconsume`))) throw new Error('PAIRING_CONSUME_BINDING_INVALID');
      const signature = canonical?.success ? canonical.value.assertionBase64url : typeof req.body?.signature === 'string' ? req.body.signature : '';
      if (!signature || signature.length > 512) throw new Error('PAIRING_CONSUME_PROOF_INVALID');
      const result = runtime.pairing.consume(req.params.pairingId, signature);
      const credentialEnvelope = runtime.crypto.encrypt(result.credential.sessionId, 'pairing.credential', { credential: result.credential }, 'server_to_client', 'http');
      const publicResult = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, pairing: result.pairing, session: result.session, credentialEnvelope };
      const parsed = parseMobilePairingConsumeResultV2(publicResult);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      res.json({ success: true, data: parsed.value, tlsRequiredForRemoteTransport: true });
    } catch (error) {
      const mapped = publicError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.get('/api/edith/mobile/pairings', requireOwnerSession, (_req, res) => {
    res.json({ success: true, data: { pairings: runtime.store.listPairings().map(pairingView) } });
  });

  router.post('/api/edith/mobile/pairings/:pairingId/approve', ...protectedMutation, (req, res) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const approvedCommands = Array.isArray(req.body?.approvedCommands) ? req.body.approvedCommands as MobileCommand[] : undefined;
      const owner = getOwnerSession(req)!;
      res.json({ success: true, data: { pairing: runtime.pairing.approve(req.params.pairingId, code, approvedCommands, { bindingId: owner.bindingId, expiresAt: new Date(owner.expiresAt).toISOString() }) } });
    } catch (error) {
      const mapped = publicError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/api/edith/mobile/pairings/:pairingId/reject', ...protectedMutation, (req, res) => {
    try { res.json({ success: true, data: { pairing: runtime.pairing.reject(req.params.pairingId) } }); }
    catch (error) { const mapped = publicError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/edith/mobile/devices', requireOwnerSession, (_req, res) => {
    res.json({ success: true, data: { serverId: runtime.store.serverId(), devices: runtime.store.listDevices(), realtime: runtime.realtime.status() } });
  });

  router.post('/api/edith/mobile/devices/:deviceId/revoke', ...protectedMutation, (req, res) => {
    try {
      const device = runtime.pairing.revokeDevice(req.params.deviceId);
      runtime.realtime.disconnectDevice(req.params.deviceId);
      res.json({ success: true, data: { device } });
    } catch (error) { const mapped = publicError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.post('/api/mobile/session/rotate', deviceAuth, (req, res) => {
    try {
      encryptedBody(req, runtime, 'session.rotate');
      const context = mobileContext(req);
      const credential = runtime.pairing.rotate(context);
      const record = runtime.store.getCredential(credential.credentialId);
      if (!record) throw new Error('DEVICE_CREDENTIAL_INVALID');
      res.json(encryptedResponse(req, runtime, 'session.rotated', { credential, credentialMetadata: runtime.pairing.credentialMetadata(record), session: runtime.pairing.sessionStatus({ ...context, credential: record }) }));
    } catch (error) { const mapped = publicError(error); res.status(mapped.status).json(mapped.body); }
  });

  router.get('/api/mobile/session/status', deviceAuth, (req, res) => {
    const context = mobileContext(req);
    res.json(encryptedResponse(req, runtime, 'session.status', {
      session: runtime.pairing.sessionStatus(context),
      credential: runtime.pairing.credentialMetadata(context.credential),
      trust: context.device.trust,
      allowedCommands: context.device.allowedCommands,
      server: runtime.pairing.serverStatus(context.credential.workspaceId),
    }));
  });

  return router;
}
