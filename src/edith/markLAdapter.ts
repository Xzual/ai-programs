import fs from 'fs';
import path from 'path';
import type { EdithRiskLevel } from './core';

export type MarkLCapabilityStatus = 'AVAILABLE' | 'MISSING' | 'DISABLED';

export interface MarkLCapability {
  id: string;
  modulePath: string;
  description: string;
  permissions: string[];
  riskLevel: EdithRiskLevel;
  status: MarkLCapabilityStatus;
  enabledByDefault: boolean;
  adapterMode: 'metadata_only' | 'read_only_candidate' | 'high_risk_blocked';
}

export interface MarkLAdapterSnapshot {
  root: string;
  exists: boolean;
  readmeExists: boolean;
  requirementsExists: boolean;
  capabilityCount: number;
  availableCount: number;
  highRiskCount: number;
  capabilities: MarkLCapability[];
}

const MARK_L_ROOT = path.resolve(process.cwd(), 'Mark-L-main');

const CAPABILITY_MANIFEST: Array<Omit<MarkLCapability, 'status'>> = [
  {
    id: 'mark_l_system_monitor',
    modulePath: 'actions/system_monitor.py',
    description: 'Reads CPU, RAM, GPU, temperature, uptime, and process telemetry.',
    permissions: ['system:read'],
    riskLevel: 1,
    enabledByDefault: false,
    adapterMode: 'read_only_candidate',
  },
  {
    id: 'mark_l_screen_processor',
    modulePath: 'actions/screen_processor.py',
    description: 'Captures or processes screen/camera context for visual awareness.',
    permissions: ['screen:read', 'camera:read'],
    riskLevel: 3,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_browser_control',
    modulePath: 'actions/browser_control.py',
    description: 'Opens, navigates, and interacts with browser sessions.',
    permissions: ['network:read', 'browser:control'],
    riskLevel: 4,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_computer_control',
    modulePath: 'actions/computer_control.py',
    description: 'Performs keyboard, mouse, clipboard, screenshot, and window operations.',
    permissions: ['computer:control', 'system:exec', 'clipboard:read', 'clipboard:write'],
    riskLevel: 5,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_open_app',
    modulePath: 'actions/open_app.py',
    description: 'Launches desktop applications.',
    permissions: ['system:exec'],
    riskLevel: 4,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_file_controller',
    modulePath: 'actions/file_controller.py',
    description: 'Performs filesystem operations.',
    permissions: ['file:read', 'file:write'],
    riskLevel: 5,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_file_processor',
    modulePath: 'actions/file_processor.py',
    description: 'Reads and summarizes local documents.',
    permissions: ['file:read'],
    riskLevel: 2,
    enabledByDefault: false,
    adapterMode: 'metadata_only',
  },
  {
    id: 'mark_l_reminder',
    modulePath: 'actions/reminder.py',
    description: 'Creates OS-native reminders or notifications.',
    permissions: ['system:notify', 'system:schedule'],
    riskLevel: 3,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
  {
    id: 'mark_l_web_search',
    modulePath: 'actions/web_search.py',
    description: 'Runs Gemini/DDG web search and research flows.',
    permissions: ['network:read'],
    riskLevel: 2,
    enabledByDefault: false,
    adapterMode: 'metadata_only',
  },
  {
    id: 'mark_l_proactive',
    modulePath: 'actions/proactive.py',
    description: 'Performs proactive time/context-aware assistant check-ins.',
    permissions: ['system:read', 'memory:read', 'notification:write'],
    riskLevel: 3,
    enabledByDefault: false,
    adapterMode: 'high_risk_blocked',
  },
];

function capabilityStatus(modulePath: string): MarkLCapabilityStatus {
  if (!fs.existsSync(MARK_L_ROOT)) return 'MISSING';
  return fs.existsSync(path.join(MARK_L_ROOT, modulePath)) ? 'DISABLED' : 'MISSING';
}

export class MarkLAdapterService {
  getRoot(): string {
    return MARK_L_ROOT;
  }

  listCapabilities(): MarkLCapability[] {
    return CAPABILITY_MANIFEST.map((capability) => ({
      ...capability,
      status: capabilityStatus(capability.modulePath),
    }));
  }

  snapshot(): MarkLAdapterSnapshot {
    const capabilities = this.listCapabilities();
    return {
      root: MARK_L_ROOT,
      exists: fs.existsSync(MARK_L_ROOT),
      readmeExists: fs.existsSync(path.join(MARK_L_ROOT, 'readme.md')),
      requirementsExists: fs.existsSync(path.join(MARK_L_ROOT, 'requirements.txt')),
      capabilityCount: capabilities.length,
      availableCount: capabilities.filter((capability) => capability.status !== 'MISSING').length,
      highRiskCount: capabilities.filter((capability) => capability.riskLevel >= 3).length,
      capabilities,
    };
  }
}

export const markLAdapterService = new MarkLAdapterService();
