import path from 'node:path';
import { DurableStateStore } from '../../server/advanced/durableStateStore';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';
import { getEdithPersistenceStore } from './persistence';
import { taskService } from './taskService';
import {workspaceManager} from './workspaceManager';
import {hudSafeId,hudPositiveInteger,hudUtc,captureTaskHudAdmissionContext,type PersistedTaskAdmissionV1,type TaskHudBindingContextV1,type TrustedTaskHudAdmissionAuthorityV1,type TrustedTaskHudAdmissionContextV1} from './taskHudContracts';
export type {TaskHudBindingContextV1} from './taskHudContracts';
interface ContinuationBinding {ownerActor:'owner';originatingSessionBindingId:string;hud?:TaskHudBindingContextV1 & PersistedTaskAdmissionV1}

import { killSwitchService } from './killSwitch';

/** Continuation never replans completed work or guesses the outcome of an interrupted effect. */
export class TaskContinuationAdapter {
  constructor(
    private readonly store = new DurableStateStore(path.join(getEdithPersistenceStore().getPaths().dataDir, 'task-continuation.db')),
    private readonly ownerActive = ownerSessionBindingActive,
    private readonly currentWorkspace = () => workspaceManager.getConfig()?.workspaceId,
  ) {}
  bind(taskId: string, ownerSessionBindingId: string, hud?: TaskHudBindingContextV1): PersistedTaskAdmissionV1 | undefined {
    const task=taskService.getTask(taskId);
    if (!this.ownerActive(ownerSessionBindingId) || !task) throw new Error('TASK_BINDING_REQUIRED');
    if(hud && (!hudSafeId(taskId)||!hudSafeId(hud.workspaceId)||!hudSafeId(hud.voiceSessionId)||!hudSafeId(hud.utteranceId)
      ||!hudSafeId(hud.skillId)||!hudPositiveInteger(hud.commandSequence)||this.currentWorkspace()!==hud.workspaceId
      ||!hudPositiveInteger(task.revision)||!hudPositiveInteger(task.eventSequence)||!hudUtc(task.createdAt)))throw new Error('TASK_HUD_BINDING_REQUIRED');
    let admission:PersistedTaskAdmissionV1|undefined;
    this.store.update((entries) => {
      const current = entries.get(taskId) as ContinuationBinding | undefined;
      if (current && current.ownerActor !== 'owner') throw new Error('TASK_BINDING_CONFLICT');
      if(current?.hud){
        if(current.originatingSessionBindingId!==ownerSessionBindingId||hud&&(['workspaceId','voiceSessionId','utteranceId','commandSequence','skillId'] as const).some(k=>current.hud![k]!==hud[k]))throw new Error('TASK_HUD_ADMISSION_CONFLICT');
        admission=this.admission(current.hud);return;
      }
      if(!hud){entries.set(taskId,{ownerActor:'owner',originatingSessionBindingId:ownerSessionBindingId});return;}
      for(const [otherId,value] of entries){
        const other=value as ContinuationBinding;
        if(otherId!==taskId&&other.originatingSessionBindingId===ownerSessionBindingId&&other.hud?.voiceSessionId===hud.voiceSessionId&&other.hud.utteranceId===hud.utteranceId)throw new Error('TASK_HUD_ADMISSION_CONFLICT');
      }
      const persisted={...hud,taskId,revision:task.revision!,eventSequence:task.eventSequence!,admittedAt:task.createdAt};
      entries.set(taskId,{ownerActor:'owner',originatingSessionBindingId:ownerSessionBindingId,hud:persisted});
      admission=this.admission(persisted);
    });
    return admission;
  }
  /** After actual persistence, before planner/executor and outside the best-effort notification callback. */
  admitHudTask(taskId:string,skillId:string,authority:TrustedTaskHudAdmissionAuthorityV1,expected:Readonly<TrustedTaskHudAdmissionContextV1>):PersistedTaskAdmissionV1 {
    const current=captureTaskHudAdmissionContext(authority);
    if((['ownerSessionBindingId','workspaceId','voiceSessionId','utteranceId','commandSequence'] as const).some(key=>current[key]!==expected[key]))throw new Error('TASK_HUD_STALE_SCOPE');
    const admission=this.bind(taskId,current.ownerSessionBindingId,{workspaceId:current.workspaceId,voiceSessionId:current.voiceSessionId,utteranceId:current.utteranceId,commandSequence:current.commandSequence,skillId});
    if(!admission)throw new Error('TASK_HUD_BINDING_REQUIRED');
    return admission;
  }
  private admission(hud:PersistedTaskAdmissionV1):PersistedTaskAdmissionV1 {
    return {taskId:hud.taskId,skillId:hud.skillId,revision:hud.revision,eventSequence:hud.eventSequence,admittedAt:hud.admittedAt};
  }
  /** Read locator only. Every read rechecks the original live owner and actual current workspace. */
  assertHudRead(taskId:string,ownerSessionBindingId:string,workspaceId:string):void {
    if(!this.ownerActive(ownerSessionBindingId))throw new Error('OWNER_SESSION_REQUIRED');
    if(!hudSafeId(workspaceId)||this.currentWorkspace()!==workspaceId)throw new Error('TASK_HUD_FORBIDDEN');
    const binding=this.store.get(taskId) as ContinuationBinding|undefined;
    if(!binding?.hud)throw new Error('TASK_HUD_BINDING_REQUIRED');
    if(binding.ownerActor!=='owner'||binding.originatingSessionBindingId!==ownerSessionBindingId||binding.hud.workspaceId!==workspaceId)throw new Error('TASK_HUD_FORBIDDEN');
    if(!taskService.getTask(taskId))throw new Error('TASK_HUD_BINDING_REQUIRED');
  }
  async resume(taskId: string, ownerSessionBindingId: string) {
    killSwitchService.assertAllowed('tool_execution', 'owner');
    if (!this.ownerActive(ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    const binding = this.store.get(taskId) as { ownerActor?: string } | undefined;
    // A fresh authenticated local owner may explicitly continue; stored session metadata
    // itself never authorizes execution after restart.
    if (binding?.ownerActor !== 'owner') throw new Error('TASK_BINDING_REQUIRED');
    const task = taskService.getTask(taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    if(task.toolsRequired.includes('rea_analysis')||task.plan?.steps.some(step=>step.reaCall||step.suggestedTools.includes('rea_analysis')))throw new Error('REA_CONTINUATION_REQUIRES_NEW_CANONICAL_ADMISSION');
    if (task.status === 'COMPLETED' && task.verification?.status === 'PASS') return { outcome: 'already_completed' as const, task, toolCalls: 0 };
    if (task.status === 'RUNNING' || task.plan?.steps.some((step) => step.status === 'RUNNING')) throw new Error('CONTINUATION_OUTCOME_UNKNOWN');
    if (task.plan?.status !== 'READY' || !['QUEUED', 'PLANNING', 'BLOCKED'].includes(task.status)) throw new Error('CONTINUATION_NOT_READY');
    const {executorService}=await import('./executor');
    const result = await executorService.executeTask(taskId);
    if (!this.ownerActive(ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    return { outcome: result.task?.verification?.status === 'PASS' ? 'completed' as const : 'attention_required' as const, ...result };
  }
}

let continuation:TaskContinuationAdapter|undefined;
export const getTaskContinuationAdapter=()=>continuation??=new TaskContinuationAdapter();
