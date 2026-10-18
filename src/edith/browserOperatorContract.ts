import type { BrowserWorkflowAction, BrowserWorkflowRequest } from './core';

/** Pure wire validation. Parsing never issues a grant, target lease or native proof. */
export const BROWSER_OPERATOR_CONTRACT = Object.freeze({ schema: 'edith.browser.operator', version: 1 } as const);
export const BROWSER_ACTIONS = Object.freeze([
  'search', 'navigate', 'extract', 'screenshot', 'download_pdf', 'read_pdf', 'upload_file', 'fill_form',
  'title', 'scroll', 'new_tab',
] as const satisfies readonly BrowserWorkflowAction[]);
export const BROWSER_TOOL_IDS = Object.freeze([
  'browser_workflow', 'browser_search', 'browser_open', 'playwright_browser_agent',
] as const);
export const BROWSER_TOOL_POLICY = Object.freeze({
  riskLevel: 4,
  requiredPermissions: Object.freeze(['network:read', 'browser:control'] as const),
  requiresApproval: true,
} as const);
export type BrowserToolId = typeof BROWSER_TOOL_IDS[number];
export type BrowserActionMode = 'READ_ONLY' | 'SAFE_NAVIGATION' | 'FORM_FILLING_WITH_APPROVAL' | 'DOWNLOAD_WITH_APPROVAL';
export const BROWSER_ACTION_MODES: Readonly<Record<BrowserWorkflowAction, BrowserActionMode>> = Object.freeze({
  search: 'SAFE_NAVIGATION', navigate: 'SAFE_NAVIGATION', extract: 'SAFE_NAVIGATION',
  screenshot: 'SAFE_NAVIGATION', title: 'READ_ONLY', scroll: 'SAFE_NAVIGATION', new_tab: 'SAFE_NAVIGATION',
  fill_form: 'FORM_FILLING_WITH_APPROVAL', read_pdf: 'READ_ONLY',
  download_pdf: 'DOWNLOAD_WITH_APPROVAL', upload_file: 'FORM_FILLING_WITH_APPROVAL',
});
export function getBrowserToolPolicy(toolId: BrowserToolId): typeof BROWSER_TOOL_POLICY {
  if (!(BROWSER_TOOL_IDS as readonly string[]).includes(toolId)) throw new Error('Unknown browser tool ID');
  return BROWSER_TOOL_POLICY;
}
export function getBrowserActionSupport(action: BrowserWorkflowAction): 'supported' | 'unsupported' {
  return ['download_pdf', 'read_pdf', 'upload_file'].includes(action) ? 'unsupported' : 'supported';
}
export type ParsedBrowserWorkflowRequest = Omit<BrowserWorkflowRequest, 'approvalGranted'>;
export type BrowserParseResult<T> = { success: true; value: T } | { success: false; errorCode: 'VALIDATION_ERROR'; reason: string };
const invalid = <T>(reason: string): BrowserParseResult<T> => ({ success: false, errorCode: 'VALIDATION_ERROR', reason });
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (row: Record<string, unknown>, allowed: readonly string[]) => Object.keys(row).every(key => allowed.includes(key));
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string'
  && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const id = (value: unknown): value is string => text(value, 256) && !/\s|[\\/]/.test(value) && !sensitive(value);
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sensitive = (value: string) => [
  /\bBearer\s+\S+|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|authorization|cookie|credential|private[_-]?key)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
].some(pattern => pattern.test(value));
const safeEvidence = (value: unknown, max: number, empty = false): value is string => text(value, max, empty)
  && !sensitive(value) && !/(?:^|\s)(?:[a-z]:[\\/]|\\\\)|^\/(?:Users|home|tmp|var|etc)\//i.test(value);
function httpUrl(value: unknown): value is string {
  if (!text(value, 4096) || /[\s\\]/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    // URLSearchParams tolerates malformed percent escapes. Reject them before it
    // decodes query keys/values, and use this fence for requests AND observations.
    const decodedUrl = decodeURIComponent(value);
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || sensitive(decodedUrl)) return false;
    if ([...url.searchParams].some(([key, item]) => /(?:token|secret|password|credential|authorization|cookie|api[_-]?key)/i.test(key) || !safeEvidence(item, 4096, true))
      || !safeEvidence(decodeURIComponent(url.hash), 4096, true)) return false;
    return true;
  } catch { return false; }
}
function stringMap(value: unknown, values: boolean): value is Record<string, string> {
  if (!plain(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 1 && entries.length <= 10 && entries.every(([key, entry]) =>
    text(key, 64) && !['__proto__', 'constructor', 'prototype'].includes(key)
    && !/(?:password|secret|token|credential|authorization|cookie|api[_-]?key)/i.test(key)
    && text(entry, values ? 2000 : 512, values) && !sensitive(entry))
    && (!values || entries.reduce((sum, [, entry]) => sum + String(entry).length, 0) <= 10000);
}

export function parseBrowserWorkflowRequest(value: unknown): BrowserParseResult<ParsedBrowserWorkflowRequest> {
  if (!plain(value) || !exact(value, ['action', 'query', 'url', 'selectors', 'filePath', 'verificationGoal',
    'dryRun', 'approvalGranted', 'sessionId', 'pageId', 'fieldValues', 'scrollDeltaY'])) return invalid('Unknown request field or non-object request.');
  const action = value.action as BrowserWorkflowAction;
  if (!(BROWSER_ACTIONS as readonly unknown[]).includes(action) || !safeEvidence(value.verificationGoal, 2000)) return invalid('Action and a non-sensitive verificationGoal are required.');
  if (('dryRun' in value && typeof value.dryRun !== 'boolean') || ('approvalGranted' in value && typeof value.approvalGranted !== 'boolean')) return invalid('Legacy approval/dryRun fields must be booleans.');
  if (('sessionId' in value && !id(value.sessionId)) || ('pageId' in value && !id(value.pageId))
    || ('pageId' in value && !('sessionId' in value))) return invalid('Invalid session/page identity.');
  if ('url' in value && !httpUrl(value.url)) return invalid('URL must be an absolute HTTP(S) URL without credentials.');
  if ('query' in value && (action !== 'search' || !safeEvidence(value.query, 2000))) return invalid('Non-sensitive query is valid only for search.');
  if (action === 'search' && (!safeEvidence(value.query, 2000) || 'url' in value)) return invalid('Search needs a non-sensitive query, not a caller search-provider URL.');
  if (['navigate', 'new_tab', 'download_pdf', 'read_pdf', 'upload_file'].includes(action) && !('url' in value)) return invalid('This action requires a URL.');
  if (['title', 'extract', 'screenshot', 'fill_form'].includes(action) && !('url' in value) && !('sessionId' in value)) return invalid('This action requires URL or an existing session.');
  if ('filePath' in value && (action !== 'upload_file' || !text(value.filePath, 4096))) return invalid('filePath is valid only for unsupported upload_file.');
  if (action === 'upload_file' && !text(value.filePath, 4096)) return invalid('upload_file requires filePath but remains unsupported.');
  if ('selectors' in value && (!['fill_form', 'extract'].includes(action) || !stringMap(value.selectors, false))) return invalid('Selectors require bounded logical keys and CSS locator strings for form/extract.');
  if ('fieldValues' in value && (action !== 'fill_form' || !stringMap(value.fieldValues, true))) return invalid('Field values are valid only for fill_form.');
  if (action === 'fill_form') {
    if (!stringMap(value.selectors, false) || !stringMap(value.fieldValues, true)) return invalid('fill_form requires explicit selectors and fieldValues.');
    const keys = Object.keys(value.selectors);
    if (keys.length !== Object.keys(value.fieldValues).length || keys.some(key => !Object.hasOwn(value.fieldValues as object, key))) return invalid('Selector and field value keys must match exactly.');
  }
  if ('scrollDeltaY' in value && (action !== 'scroll' || !integer(value.scrollDeltaY, -1000, 1000) || value.scrollDeltaY === 0)) return invalid('Scroll delta must be a nonzero integer within +/-1000.');
  if (action === 'scroll' && (!id(value.sessionId) || !id(value.pageId) || !integer(value.scrollDeltaY, -1000, 1000) || value.scrollDeltaY === 0)) return invalid('Scroll requires live session/page IDs and a bounded delta.');
  const { approvalGranted: _ignored, ...request } = value;
  return { success: true, value: { ...request,
    ...('selectors' in value ? { selectors: { ...(value.selectors as Record<string, string>) } } : {}),
    ...('fieldValues' in value ? { fieldValues: { ...(value.fieldValues as Record<string, string>) } } : {}),
  } as unknown as ParsedBrowserWorkflowRequest };
}

export const BROWSER_FAILURE_CODES = Object.freeze([
  'VALIDATION_ERROR', 'PERMISSION_DENIED', 'OWNER_SESSION_REQUIRED', 'KILL_SWITCH_ACTIVE', 'CONFIGURATION_REQUIRED',
  'UNSUPPORTED_ACTION', 'SESSION_EXPIRED', 'PAGE_SELECTION_REQUIRED', 'PAGE_NOT_FOUND', 'NAVIGATION_BLOCKED',
  'NETWORK_TARGET_UNSAFE', 'TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS', 'TARGET_CONTEXT_CHANGED', 'TARGET_STALE',
  'TARGET_OCCLUDED', 'READBACK_MISMATCH', 'SCROLL_BOUNDARY', 'DEADLINE_EXCEEDED', 'NATIVE_BINDING_UNAVAILABLE',
  'NATIVE_IDENTITY_MISMATCH', 'VIEWPORT_BINDING_INVALID', 'EFFECT_OUTCOME_UNKNOWN',
] as const);
export type BrowserFailureCode = typeof BROWSER_FAILURE_CODES[number];
export type BrowserPostconditionKind = 'url_committed' | 'search_results_observed' | 'title_observed' | 'page_created'
  | 'scroll_offset_matched' | 'field_value_matched' | 'text_artifact_created' | 'screenshot_artifact_created';
const postconditionFor: Readonly<Partial<Record<BrowserWorkflowAction, BrowserPostconditionKind>>> = Object.freeze({
  search: 'search_results_observed', navigate: 'url_committed', title: 'title_observed', new_tab: 'page_created',
  scroll: 'scroll_offset_matched', fill_form: 'field_value_matched', extract: 'text_artifact_created', screenshot: 'screenshot_artifact_created',
});
export interface BrowserPageObservation {
  id: string; sessionId: string; pageId: string; documentId: string; generation: number;
  observedAt: string; url: string; title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; deviceScaleFactor: number;
    visualOffsetX: number; visualOffsetY: number; visualScale: number };
}
export interface BrowserOperatorReceipt {
  schema: typeof BROWSER_OPERATOR_CONTRACT.schema; version: typeof BROWSER_OPERATOR_CONTRACT.version;
  operationId: string; action: BrowserWorkflowAction;
  status: 'verified' | 'partial' | 'blocked' | 'unsupported' | 'failed' | 'schema_only' | 'configuration_required';
  reasonCode?: BrowserFailureCode; sessionId?: string; pageId?: string;
  backend: 'owned_headed_playwright'; inputProvenance: 'dom_api' | 'native_input' | 'none'; nativePhysicalProof: boolean;
  before?: BrowserPageObservation; after?: BrowserPageObservation;
  postconditions: Array<{ kind: BrowserPostconditionKind; matched: boolean; expectedFingerprint?: string; observedFingerprint?: string; evidenceId: string }>;
  artifacts: Array<{ id: string; kind: 'text' | 'screenshot'; sha256: string; bytes: number }>;
  targetIds: string[]; resolveAttempts: number; inputDispatches: number;
}
function observation(value: unknown): value is BrowserPageObservation {
  if (!plain(value) || !exact(value, ['id', 'sessionId', 'pageId', 'documentId', 'generation', 'observedAt', 'url', 'title', 'viewport'])
    || !['id', 'sessionId', 'pageId', 'documentId'].every(key => id(value[key])) || !integer(value.generation, 1, Number.MAX_SAFE_INTEGER)
    || !text(value.observedAt, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt)
    || !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString() !== value.observedAt
    || !httpUrl(value.url) || !safeEvidence(value.title, 2000, true) || !plain(value.viewport)) return false;
  const vp = value.viewport;
  if (!exact(vp, ['width', 'height', 'scrollX', 'scrollY', 'deviceScaleFactor', 'visualOffsetX', 'visualOffsetY', 'visualScale'])) return false;
  return ['width', 'height'].every(key => typeof vp[key] === 'number' && Number.isFinite(vp[key]) && Number(vp[key]) > 0 && Number(vp[key]) <= 16384)
    && ['scrollX', 'scrollY', 'visualOffsetX', 'visualOffsetY'].every(key => typeof vp[key] === 'number' && Number.isFinite(vp[key]) && Math.abs(Number(vp[key])) <= 10000000)
    && ['deviceScaleFactor', 'visualScale'].every(key => typeof vp[key] === 'number' && Number.isFinite(vp[key]) && Number(vp[key]) > 0 && Number(vp[key]) <= 16);
}

/** Syntactic consistency only: the producer/native issuer must validate stored facts and authority. */
export function parseBrowserOperatorReceipt(value: unknown): BrowserParseResult<BrowserOperatorReceipt> {
  if (!plain(value) || !exact(value, ['schema', 'version', 'operationId', 'action', 'status', 'reasonCode', 'sessionId', 'pageId',
    'backend', 'inputProvenance', 'nativePhysicalProof', 'before', 'after', 'postconditions', 'artifacts', 'targetIds', 'resolveAttempts', 'inputDispatches'])
    || value.schema !== BROWSER_OPERATOR_CONTRACT.schema || value.version !== BROWSER_OPERATOR_CONTRACT.version
    || !id(value.operationId) || !(BROWSER_ACTIONS as readonly unknown[]).includes(value.action)
    || typeof value.status !== 'string' || !['verified', 'partial', 'blocked', 'unsupported', 'failed', 'schema_only', 'configuration_required'].includes(value.status)
    || value.backend !== 'owned_headed_playwright' || typeof value.inputProvenance !== 'string' || !['dom_api', 'native_input', 'none'].includes(value.inputProvenance)
    || typeof value.nativePhysicalProof !== 'boolean' || !integer(value.resolveAttempts, 0, 2) || !integer(value.inputDispatches, 0, 10)) return invalid('Invalid browser receipt envelope.');
  if (('reasonCode' in value && !(BROWSER_FAILURE_CODES as readonly unknown[]).includes(value.reasonCode))
    || ('sessionId' in value && !id(value.sessionId)) || ('pageId' in value && (!id(value.pageId) || !id(value.sessionId)))) return invalid('Invalid receipt reason/session/page.');
  if (('before' in value && !observation(value.before)) || ('after' in value && !observation(value.after))) return invalid('Invalid page observation.');
  const before = value.before as BrowserPageObservation | undefined, after = value.after as BrowserPageObservation | undefined;
  for (const obs of [before, after]) if (obs && (obs.sessionId !== value.sessionId || obs.pageId !== value.pageId)) return invalid('Observation does not bind to receipt session/page.');
  if (before && after && (after.generation <= before.generation || Date.parse(after.observedAt) < Date.parse(before.observedAt))) return invalid('Post observation must be newer.');
  if (!Array.isArray(value.targetIds) || value.targetIds.length > 10 || !value.targetIds.every(id) || new Set(value.targetIds).size !== value.targetIds.length
    || !Array.isArray(value.artifacts) || value.artifacts.length > 10 || !Array.isArray(value.postconditions) || value.postconditions.length > 20) return invalid('Invalid bounded receipt lists.');
  const artifacts = value.artifacts as BrowserOperatorReceipt['artifacts'];
  if (!artifacts.every(a => plain(a) && exact(a, ['id', 'kind', 'sha256', 'bytes']) && id(a.id) && ['text', 'screenshot'].includes(a.kind)
    && fingerprint(a.sha256) && integer(a.bytes, 1, a.kind === 'text' ? 100000 : 10000000)) || new Set(artifacts.map(a => a.id)).size !== artifacts.length) return invalid('Invalid artifact evidence.');
  const evidenceIds = new Set([...artifacts.map(a => a.id), ...[before?.id, after?.id].filter((item): item is string => !!item)]);
  const conditions = value.postconditions as BrowserOperatorReceipt['postconditions'];
  if (!conditions.every(c => plain(c) && exact(c, ['kind', 'matched', 'expectedFingerprint', 'observedFingerprint', 'evidenceId'])
    && Object.values(postconditionFor).includes(c.kind) && typeof c.matched === 'boolean' && id(c.evidenceId) && evidenceIds.has(c.evidenceId)
    && (!('expectedFingerprint' in c) || fingerprint(c.expectedFingerprint)) && (!('observedFingerprint' in c) || fingerprint(c.observedFingerprint))
    && !(c.matched && c.expectedFingerprint && c.observedFingerprint && c.expectedFingerprint !== c.observedFingerprint))) return invalid('Invalid postcondition evidence binding.');
  if (value.nativePhysicalProof && (value.inputProvenance !== 'native_input' || value.inputDispatches === 0 || value.status !== 'verified')) return invalid('DOM/read-only/partial receipts cannot claim native physical proof.');
  if (value.inputProvenance === 'none' && value.inputDispatches !== 0) return invalid('None provenance cannot contain input.');
  const action = value.action as BrowserWorkflowAction, status = value.status as BrowserOperatorReceipt['status'];
  if (getBrowserActionSupport(action) === 'unsupported' && (status === 'verified' || status === 'partial' || before || after
    || value.inputDispatches !== 0 || conditions.length || artifacts.length || value.targetIds.length)) return invalid('Unsupported action cannot report execution.');
  if (status === 'schema_only' || status === 'configuration_required' || status === 'unsupported' || status === 'blocked') {
    if (value.inputDispatches !== 0 || value.nativePhysicalProof || value.inputProvenance !== 'none' || before || after
      || conditions.length || artifacts.length || value.targetIds.length || value.resolveAttempts !== 0) return invalid('Nonexecuted status cannot include execution evidence.');
  }
  if ((status === 'configuration_required' && value.reasonCode !== 'CONFIGURATION_REQUIRED')
    || (status === 'unsupported' && (getBrowserActionSupport(action) !== 'unsupported' || value.reasonCode !== 'UNSUPPORTED_ACTION'))
    || (status === 'schema_only' && 'reasonCode' in value)
    || (['partial', 'blocked', 'failed'].includes(status) && !('reasonCode' in value))) return invalid('Status requires an exact reason.');
  if (status === 'verified') {
    if (getBrowserActionSupport(action) !== 'supported' || 'reasonCode' in value || !after || !id(value.sessionId) || !id(value.pageId)
      || value.inputProvenance === 'none' || !conditions.length || !conditions.every(c => c.matched)
      || !conditions.some(c => c.kind === postconditionFor[action])) return invalid('Verified requires supported action and fresh matching action evidence.');
    if (['title', 'extract', 'screenshot', 'scroll', 'fill_form'].includes(action) && before && (before.documentId !== after.documentId || before.url !== after.url)) return invalid('Action changed its document context.');
    if (action === 'scroll' && (!before || value.inputDispatches !== 1 || before.viewport.scrollY === after.viewport.scrollY)) return invalid('Scroll requires actual changed offset and one dispatch.');
    if (action === 'fill_form' && (!before || !value.targetIds.length || value.resolveAttempts < 1 || value.inputDispatches !== value.targetIds.length
      || conditions.filter(c => c.kind === 'field_value_matched' && c.expectedFingerprint && c.observedFingerprint).length !== value.targetIds.length)) return invalid('Form requires per-target value fingerprints and dispatch counts.');
    if (['extract', 'screenshot', 'title'].includes(action) && value.inputDispatches !== 0) return invalid('Observation action cannot claim input.');
    if (action === 'extract' || action === 'screenshot') {
      const kind = action === 'extract' ? 'text' : 'screenshot';
      if (!artifacts.some(a => a.kind === kind && conditions.some(c => c.kind === postconditionFor[action] && c.evidenceId === a.id))) return invalid('Requested artifact is required, not a page title.');
    }
  }
  // Return a detached JSON shape: callers cannot mutate the parsed result through input aliases.
  return { success: true, value: JSON.parse(JSON.stringify(value)) as BrowserOperatorReceipt };
}
