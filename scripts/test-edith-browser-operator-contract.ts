import assert from 'node:assert/strict';
import {
  BROWSER_OPERATOR_CONTRACT, BROWSER_ACTIONS, BROWSER_TOOL_IDS, BROWSER_TOOL_POLICY,
  getBrowserToolPolicy, getBrowserActionSupport, parseBrowserWorkflowRequest, parseBrowserOperatorReceipt,
  type BrowserOperatorReceipt, type BrowserPageObservation,
} from '../src/edith/browserOperatorContract';

// Pure shape checks only. No browser, network, server, permission store or native issuer.
const checks: string[] = [];
const request = (action: string, extra: Record<string, unknown> = {}) => ({ action, verificationGoal: 'Observe the requested bounded effect.', ...extra });
const acceptedRequest = (value: unknown) => {
  const parsed = parseBrowserWorkflowRequest(value);
  if (parsed.success === false) assert.fail(parsed.reason);
  return parsed.value;
};
const rejectedRequest = (value: unknown) => {
  const parsed = parseBrowserWorkflowRequest(value);
  assert.equal(parsed.success, false, JSON.stringify(value));
  if (!parsed.success) { assert.equal(parsed.errorCode, 'VALIDATION_ERROR'); assert.ok(parsed.reason.length); }
};
const url = 'https://example.com/document';
const validRequests = [
  request('search', { query: 'bounded browser contract' }),
  request('navigate', { url }), request('title', { url }), request('new_tab', { url }),
  request('extract', { url, selectors: { main: 'main' } }), request('screenshot', { url }),
  request('scroll', { sessionId: 'session-1', pageId: 'page-1', scrollDeltaY: -1000 }),
  request('fill_form', { url, selectors: { name: '#name', notes: 'textarea' }, fieldValues: { name: 'Ada', notes: '' } }),
  request('download_pdf', { url }), request('read_pdf', { url }), request('upload_file', { url, filePath: 'C:\\fixture\\document.txt' }),
];
assert.equal(validRequests.length, BROWSER_ACTIONS.length);
assert.deepEqual(new Set(validRequests.map(v => v.action)), new Set(BROWSER_ACTIONS));
validRequests.forEach(acceptedRequest);
validRequests.forEach(value => acceptedRequest({ ...value, dryRun: true }));
for (const action of ['download_pdf', 'read_pdf', 'upload_file'] as const) assert.equal(getBrowserActionSupport(action), 'unsupported');
for (const action of ['search', 'navigate', 'title', 'new_tab', 'extract', 'screenshot', 'scroll', 'fill_form'] as const) assert.equal(getBrowserActionSupport(action), 'supported');
checks.push('legacy_and_added_actions_parse_without_claiming_unsupported_execution');

for (const approvalGranted of [true, false]) {
  const result = acceptedRequest(request('navigate', { url, approvalGranted }));
  assert.equal(Object.hasOwn(result, 'approvalGranted'), false);
}
const formInput: Record<string, unknown> = request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { name: 'Ada' } });
const detachedForm = acceptedRequest(formInput);
(formInput.selectors as Record<string, string>).name = '#changed';
(formInput.fieldValues as Record<string, string>).name = 'Changed';
assert.equal(detachedForm.selectors?.name, '#name');
assert.equal(detachedForm.fieldValues?.name, 'Ada');
checks.push('legacy_boolean_is_not_authority_and_parsed_fields_are_detached');

const invalidRequests: unknown[] = [
  null, [], 'navigate', request('execute_script', { url }), { action: 'navigate', url },
  request('navigate', { url, dryRun: 'true' }), request('navigate', { url, approvalGranted: 1 }),
  request('navigate', { url: 'https://user:password@example.com/' }), request('navigate', { url: 'file:///tmp/x' }),
  request('navigate', { url: 'javascript:alert(1)' }), request('navigate', { url: '/relative' }),
  request('navigate', { url, verificationGoal: 'x'.repeat(2001) }),
  request('search', { query: 'hello', url }), request('search', { query: 'x'.repeat(2001) }),
  request('title', { url, query: 'hello' }), request('title', { pageId: 'page-1' }),
  request('title', { sessionId: 'session with spaces' }), request('title', { url, selectors: { a: '#a' } }),
  request('extract', { url, fieldValues: { a: 'text' } }), request('navigate', { url, scrollDeltaY: 1 }),
  request('scroll', { sessionId: 'session-1', pageId: 'page-1', scrollDeltaY: 0 }),
  request('scroll', { sessionId: 'session-1', pageId: 'page-1', scrollDeltaY: 1001 }),
  request('scroll', { sessionId: 'session-1', pageId: 'page-1', scrollDeltaY: 0.5 }),
  request('scroll', { sessionId: 'session-1', scrollDeltaY: 10 }),
  request('fill_form', { url, selectors: { name: '#name' } }),
  request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { other: 'Ada' } }),
  request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { name: 'Ada', extra: 'x' } }),
  request('fill_form', { url, selectors: { name: '#'.repeat(513) }, fieldValues: { name: 'Ada' } }),
  request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { name: 'x'.repeat(2001) } }),
  request('fill_form', { url, selectors: { password: '#password' }, fieldValues: { password: 'private' } }),
  request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { name: 'token=private-token' } }),
  request('extract', { url, selectors: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`field${i}`, '#field'])) }),
  request('upload_file', { url }), request('download_pdf', { url, filePath: 'fixture.txt' }),
  request('search'), request('navigate'),
  request('title', { sessionId: 12 }), request('title', { sessionId: 'session-1', pageId: 12 }),
  request('fill_form', { url, selectors: { name: 12 }, fieldValues: { name: 'Ada' } }),
  request('fill_form', { url, selectors: { name: '#name' }, fieldValues: { name: 12 } }),
];
for (const field of ['authorizedPermissions', 'permissions', 'authorization', 'ownerSessionBindingId', 'HWND', 'PID', 'token', 'x', 'endpoint', 'nativePhysicalProof']) {
  invalidRequests.push(request('navigate', { url, [field]: true }));
}
invalidRequests.forEach(rejectedRequest);
checks.push('request_bounds_action_relationships_credentials_and_authority_injection_rejected');

// Synthetic credential canaries only; errors must not relay the supplied value.
const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
const secretPatterns = [jwt, `ghp_${'a'.repeat(24)}`, `AIza${'a'.repeat(32)}`, `sk-proj-${'a'.repeat(24)}`,
  'Bearer fixture-canary', 'api_key=fixture-canary', 'client_secret=fixture-canary', 'password=fixture-canary',
  '-----BEGIN PRIVATE KEY-----'];
const credentialRequests: unknown[] = [
  request('navigate', { url: `${url}?api_key=fixture-canary` }),
  request('navigate', { url: `${url}?%74oken=fixture-canary` }),
  request('navigate', { url: `${url}?%61pi%5Fkey=fixture-canary` }),
  request('navigate', { url: `${url}?q=${encodeURIComponent(jwt)}` }),
  request('navigate', { url: `${url}#%74oken%3Dfixture-canary` }),
  request('navigate', { url: `${url}#${jwt}` }),
  request('navigate', { url: `${url}?q=%ZZ` }),
  request('navigate', { url: `${url}?%E0%A4=value` }),
  request('navigate', { url: `${url}#%E0%A4` }),
  request('navigate', { url: `${url}/%` }),
];
for (const secret of secretPatterns) {
  credentialRequests.push(request('search', { query: secret }));
  credentialRequests.push(request('navigate', { url, verificationGoal: secret }));
  credentialRequests.push(request('fill_form', { url, selectors: { notes: 'textarea' }, fieldValues: { notes: secret } }));
}
for (const value of credentialRequests) {
  rejectedRequest(value);
  const parsed = parseBrowserWorkflowRequest(value);
  assert(!JSON.stringify(parsed).includes('fixture-canary'));
  assert(!JSON.stringify(parsed).includes(jwt));
}
acceptedRequest(request('search', { query: 'API key documentation and token/password help', verificationGoal: 'Read password reset documentation.' }));
acceptedRequest(request('navigate', { url: `${url}?q=API%20key%20documentation&rate=100%25#password-help` }));
acceptedRequest(request('fill_form', { url, selectors: { notes: 'textarea' }, fieldValues: { notes: 'API key documentation; token and password help.' } }));
checks.push('credentials_rejected_before_effect_in_url_intent_and_form_without_banning_documentation');

assert.deepEqual(BROWSER_TOOL_POLICY.requiredPermissions, ['network:read', 'browser:control']);
assert.equal(BROWSER_TOOL_POLICY.riskLevel, 4);
assert.equal(BROWSER_TOOL_POLICY.requiresApproval, true);
assert.ok(Object.isFrozen(BROWSER_TOOL_POLICY));
assert.ok(Object.isFrozen(BROWSER_TOOL_POLICY.requiredPermissions));
for (const toolId of BROWSER_TOOL_IDS) assert.equal(getBrowserToolPolicy(toolId), BROWSER_TOOL_POLICY);
assert.throws(() => getBrowserToolPolicy('unregistered' as typeof BROWSER_TOOL_IDS[number]));
checks.push('four_browser_tools_share_immutable_conservative_policy');

const observedAt = new Date().toISOString();
const observation = (id: string, generation: number, scrollY = 0): BrowserPageObservation => ({
  id, sessionId: 'session-1', pageId: 'page-1', documentId: 'document-1', generation, observedAt, url, title: 'Fixture page',
  viewport: { width: 800, height: 600, scrollX: 0, scrollY, deviceScaleFactor: 1, visualOffsetX: 0, visualOffsetY: 0, visualScale: 1 },
});
const emptyReceipt = (status: BrowserOperatorReceipt['status'], action: BrowserOperatorReceipt['action'] = 'navigate'): BrowserOperatorReceipt => ({
  ...BROWSER_OPERATOR_CONTRACT, operationId: 'operation-1', action, status, backend: 'owned_headed_playwright',
  inputProvenance: 'none', nativePhysicalProof: false, postconditions: [], artifacts: [], targetIds: [], resolveAttempts: 0, inputDispatches: 0,
});
const titleReceipt: BrowserOperatorReceipt = {
  ...emptyReceipt('verified', 'title'), sessionId: 'session-1', pageId: 'page-1', inputProvenance: 'dom_api',
  before: observation('before-1', 1), after: observation('after-1', 2),
  postconditions: [{ kind: 'title_observed', matched: true, evidenceId: 'after-1' }],
};
const sha = 'a'.repeat(64);
const formReceipt: BrowserOperatorReceipt = {
  ...titleReceipt, action: 'fill_form', targetIds: ['target-name'], resolveAttempts: 1, inputDispatches: 1,
  postconditions: [{ kind: 'field_value_matched', matched: true, expectedFingerprint: sha, observedFingerprint: sha, evidenceId: 'after-1' }],
};
const scrollReceipt: BrowserOperatorReceipt = {
  ...titleReceipt, action: 'scroll', inputDispatches: 1, after: observation('after-1', 2, 100),
  postconditions: [{ kind: 'scroll_offset_matched', matched: true, evidenceId: 'after-1' }],
};
const extractReceipt: BrowserOperatorReceipt = {
  ...titleReceipt, action: 'extract', artifacts: [{ id: 'text-1', kind: 'text', sha256: sha, bytes: 42 }],
  postconditions: [{ kind: 'text_artifact_created', matched: true, evidenceId: 'text-1' }],
};
const screenshotReceipt: BrowserOperatorReceipt = {
  ...titleReceipt, action: 'screenshot', artifacts: [{ id: 'image-1', kind: 'screenshot', sha256: sha, bytes: 2048 }],
  postconditions: [{ kind: 'screenshot_artifact_created', matched: true, evidenceId: 'image-1' }],
};
const acceptedReceipt = (value: unknown) => {
  const parsed = parseBrowserOperatorReceipt(value);
  if (parsed.success === false) assert.fail(parsed.reason);
  return parsed.value;
};
const rejectedReceipt = (value: unknown) => {
  const parsed = parseBrowserOperatorReceipt(value);
  assert.equal(parsed.success, false, JSON.stringify(value));
  if (!parsed.success) assert.equal(parsed.errorCode, 'VALIDATION_ERROR');
};
[
  emptyReceipt('schema_only'), { ...emptyReceipt('configuration_required'), reasonCode: 'CONFIGURATION_REQUIRED' },
  { ...emptyReceipt('unsupported', 'download_pdf'), reasonCode: 'UNSUPPORTED_ACTION' },
  { ...emptyReceipt('blocked'), reasonCode: 'PERMISSION_DENIED' },
  { ...emptyReceipt('failed'), reasonCode: 'DEADLINE_EXCEEDED' },
  { ...titleReceipt, status: 'partial', reasonCode: 'READBACK_MISMATCH', postconditions: [{ kind: 'title_observed', matched: false, evidenceId: 'after-1' }] },
  titleReceipt, formReceipt, scrollReceipt, extractReceipt, screenshotReceipt,
  { ...titleReceipt, action: 'navigate', inputDispatches: 1, postconditions: [{ kind: 'url_committed', matched: true, evidenceId: 'after-1' }] },
  { ...titleReceipt, action: 'search', inputDispatches: 1, postconditions: [{ kind: 'search_results_observed', matched: true, evidenceId: 'after-1' }] },
  { ...titleReceipt, action: 'new_tab', inputDispatches: 1, postconditions: [{ kind: 'page_created', matched: true, evidenceId: 'after-1' }] },
].forEach(acceptedReceipt);
const parsedTitle = acceptedReceipt(titleReceipt);
parsedTitle.after!.viewport.width = 999;
assert.equal(titleReceipt.after!.viewport.width, 800);
checks.push('receipt_statuses_action_evidence_and_detached_nested_shapes');

const invalidReceipts: unknown[] = [
  { ...titleReceipt, schema: 'arbitrary.success' }, { ...titleReceipt, version: 2 },
  { ...titleReceipt, nativePhysicalProof: true }, { ...titleReceipt, nativePhysicalProof: 'false' },
  { ...titleReceipt, inputDispatches: 1 }, { ...titleReceipt, reasonCode: 'READBACK_MISMATCH' },
  { ...titleReceipt, after: undefined }, { ...titleReceipt, postconditions: [] },
  { ...titleReceipt, postconditions: [{ kind: 'url_committed', matched: true, evidenceId: 'after-1' }] },
  { ...titleReceipt, postconditions: [{ kind: 'title_observed', matched: true, evidenceId: 'missing-observation' }] },
  { ...titleReceipt, postconditions: [{ kind: 'title_observed', matched: false, evidenceId: 'after-1' }] },
  { ...titleReceipt, after: { ...titleReceipt.after!, pageId: 'unrelated-page' } },
  { ...titleReceipt, after: { ...titleReceipt.after!, generation: 1 } },
  { ...titleReceipt, after: { ...titleReceipt.after!, title: 'token=private-token' } },
  { ...titleReceipt, after: { ...titleReceipt.after!, url: 'https://example.com/?api_key=private-token' } },
  { ...titleReceipt, after: { ...titleReceipt.after!, viewport: { ...titleReceipt.after!.viewport, hwnd: 123 } } },
  { ...formReceipt, inputDispatches: 2 }, { ...formReceipt, before: undefined },
  { ...formReceipt, targetIds: ['target-name', 'target-name'] },
  { ...formReceipt, after: { ...formReceipt.after!, documentId: 'different-document' } },
  { ...formReceipt, postconditions: [{ ...formReceipt.postconditions[0], observedFingerprint: 'b'.repeat(64) }] },
  { ...scrollReceipt, after: observation('after-1', 2, 0) }, { ...scrollReceipt, inputDispatches: 2 },
  { ...extractReceipt, artifacts: [] },
  { ...extractReceipt, artifacts: [{ id: 'text-1', kind: 'text', sha256: 'invalid', bytes: 42 }] },
  { ...extractReceipt, artifacts: [{ id: 'text-1', kind: 'text', sha256: sha, bytes: 0 }] },
  { ...extractReceipt, artifacts: [{ id: 'text-1', kind: 'text', sha256: sha, bytes: 100001 }] },
  { ...screenshotReceipt, artifacts: [{ id: 'image-1', kind: 'text', sha256: sha, bytes: 2048 }] },
  { ...emptyReceipt('schema_only'), inputProvenance: 'dom_api' },
  { ...emptyReceipt('configuration_required'), reasonCode: 'PERMISSION_DENIED' },
  { ...emptyReceipt('unsupported', 'title'), reasonCode: 'UNSUPPORTED_ACTION' },
  { ...emptyReceipt('blocked'), reasonCode: 'NOT_A_FAILURE_CODE' },
  { ...emptyReceipt('failed') }, { ...titleReceipt, action: 'download_pdf' },
  { ...titleReceipt, status: new String('verified') },
  { ...titleReceipt, status: { toString: () => 'verified' } },
  { ...titleReceipt, action: 'download_pdf', status: 'partial', reasonCode: 'READBACK_MISMATCH' },
  { ...titleReceipt, after: { ...titleReceipt.after!, rawText: 'private content' } },
  { ...formReceipt, postconditions: [{ ...formReceipt.postconditions[0], value: 'Ada' }] },
  { ...extractReceipt, artifacts: [{ ...extractReceipt.artifacts[0], selectors: { main: 'main' } }] },
];
for (const field of ['approvalGranted', 'authorizedPermissions', 'selector', 'fieldValues', 'rawSecret', 'nativeBindingAuthority', 'PID', 'token', 'endpoint']) invalidReceipts.push({ ...titleReceipt, [field]: true });
invalidReceipts.forEach(rejectedReceipt);
checks.push('receipt_fake_completion_artifact_context_secret_and_authority_fields_rejected');

// This acceptance asserts only wire syntax, never existence of a trusted native issuer.
acceptedReceipt({ ...formReceipt, inputProvenance: 'native_input', nativePhysicalProof: true });
rejectedReceipt({ ...emptyReceipt('schema_only'), inputProvenance: 'native_input', nativePhysicalProof: true });
checks.push('native_shape_parsing_does_not_issue_native_authority_or_approval');
console.log(JSON.stringify({ success: true, checks, requestNegativeCases: invalidRequests.length + credentialRequests.length, credentialRequestNegativeCases: credentialRequests.length, receiptNegativeCases: invalidReceipts.length, runtimeExecuted: false }, null, 2));
