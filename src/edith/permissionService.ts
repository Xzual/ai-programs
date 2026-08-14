import type { EdithRegisteredTool, EdithRiskLevel } from './core';

export type EdithPermissionDecisionStatus = 'ALLOW' | 'DENY';

export interface EdithPermissionDecision {
  status: EdithPermissionDecisionStatus;
  toolId: string;
  actor: string;
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  authorizedPermissions: string[];
  missingPermissions: string[];
  highRisk: boolean;
  rationale: string;
}

export const DEFAULT_LOCAL_PERMISSIONS = [
  'system:read',
  'network:read',
  'file:read',
  'system:notify',
];

export const HIGH_RISK_PERMISSIONS = [
  'system:exec',
  'file:write',
  'browser:control',
  'computer:control',
];

export class PermissionService {
  highRiskEnabled(): boolean {
    return process.env.EDITH_ENABLE_HIGH_RISK_TOOLS === 'true';
  }

  defaultAuthorizedPermissions(): string[] {
    return this.highRiskEnabled()
      ? [...DEFAULT_LOCAL_PERMISSIONS, ...HIGH_RISK_PERMISSIONS]
      : [...DEFAULT_LOCAL_PERMISSIONS];
  }

  isHighRisk(tool: Pick<EdithRegisteredTool, 'metadata'>): boolean {
    return tool.metadata.riskLevel >= 3 ||
      tool.metadata.requiredPermissions.some((permission) => HIGH_RISK_PERMISSIONS.includes(permission));
  }

  decideToolExecution(params: {
    tool: EdithRegisteredTool;
    actor: string;
    authorizedPermissions?: string[];
  }): EdithPermissionDecision {
    const authorizedPermissions = params.authorizedPermissions ?? this.defaultAuthorizedPermissions();
    const requiredPermissions = params.tool.metadata.requiredPermissions;
    const missingPermissions = requiredPermissions.filter(
      (permission) => !authorizedPermissions.includes(permission)
    );
    const highRisk = this.isHighRisk(params.tool);
    const status: EdithPermissionDecisionStatus = missingPermissions.length === 0 ? 'ALLOW' : 'DENY';
    return {
      status,
      toolId: params.tool.id,
      actor: params.actor,
      riskLevel: params.tool.metadata.riskLevel,
      requiredPermissions,
      authorizedPermissions,
      missingPermissions,
      highRisk,
      rationale: status === 'ALLOW'
        ? `Actor ${params.actor} has required permissions for ${params.tool.id}.`
        : `Actor ${params.actor} is missing permissions for ${params.tool.id}: ${missingPermissions.join(', ')}.`,
    };
  }
}

export const permissionService = new PermissionService();
