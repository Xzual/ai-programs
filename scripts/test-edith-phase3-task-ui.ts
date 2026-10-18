import assert from 'node:assert/strict';
import { parseTaskActivityV2, parseTaskListV2, TaskContractError } from '../src/edith/taskActivityClient';

const now = '2026-09-28T12:00:00.000Z';
const progress = {
  contractVersion: 2 as const,
  taskId: 'task-phase3',
  revision: 4,
  status: 'RUNNING' as const,
  percent: 40,
  completedSteps: 1,
  totalSteps: 3,
  failedSteps: 0,
  recoveryAttempts: 0,
  terminal: false,
  sources: ['task_status', 'plan_steps'] as const,
};
const task = {
  id: 'task-phase3',
  title: 'Build truthful task capsule',
  objective: 'Render canonical task progress',
  originalUserRequest: 'Show the active task',
  priority: 'high',
  status: 'RUNNING',
  createdAt: now,
  dependencies: [],
  subtasks: [],
  candidateAgents: [],
  toolsRequired: [],
  permissionsRequired: [],
  riskLevel: 1,
  checkpoints: [],
  artifacts: [],
  observations: [],
  validationRules: [],
  timeline: [],
  agentActivity: [],
  memoryReferences: [],
  auditEvents: [],
  contractVersion: 2,
  revision: 4,
  eventSequence: 8,
  progress,
};
const event = {
  contractVersion: 2,
  taskId: task.id,
  eventId: 'event-phase3',
  sequence: 8,
  revision: 4,
  type: 'task.step_updated',
  occurredAt: now,
  payload: { stepId: 'step-ui', status: 'RUNNING', attempt: 1 },
  context: { correlationId: 'corr-phase3', idempotencyKey: 'idem-phase3' },
};
const envelope = (data: unknown) => ({ success: true, contract: { schema: 'edith.shared', version: 2 }, data });

const tasks = parseTaskListV2(envelope({ tasks: [task] }));
assert.equal(tasks.length, 1);
assert.equal(tasks[0].progress.percent, 40);
assert.deepEqual(tasks[0].progress.sources, ['task_status', 'plan_steps']);

const activity = parseTaskActivityV2(envelope({ task: { ...task, progress: undefined }, progress, events: [event] }));
assert.equal(activity.events[0].type, 'task.step_updated');
assert.equal(activity.task.revision, 4);

assert.throws(
  () => parseTaskListV2({ success: true, tasks: [task] }),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_V2_ENVELOPE_REQUIRED',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, status: 'Working hard: 80%' }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_RECORD_INVALID',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, progress: { ...progress, percent: 80, sources: ['status_text'] } }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_PROGRESS_INVALID',
);
assert.throws(
  () => parseTaskActivityV2(envelope({ task: { ...task, progress: undefined }, progress, events: [{ ...event, taskId: 'other-task' }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_EVENT_TASK_MISMATCH',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, apiKey: 'must-never-render' }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_RECORD_INVALID',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, priority: 42 }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_RECORD_INVALID',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, plan: { steps: 'not-an-array' } }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_PLAN_INVALID',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, progress: { ...progress, status: 'COMPLETED', terminal: true } }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_PROGRESS_INVALID',
);
assert.throws(
  () => parseTaskListV2(envelope({ tasks: [{ ...task, progress: { ...progress, terminal: true } }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_PROGRESS_INVALID',
);
assert.throws(
  () => parseTaskActivityV2(envelope({ task: { ...task, progress: undefined }, progress, events: [{ ...event, sequence: 9 }] })),
  (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_EVENT_AHEAD_OF_SNAPSHOT',
);

for (const data of [{ tasks: [task] }, { task: { ...task, progress: undefined }, progress, events: [event] }]) {
  const parse = 'tasks' in data ? parseTaskListV2 : parseTaskActivityV2;
  const { success: _success, ...missingSuccess } = envelope(data);
  for (const invalidEnvelope of [missingSuccess, { ...envelope(data), success: false }]) {
    assert.throws(
      () => parse(invalidEnvelope),
      (error: unknown) => error instanceof TaskContractError && error.code === 'TASK_V2_ENVELOPE_REQUIRED',
    );
  }
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'strict_v2_envelope',
    'structured_progress_only',
    'canonical_status_only',
    'task_event_correlation',
    'ui_critical_task_shape',
    'task_progress_consistency',
    'event_snapshot_bounds',
    'secret_material_rejected',
  ],
}, null, 2));

// Additive request-correlation coverage; all original parser assertions remain unchanged.
import { fetchTaskActivityV2 } from '../src/edith/taskActivityClient';
async function testActualTaskActivityRequest() {
  const originalFetch=globalThis.fetch, requested='task/A?B#C', controller=new AbortController();
  const payload=(id:string)=>envelope({task:{...task,id,progress:undefined},progress:{...progress,taskId:id},events:[{...event,taskId:id}]});
  try {
    globalThis.fetch=(async(input,options)=>{
      assert.equal(input,`/api/edith/tasks/${encodeURIComponent(requested)}/activity`); assert.equal(options?.credentials,'include'); assert.equal(options?.signal,controller.signal);
      return new Response(JSON.stringify(payload(requested)));
    }) as typeof fetch;
    assert.equal((await fetchTaskActivityV2(requested,controller.signal)).task.id,requested);
    globalThis.fetch=(async()=>new Response(JSON.stringify(payload('task-B')))) as typeof fetch;
    await assert.rejects(fetchTaskActivityV2(requested),(e:unknown)=>e instanceof TaskContractError && e.code==='TASK_ACTIVITY_REQUEST_MISMATCH');
    assert.equal((await fetchTaskActivityV2('task-B')).task.id,'task-B');
    globalThis.fetch=(async()=>new Response('not JSON')) as typeof fetch;
    await assert.rejects(fetchTaskActivityV2(requested),(e:unknown)=>e instanceof TaskContractError && e.code==='TASK_RESPONSE_MALFORMED');
    globalThis.fetch=(async()=>{throw new DOMException('Aborted','AbortError');}) as typeof fetch;
    await assert.rejects(fetchTaskActivityV2(requested,controller.signal),{name:'AbortError'});
    console.log(JSON.stringify({success:true,checks:['actual_fetch_b_for_a_rejected','requested_b_succeeds','encoded_id_credentials_signal','malformed_and_abort_preserved']}));
  } finally { globalThis.fetch=originalFetch; }
}
testActualTaskActivityRequest().catch(e=>{console.error(e);process.exitCode=1;});
