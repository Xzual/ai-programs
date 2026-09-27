import type { EdithSkill, SkillRisk } from './skillRegistry';

export const EDITH_SKILL_DISTRIBUTIONS = ['built_in', 'private', 'community'] as const;
export type EdithSkillDistribution = typeof EDITH_SKILL_DISTRIBUTIONS[number];

export const EDITH_SKILL_TRUST_STATES = ['trusted_builtin', 'owner_private', 'unverified_community'] as const;
export type EdithSkillTrustState = typeof EDITH_SKILL_TRUST_STATES[number];

export interface EdithSkillPackageMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  distribution: EdithSkillDistribution;
  trust: EdithSkillTrustState;
  source: string;
  sourceRevision?: string;
  checksum?: string;
  signatureVerified: boolean;
  sandboxed: boolean;
  adapterBound: boolean;
  enabled: boolean;
  riskLevel: SkillRisk;
  requiredPermissions: string[];
  toolIds: string[];
  installedAt?: string;
  updatedAt: string;
}

export interface EdithSkillExecutionEligibility {
  executable: boolean;
  status: 'ready' | 'configuration_required' | 'blocked';
  reason: string;
}

export function builtInSkillMetadata(skill: EdithSkill): EdithSkillPackageMetadata {
  return {
    id: skill.id,
    name: skill.name,
    version: '1.0.0',
    description: skill.description,
    distribution: 'built_in',
    trust: 'trusted_builtin',
    source: 'edith-code-registry',
    signatureVerified: true,
    sandboxed: true,
    adapterBound: skill.capabilities.length > 0,
    enabled: skill.status === 'ready' || skill.status === 'degraded',
    riskLevel: skill.riskLevel,
    requiredPermissions: [...skill.requiredPermissions],
    toolIds: [],
    updatedAt: skill.lastChecked,
  };
}

export function validateSkillPackageMetadata(metadata: EdithSkillPackageMetadata): string[] {
  const errors: string[] = [];
  if (!metadata.id.trim()) errors.push('id is required');
  if (!metadata.name.trim()) errors.push('name is required');
  if (!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(metadata.version)) errors.push('version must be semver-like');
  if (!metadata.source.trim()) errors.push('source is required');
  if (!EDITH_SKILL_DISTRIBUTIONS.includes(metadata.distribution)) errors.push('distribution is invalid');
  if (!EDITH_SKILL_TRUST_STATES.includes(metadata.trust)) errors.push('trust state is invalid');
  if (metadata.distribution === 'community' && metadata.trust !== 'unverified_community') {
    errors.push('community skills must remain unverified until a future trust workflow verifies them');
  }
  return errors;
}

export function skillExecutionEligibility(metadata: EdithSkillPackageMetadata): EdithSkillExecutionEligibility {
  const errors = validateSkillPackageMetadata(metadata);
  if (errors.length) return { executable: false, status: 'blocked', reason: errors.join('; ') };
  if (metadata.distribution === 'community') {
    return { executable: false, status: 'blocked', reason: 'Community skill execution is not enabled in this foundation.' };
  }
  if (metadata.distribution === 'private' && (!metadata.signatureVerified || !metadata.sandboxed)) {
    return { executable: false, status: 'blocked', reason: 'Private skills require verified ownership/signature and sandboxing.' };
  }
  if (!metadata.adapterBound || !metadata.enabled) {
    return { executable: false, status: 'configuration_required', reason: 'A trusted runtime adapter and enabled state are required.' };
  }
  return { executable: true, status: 'ready', reason: 'Trusted metadata is bound to an enabled E.D.I.T.H. runtime adapter.' };
}
