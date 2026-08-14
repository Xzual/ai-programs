import fs from 'node:fs';
import path from 'node:path';
import type { EdithRegisteredTool, EdithRiskLevel } from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';

export type EdithPermissionDecisionStatus = 'ALLOW' | 'DENY';

export interface EdithPermissionDecision {
  status: EdithPermissionDecisionStatus;
  toolId: string;
  actor: string;
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  authorizedPermissions: string[];
  missingPermissions: string[];
  activeGrantIds: string[];
  highRisk: boolean;
  rationale: string;
}

export interface PermissionGrant {
  id: string;
  actor: string;
  permissions: string[];
  toolIds?: string[];
  reason: string;
  grantedBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface CreatePermissionGrantInput {
  actor?: string;
  permissions: string[];
  toolIds?: string[];
  reason: string;
  grantedBy?: string;
  ttlMs?: number;
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

const DEFAULT_GRANT_TTL_MS = 15 * 60 * 1000;
const MAX_GRANT_TTL_MS = 60 * 60 * 1000;

function grantId(): string {
  return `permgrant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export class PermissionService {
  highRiskEnabled(): boolean {
    return process.env.EDITH_ENABLE_HIGH_RISK_TOOLS === 'true';
  }

  defaultAuthorizedPermissions(): string[] {
    return this.highRiskEnabled()
      ? [...DEFAULT_LOCAL_PERMISSIONS, ...HIGH_RISK_PERMISSIONS]
      : [...DEFAULT_LOCAL_PERMISSIONS];
  }

  listGrants(options: { includeExpired?: boolean; includeRevoked?: boolean } = {}): PermissionGrant[] {
    const now = Date.now();
    return this.readGrants()
      .filter((grant) => options.includeRevoked || !grant.revokedAt)
      .filter((grant) => options.includeExpired || Date.parse(grant.expiresAt) > now)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  createGrant(input: CreatePermissionGrantInput): PermissionGrant {
    const permissions = unique(input.permissions);
    if (permissions.length === 0) {
      throw new Error('At least one permission is required.');
    }
    const ttlMs = Math.min(Math.max(Number(input.ttlMs ?? DEFAULT_GRANT_TTL_MS), 1), MAX_GRANT_TTL_MS);
    const now = Date.now();
    const grant: PermissionGrant = {
      id: grantId(),
      actor: input.actor?.trim() || '*',
      permissions,
      toolIds: input.toolIds ? unique(input.toolIds) : undefined,
      reason: input.reason.trim() || 'Temporary permission grant.',
      grantedBy: input.grantedBy?.trim() || 'local-user',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    const grants = this.readGrants();
    this.writeGrants([...grants, grant]);
    this.audit('permission.grant', grant.grantedBy, grant, `Permission grant created for ${grant.actor}: ${permissions.join(', ')}`);
    return grant;
  }

  revokeGrant(id: string, revokedBy = 'local-user'): PermissionGrant | undefined {
    const grants = this.readGrants();
    const existing = grants.find((grant) => grant.id === id);
    if (!existing) return undefined;
    const revoked: PermissionGrant = {
      ...existing,
      revokedAt: existing.revokedAt ?? new Date().toISOString(),
      revokedBy,
    };
    this.writeGrants(grants.map((grant) => grant.id === id ? revoked : grant));
    this.audit('permission.revoke', revokedBy, revoked, `Permission grant revoked: ${id}`);
    return revoked;
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
    const grantMatches = this.activeGrantsFor(params.actor, params.tool.id);
    const authorizedPermissions = unique([
      ...(params.authorizedPermissions ?? this.defaultAuthorizedPermissions()),
      ...grantMatches.flatMap((grant) => grant.permissions),
    ]);
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
      activeGrantIds: grantMatches.map((grant) => grant.id),
      highRisk,
      rationale: status === 'ALLOW'
        ? `Actor ${params.actor} has required permissions for ${params.tool.id}.`
        : `Actor ${params.actor} is missing permissions for ${params.tool.id}: ${missingPermissions.join(', ')}.`,
    };
  }

  private activeGrantsFor(actor: string, toolId: string): PermissionGrant[] {
    const now = Date.now();
    return this.readGrants().filter((grant) => {
      if (grant.revokedAt || Date.parse(grant.expiresAt) <= now) return false;
      if (grant.actor !== '*' && grant.actor !== actor) return false;
      if (grant.toolIds && grant.toolIds.length > 0 && !grant.toolIds.includes(toolId)) return false;
      return true;
    });
  }

  private grantsFile(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'permission-grants.json');
  }

  private readGrants(): PermissionGrant[] {
    const file = this.grantsFile();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeGrants(grants: PermissionGrant[]): void {
    const file = this.grantsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(grants, null, 2), 'utf8');
  }

  private audit(action: string, actor: string, grant: PermissionGrant, message: string): void {
    appendAuditEvent(createAuditEvent({
      actor,
      action,
      toolId: 'permission_service',
      target: grant.id,
      authorization: 'allowed',
      riskLevel: grant.permissions.some((permission) => HIGH_RISK_PERMISSIONS.includes(permission)) ? 4 : 1,
      result: 'success',
      message,
    }));
  }
}

export const permissionService = new PermissionService();
