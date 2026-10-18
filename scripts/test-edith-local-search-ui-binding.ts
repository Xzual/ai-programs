import assert from 'node:assert/strict';
import { fetchLocalSearch, parseLocalSearchResponse, LOCAL_SEARCH_SCOPES, LocalSearchClientError, type LocalSearchScope } from '../src/edith/localSearchClient';
import { getResearch, ResearchClientError } from '../src/edith/researchClient';
// Actual clients with adversarial mocked transport; not mounted-server, rendered UI or native evidence.
const iso = '2026-10-08T12:00:00.000Z';
const row = { id: 'task:a:b/c', scope: 'task', title: '<b>plain text</b>', summary: 'Snippet', score: 4, matchedFields: ['title'], metadata: { status: 'RUNNING' },
  provenance: { source: 'edith_local_store', recordType: 'EdithTask', recordId: 'a:b/c', retrievedAt: iso } };
const envelope = (results: unknown[] = [row], scopes: readonly string[] = ['task'], correlationId = 'corr-test') => ({ success: true,
  contract: { schema: 'edith.shared', version: 2, amendment: '2.1' }, correlationId, data: { results, scopes, limit: 25 } });
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const rejects = (v: unknown) => assert.throws(() => parseLocalSearchResponse(v, ['task']), LocalSearchClientError);
const code = (expected: string) => (e: unknown) => e instanceof LocalSearchClientError && e.code === expected;
const originalFetch = globalThis.fetch;
const checks: string[] = [];
async function main() {
  assert.equal(parseLocalSearchResponse(envelope(), ['task']).results[0].title, '<b>plain text</b>');
  assert.deepEqual(parseLocalSearchResponse(envelope([]), ['task']).results, []);
  const mappings = [['memory','edith_local_store','MemoryItem','key'],['knowledge','edith_local_store','KnowledgeGraphNode','tags'],
    ['research','phase4_store','ResearchRunV2','claims'],['playbook','phase4_store','PlaybookDefinitionV2','steps']];
  const all = [row, ...mappings.map(([scope,source,recordType,field]) => ({ ...row, scope, id: `${scope}:r`, matchedFields: [field], provenance: { ...row.provenance, source, recordType, recordId:'r' } }))];
  assert.equal(parseLocalSearchResponse(envelope(all, LOCAL_SEARCH_SCOPES)).results.length, 5);
  for (const patch of [{id:'task:other'},{scope:'research'},{score:0},{score:-1},{score:Infinity},{score:1.1},{score:'4'}, {title:5},{summary:'x'.repeat(1001)},
    {matchedFields:[]},{matchedFields:['title','title']},{matchedFields:['secretField']},{metadata:{n:NaN}},{metadata:{nested:{}}},{metadata:{secret:'unsafe'}},{href:'https://example.com'},
    {provenance:{...row.provenance,recordId:'other'}},{provenance:{...row.provenance,source:'phase4_store'}},{provenance:{...row.provenance,recordType:'ResearchRunV2'}},
    {provenance:{...row.provenance,retrievedAt:'not-time'}},{provenance:{...row.provenance,retrievedAt:'2026-02-30T00:00:00.000Z'}}]) rejects(envelope([{...row,...patch}]));
  rejects(envelope([row,row])); rejects(envelope(Array(26).fill(row)));
  for (const bad of [null,[],{}, {...envelope(),success:false},{...envelope(),correlationId:''},{...envelope(),contract:{schema:'edith.shared',version:1,amendment:'2.1'}},
    {...envelope(),contract:{schema:'edith.shared',version:2,amendment:'2.0'}},{...envelope(),data:{...envelope().data,limit:100}},{...envelope(),data:{...envelope().data,scopes:['research']}}]) rejects(bad);
  checks.push('all_scope_provenance_positive_empty_plain_text_and_malformed_relations');
  let calls = 0; const controller = new AbortController();
  globalThis.fetch = (async (input, options) => {
    calls++; const url = new URL(String(input),'http://fixture.invalid');
    assert.equal(url.pathname,'/api/edith/search'); assert.deepEqual([...url.searchParams.keys()].sort(),['limit','query','scopes']);
    assert.equal(url.searchParams.get('query'),'R4 & # = fixture'); assert.equal(url.searchParams.get('limit'),'25'); assert.equal(url.searchParams.get('scopes'),'task');
    assert.equal(options?.method,'GET'); assert.equal(options?.credentials,'include'); assert.equal(options?.signal,controller.signal);
    const headers = new Headers(options?.headers); assert.equal(headers.get('Accept'),'application/json'); assert.match(headers.get('x-correlation-id')!,/^search-[a-f0-9-]+$/);
    return response(envelope([row],['task'],headers.get('x-correlation-id')!));
  }) as typeof fetch;
  await fetchLocalSearch('  \uFF324 & # = fixture  ',['task','task'],controller.signal);
  const before = calls;
  for (const query of ['', ' ', 'x'.repeat(501), Array(33).fill('x').join(' ')]) await assert.rejects(fetchLocalSearch(query,['task']),code('INVALID_SEARCH_QUERY'));
  for (const scopes of [[],['invalid'],Array(6).fill('task')]) await assert.rejects(fetchLocalSearch('query',scopes as LocalSearchScope[]),code('INVALID_SEARCH_SCOPES'));
  assert.equal(calls,before); checks.push('normalized_bounded_encoded_query_scopes_get_credentials_signal');
  for (const status of [400,401,500]) { globalThis.fetch=(async()=>new Response('not JSON',{status})) as typeof fetch; await assert.rejects(fetchLocalSearch('query',['task']),code(`LOCAL_SEARCH_HTTP_${status}`)); }
  globalThis.fetch=(async()=>new Response('{bad JSON')) as typeof fetch; await assert.rejects(fetchLocalSearch('query',['task']),code('LOCAL_SEARCH_RESPONSE_MALFORMED'));
  globalThis.fetch=(async()=>response(envelope())) as typeof fetch; await assert.rejects(fetchLocalSearch('query',['task']),code('LOCAL_SEARCH_REQUEST_MISMATCH'));
  globalThis.fetch=(async()=>{throw new TypeError('offline fixture');}) as typeof fetch; await assert.rejects(fetchLocalSearch('query',['task']),TypeError);
  checks.push('auth_validation_runtime_nonjson_offline_and_wrong_correlation');
  controller.abort(); await assert.rejects(fetchLocalSearch('query',['task'],controller.signal),{name:'AbortError'});
  const late = new AbortController(); globalThis.fetch=(async()=>{late.abort();return response(envelope());}) as typeof fetch;
  await assert.rejects(fetchLocalSearch('query',['task'],late.signal),{name:'AbortError'});
  const pending: Array<{correlation:string; resolve:(r:Response)=>void}> = [];
  globalThis.fetch=((_,options)=>new Promise<Response>(resolve=>pending.push({correlation:new Headers(options?.headers).get('x-correlation-id')!,resolve}))) as typeof fetch;
  const first=fetchLocalSearch('first',['task']), second=fetchLocalSearch('second',['task']);
  pending[1].resolve(response(envelope([],['task'],pending[1].correlation))); assert.equal((await second).correlationId,pending[1].correlation);
  pending[0].resolve(response(envelope([row],['task'],pending[0].correlation))); assert.equal((await first).correlationId,pending[0].correlation);
  checks.push('abort_before_after_and_out_of_order_client_identity_not_ui_commit');
  const runId='run/A?B#C', run={runId,query:'R4 fixture',status:'queued',sourceIds:[],artifactIds:[]};
  const research=(run:unknown,success=true)=>({success,contract:{schema:'edith.shared',version:2,amendment:'2.1'},data:{run},errorCode:'RESEARCH_FAILED'});
  const researchAbort=new AbortController(); globalThis.fetch=(async(input,options)=>{
    assert.equal(input,`/api/edith/research/${encodeURIComponent(runId)}`); assert.equal(options?.credentials,'include'); assert.equal(options?.signal,researchAbort.signal); return response(research(run));
  }) as typeof fetch;
  assert.equal((await getResearch(runId,researchAbort.signal)).runId,runId);
  for (const status of [200,400]) { globalThis.fetch=(async()=>response(research({...run,runId:'run-other'},status===200),status)) as typeof fetch;
    await assert.rejects(getResearch(runId),(e:unknown)=>e instanceof ResearchClientError && e.code==='RESEARCH_REQUEST_MISMATCH' && !e.run); }
  globalThis.fetch=(async()=>{throw new DOMException('Aborted','AbortError');}) as typeof fetch; await assert.rejects(getResearch(runId,researchAbort.signal),{name:'AbortError'});
  checks.push('research_valid_b_for_a_success_and_error_reject_encoded_id_abort');
  console.log(JSON.stringify({success:true,classification:'ACTUAL_CLIENT_ADVERSARIAL_MOCK_TRANSPORT',checks},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.fetch=originalFetch;});
