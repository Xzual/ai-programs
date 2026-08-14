export type EdithRiskLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type EdithTaskStatus =
  | 'CREATED'
  | 'ANALYZING'
  | 'PLANNING'
  | 'WAITING_DEPENDENCY'
  | 'WAITING_PERMISSION'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'RETRYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK';

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
  result?: string;
  failureReason?: string;
  memoryReferences: string[];
  auditEvents: string[];
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
  category: 'file' | 'system' | 'reminder' | 'analytics' | 'web' | 'media' | 'code' | 'monitor';
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
      return { success: false, toolId, error: `Unknown EDITH tool: ${toolId}` };
    }

    this.assertPermission(tool, context);

    if (context.dryRun) {
      return {
        success: true,
        toolId,
        result: `Dry run passed for ${tool.metadata.name}.`,
        structuredOutput: { dryRun: true, metadata: tool.metadata },
      };
    }

    return tool.handler(args, context);
  }

  private assertPermission(tool: EdithRegisteredTool, context: EdithToolExecutionContext): void {
    const missing = tool.metadata.requiredPermissions.filter(
      (permission) => !context.authorizedPermissions.includes(permission)
    );
    if (missing.length > 0) {
      throw new EdithPermissionError(
        `Missing permissions for ${tool.id}: ${missing.join(', ')}`,
        missing,
        tool.metadata.riskLevel
      );
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
    status: 'CREATED',
    createdAt: new Date().toISOString(),
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
    memoryReferences: [],
    auditEvents: [],
  };
}
