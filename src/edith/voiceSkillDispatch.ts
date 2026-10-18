import path from 'node:path';
import { Phase4IdempotencyStore } from '../../server/routes/phase4IdempotencyStore';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';
import { getEdithPersistenceStore } from './persistence';
import { taskService } from './taskService';
import { plannerService } from './planner';
import { executorService } from './executor';
import { edithToolRegistry } from './serverRegistry';
import { killSwitchService } from './killSwitch';
import { TaskContinuationAdapter } from './taskContinuationAdapter';
import { getSkillRegistry, type SkillRegistrySnapshot } from './skillRegistry';
import { permissionService } from './permissionService';
import {captureTaskHudAdmissionContext,type TrustedVoiceDispatchHooksV1} from './taskHudContracts';
export type {TrustedVoiceDispatchHooksV1} from './taskHudContracts';

export interface VoiceSkillTranscript {
  ownerSessionBindingId: string;
  voiceSessionId: string;
  utteranceId: string;
  text: string;
  isFinal: boolean;
}
export interface VoiceSkillIntent { skillId: string; objective: string; toolIds: string[]; requiredPermissions?: string[] }
/** Supplied only by trusted server composition, never accepted from a transcript payload. */
export type VoiceSkillIntentResolver = (text: string) => VoiceSkillIntent | undefined | Promise<VoiceSkillIntent | undefined>;

export const resolveBuiltinVoiceSkill: VoiceSkillIntentResolver = (text) => {
  const command = text.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/[.!?]+$/, '');
  if (['sistem durumunu göster', 'sistem durumunu kontrol et', 'system status', 'check system status'].includes(command)) return { skillId: 'system_status', objective: 'Read system health status and verify the report.', toolIds: ['system_monitor'] };
  if (['becerileri listele', 'yetenekleri listele', 'list skills'].includes(command)) return { skillId: 'skill_store', objective: 'List available AI skills and verify catalog output.', toolIds: ['ai_skill_catalog'] };
  if (['yetenek durumunu göster', 'show capabilities'].includes(command)) return { skillId: 'control_center', objective: 'Read Mark L capabilities and verify output.', toolIds: ['mark_l_capabilities'] };
  return undefined;
};

/** Exact approved read profiles, validated against current canonical skill readiness.
 * SkillStore's planned installer is never made executable by its read-only catalog view.
 */
export function createRegistryVoiceSkillResolver(readRegistry: () => Promise<SkillRegistrySnapshot> = () => getSkillRegistry({ forceRefresh: true })): VoiceSkillIntentResolver {
  return async (text) => {
    const snapshot = await readRegistry();
    const checkedAt = Date.parse(snapshot.checkedAt);
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 30_000 || checkedAt > Date.now() + 1_000) return undefined;
    const command = text.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/[.!?]+$/, '');
    let intent = await resolveBuiltinVoiceSkill(text);
    if (['awesome skill kataloğunu göster', 'awesome_skill_catalog_search', 'awesome agent skills catalog search'].includes(command)) {
      intent = { skillId: 'control_center', objective: 'List Awesome Agent Skills catalog and verify catalog skills output.', toolIds: ['awesome_skill_catalog_search'] };
    }
    // Catalog viewing is a control-center read action; the planned SkillStore installer stays blocked.
    if (intent?.skillId === 'skill_store') intent = { ...intent, skillId: 'control_center' };
    if (!intent) {
      const skill = snapshot.skills.find((skill) => [skill.id, skill.name, ...skill.examples].some((name) => name.normalize('NFKC').toLocaleLowerCase('tr-TR').trim() === command));
      if (skill?.id === 'system_status') intent = { skillId: skill.id, objective: 'Read system health status and verify the report.', toolIds: ['system_monitor'] };
      if (skill?.id === 'control_center') intent = { skillId: skill.id, objective: 'Read Mark L capabilities and verify output.', toolIds: ['mark_l_capabilities'] };
    }
    if (!intent) return undefined;
    const skill = snapshot.skills.find((skill) => skill.id === intent!.skillId);
    if (!skill || skill.status !== 'ready' || !skill.readiness.ready || skill.requiredConfig.length) return undefined;
    if (intent.toolIds.some((id) => {
      const tool = edithToolRegistry.get(id);
      return !tool || !tool.metadata.platforms.includes(process.platform) || Object.values(tool.metadata.inputSchema).some((field) => field.required);
    })) return undefined;
    return { ...intent, requiredPermissions: [...skill.requiredPermissions] };
  };
}

export const resolveRegistryVoiceSkill = createRegistryVoiceSkillResolver();

export class VoiceSkillDispatch {
  constructor(
    private readonly idempotency = new Phase4IdempotencyStore(path.join(getEdithPersistenceStore().getPaths().dataDir, 'voice-skill-idempotency.db')),
    private readonly resolveIntent: VoiceSkillIntentResolver = resolveRegistryVoiceSkill,
    private readonly ownerActive = ownerSessionBindingActive,
    private readonly continuation = new TaskContinuationAdapter(),
  ) {}
  async dispatch(transcript: VoiceSkillTranscript, hooks?: TrustedVoiceDispatchHooksV1): Promise<Record<string, unknown>> {
    if (!this.ownerActive(transcript.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    if (!transcript.isFinal) return { outcome: 'ignored_partial', taskCreated: false, modelCalls: 0 };
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(transcript.voiceSessionId) || !/^[A-Za-z0-9._:-]{1,160}$/.test(transcript.utteranceId) || !transcript.text.trim() || transcript.text.length > 2_000) throw new Error('VOICE_TRANSCRIPT_INVALID');
    const captured = hooks?.taskAdmission ? captureTaskHudAdmissionContext(hooks.taskAdmission) : undefined;
    if (captured && (captured.ownerSessionBindingId !== transcript.ownerSessionBindingId || captured.voiceSessionId !== transcript.voiceSessionId || captured.utteranceId !== transcript.utteranceId)) throw new Error('TASK_HUD_STALE_SCOPE');
    const assertAdmissionCurrent = () => {
      if (!captured || !hooks?.taskAdmission) return;
      const current = captureTaskHudAdmissionContext(hooks.taskAdmission);
      if ((['ownerSessionBindingId','workspaceId','voiceSessionId','utteranceId','commandSequence'] as const).some(key => current[key] !== captured[key])) throw new Error('TASK_HUD_STALE_SCOPE');
    };
    killSwitchService.assertAllowed('task_creation', 'owner');
    killSwitchService.assertAllowed('tool_execution', 'owner');
    const intent = await this.resolveIntent(transcript.text);
    if (!this.ownerActive(transcript.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    killSwitchService.assertAllowed('tool_execution', 'owner');
    if (!intent) return { outcome: 'configuration_required', reasonCode: 'VOICE_SKILL_MAPPING_REQUIRED', taskCreated: false, modelCalls: 0 };
    if (!intent.toolIds.length || intent.toolIds.length > 4 || intent.toolIds.some((id) => !edithToolRegistry.get(id))) throw new Error('UNKNOWN_CANONICAL_TOOL');
    const denied = intent.toolIds.some((id) => {
      const tool = edithToolRegistry.get(id)!;
      return permissionService.decideToolExecution({ tool: { ...tool, metadata: { ...tool.metadata, requiredPermissions: [...new Set([...tool.metadata.requiredPermissions, ...(intent.requiredPermissions ?? [])])] } }, actor: 'owner' }).status !== 'ALLOW';
    });
    if (denied) return { outcome: 'attention_required', reasonCode: 'PERMISSION_DENIED', taskCreated: false, modelCalls: 0 };
    const fingerprint = captured ? {text: transcript.text, taskAdmission: captured} : {text: transcript.text};
    const pending = this.idempotency.execute(`voice:${transcript.ownerSessionBindingId}:${transcript.voiceSessionId}`, transcript.utteranceId, fingerprint, async () => {
      if (!this.ownerActive(transcript.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
      assertAdmissionCurrent();
      killSwitchService.assertAllowed('task_creation', 'owner');
      killSwitchService.assertAllowed('tool_execution', 'owner');
      const task = taskService.createTask({ title: `Voice: ${intent.skillId}`, objective: intent.objective,
        originalUserRequest: intent.objective, normalizedIntent: intent.skillId, toolsRequired: intent.toolIds,
        permissionsRequired: [...new Set([...intent.toolIds.flatMap((id) => edithToolRegistry.get(id)!.metadata.requiredPermissions), ...(intent.requiredPermissions ?? [])])] });
      if (captured && hooks?.taskAdmission) {
        let admission;
        try {
          admission = this.continuation.admitHudTask(task.id, intent.skillId, hooks.taskAdmission, captured);
        } catch {
          // The task really exists, but no HUD enrollment or execution was admitted.
          return {status: 409, body: {outcome:'attention_required',taskId:task.id,taskCreated:true,reasonCode:'TASK_HUD_BINDING_FAILED',verificationStatus:'unavailable',modelCalls:0}};
        }
        try { hooks.onTaskAdmitted?.(admission); } catch { /* Committed binding survives best-effort synchronous notification failure. */ }
      } else {
        this.continuation.bind(task.id, transcript.ownerSessionBindingId);
      }
      if (!this.ownerActive(transcript.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
      assertAdmissionCurrent();
      killSwitchService.assertAllowed('tool_execution', 'owner');
      const planned = plannerService.planTask(task.id);
      if (!planned.success) return { status: 422, body: { outcome: 'attention_required', taskId: task.id, verificationStatus: 'unavailable', modelCalls: 0 } };
      const result = await executorService.executeTask(task.id);
      killSwitchService.assertAllowed('tool_execution', 'owner');
      if (!this.ownerActive(transcript.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
      assertAdmissionCurrent();
      const verified = result.task?.status === 'COMPLETED' && result.task.verification?.status === 'PASS';
      return { status: verified ? 200 : 422, body: { outcome: verified ? 'completed' : 'attention_required', skillId: intent.skillId, taskId: task.id,
        verificationStatus: result.task?.verification?.status ?? 'unavailable', toolCalls: result.toolCalls, modelCalls: 0 } };
    });
    if (!pending) throw new Error('IDEMPOTENCY_KEY_REUSED');
    const result = await pending.result;
    return { ...result.body, idempotentReplay: pending.replayed };
  }
}
