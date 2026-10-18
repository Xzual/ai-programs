import { createHash } from 'node:crypto';
import { ReaContractError, snapshotReaJson, validateReaRemoteEvidence, type ReaRemoteFlowContext, type ReaRemoteFlowResult, type ReaTechnicalFact } from './reaContract';

type Row = Record<string, unknown>;
type Check = (value: unknown) => void;
const invalid = (): never => { throw new ReaContractError('REA_REPLY_INVALID'); };
const row = (value: unknown): Row => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Row; };
const text: Check = value => { if (typeof value !== 'string') invalid(); };
const integer: Check = value => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); };
const exact = (expected: unknown): Check => value => { if (value !== expected) invalid(); };
const oneOf = (...values: unknown[]): Check => value => { if (!values.includes(value)) invalid(); };
const array = (check: Check): Check => value => { if (!Array.isArray(value) || value.length > 20000) invalid(); for (const item of value as unknown[]) check(item); };
const object = (fields: Record<string, Check>): Check => value => { const obj = row(value); if (Object.keys(obj).length !== Object.keys(fields).length || Object.keys(fields).some(key => !Object.hasOwn(obj, key))) invalid(); for (const [key, check] of Object.entries(fields)) check(obj[key]); };
const digest: Check = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); };
const json: Check = value => {
  function visit(v: unknown, depth: number): void { if (depth > 64) invalid(); if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return; if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; } for (const item of Object.values(row(v))) visit(item, depth + 1); }
  visit(value, 0);
};
const numericLiteral = object({ pointer: text, producer_type: oneOf('json-number', 'integer', 'float'), literal: text });
const redaction: Check = value => { const item = row(value); object({ pointer: text, reason: oneOf('transport-credential', 'explicit-sensitive-value'), ...(Object.hasOwn(item, 'scope') ? { scope: exact('property-name') } : {}) })(item); if (Object.hasOwn(item, 'scope') && item.reason !== 'explicit-sensitive-value') invalid(); };
const binary: Check = value => {
  const item = row(value);
  object({ pointer: text, representation: oneOf('producer-bytes', 'har-base64-content'), state: oneOf('retained', 'redacted'), bytes: item.state === 'retained' ? integer : exact(null), sha256: item.state === 'retained' ? digest : exact(null), content_base64: item.state === 'retained' ? text : exact(null) })(item);
  if (item.state === 'retained') {
    const encoded = item.content_base64 as string;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) invalid();
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) invalid();
  }
};
const location: Check = value => {
  const item = row(value);
  if (item.kind === 'unknown') object({ kind: exact('unknown'), reason: exact('explicit-sensitive-value') })(item);
  else if (item.kind === 'json-pointer') object({ kind: exact('json-pointer'), pointer: text })(item);
  else if (item.kind === 'archive-members') { object({ kind: exact('archive-members'), members: array(text) })(item); if (!(item.members as unknown[]).length) invalid(); }
  else { object({ kind: exact('byte-range'), offset: integer, bytes: integer })(item); if (item.bytes === 0) invalid(); }
};
const provider = { id: 'har-schema/lossless-json', name: 'REA HAR capture adapter', version: 'har-schema@2.0.0;jsonc-parser@3.3.1;lossless-json@4.3.1' } as const;
const captureSchema = object({
  decoder: object({ id: exact(provider.id), name: exact(provider.name), version: exact(provider.version) }),
  container: object({ reported: json, numeric_literals: array(numericLiteral), redactions: array(redaction), records_pointer: value => { if (value !== null) text(value); } }),
  total_records: integer,
  records: array(object({ ordinal: integer, location, reported: json, binary_fields: array(binary), numeric_literals: array(numericLiteral), redactions: array(redaction), limitations: array(text) })),
  artifact: object({ path: text, sha256: digest, bytes: integer }),
  format: exact('har'), runtime_attribution: exact('unknown'), limitations: array(text),
});

/** Historical selected bytes only. This flow never resolves or fetches a recorded URL. */
export async function runReaWeb(ctx: ReaRemoteFlowContext): Promise<ReaRemoteFlowResult> {
  ctx.assertCurrent();
  const binding = ctx.target.binding;
  if (binding.profile !== 'web' || ctx.input.profile !== 'web' || Object.keys(ctx.input.profileOptions ?? {}).length || ctx.input.featureQuery !== undefined) throw new ReaContractError('REA_INPUT_INVALID');
  if (binding.target.kind === 'web-url') throw new ReaContractError('REA_REMOTE_NETWORK_UNSUPPORTED');
  if (binding.target.kind !== 'retained-har' || binding.permission.kind !== 'historical-capture' || binding.permission.network !== 'none' || binding.permission.actions.length) throw new ReaContractError('REA_REMOTE_SELECTION_FORBIDDEN');
  const capturePath = ctx.capturePath;
  if (typeof capturePath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(capturePath) || capturePath.includes('\0') || !/^[a-f0-9]{64}$/.test(binding.target.sha256)) throw new ReaContractError('REA_REMOTE_SELECTION_FORBIDDEN');
  const args = Object.freeze({ capture_path: capturePath, format: 'har', detail: 'complete' });
  ctx.assertCurrent(); await ctx.requireAvailable('inspect_web_network_capture'); ctx.assertCurrent();
  const response = await ctx.callTool('inspect_web_network_capture', args); ctx.assertCurrent();
  const envelope = row(snapshotReaJson(response));
  const allowed = ['content', 'structuredContent', 'isError', '_meta'];
  if (!Object.hasOwn(envelope, 'content') || !Object.hasOwn(envelope, 'structuredContent') || Object.keys(envelope).some(key => !allowed.includes(key)) || (envelope.isError !== undefined && typeof envelope.isError !== 'boolean')) invalid();
  array(value => { text(row(value).type); })(envelope.content);
  if (envelope.isError === true) throw new ReaContractError('REA_NOT_AVAILABLE');
  const body = row(envelope.structuredContent), normalized = row(body.normalized_result);
  captureSchema(normalized);
  const records = normalized.records as Row[], artifact = row(normalized.artifact);
  if (normalized.total_records !== records.length || records.some((item, i) => item.ordinal !== i) || artifact.path !== capturePath || artifact.sha256 !== binding.target.sha256 || (artifact.bytes as number) > 33554432) invalid();
  if (row(normalized.container).records_pointer !== '/log/entries') invalid();
  const evidence = validateReaRemoteEvidence(body, { operation: 'inspect_web_network_capture', parameters: { capture_path: capturePath, format: 'har', record_ordinals: records.map(item => item.ordinal), sensitive_value_count: 0 }, providerId: provider.id, providerVersion: provider.version, capturePath, captureSha256: binding.target.sha256 });
  let binaries = 0, retainedBytes = 0, numbers = (row(normalized.container).numeric_literals as unknown[]).length, redactions = (row(normalized.container).redactions as unknown[]).length;
  for (const item of records) { numbers += (item.numeric_literals as unknown[]).length; redactions += (item.redactions as unknown[]).length; for (const value of item.binary_fields as Row[]) { binaries++; if (value.state === 'retained') { retainedBytes += value.bytes as number; if (!Number.isSafeInteger(retainedBytes)) invalid(); } } }
  const values: readonly [string, string, number, string][] = [ ['capture_records', 'Retained historical records', records.length, 'total_records'], ['capture_bytes', 'Selected capture bytes', artifact.bytes as number, 'artifact/bytes'], ['capture_binary_fields', 'Returned binary fields', binaries, 'records'], ['capture_retained_binary_bytes', 'Retained decoded binary bytes', retainedBytes, 'records'], ['capture_numeric_literals', 'Preserved numeric literals', numbers, ''], ['capture_redactions', 'Reported redactions', redactions, ''] ];
  const technicalFacts: ReaTechnicalFact[] = values.map(([key, label, value, pointer]) => Object.freeze({ key, label, value, jsonPointer: '/normalized_result' + (pointer ? '/' + pointer : ''), evidenceId: evidence.originalEvidenceId, scope: 'producer-returned', confidence: 'observed', limitation: 'Historical capture only; counts cover returned producer records and sidecars, not current network activity or authenticated server behavior.' }));
  ctx.assertCurrent();
  return Object.freeze({ evidence, technicalFacts: Object.freeze(technicalFacts), evidenceKind: 'analysis', sourceCoverage: 'complete', evidenceRefs: Object.freeze([evidence.originalEvidenceId]), providerCleanup: 'confirmed', observationKind: 'historical-capture' });
}
