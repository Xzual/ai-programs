import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Request, RequestHandler } from 'express';
import { appendSecurityAudit } from '../security/auditLog';
import type { MobileRuntime } from './runtime';
import type { MobileSessionContext } from './types';

const contexts = new WeakMap<Request, MobileSessionContext>();

export function isLoopbackAddress(address?: string): boolean {
  const value = String(address ?? '').replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  return value === '::1' || (net.isIP(value) === 4 && value.startsWith('127.'));
}

export function isSecureMobileTransport(request: IncomingMessage): boolean {
  return Boolean((request.socket as { encrypted?: boolean }).encrypted) || isLoopbackAddress(request.socket.remoteAddress);
}

export const requireSecureMobileTransport: RequestHandler = (req, res, next) => {
  if (isSecureMobileTransport(req)) return next();
  res.status(426).json({ success: false, errorCode: 'TLS_REQUIRED', safeMessage: 'Remote mobile transport requires HTTPS/WSS. Application encryption does not replace TLS.' });
};

export function mobileContext(req: Request): MobileSessionContext {
  const context = contexts.get(req);
  if (!context) throw new Error('DEVICE_AUTH_REQUIRED');
  return context;
}

export function createDeviceAuth(runtime: MobileRuntime): RequestHandler {
  return (req, res, next) => {
    const match = /^Device\s+(.+)$/i.exec(req.get('authorization') ?? '');
    try {
      if (!match?.[1]) throw new Error('DEVICE_AUTH_REQUIRED');
      contexts.set(req, runtime.pairing.authenticate(match[1].trim()));
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) {
      appendSecurityAudit(req, { action: 'mobile.device_auth_denied', authorization: 'denied', result: 'denied', message: 'Mobile device authentication was denied.', riskLevel: 4 });
      res.status(401).json({ success: false, errorCode: error instanceof Error ? error.message : 'DEVICE_AUTH_REQUIRED', safeMessage: 'A valid trusted-device credential is required.' });
    }
  };
}

export function encryptedBody<T>(req: Request, runtime: MobileRuntime, purpose: string, channel: 'http' | 'realtime' | 'transfer' = 'http'): T {
  const context = mobileContext(req);
  const envelope = req.body?.envelope;
  if (!envelope || typeof envelope !== 'object') throw new Error('ENCRYPTED_ENVELOPE_REQUIRED');
  return runtime.crypto.decrypt<T>(context.credential.sessionId, envelope, purpose, 'client_to_server', channel);
}

export function encryptedResponse(req: Request, runtime: MobileRuntime, purpose: string, data: unknown, channel: 'http' | 'realtime' | 'transfer' = 'http'): { success: true; envelope: unknown } {
  const context = mobileContext(req);
  return { success: true, envelope: runtime.crypto.encrypt(context.credential.sessionId, purpose, data, 'server_to_client', channel) };
}
