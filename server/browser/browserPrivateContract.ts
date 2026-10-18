import type { BrowserOperatorReceipt, BrowserToolId } from '../../src/edith/browserOperatorContract';

declare const privateBrowserBrand: unique symbol;
export type BrowserOwnerCap = Readonly<{ readonly [privateBrowserBrand]: 'owner' }>;
export type BrowserParentExecutionCap = Readonly<{ readonly [privateBrowserBrand]: 'execution'; readonly taskId: string; readonly planId: string }>;
export type BrowserParentStepCap = Readonly<{ readonly [privateBrowserBrand]: 'step'; readonly taskId: string; readonly stepId: string }>;
export type BrowserParentAggregateCap = Readonly<{ readonly [privateBrowserBrand]: 'aggregate' }>;
export type BrowserParentEvidenceCap = Readonly<{ readonly [privateBrowserBrand]: 'evidence' }>;
export type BrowserParentClosedReason = 'owner_lost' | 'permission_lost' | 'task_stopped' | 'plan_changed' | 'expired' | 'session_closed' | 'unknown_effect' | 'explicit_revoke';
export interface BrowserParentRequiredCheck {
  readonly id: string; readonly label: string; readonly required: true;
  readonly status: 'PASS'; readonly evidence: string;
}
export interface BrowserParentStepResult {
  readonly taskId: string; readonly operationId?: string; readonly stepId: string;
  readonly scope: 'parent-step'; readonly outcome: 'verified' | 'blocked' | 'partial' | 'failed';
  readonly success: boolean; readonly receipt?: BrowserOperatorReceipt;
  readonly evidence?: BrowserParentEvidenceCap; readonly auditEventId?: string;
  readonly reasonCode?: string;
}
export interface BrowserParentOccurrence {
  readonly stepId: string; readonly toolId: BrowserToolId; readonly ordinal: number;
}
export interface BrowserParentAggregateView {
  readonly taskId: string; readonly planId: string; readonly planFingerprint: string;
  readonly ownerGeneration: number; readonly executionGeneration: number;
  readonly expectedOccurrences: readonly BrowserParentOccurrence[];
  readonly originalRequiredCheckSet: Readonly<{ taskRulesFingerprint: string; planCriteriaFingerprint: string;
    stepCriteria: readonly { readonly stepId: string; readonly criteriaFingerprint: string }[] }>;
  readonly steps: readonly { readonly stepId: string; readonly operationId: string;
    readonly requestHash: string; readonly evidenceDigest: string; readonly auditEventId: string }[];
  readonly requiredChecks: readonly BrowserParentRequiredCheck[];
  /** Exact SHA256 of the immutable aggregate view before this field; consumer reserves this digest. */
  readonly verificationDigest: string;
  readonly commitState: 'available' | 'reserved';
}
