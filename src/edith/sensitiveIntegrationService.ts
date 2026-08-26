import { appendAuditEvent, createAuditEvent } from './audit';
import type { EdithRegisteredTool, EdithRiskLevel, EdithToolResult } from './core';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { permissionService } from './permissionService';

export type SensitiveIntegrationDomain = 'iot' | 'finance';

export interface SensitiveIntegrationCapability {
  id: 'iot_feedback_stub' | 'finance_trading_guard';
  domain: SensitiveIntegrationDomain;
  name: string;
  status: 'configuration_required';
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  supportedActions: string[];
  safetyBoundary: string;
}

export interface SensitiveActionRequest {
  action: string;
  target?: string;
  payload?: Record<string, unknown>;
  reason?: string;
  dryRun?: boolean;
}

function toolForCapability(capability: SensitiveIntegrationCapability): EdithRegisteredTool {
  return {
    id: capability.id,
    metadata: {
      name: capability.name,
      version: '0.1.0',
      description: capability.safetyBoundary,
      category: capability.domain === 'iot' ? 'iot' : 'finance',
      inputSchema: {},
      outputSchema: {},
      requiredPermissions: capability.requiredPermissions,
      riskLevel: capability.riskLevel,
      timeoutMs: 5000,
      retryLimit: 0,
      supportsDryRun: true,
      supportsRollback: false,
      platforms: ['win32', 'darwin', 'linux'],
      dependencies: ['real provider integration'],
    },
    handler: () => ({ success: false, toolId: capability.id }),
  };
}

export class SensitiveIntegrationService {
  capabilities(): SensitiveIntegrationCapability[] {
    return [
      {
        id: 'iot_feedback_stub',
        domain: 'iot',
        name: 'IoT Feedback Stub',
        status: 'configuration_required',
        riskLevel: 4,
        requiredPermissions: ['iot:control'],
        supportedActions: ['status', 'notify', 'light_feedback', 'device_feedback'],
        safetyBoundary: 'IoT actions are architecture stubs until a real smart-home provider is configured and explicitly permission-gated.',
      },
      {
        id: 'finance_trading_guard',
        domain: 'finance',
        name: 'Finance Trading Guard',
        status: 'configuration_required',
        riskLevel: 5,
        requiredPermissions: ['trading:execute'],
        supportedActions: ['quote', 'portfolio_read', 'paper_order', 'live_order'],
        safetyBoundary: 'Finance/trading execution is disabled by default; live orders require explicit high-risk permissions and a real broker adapter.',
      },
    ];
  }

  run(domain: SensitiveIntegrationDomain, request: SensitiveActionRequest, actor = 'edith-api'): EdithToolResult {
    const capability = this.capabilities().find((item) => item.domain === domain);
    if (!capability) {
      return { success: false, toolId: 'sensitive_integration', error: `Unknown sensitive integration domain: ${domain}`, errorCode: 'VALIDATION_ERROR' };
    }
    if (!request.action || !capability.supportedActions.includes(request.action)) {
      return {
        success: false,
        toolId: capability.id,
        error: `Unsupported ${domain} action: ${request.action || 'missing'}`,
        errorCode: 'VALIDATION_ERROR',
        structuredOutput: { supportedActions: capability.supportedActions },
      };
    }

    try {
      killSwitchService.assertAllowed(domain === 'finance' ? 'trading_execution' : 'tool_execution', actor);
    } catch (error) {
      if (!(error instanceof KillSwitchActiveError)) throw error;
      this.audit(capability, actor, 'sensitive_integration.blocked_by_kill_switch', 'denied', error.message);
      return {
        success: false,
        toolId: capability.id,
        error: error.message,
        errorCode: 'PERMISSION_DENIED',
        structuredOutput: { killSwitch: error.state, disabledCapability: error.capability },
      };
    }

    const decision = permissionService.decideToolExecution({
      tool: toolForCapability(capability),
      actor,
    });
    if (decision.status === 'DENY') {
      this.audit(capability, actor, 'sensitive_integration.permission_denied', 'denied', decision.rationale);
      return {
        success: false,
        toolId: capability.id,
        error: decision.rationale,
        errorCode: 'PERMISSION_DENIED',
        structuredOutput: { capability, permissionDecision: decision },
      };
    }

    const message = `${capability.name} passed permission checks, but no real provider adapter is configured. No external action was executed.`;
    this.audit(capability, actor, request.dryRun ? 'sensitive_integration.dry_run' : 'sensitive_integration.configuration_required', 'allowed', message);
    return {
      success: false,
      toolId: capability.id,
      error: `CONFIGURATION_REQUIRED: ${message}`,
      errorCode: 'TOOL_ERROR',
      structuredOutput: {
        capability,
        request,
        honestStatus: 'No IoT, broker, exchange, bank, or trading action was executed.',
      },
    };
  }

  private audit(
    capability: SensitiveIntegrationCapability,
    actor: string,
    action: string,
    authorization: 'allowed' | 'denied',
    message: string
  ): void {
    appendAuditEvent(createAuditEvent({
      actor,
      action,
      toolId: capability.id,
      authorization,
      riskLevel: capability.riskLevel,
      result: authorization === 'allowed' ? 'error' : 'denied',
      message,
    }));
  }
}

export const sensitiveIntegrationService = new SensitiveIntegrationService();
