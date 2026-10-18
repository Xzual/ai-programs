import { createHash, createPublicKey } from 'node:crypto';
import express, { type Express } from 'express';
import { TASK_CONTRACT_VERSION, EDITH_CONTRACT_AMENDMENT, EDITH_MOBILE_PROTOCOL_VERSION, type MobilePublicKeyV2 } from '../../src/edith/contracts';
import type { MobileCommand } from './types';

export const RECONNECT_SCHEMA = 'edith.mobile.reconnect/1' as const;
export const P256_SUITE = 'P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM' as const;
type Versions = { schema: typeof RECONNECT_SCHEMA; contractVersion: typeof TASK_CONTRACT_VERSION; amendment: typeof EDITH_CONTRACT_AMENDMENT; protocolVersion: typeof EDITH_MOBILE_PROTOCOL_VERSION };
export interface ReconnectInitiation extends Versions {
  serverId: string; workspaceId: string; deviceId: string; signingKeyFingerprint: string;
  cryptoSuite: typeof P256_SUITE; clientNonce: string; clientAgreementKey: MobilePublicKeyV2;
  issuedAt: string; assertionBase64url: string;
}
export interface ReconnectConsume extends Versions { reconnectId: string; challengeId: string; transcriptFingerprint: string; assertionBase64url: string }
export interface ReconnectOffer {
  schema: typeof RECONNECT_SCHEMA; reconnectId: string; challengeId: string; serverId: string;
  workspaceId: string; deviceId: string; ownerBindingId: string; ownerSessionId: string;
  ownerExpiresAt: string; trustExpiresAt: string; signingKeyFingerprint: string; cryptoSuite: typeof P256_SUITE;
  clientNonce: string; clientAgreementKeyFingerprint: string; priorSessionId: string; priorCredentialId: string;
  priorCredentialFingerprint: string; priorGeneration: number; nextGeneration: number; nextSessionId: string;
  approvedCommands: MobileCommand[]; approvedCommandsFingerprint: string; challengeBase64url: string;
  serverAgreementKey: MobilePublicKeyV2; initiationTranscriptFingerprint: string; issuedAt: string; expiresAt: string;
  transcriptBase64url: string; transcriptFingerprint: string;
}
type Result<T> = { success: true; value: T } | { success: false; errorCode: string; message: string };
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const reconnectIdValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const reconnectTimestampValid = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: Record<string, unknown>, fields: string[]): boolean => Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
function urlBytes(value: unknown, max: number, size?: number): Buffer | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) return;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length <= max && (size === undefined || bytes.length === size) && bytes.toString('base64url') === value ? bytes : undefined;
}
function signature(value: unknown): boolean {
  const bytes = urlBytes(value, 80);
  if (!bytes || bytes.length < 8 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) return false;
  let offset = 2;
  for (let i = 0; i < 2; i++) {
    if (bytes[offset++] !== 2) return false;
    const length = bytes[offset++];
    if (!length || length > 33 || offset + length > bytes.length || (bytes[offset] & 0x80) || (length > 1 && bytes[offset] === 0 && !(bytes[offset + 1] & 0x80))) return false;
    const integer = bytes.subarray(offset, offset + length);
    const scalar = BigInt(`0x${integer.toString('hex')}`);
    if (scalar === 0n || scalar >= 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n) return false;
    offset += length;
  }
  return offset === bytes.length;
}
export function reconnectAgreementKeyValid(value: unknown): value is MobilePublicKeyV2 {
  if (!object(value) || !exact(value, ['contractVersion', 'amendment', 'algorithm', 'encoding', 'value', 'fingerprint']) || value.contractVersion !== TASK_CONTRACT_VERSION || value.amendment !== EDITH_CONTRACT_AMENDMENT || value.algorithm !== 'ECDH-P256' || value.encoding !== 'spki_der_base64' || typeof value.value !== 'string' || !fingerprint(value.fingerprint) || value.value.length > 344 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.value)) return false;
  try {
    const bytes = Buffer.from(value.value, 'base64');
    if (!bytes.length || bytes.length > 256 || bytes.toString('base64') !== value.value || hash(bytes) !== value.fingerprint) return false;
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' && Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(bytes);
  } catch { return false; }
}
const versions = (row: Record<string, unknown>): boolean => row.schema === RECONNECT_SCHEMA && row.contractVersion === TASK_CONTRACT_VERSION && row.amendment === EDITH_CONTRACT_AMENDMENT && row.protocolVersion === EDITH_MOBILE_PROTOCOL_VERSION;
function bounded(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (Array.isArray(value)) return value.every(item => bounded(item, depth + 1));
  if (object(value)) return Object.values(value).every(item => bounded(item, depth + 1));
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
function parse<T>(value: unknown, validate: (row: Record<string, unknown>) => boolean): Result<T> {
  try {
    if (object(value) && bounded(value) && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16 * 1024 && validate(value)) return { success: true, value: value as T };
  } catch { /* cyclic or foreign input is malformed */ }
  return { success: false, errorCode: 'RECONNECT_REQUEST_INVALID', message: 'Invalid reconnect request.' };
}
export function parseReconnectInitiation(value: unknown): Result<ReconnectInitiation> {
  return parse(value, row => exact(row, ['schema', 'contractVersion', 'amendment', 'protocolVersion', 'serverId', 'workspaceId', 'deviceId', 'signingKeyFingerprint', 'cryptoSuite', 'clientNonce', 'clientAgreementKey', 'issuedAt', 'assertionBase64url']) && versions(row) && ['serverId', 'workspaceId', 'deviceId'].every(field => reconnectIdValid(row[field])) && fingerprint(row.signingKeyFingerprint) && row.cryptoSuite === P256_SUITE && !!urlBytes(row.clientNonce, 32, 32) && reconnectAgreementKeyValid(row.clientAgreementKey) && reconnectTimestampValid(row.issuedAt) && signature(row.assertionBase64url));
}
export function parseReconnectConsume(value: unknown): Result<ReconnectConsume> {
  return parse(value, row => exact(row, ['schema', 'contractVersion', 'amendment', 'protocolVersion', 'reconnectId', 'challengeId', 'transcriptFingerprint', 'assertionBase64url']) && versions(row) && reconnectIdValid(row.reconnectId) && reconnectIdValid(row.challengeId) && fingerprint(row.transcriptFingerprint) && signature(row.assertionBase64url));
}
export function parseReconnectOffer(value: unknown): Result<ReconnectOffer> {
  const ids = ['reconnectId', 'challengeId', 'serverId', 'workspaceId', 'deviceId', 'ownerBindingId', 'ownerSessionId', 'priorSessionId', 'priorCredentialId', 'nextSessionId'];
  const hashes = ['signingKeyFingerprint', 'clientAgreementKeyFingerprint', 'priorCredentialFingerprint', 'approvedCommandsFingerprint', 'initiationTranscriptFingerprint', 'transcriptFingerprint'];
  const times = ['ownerExpiresAt', 'trustExpiresAt', 'issuedAt', 'expiresAt'];
  const commands: MobileCommand[] = ['task.list', 'task.detail', 'task.activity', 'task.create_low_risk', 'task.pause', 'task.resume', 'task.cancel', 'emergency_stop', 'file.upload', 'file.download', 'clipboard.publish', 'clipboard.consume', 'live_view.start', 'live_view.stop', 'wake.request', 'offline_queue.manage', 'handoff.manage', 'result_card.read', 'audio_handoff.manage', 'pc_status.read'];
  return parse(value, row => {
    if (!exact(row, ['schema', ...ids, ...hashes, ...times, 'cryptoSuite', 'clientNonce', 'priorGeneration', 'nextGeneration', 'approvedCommands', 'challengeBase64url', 'serverAgreementKey', 'transcriptBase64url']) || row.schema !== RECONNECT_SCHEMA || row.cryptoSuite !== P256_SUITE || !ids.every(field => reconnectIdValid(row[field])) || !hashes.every(field => fingerprint(row[field])) || !times.every(field => reconnectTimestampValid(row[field])) || !reconnectAgreementKeyValid(row.serverAgreementKey) || !urlBytes(row.clientNonce, 32, 32) || !urlBytes(row.challengeBase64url, 32, 32)) return false;
    if (!Number.isSafeInteger(row.priorGeneration) || Number(row.priorGeneration) < 0 || !Number.isSafeInteger(row.nextGeneration) || row.nextGeneration !== Number(row.priorGeneration) + 1 || row.nextSessionId === row.priorSessionId) return false;
    if (!Array.isArray(row.approvedCommands) || row.approvedCommands.length > commands.length || new Set(row.approvedCommands).size !== row.approvedCommands.length || !row.approvedCommands.every(command => commands.includes(command as MobileCommand)) || hash([...row.approvedCommands].sort().join('\n')) !== row.approvedCommandsFingerprint) return false;
    const issued = Date.parse(String(row.issuedAt)); const expires = Date.parse(String(row.expiresAt));
    if (expires <= issued || expires - issued > 60_000 || expires > Date.parse(String(row.ownerExpiresAt)) || expires > Date.parse(String(row.trustExpiresAt))) return false;
    const bytes = urlBytes(row.transcriptBase64url, 4096);
    const expected = reconnectTranscript(row as unknown as ReconnectOffer);
    return !!bytes && bytes.equals(Buffer.from(expected, 'utf8')) && hash(expected) === row.transcriptFingerprint;
  });
}
function transcript(fields: unknown[]): string {
  if (fields.some(field => typeof field !== 'string' && typeof field !== 'number' || /[\r\n]/.test(String(field)))) throw new Error('RECONNECT_TRANSCRIPT_INVALID');
  const result = fields.join('\n');
  if (Buffer.byteLength(result, 'utf8') > 4096) throw new Error('RECONNECT_TRANSCRIPT_INVALID');
  return result;
}
export function initiationTranscript(request: ReconnectInitiation): string {
  return transcript(['edith.mobile.reconnect.request.v1', request.serverId, request.workspaceId, request.deviceId, request.cryptoSuite, request.signingKeyFingerprint, request.clientAgreementKey.fingerprint, request.clientNonce, request.issuedAt]);
}
export function reconnectTranscript(offer: ReconnectOffer): string {
  return transcript(['edith.mobile.reconnect.v1', offer.serverId, offer.workspaceId, offer.reconnectId, offer.challengeId, offer.deviceId, offer.cryptoSuite, offer.signingKeyFingerprint, offer.clientAgreementKeyFingerprint, offer.serverAgreementKey.fingerprint, offer.ownerBindingId, offer.ownerSessionId, offer.ownerExpiresAt, offer.trustExpiresAt, offer.priorCredentialId, offer.priorCredentialFingerprint, offer.priorSessionId, offer.priorGeneration, offer.nextSessionId, offer.nextGeneration, offer.approvedCommandsFingerprint, offer.clientNonce, offer.initiationTranscriptFingerprint, offer.issuedAt, offer.expiresAt, offer.challengeBase64url]);
}

/** Validate raw JSON before JSON.parse loses duplicate object member names. */
export function assertReconnectRawJson(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024) throw new Error('RECONNECT_REQUEST_TOO_LARGE');
  let cursor = 0;
  const whitespace = (): void => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error('RECONNECT_REQUEST_INVALID');
  };
  const value = (depth: number): void => {
    if (depth > 8) throw new Error('RECONNECT_REQUEST_INVALID');
    whitespace();
    if (text[cursor] === '"') { string(); return; }
    if (text[cursor] === '{' || text[cursor] === '[') {
      const object = text[cursor++] === '{'; const end = object ? '}' : ']'; const names = new Set<string>();
      whitespace(); if (text[cursor] === end) { cursor++; return; }
      while (cursor < text.length) {
        whitespace();
        if (object) {
          if (text[cursor] !== '"') throw new Error('RECONNECT_REQUEST_INVALID');
          const name = string(); if (names.has(name)) throw new Error('RECONNECT_REQUEST_INVALID'); names.add(name);
          whitespace(); if (text[cursor++] !== ':') throw new Error('RECONNECT_REQUEST_INVALID');
        }
        value(depth + 1); whitespace(); const next = text[cursor++];
        if (next === end) return; if (next !== ',') throw new Error('RECONNECT_REQUEST_INVALID');
      }
      throw new Error('RECONNECT_REQUEST_INVALID');
    }
    const start = cursor;
    while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor++;
    if (cursor === start) throw new Error('RECONNECT_REQUEST_INVALID');
    JSON.parse(text.slice(start, cursor));
  };
  value(0); whitespace(); if (cursor !== text.length) throw new Error('RECONNECT_REQUEST_INVALID');
  JSON.parse(text);
}
export function installReconnectParsers(app: Express): void {
  const parser = express.json({ limit: 16 * 1024, strict: true, inflate: false, verify: (_req, _res, bytes) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertReconnectRawJson(text);
  } });
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !/^\/api\/mobile\/session\/reconnect\/(?:challenge|[^/]+\/consume)\/?$/.test(req.path)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (!req.is('application/json')) { res.status(400).json({ errorCode: 'RECONNECT_REQUEST_INVALID', message: 'Invalid reconnect request.' }); return; }
    parser(req, res, error => {
      if (!error) { next(); return; }
      const tooLarge = (error as { type?: string }).type === 'entity.too.large';
      res.status(tooLarge ? 413 : 400).json({ errorCode: tooLarge ? 'RECONNECT_REQUEST_TOO_LARGE' : 'RECONNECT_REQUEST_INVALID', message: 'Invalid reconnect request.' });
    });
  });
}
