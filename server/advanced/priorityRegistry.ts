import type { PriorityTaskPolicyV2 } from '../../src/edith/contracts';

const policies = new Map<string, PriorityTaskPolicyV2>();

export function setAdvancedPriorityPolicy(policy: PriorityTaskPolicyV2): void {
  policies.set(policy.taskId, structuredClone(policy));
}

export function getAdvancedPriorityPolicy(taskId: string): PriorityTaskPolicyV2 | undefined {
  const policy = policies.get(taskId);
  return policy ? structuredClone(policy) : undefined;
}

export function removeAdvancedPriorityPoliciesForOwner(ownerSessionBindingId: string): void {
  for (const [taskId, policy] of policies) {
    if (policy.ownerSessionBindingId === ownerSessionBindingId) policies.delete(taskId);
  }
}

export function clearAdvancedPriorityPolicies(): void {
  policies.clear();
}
