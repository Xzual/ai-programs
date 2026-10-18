/** Root N1 final fields + exact amendment 9F90. Declarations only.
 * Brands are NOT runtime authority. Issuers must enforce exact private object identity,
 * boot/source ownership and one-use tombstones; wire DTOs never issue capabilities.
 * Exact-key/range/ASCII/digest validation belongs to the private decoders.
 */
import type { Request } from 'express';
import type { BrowserWorkflowAction, EdithToolResult } from '../../src/edith/core';
import type { ExecuteTaskResult } from '../../src/edith/executor';
import type { BrowserOperatorReceipt, BrowserFailureCode, ParsedBrowserWorkflowRequest } from '../../src/edith/browserOperatorContract';
import type { BrowserOwnerCap, BrowserParentExecutionCap, BrowserParentStepCap, BrowserParentAggregateView, BrowserParentClosedReason } from './browserPrivateContract';
export type { BrowserOwnerCap, BrowserParentExecutionCap, BrowserParentStepCap } from './browserPrivateContract';

declare const nativePrivateBrand: unique symbol;
type NativeOpaque<Name extends string> = Readonly<{ readonly [nativePrivateBrand]: Name }>;
export type OriginalOwnerCap = BrowserOwnerCap;
export type PrivateBridgeContext = NativeOpaque<'private-peer'>;
export type RetainedBrowserRequestRef = NativeOpaque<'retained-request'>;
export type AttemptRef = NativeOpaque<'attempt'>;
export type OriginalAttemptLookupRef = NativeOpaque<'attempt-lookup'>;
export type OriginalOperationLookupRef = NativeOpaque<'operation-lookup'>;
export type BackendBootRef = NativeOpaque<'backend-boot'>;
export type NativeBootRef = NativeOpaque<'native-boot'>;
export type EnrollmentSourceRef = NativeOpaque<'enrollment-source'>;
export type EnrollmentChallengeRef = NativeOpaque<'enrollment-challenge'>;
export type EnrollmentRecheckRef = NativeOpaque<'enrollment-recheck'>;
export type NativeSessionRef = NativeOpaque<'native-session'>;
export type BindingRef = NativeOpaque<'binding'>;
export type SnapshotRef = NativeOpaque<'snapshot'>;
export type PlannedNativeBatchRef = NativeOpaque<'planned-batch'>;
export type MapChallengeRef = NativeOpaque<'map-challenge'>;
export type NativeMapRef = NativeOpaque<'native-map'>;
export type PermitRef = NativeOpaque<'permit'>;
export type NativeDispatchCommandRef = NativeOpaque<'command'>;
export type BackendConsumedCommandRef = NativeOpaque<'backend-consumed-command'>;
export type BackendConsumedEnterCommandRef = NativeOpaque<'backend-consumed-enter'>;
export type DispatchChallengeRef = NativeOpaque<'dispatch-challenge'>;
export type DispatchRef = NativeOpaque<'counted-dispatch'>;
export type ApprovedInputRef = NativeOpaque<'approved-input'>;
export type TargetRef = NativeOpaque<'target'>;
export type SearchTargetRef = NativeOpaque<'search-target'>;
export type ScrollTargetRef = NativeOpaque<'scroll-target'>;
export type PrivateFixedProviderProfileRef = NativeOpaque<'fixed-provider-profile'>;
export type ReplacementPostconditionRef = NativeOpaque<'replacement-postcondition'>;
export type PostconditionRef = NativeOpaque<'postcondition'>;
export type SearchCausalSuccessorRef = NativeOpaque<'search-causal-successor'>;
export type HrefCausalSuccessorRef = NativeOpaque<'href-causal-successor'>;
export type SearchSuccessorEvidenceRef = NativeOpaque<'search-successor-evidence'>;
export type RetainedEngineNavigationRef = NativeOpaque<'retained-engine-navigation'>;
export type DormantSearchSubmitAdmissionRef = NativeOpaque<'dormant-submit-admission'>;
export type SearchSubmitAdmissionRef = NativeOpaque<'submit-admission'>;
export type FocusSourceRef = NativeOpaque<'focus-source-challenge'>;
export type FocusActionRef = NativeOpaque<'focus-action'>;
export type NativeDomPairCap = NativeOpaque<'native-dom-pair'>;
export type NativeParentStrategySetCap = NativeOpaque<'native-parent-strategies'>;
export type NativeParentEvidenceCap = NativeOpaque<'native-parent-evidence'>;
export type NativeParentAggregateCap = NativeOpaque<'native-parent-aggregate'>;
export type StepEvidenceRef = NativeOpaque<'step-evidence'>;
export type BrowserNativeSourceHandle = NativeOpaque<'source-engine-handle'>;
export type NativeSourceTargetCap = NativeOpaque<'source-engine-target'>;
export type NativeSourceSnapshotCap = NativeOpaque<'source-engine-snapshot'>;
export type NativeSourceInputCap = NativeOpaque<'source-engine-input'>;
export type NativeSourcePostconditionCap = NativeOpaque<'source-engine-postcondition'>;
export type SourcePostconditionRef = NativeSourcePostconditionCap;
/** Bounded >=128-bit ASCII lookup string; a wire value is never a Cap/Ref. */
export type NativeWireRef = string;
/** Validated decimal u64 string (never JS Number/RuntimeID inference). */
export type KernelCreation = string;
export type NativeDigest = string;
export type B0ReasonCode = BrowserFailureCode;
/** Fixed sanitized decoder-controlled native status code, never caller text. */
export type NativeReasonCode = string;
export type StopReason = BrowserParentClosedReason;

export interface EnrollmentSourceView {
 readonly version: 1; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly enrollmentSourceRef: NativeWireRef; readonly enrollmentChallengeRef: NativeWireRef;
 readonly originalOwnerRef: NativeWireRef; readonly originalTaskRef: NativeWireRef;
 readonly attemptRef: NativeWireRef; readonly operationRef: NativeWireRef;
 readonly requestScopeDigest: NativeDigest; readonly sourceEpochDigest: NativeDigest;
 readonly confirmationDescription: string; readonly issuedAtMs: number;
 readonly operationDeadlineMs: number; readonly expiresAtMs: number;
}
export interface EnrollmentRecheckView {
 readonly version: 1; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly enrollmentSourceRef: NativeWireRef; readonly enrollmentChallengeRef: NativeWireRef;
 readonly enrollmentRecheckRef: NativeWireRef; readonly sourceEpochDigest: NativeDigest; readonly expiresAtMs: number;
}
export interface NativeConsentEnrollmentView {
 readonly version: 1; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly enrollmentSourceRef: NativeWireRef; readonly enrollmentChallengeRef: NativeWireRef;
 readonly enrollmentRecheckRef: NativeWireRef; readonly consentRef: NativeWireRef; readonly nativeSessionRef: NativeWireRef;
 readonly originalOwnerRef: NativeWireRef; readonly originalTaskRef: NativeWireRef;
 readonly attemptRef: NativeWireRef; readonly operationRef: NativeWireRef;
 readonly requestScopeDigest: NativeDigest; readonly sourceEpochDigest: NativeDigest;
 readonly computerSessionGeneration: number; readonly localSessionExpiresAtMs: number;
 readonly reservationRef: NativeWireRef; readonly reservationGeneration: number; readonly reservationExpiresAtMs: number;
 readonly nativeStopEpoch: number; readonly confirmationRef: NativeWireRef;
 readonly confirmationMethod: 'win32-scoped-messagebox-yes'; readonly approvedAtMs: number; readonly expiresAtMs: number;
}
export type MeasuredConsentTransfer = NativeConsentEnrollmentView;
export type NativeSourceRequest =
 | Readonly<{ version: 1; phase: 'enrollment'; attemptRef: NativeWireRef }>
 | Readonly<{ version: 1; phase: 'enrollment_recheck'; enrollmentSourceRef: NativeWireRef; enrollmentChallengeRef: NativeWireRef }>
 | Readonly<{ bindingRef: NativeWireRef }>;
export interface NativeAssociateRequest {
 readonly version: 1; readonly attemptRef: NativeWireRef; readonly nativeSessionRef: NativeWireRef;
 readonly enrollmentSourceRef: NativeWireRef; readonly enrollmentChallengeRef: NativeWireRef;
 readonly enrollmentRecheckRef: NativeWireRef; readonly consentView: NativeConsentEnrollmentView;
}
export interface NativeBootRequest { readonly version: 1; readonly nativeBootNonce: string }
export interface NativeBootView { readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef }

export interface NativeMapView {
 readonly version: 1; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly challengeRef: NativeWireRef; readonly mapRef: NativeWireRef; readonly originalTaskRef: NativeWireRef;
 readonly operationRef: NativeWireRef; readonly actionBatchRef: NativeWireRef; readonly snapshotRef: NativeWireRef;
 readonly processLaunchRef: NativeWireRef; readonly kernelCreation: KernelCreation; readonly executableFingerprint: NativeDigest;
 readonly kernelIdentityRef: NativeWireRef; readonly rootIdentityRef: NativeWireRef; readonly contentIdentityRef: NativeWireRef;
 readonly logicalDocumentRef: NativeWireRef; readonly logicalAncestryDigest: NativeDigest; readonly logicalRuntimeIdDigest: NativeDigest;
 readonly engineInventoryDigest: NativeDigest; readonly nativeInventoryDigest: NativeDigest; readonly sourceEpochDigest: NativeDigest;
 readonly nativeSessionRef: NativeWireRef; readonly nativeSessionGeneration: number; readonly localConsentRef: NativeWireRef;
 readonly reservationRef: NativeWireRef; readonly reservationGeneration: number; readonly nativeStopEpoch: number;
 readonly profile: 'exclusive-mainpage-dpi96-v1';
 readonly transform: Readonly<{ originPhysicalX: number; originPhysicalY: number; widthPhysical: number; heightPhysical: number; dpi: 96; dpr: 1; visualScale: 1 }>;
 readonly nativeHitTargetRef: NativeWireRef; readonly nativeHitProofDigest: NativeDigest;
 readonly measuredAtMs: number; readonly expiresAtMs: number;
}
export interface NativeLedgerView {
 readonly version: 1; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly challengeRef: NativeWireRef; readonly ledgerRef: NativeWireRef; readonly permitRef: NativeWireRef;
 readonly operationRef: NativeWireRef; readonly actionBatchRef: NativeWireRef; readonly processLaunchRef: NativeWireRef;
 readonly kernelIdentityRef: NativeWireRef; readonly viewportMapRef: NativeWireRef; readonly nativeSessionRef: NativeWireRef;
 readonly nativeSessionGeneration: number; readonly localConsentRef: NativeWireRef; readonly reservationRef: NativeWireRef;
 readonly reservationGeneration: number; readonly nativeStopEpoch: number; readonly sequence: number;
 readonly claimedAtMs: number; readonly completedAtMs: number; readonly requestedEventCount: number; readonly sentEventCount: number;
 readonly cleanupRequestedCount: number; readonly cleanupSentCount: number; readonly cursorEffect: boolean;
 readonly focusEffect: boolean; readonly possibleEffect: boolean; readonly result: 'sent' | 'zero_effect_denied' | 'partial' | 'unknown';
}
export interface NativeDispatchCommand {
 readonly commandRef: NativeWireRef; readonly permitRef: NativeWireRef; readonly operationRef: NativeWireRef;
 readonly actionBatchRef: NativeWireRef; readonly targetRef: NativeWireRef; readonly approvedInputRef: NativeWireRef;
 readonly expiresAtMs: number; readonly sourceEpochDigest: NativeDigest;
}
export type NativeMapRequest = Readonly<{ challengeRef: NativeWireRef; mapRef: NativeWireRef; mapView: NativeMapView }>;
export type NativeCheckRequest = Readonly<{ bindingRef: NativeWireRef; snapshotRef: NativeWireRef; mapRef: NativeWireRef }>;
export type NativeConsumeRequest = Readonly<{ permitRef: NativeWireRef }>;
export type NativeDispatchRequest = Readonly<{ challengeRef: NativeWireRef; permitRef: NativeWireRef; ledgerRef: NativeWireRef; ledgerView: NativeLedgerView }>;
export type NativeVerifyRequest = Readonly<{ permitRef: NativeWireRef; dispatchRef: NativeWireRef }>;
export type NativeCancelRequest = Readonly<{ bindingRef: NativeWireRef; reason: StopReason }>;

export interface FocusSourceView {
 readonly version: 1; readonly operationRef: NativeWireRef; readonly bindingRef: NativeWireRef;
 readonly focusSourceRef: NativeWireRef; readonly sourceEpochDigest: NativeDigest; readonly originalRootWindowRef: NativeWireRef;
 readonly allowedForeground: 'managed-edith-or-original-chrome'; readonly expiresAtMs: number;
}
interface OriginalFocusTransferFields {
 readonly version: 1; readonly focusActionRef: NativeWireRef; readonly sourceEpochDigest: NativeDigest;
 readonly nativeBootRef: NativeWireRef; readonly nativeSessionRef: NativeWireRef; readonly computerSessionGeneration: number;
 readonly reservationRef: NativeWireRef; readonly reservationGeneration: number; readonly nativeStopEpoch: number;
 readonly originalRootWindowRef: NativeWireRef; readonly measuredBeforeAtMs: number; readonly measuredAfterAtMs: number;
 readonly expiresAtMs: number; readonly beforeGuardsCurrent: true; readonly afterGuardsCurrent: boolean;
 readonly afterForeground: 'original-chrome' | 'other' | 'unknown'; readonly rootAssociationCurrent: boolean;
}
export type MeasuredOriginalFocusTransfer =
 | Readonly<OriginalFocusTransferFields & { kind: 'already-foreground'; beforeForeground: 'original-chrome'; possibleEffect: false }>
 | Readonly<OriginalFocusTransferFields & { kind: 'set-original-foreground'; beforeForeground: 'managed-edith'; possibleEffect: true; apiBool: number | null }>;
export type FocusMeasuredTransfer = MeasuredOriginalFocusTransfer;
export interface FocusRecordAckView {
 readonly version: 1; readonly operationRef: NativeWireRef; readonly focusSourceRef: NativeWireRef; readonly focusActionRef: NativeWireRef;
 readonly outcome: 'focused' | 'already-foreground' | 'denied' | 'unknown'; readonly possibleEffect: boolean;
}
export type NativeFocusSourceRequest = Readonly<{ version: 1; operationRef: NativeWireRef; bindingRef: NativeWireRef }>;
export type NativeFocusRecordRequest = Readonly<{ version: 1; operationRef: NativeWireRef; bindingRef: NativeWireRef; focusSourceRef: NativeWireRef; focusRecord: MeasuredOriginalFocusTransfer }>;
export type NativeDriverNextRequest = Readonly<{ version: 1; operationRef: NativeWireRef }>;
export type NativeDriverNextView =
 | Readonly<{ version: 1; phase: 'enrollment'; operationRef: NativeWireRef; attemptRef: NativeWireRef }>
 | Readonly<{ version: 1; phase: 'focus'; operationRef: NativeWireRef; bindingRef: NativeWireRef; focusSourceRef: NativeWireRef }>
 | Readonly<{ version: 1; phase: 'measure'; operationRef: NativeWireRef; bindingRef: NativeWireRef; batchRef: NativeWireRef; snapshotRef: NativeWireRef; mapChallengeRef: NativeWireRef }>
 | Readonly<{ version: 1; phase: 'dispatch'; operationRef: NativeWireRef; batchRef: NativeWireRef; permitRef: NativeWireRef }>
 | Readonly<{ version: 1; phase: 'idle'; operationRef: NativeWireRef; reasonCode: NativeReasonCode }>
 | Readonly<{ version: 1; phase: 'terminal'; operationRef: NativeWireRef; safeStatus: NativeBrowserSafeStatus }>;
export type NativeInputRequest = Readonly<{ version: 1; commandRef: NativeWireRef; approvedInputRef: NativeWireRef }>;
export type NativeInputArmRequest = NativeInputRequest;
export interface DormantSearchSubmitAdmissionView {
 readonly version: 1; readonly commandRef: NativeWireRef; readonly approvedInputRef: NativeWireRef;
 readonly searchSubmitAdmissionRef: NativeWireRef; readonly causalSuccessorRef: NativeWireRef; readonly expiresAtMs: number;
}
interface NativeInputFields { readonly version: 1; readonly commandRef: NativeWireRef; readonly approvedInputRef: NativeWireRef; readonly expiresAtMs: number }
export type ResolvedNativeInputWireView =
 | Readonly<NativeInputFields & { kind: 'replace-field'; targetRef: NativeWireRef; text: string; utf16Units: number; clearPlan: 'none' | 'ctrl-a-backspace'; expectedPrimaryEventCount: number }>
 | Readonly<NativeInputFields & { kind: 'fixed-return'; targetRef: NativeWireRef; searchSubmitAdmissionRef: NativeWireRef; causalSuccessorRef: NativeWireRef; expectedPrimaryEventCount: 2 }>
 | Readonly<NativeInputFields & { kind: 'click-approved-href'; targetRef: NativeWireRef; causalSuccessorRef: NativeWireRef; expectedPrimaryEventCount: 2 }>
 | Readonly<NativeInputFields & { kind: 'scroll-profile-wheel'; surfaceRef: NativeWireRef; direction: 'up' | 'down'; wheelDelta: -120 | 120; expectedPrimaryEventCount: 1 }>;
export interface NativeBrowserSafeStatus {
 readonly status: 'unavailable' | 'ready' | 'denied' | 'partial' | 'unknown' | 'complete'; readonly reasonCode: NativeReasonCode;
 readonly logicalBatches: number; readonly requestedEventCount: number; readonly sentEventCount: number;
 readonly cleanupRequestedCount: number; readonly cleanupSentCount: number; readonly possibleEffect: boolean;
}
export interface NativeWorkflowPendingV1 {
 readonly success: true; readonly pending: true; readonly version: 1; readonly taskId: string;
 readonly attemptLookupRef: NativeWireRef; readonly operationLookupRef: NativeWireRef; readonly status: 'awaiting-native-confirmation';
}
export interface NativeParentPendingV1 extends NativeWorkflowPendingV1 { readonly stepId: string }
export type WorkflowPostResponse = EdithToolResult | NativeWorkflowPendingV1;
export type TaskExecutePostResponse = ExecuteTaskResult | NativeParentPendingV1;
export type NativeWorkflowResult = NativeWorkflowPendingV1 | NativeParentPendingV1 | EdithToolResult;
export type NativeResolveInvoke = Readonly<{ attempt_wire_ref: NativeWireRef; local_session_ref: NativeWireRef }>;
export type NativeDispatchInvoke = Readonly<{ operation_wire_ref: NativeWireRef }>;
export type NativeReadStatusInvoke = Readonly<{ operation_wire_ref: NativeWireRef }>;
export interface NativeParentStepResult {
 readonly taskId: string; readonly stepId: string; readonly scope: 'parent-step'; readonly success: boolean;
 readonly outcome: 'verified' | 'partial' | 'failed'; readonly operationId?: string; readonly auditEventId?: string;
 readonly receipt?: BrowserOperatorReceipt; readonly evidence?: NativeParentEvidenceCap; readonly reasonCode?: B0ReasonCode;
}
export type NativeStepResult = EdithToolResult;
export interface NativeParentAggregateView extends BrowserParentAggregateView {
 readonly nativePairs: readonly Readonly<{ stepId: string; operationId: string; strategyDigest: NativeDigest; pairDigest: NativeDigest;
  nativeLedgerDigest: NativeDigest; domObservationDigest: NativeDigest; auditEventId: string }>[];
}

/** Exact source/service methods from the frozen defining contracts. */
export interface NativeProducerPort {
 captureOwner(req: Request): BrowserOwnerCap;
 retainNativeWorkflowRequest(req: Request, owner: BrowserOwnerCap): RetainedBrowserRequestRef;
 selectOriginalBrowserExecution(request: RetainedBrowserRequestRef): 'existing-dom' | 'native-candidate' | 'unsupported';
 openNativeOriginal(owner: BrowserOwnerCap, strictRequest: RetainedBrowserRequestRef): AttemptRef;
 openNativeParentStep(execution: BrowserParentExecutionCap, step: BrowserParentStepCap): AttemptRef;
 runOriginalNativeLeaf(attempt: AttemptRef): Promise<NativeStepResult>;
 startNativeOriginal(attempt: AttemptRef): NativeWorkflowPendingV1;
 readNativeAttemptTicket(attempt: AttemptRef): NativeWorkflowPendingV1;
 freezeNativeParentStrategies(execution: BrowserParentExecutionCap): NativeParentStrategySetCap;
 startNativeParentLeaf(attempt: AttemptRef): Promise<NativeParentStepResult>;
 readNativeParentContinuation(execution: BrowserParentExecutionCap): NativeParentPendingV1 | ExecuteTaskResult;
 readNativeWorkflowResult(owner: BrowserOwnerCap, attempt: OriginalAttemptLookupRef): NativeWorkflowResult;
 verifyNativeAttemptPair(attempt: AttemptRef): Promise<NativeDomPairCap>;
 publishNativeParentPair(execution: BrowserParentExecutionCap, step: BrowserParentStepCap, pair: NativeDomPairCap): NativeParentStepResult;
 readNativeParentAggregate(execution: BrowserParentExecutionCap): NativeParentAggregateCap | undefined;
 inspectNativeParentAggregate(cap: NativeParentAggregateCap): Readonly<NativeParentAggregateView>;
 consumeNativeParentAggregate(cap: NativeParentAggregateCap, verificationDigest: string): void;
 prepareFreshNativeStep(binding: BindingRef, attempt: AttemptRef, batch: PlannedNativeBatchRef): Promise<SnapshotRef>;
 prepareNativeSearchTarget(attempt: AttemptRef, profile: PrivateFixedProviderProfileRef): SearchTargetRef;
 prepareSearchReplace(attempt: AttemptRef, target: SearchTargetRef): PlannedNativeBatchRef;
 verifyReplacement(dispatch: DispatchRef, target: SearchTargetRef): Promise<ReplacementPostconditionRef>;
 prepareSearchSubmitSuccessor(attempt: AttemptRef, replacement: ReplacementPostconditionRef, target: SearchTargetRef): Promise<PlannedNativeBatchRef>;
 armExactSearchSubmit(command: BackendConsumedEnterCommandRef, target: SearchTargetRef, successor: SearchCausalSuccessorRef): Promise<DormantSearchSubmitAdmissionRef>;
 sealSearchCausalSuccessor(attempt: AttemptRef, replacement: DispatchRef, enter: DispatchRef, admission: SearchSubmitAdmissionRef, observed: RetainedEngineNavigationRef): SearchSuccessorEvidenceRef;
 verifySearchCausalSuccessor(edge: SearchSuccessorEvidenceRef): Promise<PostconditionRef>;
 prepareApprovedHrefTarget(attempt: AttemptRef): TargetRef;
 prepareHrefSuccessor(attempt: AttemptRef, target: TargetRef): HrefCausalSuccessorRef;
 verifyHrefCausalSuccessor(edge: HrefCausalSuccessorRef, dispatch: DispatchRef, observed: RetainedEngineNavigationRef): Promise<PostconditionRef>;
 prepareNativeScrollProfile(attempt: AttemptRef): ScrollTargetRef;
 verifyNativeScrollProfile(target: ScrollTargetRef, dispatch: DispatchRef): Promise<PostconditionRef>;
}
export interface NativeAuthorityPort {
 /** Simulation NEVER issues nativePhysicalProof/PASS; only genuine issued paired records may complete. */
 readonly evidenceKind: 'genuine-native' | 'simulated-native-producer';
 currentBoot(): NativeBootRef | undefined;
 awaitCompletion(attempt: AttemptRef, scope: NativeCompletionScope): Promise<NativeCompletionRefs>;
 supportsStrategy(action: BrowserWorkflowAction): boolean;
 inspectIssuedDispatch(dispatch: DispatchRef, scope: Readonly<{ attempt: AttemptRef; batch: PlannedNativeBatchRef; snapshot: SnapshotRef; sourceEpochDigest: string }>): Readonly<NativeLedgerView> | undefined;
 registerBoot(peer: PrivateBridgeContext, nativeBootNonce: string): NativeBootRef;
 prepareEnrollmentSource(peer: PrivateBridgeContext, attempt: AttemptRef): EnrollmentSourceRef;
 recheckEnrollmentSource(peer: PrivateBridgeContext, source: EnrollmentSourceRef, challenge: EnrollmentChallengeRef): EnrollmentRecheckRef;
 associateMeasuredConsent(peer: PrivateBridgeContext, source: EnrollmentSourceRef, recheck: EnrollmentRecheckRef, consent: MeasuredConsentTransfer): BindingRef;
 issueMapChallenge(binding: BindingRef, snapshot: SnapshotRef): MapChallengeRef;
 acceptMeasuredMap(peer: PrivateBridgeContext, challenge: MapChallengeRef, mapWire: NativeMapView): NativeMapRef;
 claimStep(binding: BindingRef, snapshot: SnapshotRef, map: NativeMapRef): Promise<PermitRef>;
 consumeForDispatch(peer: PrivateBridgeContext, permit: PermitRef): NativeDispatchCommand;
 recordMeasuredDispatch(peer: PrivateBridgeContext, challenge: DispatchChallengeRef, ledger: NativeLedgerView): DispatchRef;
 verifyAndFinishStep(permit: PermitRef, dispatch: DispatchRef): Promise<StepEvidenceRef>;
 revoke(binding: BindingRef, reason: StopReason): void;
 readOriginalNativeNext(peer: PrivateBridgeContext, operation: OriginalOperationLookupRef): Promise<NativeDriverNextView>;
 resolveOriginalNativeInput(peer: PrivateBridgeContext, command: BackendConsumedCommandRef, input: ApprovedInputRef): ResolvedNativeInputWireView;
 armOriginalNativeInput(peer: PrivateBridgeContext, command: BackendConsumedEnterCommandRef, input: ApprovedInputRef): DormantSearchSubmitAdmissionView;
 prepareOriginalFocusSource(peer: PrivateBridgeContext, operation: OriginalOperationLookupRef, binding: BindingRef): FocusSourceRef;
 recordOriginalNativeFocus(peer: PrivateBridgeContext, source: FocusSourceRef, measured: MeasuredOriginalFocusTransfer): FocusRecordAckView;
}
/** Private cross-owner callbacks; object identities, not wire booleans or payload facts.
 * Implementations MUST reject foreign/cloned/expired/consumed-loss scopes. No fallback.
 * These minimal glue signatures are explicit ownership ports (see declaration handoff).
 */
export interface NativeIssuedScope {
 readonly attempt: AttemptRef; readonly binding: BindingRef; readonly backendBoot: BackendBootRef; readonly nativeBoot: NativeBootRef;
 readonly snapshot: SnapshotRef; readonly batch: PlannedNativeBatchRef; readonly permit: PermitRef;
}
export interface NativeAuthorityIdentityPort {
 verifyIssuedBinding(binding: BindingRef, attempt: AttemptRef, backendBoot: BackendBootRef, nativeBoot: NativeBootRef): boolean;
 verifyIssuedDispatch(dispatch: DispatchRef, scope: NativeIssuedScope): boolean;
}
export interface NativeSourceGuardPort {
 guardOriginalAttempt(attempt: AttemptRef): void;
 guardPreparedSnapshot(snapshot: SnapshotRef, binding: BindingRef, attempt: AttemptRef, batch: PlannedNativeBatchRef): void;
 subscribeOriginalSourceLoss(attempt: AttemptRef, onLost: () => void): Readonly<{ isCurrent(): boolean; dispose(): Promise<void> }>;
 readonly producer: Pick<NativeProducerPort, 'prepareFreshNativeStep' | 'verifyNativeAttemptPair'>;
}
/** Immutable retained intent stays private; no public/native authority constructor. */
export interface NativeRetainedIntentView { readonly request: Readonly<ParsedBrowserWorkflowRequest> }
/** Trusted server-only capture. Request/body/renderer cannot construct source membership. */
export interface NativeSourceCaptureArgs {
 readonly owner: BrowserOwnerCap;
 readonly sessionId: string; readonly pageId: string;
 readonly context: Readonly<{ actor: string; taskId: string }>;
 readonly request: Readonly<ParsedBrowserWorkflowRequest>; readonly guard: () => void;
 readonly deadline: number; readonly nativeBootRef: NativeBootRef; readonly attemptRef: AttemptRef;
}
/** Private source-engine callbacks; caps have independent source WeakMap membership. */
export interface NativeSourceEnginePort {
 captureNativeRetainedSource(args: NativeSourceCaptureArgs): Promise<BrowserNativeSourceHandle>;
 prepareTarget(source: BrowserNativeSourceHandle, action: BrowserWorkflowAction, index?: number): Promise<NativeSourceTargetCap>;
 snapshot(source: BrowserNativeSourceHandle, target: NativeSourceTargetCap): Promise<NativeSourceSnapshotCap>;
 planInput(source: BrowserNativeSourceHandle, target: NativeSourceTargetCap): Promise<NativeSourceInputCap>;
 verifyPostcondition(source: BrowserNativeSourceHandle, target: NativeSourceTargetCap, request: Readonly<ParsedBrowserWorkflowRequest>): Promise<NativeSourcePostconditionCap>;
 guardSource(source: BrowserNativeSourceHandle): void;
 verifyIssuedPostcondition(postcondition: NativeSourcePostconditionCap, source: BrowserNativeSourceHandle, target: NativeSourceTargetCap): boolean;
}
export type NativeSourceCapture = NativeSourceCaptureArgs;
/** Backend-only current scope, rechecked after every await; not a wire DTO. */
export interface NativeCompletionScope {
 readonly binding: BindingRef; readonly nativeBoot: NativeBootRef;
 readonly sourceEpochDigest: NativeDigest; readonly deadline: number;
}
/** Only issuer-owned references; final publication still verifies each exact identity. */
export interface NativeCompletionRefs {
 readonly dispatches: readonly DispatchRef[]; readonly postcondition: PostconditionRef;
}
/** ADDITIVE root source-transport freeze 676E35/E55133. Original 6CDF prefix immutable. */
export type NativeCanonicalTaskId = string; // actual original Task.id ASCII<=160, NOT capability/UUID alias
export type NativeTransportFailureCode = 'NATIVE_BRIDGE_UNAUTHORIZED' | 'NATIVE_METHOD_INVALID' |
 'NATIVE_CONTENT_TYPE_INVALID' | 'NATIVE_BODY_TOO_LARGE' | 'NATIVE_INPUT_INVALID' | 'NATIVE_QUERY_INVALID' |
 'NATIVE_SCOPE_STALE' | 'NATIVE_SCOPE_CONSUMED' | 'NATIVE_QUOTA_EXHAUSTED' | 'NATIVE_BROWSER_UNAVAILABLE';
export type NativeTransportFailure = Readonly<{ success: false; errorCode: NativeTransportFailureCode }>;
export type NativeTransportSuccess<T> = Readonly<{ success: true; result: T }>;
export type NativeTransportResponse<T> = NativeTransportSuccess<T> | NativeTransportFailure;
export type NativeTransportFailureHttpStatus = 400 | 401 | 405 | 409 | 413 | 415 | 503;

export interface NativeAssociateView {
 readonly version: 1; readonly phase: 'associated'; readonly bindingRef: NativeWireRef;
 readonly attemptRef: NativeWireRef; readonly operationRef: NativeWireRef; readonly backendBootRef: NativeWireRef;
 readonly nativeBootRef: NativeWireRef; readonly nativeSessionRef: NativeWireRef; readonly sourceEpochDigest: NativeDigest; readonly expiresAtMs: number;
}
export interface NativeMapAcceptedView {
 readonly version: 1; readonly phase: 'map-accepted'; readonly bindingRef: NativeWireRef; readonly operationRef: NativeWireRef;
 readonly snapshotRef: NativeWireRef; readonly mapRef: NativeWireRef; readonly mapChallengeRef: NativeWireRef;
 readonly sourceEpochDigest: NativeDigest; readonly expiresAtMs: number;
}
export interface NativePermitIssuedView {
 readonly version: 1; readonly phase: 'permit-issued'; readonly bindingRef: NativeWireRef; readonly operationRef: NativeWireRef;
 readonly batchRef: NativeWireRef; readonly snapshotRef: NativeWireRef; readonly mapRef: NativeWireRef; readonly permitRef: NativeWireRef;
 readonly dispatchChallengeRef: NativeWireRef; readonly sourceEpochDigest: NativeDigest; readonly expiresAtMs: number;
}
export interface NativeCommandConsumedView {
 readonly version: 1; readonly phase: 'command-consumed'; readonly dispatchChallengeRef: NativeWireRef; readonly command: NativeDispatchCommand;
}
export interface NativeDispatchRecordedView {
 readonly version: 1; readonly phase: 'dispatch-recorded'; readonly operationRef: NativeWireRef; readonly permitRef: NativeWireRef;
 readonly dispatchChallengeRef: NativeWireRef; readonly dispatchRef: NativeWireRef; readonly ledgerRef: NativeWireRef;
 readonly sequence: number; readonly safeStatus: NativeBrowserSafeStatus;
}
export interface NativeStepVerifiedView {
 readonly version: 1; readonly phase: 'step-verified'; readonly operationRef: NativeWireRef; readonly permitRef: NativeWireRef;
 readonly dispatchRef: NativeWireRef; readonly stepEvidenceRef: NativeWireRef; readonly safeStatus: NativeBrowserSafeStatus;
}
export interface NativeCancelledView {
 readonly version: 1; readonly phase: 'cancelled'; readonly bindingRef: NativeWireRef; readonly operationRef: NativeWireRef; readonly safeStatus: NativeBrowserSafeStatus;
}
export interface NativeLaunchDescriptor {
 readonly processLaunchRef: NativeWireRef; readonly pid: number; readonly canonicalExecutablePath: string;
 readonly executableSha256: NativeDigest; readonly launchEpoch: string; readonly childProcessAlive: true;
}
export interface NativeEngineDescriptor {
 readonly inventoryEpoch: string; readonly observedAtMs: number; readonly complete: true; readonly dirty: false;
 readonly contextCount: 1; readonly pageCount: 1; readonly frameCount: 1;
 readonly targetId: string; readonly frameId: string; readonly loaderId: string; readonly targetTypes: readonly ('browser' | 'page')[];
}
export interface NativeViewportDescriptor {
 readonly widthCss: number; readonly heightCss: number; readonly scrollX: number; readonly scrollY: number;
 readonly dpr: 1; readonly visualScale: 1; readonly visualOffsetX: 0; readonly visualOffsetY: 0;
}
export interface NativeTargetDescriptor {
 readonly targetRef: NativeWireRef; readonly semanticDigest: NativeDigest; readonly tag: string; readonly type: string; readonly writable: boolean;
 readonly rectCss: Readonly<{ x: number; y: number; width: number; height: number }>;
 readonly intendedPointCss: Readonly<{ x: number; y: number }>;
 readonly isolatedHitTargetRef: NativeWireRef; readonly isolatedHitProofDigest: NativeDigest;
 readonly logicalDocumentRef: NativeWireRef; readonly logicalRootRef: NativeWireRef;
 readonly logicalAncestryDigest: NativeDigest; readonly engineTargetIdentityDigest: NativeDigest;
}
export interface NativeOperationBudgetBatchDescriptor {
 readonly batchRef: NativeWireRef; readonly sequence: number;
 readonly kind: 'replace-field' | 'fixed-return' | 'click-approved-href' | 'scroll-profile-wheel';
 readonly primaryEventCount: number; readonly cleanupEventBudget: number; readonly utf16Units: number;
}
export interface NativeOperationBudgetDescriptor {
 readonly logicalBatches: number; readonly primaryEventCount: number; readonly cleanupEventBudget: number;
 readonly utf16Units: number; readonly recordSlots: number; readonly wholeResolutionLimit: 2;
 readonly batches: readonly NativeOperationBudgetBatchDescriptor[];
}
export type LaunchDescriptor = NativeLaunchDescriptor;
export type EngineDescriptor = NativeEngineDescriptor;
export type ViewportDescriptor = NativeViewportDescriptor;
export type TargetDescriptor = NativeTargetDescriptor;
export type OperationBudgetDescriptor = NativeOperationBudgetDescriptor;
interface NativeBoundSourceFields {
 readonly version: 1; readonly phase: 'bound-source'; readonly backendBootRef: NativeWireRef; readonly nativeBootRef: NativeWireRef;
 readonly attemptRef: NativeWireRef; readonly operationRef: NativeWireRef; readonly bindingRef: NativeWireRef;
 readonly originalTaskRef: NativeCanonicalTaskId; readonly originalOwnerRef: NativeWireRef;
 readonly sourceEpochDigest: NativeDigest; readonly requestScopeDigest: NativeDigest;
 readonly processLaunchRef: NativeWireRef; readonly originalRootWindowRef: NativeWireRef;
 readonly issuedAtMs: number; readonly operationDeadlineMs: number; readonly expiresAtMs: number;
 readonly launch: NativeLaunchDescriptor; readonly inventory: NativeEngineDescriptor; readonly viewport: NativeViewportDescriptor;
 readonly budget: NativeOperationBudgetDescriptor;
}
export type NativeBoundSourceView =
 | Readonly<NativeBoundSourceFields & { target: null; snapshotRef: null; batchRef: null; mapChallengeRef: null }>
 | Readonly<NativeBoundSourceFields & { target: NativeTargetDescriptor; snapshotRef: NativeWireRef; batchRef: NativeWireRef; mapChallengeRef: NativeWireRef }>;
/** No /status endpoint. DriverNext is the old exact union; this map adds NO driver member. */
export interface NativeTransportResultByPath {
 readonly '/boot': NativeBootView;
 readonly '/associate': NativeAssociateView;
 readonly '/map': NativeMapAcceptedView;
 readonly '/check': NativePermitIssuedView;
 readonly '/consume': NativeCommandConsumedView;
 readonly '/dispatch': NativeDispatchRecordedView;
 readonly '/verify': NativeStepVerifiedView;
 readonly '/cancel': NativeCancelledView;
 readonly '/driver/next': NativeDriverNextView;
 readonly '/source': EnrollmentSourceView | EnrollmentRecheckView | NativeBoundSourceView;
 readonly '/input': ResolvedNativeInputWireView;
 readonly '/input/arm': DormantSearchSubmitAdmissionView;
 readonly '/focus/source': FocusSourceView;
 readonly '/focus/record': FocusRecordAckView;
}

/** Trusted source5 runtime inspection only; never HTTP callback registration/DTO authority. */
export interface NativeAttemptInspection {
 readonly attempt: AttemptRef; readonly backendBoot: BackendBootRef; readonly backendBootLookupRef: string;
 readonly nativeBoot: NativeBootRef; readonly taskId: string; readonly stepId?: string;
 readonly originalOwnerBinding: string; readonly originalOwnerRef: string; readonly originalTaskRef: NativeCanonicalTaskId;
 readonly request: Readonly<ParsedBrowserWorkflowRequest>; readonly requestHash: string;
 readonly toolId: import('../../src/edith/browserOperatorContract').BrowserToolId;
 readonly admittedAtMs: number; readonly operationDeadlineMs: number; readonly phase: 'admitted' | 'running' | 'settled' | 'revoked';
 readonly attemptLookupRef: string; readonly operationLookupRef: string;
}
export interface NativeOperationStateInspection {
 readonly phase: 'admitted' | 'running' | 'settled' | 'revoked'; readonly started: boolean;
 readonly taskId: string; readonly stepId?: string; readonly taskStatus?: import('../../src/edith/core').EdithTaskStatus;
 readonly paired: boolean; readonly canonicalLeafSettled: boolean; readonly possibleEffect: boolean; readonly reasonCode: string;
 readonly operationLookupRef: string; readonly attemptLookupRef: string; readonly operationDeadlineMs: number;
 readonly binding?: BindingRef; readonly source?: BrowserNativeSourceHandle;
}
export interface NativePlannedBatchInspection {
 readonly attempt: AttemptRef; readonly binding: BindingRef; readonly nativeBoot: NativeBootRef;
 readonly operationLookupRef: string; readonly sourceEpochDigest: string;
 readonly sourceTarget: NativeSourceTargetCap; readonly sourceInput: NativeSourceInputCap;
 readonly snapshot?: SnapshotRef; readonly sourceSnapshot?: NativeSourceSnapshotCap;
 readonly expectedPrimaryEventCount: number; readonly expiresAtMs: number;
}
export interface NativeSourceRuntimePort {
 resolveIssuedAttemptLookup(alias: string): AttemptRef;
 resolveIssuedOperationLookup(alias: string): OriginalOperationLookupRef;
 resolveIssuedOperationAttempt(op: OriginalOperationLookupRef): AttemptRef;
 inspectNativeAttempt(attempt: AttemptRef): Readonly<NativeAttemptInspection>;
 guardOriginalAttempt(attempt: AttemptRef): void;
 guardPreparedSnapshot(snapshot: SnapshotRef, binding: BindingRef, attempt: AttemptRef, batch: PlannedNativeBatchRef): void;
 inspectNativeOperationState(attempt: AttemptRef): Readonly<NativeOperationStateInspection>;
 inspectNativeBackendBoot(): Readonly<{ backendBoot: BackendBootRef; backendBootLookupRef: string }>;
 captureNativeAttemptSource(attempt: AttemptRef): Promise<BrowserNativeSourceHandle>;
 attachNativeBinding(attempt: AttemptRef, authority: NativeAuthorityPort & NativeAuthorityIdentityPort, binding: BindingRef, source: BrowserNativeSourceHandle): void;
 prepareNativeAttemptBatches(attempt: AttemptRef): Promise<readonly PlannedNativeBatchRef[]>;
 prepareFreshNativeStep(binding: BindingRef, attempt: AttemptRef, batch: PlannedNativeBatchRef): Promise<SnapshotRef>;
 inspectNativePlannedBatch(batch: PlannedNativeBatchRef): Readonly<NativePlannedBatchInspection>;
 registerNativeDispatchScope(attempt: AttemptRef, authority: NativeAuthorityPort & NativeAuthorityIdentityPort, batch: PlannedNativeBatchRef, snapshot: SnapshotRef, permit: PermitRef): void;
 verifyNativeAttemptPair(attempt: AttemptRef): Promise<NativeDomPairCap>;
 inspectNativeLaunchDescriptor(source: BrowserNativeSourceHandle): Readonly<NativeLaunchDescriptor>;
 inspectNativeTargetDescriptor(source: BrowserNativeSourceHandle, target: NativeSourceTargetCap, snapshot: NativeSourceSnapshotCap): Readonly<NativeTargetDescriptor>;
 inspectNativeOperationBudget(attempt: AttemptRef): Readonly<NativeOperationBudgetDescriptor>;
}
/** Existing source-engine WeakMaps own these views. Held objects remain in Node only. */
export interface NativeSourceEngineLookupPort {
 inspectSource(handle: BrowserNativeSourceHandle): Readonly<import('./browserNativeSource').NativeSourceView>;
 inspectSourceIdentity(handle: BrowserNativeSourceHandle): Readonly<{ attemptRef: AttemptRef; nativeBootRef: NativeBootRef; owner: BrowserOwnerCap }>;
 inspectHeldSource(handle: BrowserNativeSourceHandle): Readonly<{ launch: import('./browserSessionStore').RetainedOwnedLaunchView;
  inventory: import('./browserSessionStore').OwnedEngineInventoryView; documentId: string }>;
 inspectSnapshot(snapshot: NativeSourceSnapshotCap): Readonly<import('./browserNativeSource').NativeSourceSnapshotView>;
 inspectInput(input: NativeSourceInputCap): Readonly<import('./browserNativeSource').NativeSourceInputView>;
 inspectPostcondition(cap: NativeSourcePostconditionCap): Readonly<import('./browserNativeSource').NativeSourcePostconditionView>;
 verifyIssuedPostcondition(cap: NativeSourcePostconditionCap, handle: BrowserNativeSourceHandle, target: NativeSourceTargetCap): boolean;
 guardSource(handle: BrowserNativeSourceHandle): void;
}
export type NativeSourceTransportRuntimePort = NativeSourceRuntimePort;
/** Read-only driver lookup NEVER prepares/mints/renews a phase; transitions issue first.
 * Late historically issued dispatches retain measured conservative effects before stale
 * denial, but cannot restore proof/current scope. Simulation never step-verified/PASS.
 * Source DOM logical identities never equal native UIA RuntimeIDs; Rust holds native
 * process/kernel/root/content/UIA independently. CSS zero offsets are not desktop(0,0).
 * All-original-batch/Enter+cleanup budgets reserved before any focus/input effect.
 */
/** Backend-only observed outcome supplement. The preceding B2BF bytes remain frozen. */
export interface NativeObservedSourceRuntimePort extends NativeSourceRuntimePort {
 captureNativeObservedSuccessor(attempt: AttemptRef): Promise<Readonly<{
  source: BrowserNativeSourceHandle;
  postcondition: NativeSourcePostconditionCap;
 }>>;
 supportsNativeObservedStrategy(action: BrowserWorkflowAction): boolean;
 guardNativeObservedProfile(attempt: AttemptRef): void;
 armNativeObservedCommand(scope: Readonly<{
  attempt: AttemptRef; batch: PlannedNativeBatchRef;
  command: BackendConsumedCommandRef | BackendConsumedEnterCommandRef;
  replacement?: Readonly<{ dispatch: DispatchRef; postcondition: NativeSourcePostconditionCap }>;
 }>): Readonly<{
  admission?: DormantSearchSubmitAdmissionRef;
  successor: SearchCausalSuccessorRef | HrefCausalSuccessorRef;
  expiresAtMs: number;
 }>;
 verifyNativeObservedOutcome(scope: Readonly<{
  attempt: AttemptRef; batch: PlannedNativeBatchRef;
  command: BackendConsumedCommandRef | BackendConsumedEnterCommandRef;
  dispatch: DispatchRef;
  admission?: DormantSearchSubmitAdmissionRef;
  successor: SearchCausalSuccessorRef | HrefCausalSuccessorRef;
 }>): Promise<NativeSourcePostconditionCap>;
}
export interface NativeObservedAuthorityInspectionPort {
 assertIssuedObservedCommand(scope: Readonly<{
  attempt: AttemptRef; batch: PlannedNativeBatchRef;
  command: BackendConsumedCommandRef | BackendConsumedEnterCommandRef;
 }>): void;
}
