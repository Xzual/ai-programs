import type { ComputerActionKind, ComputerActionRequest, EdithRiskLevel, EdithToolResult } from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { permissionService } from './permissionService';

const FORBIDDEN_PATTERNS = [
  /\b(delete|remove|rm\s+-rf|del\s+|erase|format)\b/i,
  /\b(regedit|registry|set-itemproperty|new-itemproperty)\b/i,
  /\b(system settings|control panel|gpedit|bcdedit)\b/i,
  /\b(buy|sell|trade|order|withdraw|transfer)\b/i,
  /\b(all files|mass|bulk|recursive)\b/i,
];

const ACTION_RISK: Record<ComputerActionKind, EdithRiskLevel> = {
  mouse_move: 3,
  click: 4,
  double_click: 4,
  right_click: 4,
  type_text: 4,
  hotkey: 4,
  focus_window: 3,
  switch_window: 3,
  launch_app: 4,
  close_app: 4,
};

function containsForbiddenIntent(request: ComputerActionRequest): string | undefined {
  const haystack = [request.action, request.target, request.text, request.keys?.join(' '), request.reason]
    .filter(Boolean)
    .join(' ');
  return FORBIDDEN_PATTERNS.find((pattern) => pattern.test(haystack))?.source;
}

export class ComputerActionService {
  execute(request: ComputerActionRequest, actor = 'edith-computer-action'): EdithToolResult {
    const riskLevel = ACTION_RISK[request.action] ?? 5;
    const forbiddenPattern = containsForbiddenIntent(request);
    if (forbiddenPattern) {
      const audit = createAuditEvent({
        actor,
        action: 'computer_action.denied_forbidden',
        toolId: 'computer_action',
        authorization: 'denied',
        riskLevel,
        result: 'denied',
        message: `Forbidden computer action intent matched policy: ${forbiddenPattern}`,
      });
      appendAuditEvent(audit);
      return {
        success: false,
        toolId: 'computer_action',
        errorCode: 'PERMISSION_DENIED',
        error: 'FORBIDDEN_ACTION: This computer action is blocked by EDITH safety policy.',
        auditEventId: audit.id,
        structuredOutput: { request, forbiddenPattern },
      };
    }

    try {
      killSwitchService.assertAllowed('computer_control', actor);
    } catch (error) {
      if (!(error instanceof KillSwitchActiveError)) throw error;
      return {
        success: false,
        toolId: 'computer_action',
        errorCode: 'PERMISSION_DENIED',
        error: error.message,
        structuredOutput: { killSwitch: error.state },
      };
    }

    const requiredPermissions = ['computer:control'];
    if (request.action === 'launch_app' || request.action === 'close_app') {
      requiredPermissions.push('system:exec');
    }

    const pseudoTool = {
      id: 'computer_action',
      metadata: {
        requiredPermissions,
        riskLevel,
      },
    };
    const decision = permissionService.decideToolExecution({
      tool: pseudoTool as any,
      actor,
    });
    if (decision.status === 'DENY') {
      const audit = createAuditEvent({
        actor,
        action: 'computer_action.permission_denied',
        toolId: 'computer_action',
        authorization: 'denied',
        riskLevel,
        result: 'denied',
        message: decision.rationale,
      });
      appendAuditEvent(audit);
      return {
        success: false,
        toolId: 'computer_action',
        errorCode: 'PERMISSION_DENIED',
        error: decision.rationale,
        auditEventId: audit.id,
        structuredOutput: { permissionDecision: decision },
      };
    }

    const audit = createAuditEvent({
      actor,
      action: request.dryRun ? 'computer_action.dry_run' : 'computer_action.configuration_required',
      toolId: 'computer_action',
      authorization: 'allowed',
      riskLevel,
      result: request.dryRun ? 'success' : 'error',
      message: request.dryRun
        ? `Dry-run accepted for ${request.action}.`
        : 'No local computer-control runtime adapter is bound.',
    });
    appendAuditEvent(audit);

    return {
      success: Boolean(request.dryRun),
      toolId: 'computer_action',
      result: request.dryRun ? `Dry-run accepted for ${request.action}.` : undefined,
      error: request.dryRun ? undefined : 'CONFIGURATION_REQUIRED: Computer action policy passed, but no local runtime adapter is bound.',
      errorCode: request.dryRun ? undefined : 'TOOL_ERROR',
      auditEventId: audit.id,
      structuredOutput: {
        request,
        verification: request.dryRun ? 'SCHEMA_AND_POLICY_ONLY' : 'RUNTIME_NOT_BOUND',
      },
    };
  }
}

export const computerActionService = new ComputerActionService();
