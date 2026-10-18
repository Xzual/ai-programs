import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReaSafeReport } from '../src/edith/reaAnalysisService';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'artifacts/rea-integration-20261017/chat5/local-profiles/compat-adapter');
let subject: typeof import('../src/edith/reaAnalysisService') | undefined;
try { subject = await import('../src/edith/reaAnalysisService'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof subject?.createReaAnalysisService, 'function', 'private REA admission and analysis service must exist');
const { createReaAnalysisService } = subject!;
const { createReaAnalysisTool, renderReaKnowledgeReport, createReaTaskObservedMetrics } = await import('../src/edith/reaTools');
assert.equal(typeof createReaTaskObservedMetrics, 'function', 'verified metrics must project to the frozen HUD wire contract');
const sandbox = path.join(evidence, 'adapter', 'workspace');
await mkdir(sandbox, { recursive: true });
const staging = path.join(evidence, 'adapter/staging');
await mkdir(staging, { recursive: true });
const bytes = await readFile(path.join(evidence, 'contract/synthetic-target.txt'));
const golden = JSON.parse(await readFile(path.join(evidence, 'contract/golden-evidence.json'), 'utf8'));
const summaryGolden = JSON.parse(await readFile(path.join(evidence, 'contract/golden-summary-evidence.json'), 'utf8'));
const target = path.join(sandbox, 'selected.dll');
await writeFile(target, bytes);
const asarTarget = path.join(sandbox, 'selected.asar'); await writeFile(asarTarget, bytes);
const cases: string[] = [];
async function test(name: string, work: () => Promise<void>) { await work(); cases.push(name); }
function fact(report: ReaSafeReport | undefined, key: string) {
  assert.ok(report); const found = report.technicalFacts.find(item => item.key === key); assert.ok(found); return found;
}
function setup(mode = 'ok', totalTimeoutMs = 120000, profile = 'static-managed') {
  let active = true, killed = false, ready = true;
  const controller = new AbortController();
  const selected = profile === 'static-javascript' ? asarTarget : target;
  const kernel = createReaAnalysisService({
    launch: { command: process.execPath, args: [path.join(evidence, 'adapter/fixture.mjs'), mode, selected], cwd: evidence, env: {}, expectedServerName: 'rea', expectedServerVersion: '6.5.0', protocolVersion: '2025-11-25', timeoutMs: 800 },
    expectedCatalogDigest: 'c'.repeat(64), expectedServerPath: path.join(evidence, 'adapter/fixture.mjs'), serverBootId: 'adapter-boot', stagingRoot: staging, totalTimeoutMs,
    isOwnerActive: () => active, isKillSwitchActive: () => killed, isProfileReady: () => ready,
  });
  const authority = kernel.admission.issueAuthority({ ownerId: 'owner', workspaceId: 'workspace', taskId: 'task', runId: 'run', serverBootId: 'adapter-boot', expiresAt: Date.now() + 30000, signal: controller.signal });
  const selectionRef = kernel.admission.registerSelection({ ownerId: 'owner', workspaceId: 'workspace', workspaceRoot: sandbox, absolutePath: selected, sha256: golden.subject.digest.sha256, expiresAt: Date.now() + 30000 });
  const input = { schemaVersion: 1, selectionRef, profile, objective: 'Inspect selected artifact' };
  return { ...kernel, authority, input, controller, revoke: () => { active = false; }, kill: () => { killed = true; }, unready: () => { ready = false; } };
}
await test('real stdio Evidence becomes bounded safe report without target content', async () => {
  const s = setup();
  const result = await createReaAnalysisTool(s.service).execute(s.input, s.authority);
  assert.equal(result.outcome, 'partial');
  const safeReport = result.report; assert.ok(safeReport);
  assert.deepEqual(result.cleanup, { closed: true, unknownEffect: false });
  assert.equal(safeReport.originalEvidenceId, summaryGolden.evidence_id);
  assert.match(safeReport.projectionDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(`ev_${safeReport.projectionDigest}`, summaryGolden.evidence_id);
  assert.equal(safeReport.coverage, 'unverified');
  assert.deepEqual(safeReport.observedMetrics.map(m => [m.key, m.value, m.unit]), [['verified_evidence_records', 1, 'records']]);
  const report = renderReaKnowledgeReport(safeReport);
  await writeFile(path.join(evidence, 'adapter/SYNTHETIC-SAFE-REPORT.md'), report, 'utf8');
  assert.ok(report.includes(summaryGolden.evidence_id));
  for (const secret of ['INJECTION', target, 'raw_result', 'https://']) assert.equal(report.includes(secret), false);
  assert.equal(safeReport.sourceCoverage, 'partial');
  assert.equal(fact(safeReport, 'runtime_family').value, 'modern-dotnet');
  assert.ok(report.includes('modern-dotnet'));
  assert.equal(safeReport.technicalFacts[0].provenance.evidenceId, summaryGolden.evidence_id);
  assert.equal(Object.isFrozen(safeReport), true);
  assert.throws(() => renderReaKnowledgeReport({ ...safeReport, summary: 'injected' }));
  const metric = createReaTaskObservedMetrics(safeReport, { attempt: 2, stepId: 'step-1', assertCurrent() {} });
  assert.deepEqual(metric.values, [{ name: 'rea.verified_evidence_records', unit: 'count', value: 1 }]);
  assert.deepEqual(metric.evidenceRefs, [summaryGolden.evidence_id]); assert.equal(metric.coverage, 'partial');
  assert.equal(metric.attempt, 2); assert.equal(metric.scope.stepId, 'step-1');
  assert.throws(() => createReaTaskObservedMetrics(safeReport, { attempt: 0, assertCurrent() {} }));
  assert.throws(() => createReaTaskObservedMetrics(safeReport, { attempt: 2, assertCurrent() { throw Error('revoked'); } }));
  assert.strictEqual(await s.service.run(s.input, s.authority), result, 'same admitted request replays without another child');
  assert.equal((await s.service.run({ ...s.input, objective: 'different' }, s.authority)).reasonCode, 'REA_IDEMPOTENCY_CONFLICT');
});
await test('JavaScript ASAR profile uses exact static arguments and useful scoped observations', async () => {
  const s = setup('js', 120000, 'static-javascript');
  const result = await s.service.run(s.input, s.authority);
  assert.equal(result.outcome, 'partial'); assert.ok(result.report); assert.equal(result.report.sourceCoverage, 'unknown');
  assert.equal(fact(result.report, 'parsed_javascript_files').value, 6);
  assert.equal(fact(result.report, 'ipc_operations').value, 7);
  assert.deepEqual(await readdir(staging), []);
});
await test('different normalized analysis yields different useful attributable facts', async () => {
  const base = setup(); const changed = setup('alternate');
  const a = await base.service.run(base.input, base.authority);
  const b = await changed.service.run(changed.input, changed.authority);
  assert.equal(b.outcome, 'partial');
  assert.ok(a.report); assert.ok(b.report);
  assert.equal(fact(b.report, 'runtime_family').value, 'unity-mono');
  assert.equal(fact(b.report, 'references').value, 12);
  assert.notEqual(a.report.projectionDigest, b.report.projectionDigest);
  assert.notEqual(a.report.summary, b.report.summary);
});
await test('MCP receives only a verified private snapshot and removes it after close', async () => {
  const s = setup('snapshot-only');
  assert.equal((await s.service.run(s.input, s.authority)).outcome, 'partial');
  assert.deepEqual(await readdir(staging), []);
});
await test('elapsed deadline cannot start analysis after file resolution', async () => {
  const s = setup('ok', 1);
  const result = await s.service.run(s.input, s.authority);
  assert.notEqual(result.outcome, 'completed'); assert.equal(result.report, undefined);
  assert.deepEqual(await readdir(staging), []);
});
await test('concurrent distinct admissions cannot multiply owned child processes', async () => {
  const s = setup('delay');
  const first = s.service.run(s.input, s.authority);
  const other = s.admission.issueAuthority({ ownerId: 'owner', workspaceId: 'workspace', taskId: 'other-task', runId: 'other-run', serverBootId: 'adapter-boot', expiresAt: Date.now() + 30000, signal: new AbortController().signal });
  const second = await s.service.run(s.input, other);
  await first;
  assert.equal(second.reasonCode, 'REA_BUSY');
});
await test('strict public tool input cannot forge execution authority', async () => {
  const s = setup();
  assert.equal((await s.service.run(s.input, {} as any)).reasonCode, 'REA_AUTHORITY_INVALID');
  assert.equal((await s.service.run({ ...s.input, ownerId: 'owner' }, s.authority)).reasonCode, 'REA_INPUT_INVALID');
  const foreign = s.admission.issueAuthority({ ownerId: 'foreign', workspaceId: 'workspace', taskId: 'other', runId: 'other', serverBootId: 'adapter-boot', expiresAt: Date.now() + 30000, signal: new AbortController().signal });
  assert.equal((await s.service.run(s.input, foreign)).reasonCode, 'REA_SELECTION_FORBIDDEN');
});
await test('remote profiles require a separate selected capability without dispatch', async () => {
  const peerRoot=path.join(root,'artifacts/rea-integration-20261017/chat5/remote-profiles'), invocation='00000000-0000-4000-8000-000000000000';
  const starts=async()=>{try{return(await readFile(path.join(peerRoot,'peer-events.jsonl'),'utf8')).split('\n').filter(line=>line.includes(invocation)&&line.includes('"event":"start"')).length;}catch(error){if((error as any).code==='ENOENT')return 0;throw error;}};
  const before=await starts();
  const k=createReaAnalysisService({launch:{command:process.execPath,args:[path.join(peerRoot,'synthetic-peer.mjs'),'web','ok',invocation],cwd:peerRoot,env:{},expectedServerName:'rea',expectedServerVersion:'6.5.0',protocolVersion:'2025-11-25'},expectedCatalogDigest:'c'.repeat(64),expectedServerPath:path.join(peerRoot,'synthetic-peer.mjs'),serverBootId:'adapter-boot',stagingRoot:staging,isOwnerActive:()=>true,isKillSwitchActive:()=>false,isProfileReady:()=>true});
  const authority=k.admission.issueAuthority({ownerId:'owner',workspaceId:'workspace',taskId:'remote-denied',runId:'remote-denied',serverBootId:'adapter-boot',expiresAt:Date.now()+30000,signal:new AbortController().signal});
  const selectionRef=k.admission.registerSelection({ownerId:'owner',workspaceId:'workspace',workspaceRoot:sandbox,absolutePath:target,sha256:golden.subject.digest.sha256,expiresAt:Date.now()+30000});
  for(const profile of ['web','electron-passive-runtime','runtime-observation']){const r=await k.service.run({schemaVersion:1,selectionRef,profile,objective:'Inspect explicit selection'},authority);assert.equal(r.outcome,'blocked');assert.equal(r.reasonCode,'REA_REMOTE_SELECTION_FORBIDDEN');assert.equal(r.report,undefined);assert.deepEqual(r.cleanup,{closed:true,unknownEffect:false});}
  assert.equal(await starts(),before,'foreign/local capability must start zero synthetic peers');
});
for (const mode of ['catalog-digest', 'availability', 'wrong-evidence', 'missing-evidence', 'error-result', 'boot-change']) await test(mode + ' cannot publish a report', async () => {
  const s = setup(mode); const result = await s.service.run(s.input, s.authority);
  assert.notEqual(result.outcome, 'completed'); assert.equal(result.report, undefined); assert.equal(result.cleanup.closed, true);
});
await test('revoked or killed authority cannot launch or replay', async () => {
  const s = setup(); s.revoke(); assert.equal((await s.service.run(s.input, s.authority)).reasonCode, 'REA_AUTHORITY_REVOKED');
  const k = setup(); k.kill(); assert.equal((await k.service.run(k.input, k.authority)).reasonCode, 'REA_KILL_SWITCH');
  const r = setup(); r.unready(); assert.equal((await r.service.run(r.input, r.authority)).reasonCode, 'REA_PROFILE_NOT_READY');
});
await test('target digest changes are rejected before analysis', async () => {
  const s = setup(); await writeFile(target, 'changed');
  try { assert.equal((await s.service.run(s.input, s.authority)).reasonCode, 'REA_SELECTION_CHANGED'); }
  finally { await writeFile(target, bytes); }
});
await test('foreign root and symlink escapes fail closed', async () => {
  const s = setup();
  const foreign = s.admission.registerSelection({ ownerId: 'owner', workspaceId: 'workspace', workspaceRoot: path.join(sandbox, 'other-root'), absolutePath: target, sha256: golden.subject.digest.sha256, expiresAt: Date.now() + 30000 });
  assert.equal((await s.service.run({ ...s.input, selectionRef: foreign }, s.authority)).reasonCode, 'REA_SELECTION_FORBIDDEN');
  const link = path.join(sandbox, 'link.dll');
  try { await symlink(target, link); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const linked = setup();
  const ref = linked.admission.registerSelection({ ownerId: 'owner', workspaceId: 'workspace', workspaceRoot: sandbox, absolutePath: link, sha256: golden.subject.digest.sha256, expiresAt: Date.now() + 30000 });
  assert.equal((await linked.service.run({ ...linked.input, selectionRef: ref }, linked.authority)).reasonCode, 'REA_SELECTION_FORBIDDEN');
});
for (const action of ['abort', 'kill', 'revoke']) await test(action + ' during response suppresses late result and awaits cleanup', async () => {
  const s = setup('delay'); const pending = s.service.run(s.input, s.authority);
  setTimeout(() => action === 'abort' ? s.controller.abort() : action === 'kill' ? s.kill() : s.revoke(), 250);
  const result = await pending; assert.notEqual(result.outcome, 'completed'); assert.equal(result.report, undefined); assert.equal(result.cleanup.closed, true);
});
await test('selection capability revocation suppresses late result', async () => {
  const s = setup('delay'); const pending = s.service.run(s.input, s.authority);
  setTimeout(() => s.admission.revokeSelection(s.input.selectionRef), 250);
  const result = await pending; assert.notEqual(result.outcome, 'completed'); assert.equal(result.report, undefined); assert.equal(result.cleanup.closed, true);
  assert.deepEqual(await readdir(staging), []);
});
await test('issued authority and selection snapshots survive caller mutation', async () => {
  const s = setup();
  const context = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'mutation-task', runId: 'mutation-run', serverBootId: 'adapter-boot', expiresAt: Date.now() + 30000, signal: new AbortController().signal };
  const capability = s.admission.issueAuthority(context); context.ownerId = 'foreign'; context.expiresAt = 0;
  const result = await s.service.run(s.input, capability); assert.equal(result.outcome, 'partial');
  s.revoke(); assert.equal((await s.service.run(s.input, capability)).reasonCode, 'REA_AUTHORITY_REVOKED');
});
await test('export requires separate configured authorization and never becomes implicit', async () => {
  const s = setup(); const result = await s.service.run({ ...s.input, exportAuthorizationRef: 'export_unissued' }, s.authority);
  assert.equal(result.reasonCode, 'REA_EXPORT_NOT_CONFIGURED'); assert.equal(result.report, undefined);
});
assert.deepEqual(await readdir(staging), []);
console.log(JSON.stringify({ passed: true, cases, scope: 'synthetic selected files (not actual PE/ASAR analysis) and stdio peer; actual production adapter imports' }));
