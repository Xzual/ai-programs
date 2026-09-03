import { permissionService } from './permissionService';

export type EdithRiskLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type EdithToolRisk = 'READ' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type StructuredObservationSource =
  | 'screen'
  | 'window'
  | 'application'
  | 'dialog'
  | 'notification'
  | 'browser_page'
  | 'pdf'
  | 'screenshot_diff';

export interface StructuredObservation {
  id: string;
  source: StructuredObservationSource;
  capturedAt: string;
  summary: string;
  text?: string;
  application?: string;
  windowTitle?: string;
  monitorIndex?: number;
  confidence: number;
  readOnly: true;
  artifacts: string[];
  metadata: Record<string, unknown>;
}

export type ComputerActionKind =
  | 'mouse_move'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type_text'
  | 'hotkey'
  | 'focus_window'
  | 'switch_window'
  | 'launch_app'
  | 'close_app';

export interface ComputerActionRequest {
  action: ComputerActionKind;
  target?: string;
  text?: string;
  x?: number;
  y?: number;
  keys?: string[];
  reason: string;
  dryRun?: boolean;
}

export type BrowserWorkflowAction =
  | 'search'
  | 'navigate'
  | 'extract'
  | 'screenshot'
  | 'download_pdf'
  | 'read_pdf'
  | 'upload_file'
  | 'fill_form';

export interface BrowserWorkflowRequest {
  action: BrowserWorkflowAction;
  query?: string;
  url?: string;
  selectors?: Record<string, string>;
  filePath?: string;
  verificationGoal: string;
  dryRun?: boolean;
  approvalGranted?: boolean;
}

export interface InterruptSignal {
  id: string;
  taskId?: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  active: boolean;
}

export interface ConfidenceCheck {
  id: string;
  createdAt: string;
  subject: string;
  confidence: number;
  requiresApproval: boolean;
  rationale: string;
  riskLevel: EdithRiskLevel;
}

export interface PresenceContext {
  id: string;
  capturedAt: string;
  device: 'desktop' | 'browser' | 'unknown';
  activeApplication?: string;
  activeWindowTitle?: string;
  microphoneInUse?: boolean;
  cameraInUse?: boolean;
  inferredState: 'available' | 'busy' | 'meeting' | 'gaming' | 'unknown';
  confidence: number;
}

export interface SentimentContext {
  id: string;
  capturedAt: string;
  source: 'text' | 'voice' | 'unknown';
  tone: 'calm' | 'urgent' | 'frustrated' | 'positive' | 'neutral';
  responseStyle: 'brief' | 'standard' | 'supportive';
  confidence: number;
  notes: string[];
}

export interface PatternMemoryEntry {
  id: string;
  patternType: 'working_hours' | 'frequent_command' | 'application_usage' | 'routine';
  label: string;
  evidenceCount: number;
  lastObservedAt: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

export type KnowledgeGraphNodeType =
  | 'Vault'
  | 'Folder'
  | 'Tag'
  | 'Person'
  | 'Organization'
  | 'Project'
  | 'Task'
  | 'Note'
  | 'Conversation'
  | 'Website'
  | 'File'
  | 'Agent'
  | 'Memory'
  | 'Tool'
  | 'Model'
  | 'Provider'
  | 'Decision'
  | 'System'
  | 'Concept'
  | 'Automation'
  | 'SecurityEvent'
  | 'Event'
  | 'Trade';

export type KnowledgeGraphRelationshipType =
  | 'uses'
  | 'reads'
  | 'writes'
  | 'calls'
  | 'updated'
  | 'links_to'
  | 'referenced_by'
  | 'retrieved_from'
  | 'stored_in'
  | 'triggered_by'
  | 'synchronized_with'
  | 'derived_from'
  | 'mentions'
  | 'inside_folder'
  | 'tagged_with'
  | 'embeds'
  | 'verified_by'
  | 'learned_from'
  | 'part_of'
  | 'same_project'
  | 'same_person'
  | 'same_topic'
  | 'trading_observation_for'
  | 'worksWith'
  | 'created'
  | 'belongsTo'
  | 'relatedTo'
  | 'dependsOn'
  | 'mentionedIn'
  | 'owns'
  | 'participatesIn'
  | 'references'
  | 'generatedBy';

export interface KnowledgeGraphNode {
  id: string;
  title: string;
  type: KnowledgeGraphNodeType;
  aliases: string[];
  tags: string[];
  path?: string;
  folder?: string;
  source: 'edith' | 'obsidian' | 'memory' | 'task' | 'agent' | 'tool' | 'rag';
  importance: number;
  recentActivityAt: string;
  properties: Record<string, unknown>;
  deletedAt?: string;
}

export interface KnowledgeGraphRelationship {
  id: string;
  from: string;
  to: string;
  type: KnowledgeGraphRelationshipType;
  strength: number;
  source: 'edith' | 'obsidian' | 'memory' | 'task' | 'agent' | 'tool' | 'rag';
  evidence: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ObsidianNoteIndexRecord {
  path: string;
  absolutePath: string;
  entityId: string;
  title: string;
  folder: string;
  extension: '.md' | '.canvas' | 'attachment';
  mtimeMs: number;
  size: number;
  hash: string;
  tags: string[];
  links: string[];
  attachments: string[];
  properties: Record<string, unknown>;
  indexedAt: string;
  deletedAt?: string;
}

export interface KnowledgeChunk {
  id: string;
  nodeId: string;
  notePath: string;
  content: string;
  ordinal: number;
  tokensApprox: number;
  hash: string;
  embeddingStatus: 'ready' | 'embedding_provider_required';
  embeddingProvider?: string;
  embeddingModel?: string;
  vector?: number[];
  indexedAt: string;
}

export interface KnowledgeSyncEvent {
  id: string;
  action: 'create' | 'edit' | 'delete' | 'rename' | 'move' | 'reindex' | 'write';
  path: string;
  previousPath?: string;
  source: 'edith' | 'obsidian' | 'watcher' | 'manual';
  status: 'success' | 'error' | 'ignored';
  message: string;
  createdAt: string;
}

export interface KnowledgeGraphSnapshot {
  generatedAt: string;
  nodes: KnowledgeGraphNode[];
  relationships: KnowledgeGraphRelationship[];
  metrics: Array<{ label: string; value: number; type?: KnowledgeGraphNodeType | 'Relationship' | 'Chunk' }>;
  sources: Record<string, number>;
  recommendations: KnowledgeRecommendation[];
}

export interface KnowledgeRecommendation {
  id: string;
  type: 'auto_link' | 'duplicate' | 'cluster' | 'missing_relationship';
  title: string;
  rationale: string;
  nodeIds: string[];
  confidence: number;
  actionRequired: true;
}

export type EdithPlanStepStatus = 'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface EdithPlanStep {
  id: string;
  title: string;
  objective: string;
  status: EdithPlanStepStatus;
  dependsOn: string[];
  suggestedTools: string[];
  requiredPermissions: string[];
  validationCriteria: string[];
  riskLevel: EdithRiskLevel;
  parallelGroup?: string;
}

export type EdithContextReferenceType = 'memory' | 'task' | 'tool' | 'tool_run' | 'audit';

export interface EdithContextReference {
  type: EdithContextReferenceType;
  id: string;
  label: string;
  excerpt?: string;
  relevance: number;
  sensitivity?: 'public' | 'internal' | 'sensitive';
  source?: string;
}

export interface EdithContextSnapshot {
  id: string;
  query: string;
  createdAt: string;
  taskId?: string;
  summary: string;
  memoryReferences: EdithContextReference[];
  taskReferences: EdithContextReference[];
  toolReferences: EdithContextReference[];
  toolRunReferences: EdithContextReference[];
  auditReferences: EdithContextReference[];
  redactions: string[];
}

export interface EdithPlan {
  id: string;
  taskId: string;
  objective: string;
  createdAt: string;
  planner: 'heuristic-v1';
  status: 'DRAFT' | 'READY' | 'INVALID';
  steps: EdithPlanStep[];
  requiredTools: string[];
  requiredPermissions: string[];
  requiredAgents: string[];
  contextSnapshot?: EdithContextSnapshot;
  validationCriteria: string[];
  stopConditions: string[];
  maxIterations: number;
  maxRetries: number;
  maxToolCalls: number;
  taskTimeoutMs: number;
}

export type EdithVerificationStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'RETRYABLE';

export interface EdithVerificationCheck {
  id: string;
  label: string;
  status: EdithVerificationStatus;
  evidence: string;
  required: boolean;
}

export interface EdithVerificationResult {
  id: string;
  taskId: string;
  verifier: 'heuristic-v1';
  status: EdithVerificationStatus;
  checkedAt: string;
  summary: string;
  checks: EdithVerificationCheck[];
  retryable: boolean;
}

export type EdithRecoveryClassification =
  | 'VERIFICATION_RETRYABLE'
  | 'PARTIAL_RESULT'
  | 'EXECUTION_FAILED'
  | 'PERMISSION_DENIED'
  | 'BUDGET_EXHAUSTED'
  | 'UNKNOWN';

export type EdithRecoveryAction = 'REPLAN' | 'WAIT_PERMISSION' | 'STOP';

export interface EdithRecoveryEvent {
  id: string;
  taskId: string;
  createdAt: string;
  attempt: number;
  classification: EdithRecoveryClassification;
  action: EdithRecoveryAction;
  reason: string;
  previousStatus: EdithTaskStatus;
  newStatus: EdithTaskStatus;
  previousPlanId?: string;
  newPlanId?: string;
  capabilityAssessmentId?: string;
  permissionRequest?: {
    actor: string;
    toolIds: string[];
    permissions: string[];
    highRiskToolIds: string[];
    rationale: string;
  };
}

export type EdithAgentHealthState = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export interface EdithAgentMetadata {
  id: string;
  name: string;
  version: string;
  responsibility: string;
  capabilities: string[];
  allowedTools: string[];
  requiredPermissions: string[];
  inputSchema: Record<string, EdithToolSchemaField>;
  outputSchema: Record<string, EdithToolSchemaField>;
  timeoutMs: number;
  health: EdithAgentHealthState;
  metrics: {
    runs: number;
    successes: number;
    failures: number;
  };
}

export interface EdithAgentRoute {
  agentId: string;
  reason: string;
  matchedTools: string[];
  missingPermissions: string[];
}

export type EdithTaskStatus =
  | 'CREATED'
  | 'ANALYZING'
  | 'QUEUED'
  | 'PLANNING'
  | 'WAITING_DEPENDENCY'
  | 'RUNNING'
  | 'PAUSED'
  | 'RETRYING'
  | 'VERIFYING'
  | 'WAITING_PERMISSION'
  | 'WAITING_FOR_APPROVAL'
  | 'BLOCKED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK';

export type EdithTaskTimelineEventType =
  | 'status'
  | 'plan'
  | 'agent'
  | 'tool'
  | 'verification'
  | 'recovery'
  | 'memory'
  | 'checkpoint'
  | 'artifact'
  | 'observation'
  | 'permission'
  | 'audit';

export interface EdithTaskTimelineEvent {
  id: string;
  taskId: string;
  type: EdithTaskTimelineEventType;
  actor: string;
  message: string;
  createdAt: string;
  status?: EdithTaskStatus;
  toolId?: string;
  agentId?: string;
  riskLevel?: EdithRiskLevel;
  auditEventId?: string;
  metadata?: Record<string, unknown>;
}

export interface EdithAgentActivity {
  id: string;
  taskId: string;
  agentId: string;
  agentName?: string;
  role: 'orchestrator' | 'planner' | 'executor' | 'verifier' | 'recovery' | 'tool' | 'memory' | 'security' | 'abstraction';
  status: 'SELECTED' | 'RUNNING' | 'WAITING_FOR_APPROVAL' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  endedAt?: string;
  message: string;
  tools: string[];
  planningOnly: boolean;
}

export interface EdithTask {
  id: string;
  parentTaskId?: string;
  title: string;
  objective: string;
  originalUserRequest: string;
  normalizedIntent?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: EdithTaskStatus;
  createdAt: string;
  updatedAt?: string;
  deadline?: string;
  dependencies: string[];
  subtasks: string[];
  assignedAgent?: string;
  candidateAgents: string[];
  toolsRequired: string[];
  permissionsRequired: string[];
  riskLevel: EdithRiskLevel;
  checkpoints: string[];
  artifacts: string[];
  observations: string[];
  validationRules: string[];
  plan?: EdithPlan;
  verification?: EdithVerificationResult;
  recoveryEvents?: EdithRecoveryEvent[];
  timeline: EdithTaskTimelineEvent[];
  agentActivity: EdithAgentActivity[];
  result?: string;
  failureReason?: string;
  memoryReferences: string[];
  auditEvents: string[];
  queue?: {
    state: 'queued' | 'running' | 'interrupted' | 'resumable' | 'done';
    queuedAt?: string;
    startedAt?: string;
    interruptedAt?: string;
    resumeFromStepId?: string;
  };
}

export interface EdithToolSchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
}

export interface EdithToolMetadata {
  name: string;
  version: string;
  description: string;
  category: 'file' | 'system' | 'reminder' | 'analytics' | 'web' | 'media' | 'code' | 'monitor' | 'vision' | 'computer' | 'browser' | 'design3d' | 'iot' | 'finance' | 'knowledge';
  inputSchema: Record<string, EdithToolSchemaField>;
  outputSchema: Record<string, EdithToolSchemaField>;
  requiredPermissions: string[];
  riskLevel: EdithRiskLevel;
  timeoutMs: number;
  retryLimit: number;
  supportsDryRun: boolean;
  supportsRollback: boolean;
  platforms: string[];
  dependencies: string[];
}

export interface EdithToolExecutionContext {
  actor: string;
  taskId?: string;
  dryRun?: boolean;
  authorizedPermissions: string[];
}

export interface EdithToolResult {
  success: boolean;
  toolId: string;
  result?: string;
  error?: string;
  structuredOutput?: Record<string, unknown>;
  auditEventId?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorCode?: 'VALIDATION_ERROR' | 'PERMISSION_DENIED' | 'TIMEOUT' | 'TOOL_ERROR' | 'UNKNOWN_TOOL';
}

export interface EdithAuditEvent {
  id: string;
  actor: string;
  taskId?: string;
  action: string;
  toolId: string;
  target?: string;
  timestamp: string;
  authorization: 'allowed' | 'denied';
  riskLevel: EdithRiskLevel;
  result: 'success' | 'error' | 'denied';
  message?: string;
}

export type EdithToolHandler = (
  args: Record<string, unknown>,
  context: EdithToolExecutionContext
) => Promise<EdithToolResult> | EdithToolResult;

export interface EdithRegisteredTool {
  id: string;
  metadata: EdithToolMetadata;
  handler: EdithToolHandler;
}

export class EdithPermissionError extends Error {
  constructor(
    message: string,
    public readonly missingPermissions: string[],
    public readonly riskLevel: EdithRiskLevel
  ) {
    super(message);
    this.name = 'EdithPermissionError';
  }
}

export class EdithToolValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message);
    this.name = 'EdithToolValidationError';
  }
}

export class EdithToolTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'EdithToolTimeoutError';
  }
}

export class EdithToolRegistry {
  private readonly tools = new Map<string, EdithRegisteredTool>();

  register(tool: EdithRegisteredTool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  get(toolId: string): EdithRegisteredTool | undefined {
    return this.tools.get(toolId);
  }

  list(): Array<Omit<EdithRegisteredTool, 'handler'>> {
    return Array.from(this.tools.values()).map(({ id, metadata }) => ({ id, metadata }));
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    context: EdithToolExecutionContext
  ): Promise<EdithToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, toolId, error: `Unknown EDITH tool: ${toolId}`, errorCode: 'UNKNOWN_TOOL' };
    }

    this.assertPermission(tool, context);
    this.assertInputSchema(tool, args);

    if (context.dryRun) {
      return {
        success: true,
        toolId,
        result: `Dry run passed for ${tool.metadata.name}.`,
        structuredOutput: { dryRun: true, metadata: tool.metadata },
      };
    }

    return this.withTimeout(tool, args, context);
  }

  private assertPermission(tool: EdithRegisteredTool, context: EdithToolExecutionContext): void {
    const decision = permissionService.decideToolExecution({
      tool,
      actor: context.actor,
      authorizedPermissions: context.authorizedPermissions,
    });
    if (decision.status === 'DENY') {
      throw new EdithPermissionError(
        decision.rationale,
        decision.missingPermissions,
        decision.riskLevel
      );
    }
  }

  private assertInputSchema(tool: EdithRegisteredTool, args: Record<string, unknown>): void {
    const errors: string[] = [];

    for (const [key, field] of Object.entries(tool.metadata.inputSchema)) {
      const value = args[key];
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push(`${key} is required`);
        continue;
      }
      if (value === undefined || value === null || value === '') continue;

      if (!this.matchesFieldType(value, field.type)) {
        errors.push(`${key} must be ${field.type}`);
      }
    }

    if (errors.length > 0) {
      throw new EdithToolValidationError(
        `Invalid input for ${tool.id}: ${errors.join(', ')}`,
        errors
      );
    }
  }

  private matchesFieldType(value: unknown, type: EdithToolSchemaField['type']): boolean {
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return typeof value === type;
  }

  private async withTimeout(
    tool: EdithRegisteredTool,
    args: Record<string, unknown>,
    context: EdithToolExecutionContext
  ): Promise<EdithToolResult> {
    const timeoutMs = Math.max(1, tool.metadata.timeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        Promise.resolve(tool.handler(args, context)),
        new Promise<EdithToolResult>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new EdithToolTimeoutError(`Tool timed out after ${timeoutMs}ms: ${tool.id}`, timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

export function createTask(params: {
  title: string;
  objective: string;
  originalUserRequest: string;
  toolsRequired?: string[];
  permissionsRequired?: string[];
  riskLevel?: EdithRiskLevel;
}): EdithTask {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: params.title,
    objective: params.objective,
    originalUserRequest: params.originalUserRequest,
    priority: 'normal',
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependencies: [],
    subtasks: [],
    candidateAgents: [],
    toolsRequired: params.toolsRequired ?? [],
    permissionsRequired: params.permissionsRequired ?? [],
    riskLevel: params.riskLevel ?? 0,
    checkpoints: [],
    artifacts: [],
    observations: [],
    validationRules: [],
    recoveryEvents: [],
    timeline: [],
    agentActivity: [],
    memoryReferences: [],
    auditEvents: [],
  };
}
