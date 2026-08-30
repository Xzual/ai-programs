import type { BrowserWorkflowAction, EdithRiskLevel } from './core';
import { browserWorkflowService } from './browserWorkflowService';
import { computerActionService } from './computerActionService';
import { killSwitchService } from './killSwitch';
import { markLAdapterService } from './markLAdapter';
import { permissionService } from './permissionService';

export type ComputerUseMode = 'READ_ONLY' | 'SAFE_INTERACTION' | 'FULL_CONTROL' | 'PAUSED' | 'BLOCKED';
export type BrowserUseMode = 'READ_ONLY' | 'SAFE_NAVIGATION' | 'FORM_FILLING_WITH_APPROVAL' | 'DOWNLOAD_WITH_APPROVAL';
export type VoiceMode = 'DISABLED' | 'PUSH_TO_TALK' | 'HANDS_FREE' | 'WAKE_WORD' | 'SPEAKING' | 'LISTENING';
export type InteractionCapabilityStatus = 'real' | 'partial' | 'stub' | 'unsafe' | 'blocked';

export interface InteractionCapabilityClassification {
  id: string;
  area: 'computer' | 'browser' | 'voice' | 'vision' | 'mark-l';
  status: InteractionCapabilityStatus;
  mode: ComputerUseMode | BrowserUseMode | VoiceMode | 'READ_ONLY';
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  verification: string;
  notes: string;
}

export interface InteractionSafetySnapshot {
  generatedAt: string;
  defaultRule: 'READ_ONLY';
  loop: ['OBSERVE', 'UNDERSTAND', 'PLAN', 'REQUEST_APPROVAL_IF_NEEDED', 'ACT', 'VERIFY', 'REPORT'];
  computer: {
    mode: ComputerUseMode;
    runtimeBound: boolean;
    approvalRequired: true;
    phases: ReturnType<typeof computerActionService.phases>;
  };
  browser: {
    mode: BrowserUseMode;
    capabilities: ReturnType<typeof browserWorkflowService.capabilities>;
  };
  voice: {
    mode: VoiceMode;
    wakeWord: 'BLOCKED';
    stt: 'BROWSER_RUNTIME_ONLY';
    tts: 'CONFIGURATION_DEPENDENT';
    handsFreeRequiresUserSetting: true;
  };
  markL: ReturnType<typeof markLAdapterService.snapshot>;
  classifications: InteractionCapabilityClassification[];
  requiredApprovals: Array<{
    action: string;
    permissions: string[];
    reason: string;
  }>;
}

const BROWSER_ACTION_MODE: Record<BrowserWorkflowAction, BrowserUseMode> = {
  search: 'SAFE_NAVIGATION',
  navigate: 'SAFE_NAVIGATION',
  extract: 'SAFE_NAVIGATION',
  screenshot: 'SAFE_NAVIGATION',
  read_pdf: 'READ_ONLY',
  download_pdf: 'DOWNLOAD_WITH_APPROVAL',
  upload_file: 'FORM_FILLING_WITH_APPROVAL',
  fill_form: 'FORM_FILLING_WITH_APPROVAL',
};

export class InteractionSafetyService {
  snapshot(): InteractionSafetySnapshot {
    const policy = permissionService.getPolicy();
    const browserCapabilities = browserWorkflowService.capabilities();
    const markL = markLAdapterService.snapshot();
    const highRiskEnabled = permissionService.highRiskEnabled();
    const computerMode: ComputerUseMode = killSwitchService.status().active
      ? 'BLOCKED'
      : 'READ_ONLY';
    const browserMode: BrowserUseMode = highRiskEnabled && policy.mode === 'full_access'
      ? 'FORM_FILLING_WITH_APPROVAL'
      : 'READ_ONLY';

    return {
      generatedAt: new Date().toISOString(),
      defaultRule: 'READ_ONLY',
      loop: ['OBSERVE', 'UNDERSTAND', 'PLAN', 'REQUEST_APPROVAL_IF_NEEDED', 'ACT', 'VERIFY', 'REPORT'],
      computer: {
        mode: computerMode,
        runtimeBound: false,
        approvalRequired: true,
        phases: computerActionService.phases(),
      },
      browser: {
        mode: browserMode,
        capabilities: browserCapabilities,
      },
      voice: {
        mode: 'DISABLED',
        wakeWord: 'BLOCKED',
        stt: 'BROWSER_RUNTIME_ONLY',
        tts: 'CONFIGURATION_DEPENDENT',
        handsFreeRequiresUserSetting: true,
      },
      markL,
      classifications: [
        {
          id: 'vision_observe',
          area: 'vision',
          status: 'partial',
          mode: 'READ_ONLY',
          riskLevel: 0,
          requiredPermissions: ['system:read'],
          verification: 'Structured observation has readOnly=true and adapter honesty metadata.',
          notes: 'Screenshot/OCR providers are not bound; supplied text can be observed safely.',
        },
        {
          id: 'computer_action',
          area: 'computer',
          status: 'blocked',
          mode: computerMode,
          riskLevel: 4,
          requiredPermissions: ['computer:control'],
          verification: 'Policy, kill switch, forbidden intent, audit, runtime-bound check.',
          notes: 'No local computer-control runtime adapter is bound.',
        },
        ...browserCapabilities.map((capability): InteractionCapabilityClassification => ({
          id: `browser_workflow.${capability.action}`,
          area: 'browser',
          status: capability.runtimeStatus === 'AVAILABLE' ? 'real' : capability.runtimeStatus === 'CONFIGURATION_REQUIRED' ? 'stub' : 'blocked',
          mode: BROWSER_ACTION_MODE[capability.action],
          riskLevel: capability.riskLevel,
          requiredPermissions: capability.requiredPermissions,
          verification: capability.verification,
          notes: capability.requiresApproval
            ? 'Requires explicit approval before any browser or filesystem side effect.'
            : 'Allowed only through the structured browser workflow.',
        })),
        {
          id: 'voice_pipeline',
          area: 'voice',
          status: 'partial',
          mode: 'DISABLED',
          riskLevel: 2,
          requiredPermissions: ['microphone:read'],
          verification: 'Frontend reports listening/speaking state; backend does not infer audio state.',
          notes: 'Wake word is blocked; browser STT requires user gesture and settings.',
        },
        ...markL.capabilities.map((capability): InteractionCapabilityClassification => ({
          id: capability.id,
          area: 'mark-l',
          status: capability.adapterMode === 'high_risk_blocked' ? 'unsafe' : 'stub',
          mode: capability.riskLevel >= 3 ? 'BLOCKED' : 'READ_ONLY',
          riskLevel: capability.riskLevel,
          requiredPermissions: capability.permissions,
          verification: 'Adapter manifest only; no Mark-L action module is executed.',
          notes: capability.description,
        })),
      ],
      requiredApprovals: [
        {
          action: 'computer_action.*',
          permissions: ['computer:control'],
          reason: 'Mouse, keyboard, window, and app operations are high-risk and require scoped approval plus a bound runtime.',
        },
        {
          action: 'browser_workflow.download_pdf',
          permissions: ['network:read', 'browser:control', 'file:write'],
          reason: 'Download writes a file and must return path, mime type, and size evidence.',
        },
        {
          action: 'browser_workflow.upload_file/fill_form',
          permissions: ['network:read', 'browser:control'],
          reason: 'Forms and uploads can submit external data; selectors and final submit need approval.',
        },
        {
          action: 'mark_l.*',
          permissions: ['capability-specific'],
          reason: 'Mark-L is an external powerful assistant and remains adapter-only.',
        },
      ],
    };
  }
}

export const interactionSafetyService = new InteractionSafetyService();
