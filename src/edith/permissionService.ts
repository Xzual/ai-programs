import fs from 'node:fs';
import path from 'node:path';
import type { EdithRegisteredTool, EdithRiskLevel } from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';

export type EdithPermissionDecisionStatus = 'ALLOW' | 'DENY';
export type EdithPermissionMode = 'deny' | 'ask' | 'full_access';

export interface EdithPermissionPolicy {
  mode: EdithPermissionMode;
  updatedAt: string;
  updatedBy: string;
}

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
  'memory:read',
  'memory:write',
  'system:notify',
];

export const HIGH_RISK_PERMISSIONS = [
  'system:exec',
  'file:write',
  'browser:control',
  'computer:control',
  'iot:control',
  'trading:execute',
];

const DEFAULT_GRANT_TTL_MS = 15 * 60 * 1000;
const MAX_GRANT_TTL_MS = 60 * 60 * 1000;
const READ_ONLY_PERMISSIONS = [
  'system:read',
  'network:read',
  'file:read',
  'memory:read',
  'system:notify',
];
const DEFAULT_POLICY: EdithPermissionPolicy = {
  mode: 'ask',
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system',
};

function grantId(): string {
  return `permgrant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export class PermissionService {
  getPolicy(): EdithPermissionPolicy {
    const file = this.policyFile();
    if (!fs.existsSync(file)) return { ...DEFAULT_POLICY };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<EdithPermissionPolicy>;
      const mode = this.normalizeMode(parsed.mode);
      return {
        mode,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : DEFAULT_POLICY.updatedAt,
        updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : DEFAULT_POLICY.updatedBy,
      };
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  updatePolicy(input: { mode?: unknown; updatedBy?: string }): EdithPermissionPolicy {
    const policy: EdithPermissionPolicy = {
      mode: this.normalizeMode(input.mode),
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy?.trim() || 'local-user',
    };
    fs.mkdirSync(path.dirname(this.policyFile()), { recursive: true });
    fs.writeFileSync(this.policyFile(), JSON.stringify(policy, null, 2), 'utf8');
    appendAuditEvent(createAuditEvent({
      actor: policy.updatedBy,
      action: 'permission.policy.update',
      toolId: 'permission_service',
      authorization: 'allowed',
      riskLevel: policy.mode === 'full_access' ? 4 : policy.mode === 'deny' ? 2 : 1,
      result: 'success',
      message: `Permission policy mode changed to ${policy.mode}.`,
    }));
    return policy;
  }

  highRiskEnabled(): boolean {
    return process.env.EDITH_ENABLE_HIGH_RISK_TOOLS === 'true' || this.getPolicy().mode === 'full_access';
  }

  defaultAuthorizedPermissions(): string[] {
    const mode = this.getPolicy().mode;
    if (mode === 'deny') return [...READ_ONLY_PERMISSIONS];
    if (mode === 'full_access') return [...DEFAULT_LOCAL_PERMISSIONS, ...HIGH_RISK_PERMISSIONS];
    return process.env.EDITH_ENABLE_HIGH_RISK_TOOLS === 'true'
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
    const policy = this.getPolicy();
    const grantMatches = policy.mode === 'deny' ? [] : this.activeGrantsFor(params.actor, params.tool.id);
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
        ? `Actor ${params.actor} has required permissions for ${params.tool.id} under ${policy.mode} mode.`
        : policy.mode === 'deny'
          ? `Permission policy is set to deny mode; missing permissions for ${params.tool.id}: ${missingPermissions.join(', ')}.`
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

  private policyFile(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'permission-policy.json');
  }

  private normalizeMode(value: unknown): EdithPermissionMode {
    return value === 'deny' || value === 'full_access' || value === 'ask' ? value : 'ask';
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
