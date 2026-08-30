import type { BrowserWorkflowRequest, EdithToolResult } from './core';
import { executeEdithTool } from './serverRegistry';

type BrowserRuntimeStatus = 'AVAILABLE' | 'APPROVAL_REQUIRED' | 'CONFIGURATION_REQUIRED' | 'BLOCKED';

export interface BrowserWorkflowCapability {
  action: BrowserWorkflowRequest['action'];
  toolPath: string[];
  sideEffects: 'none' | 'browser_navigation' | 'file_read' | 'file_write' | 'form_input';
  requiresUrl: boolean;
  requiresQuery: boolean;
  requiresFilePath: boolean;
  requiresApproval: boolean;
  requiredPermissions: string[];
  riskLevel: 0 | 1 | 2 | 3 | 4 | 5;
  runtimeStatus: BrowserRuntimeStatus;
  verification: string;
}

const VALID_ACTIONS = new Set<BrowserWorkflowRequest['action']>([
  'search',
  'navigate',
  'extract',
  'screenshot',
  'download_pdf',
  'read_pdf',
  'upload_file',
  'fill_form',
]);

export class BrowserWorkflowService {
  capabilities(): BrowserWorkflowCapability[] {
    return [
      {
        action: 'search',
        toolPath: ['browser_search'],
        sideEffects: 'browser_navigation',
        requiresUrl: false,
        requiresQuery: true,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read'],
        riskLevel: 2,
        runtimeStatus: 'APPROVAL_REQUIRED',
        verification: 'Search query, generated URL, and user approval are recorded before dispatch.',
      },
      {
        action: 'navigate',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control'],
        riskLevel: 3,
        runtimeStatus: 'APPROVAL_REQUIRED',
        verification: 'Page title or URL evidence must be returned by the adapter.',
      },
      {
        action: 'extract',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control'],
        riskLevel: 3,
        runtimeStatus: 'CONFIGURATION_REQUIRED',
        verification: 'Extracted text artifact is required before completion.',
      },
      {
        action: 'screenshot',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control'],
        riskLevel: 3,
        runtimeStatus: 'CONFIGURATION_REQUIRED',
        verification: 'Screenshot artifact path and page URL must be recorded.',
      },
      {
        action: 'download_pdf',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'file_write',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control', 'file:write'],
        riskLevel: 4,
        runtimeStatus: 'BLOCKED',
        verification: 'Downloaded file path, mime type, and size must be recorded.',
      },
      {
        action: 'read_pdf',
        toolPath: ['vision_observe', 'playwright_browser_agent'],
        sideEffects: 'file_read',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'file:read'],
        riskLevel: 2,
        runtimeStatus: 'CONFIGURATION_REQUIRED',
        verification: 'Read-only PDF observation must be created; no form or file mutation.',
      },
      {
        action: 'upload_file',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'form_input',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: true,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control', 'file:read'],
        riskLevel: 4,
        runtimeStatus: 'BLOCKED',
        verification: 'Upload target, file path, and confirmation state must be recorded before submit.',
      },
      {
        action: 'fill_form',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'form_input',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        requiresApproval: true,
        requiredPermissions: ['network:read', 'browser:control'],
        riskLevel: 4,
        runtimeStatus: 'BLOCKED',
        verification: 'Selectors are validated; form submission requires explicit permission and post-action evidence.',
      },
    ];
  }

  async run(request: BrowserWorkflowRequest, actor = 'edith-browser-workflow'): Promise<EdithToolResult> {
    const capability = this.capabilities().find((item) => item.action === request.action);
    if (!capability || !VALID_ACTIONS.has(request.action)) {
      return {
        success: false,
        toolId: 'browser_workflow',
        error: `Unsupported browser workflow action: ${String(request.action)}.`,
        errorCode: 'VALIDATION_ERROR',
        structuredOutput: {
          request,
          validActions: Array.from(VALID_ACTIONS),
          safetyMode: 'READ_ONLY',
        },
      };
    }

    if (capability.requiresQuery && !request.query) {
      return { success: false, toolId: 'browser_workflow', error: 'query is required for search.', errorCode: 'VALIDATION_ERROR' };
    }
    if (capability.requiresUrl && !request.url) {
      return { success: false, toolId: 'browser_workflow', error: 'url is required for this browser workflow.', errorCode: 'VALIDATION_ERROR' };
    }
    if (capability.requiresFilePath && !request.filePath) {
      return { success: false, toolId: 'browser_workflow', error: 'filePath is required for this browser workflow.', errorCode: 'VALIDATION_ERROR' };
    }

    if (request.dryRun) {
      return {
        success: true,
        toolId: 'browser_workflow',
        result: `Dry-run accepted for browser workflow: ${request.action}.`,
        structuredOutput: {
          request,
          capability,
          loop: ['OBSERVE', 'UNDERSTAND', 'PLAN', 'REQUEST_APPROVAL_IF_NEEDED', 'ACT', 'VERIFY', 'REPORT'],
          verification: 'SCHEMA_ONLY',
          safetyVerification: 'SCHEMA_POLICY_AND_APPROVAL_BOUNDARY_ONLY',
          plannedTools: capability.toolPath,
        },
      };
    }

    if (capability.requiresApproval && !request.approvalGranted) {
      return {
        success: false,
        toolId: 'browser_workflow',
        error: `APPROVAL_REQUIRED: ${request.action} requires explicit approval before browser or filesystem side effects.`,
        errorCode: 'PERMISSION_DENIED',
        structuredOutput: {
          request,
          capability,
          requiredPermissions: capability.requiredPermissions,
          safetyMode: capability.sideEffects === 'file_write'
            ? 'DOWNLOAD_WITH_APPROVAL'
            : capability.sideEffects === 'form_input'
            ? 'FORM_FILLING_WITH_APPROVAL'
            : 'SAFE_NAVIGATION',
        },
      };
    }

    if (request.action === 'search') {
      return executeEdithTool('browser_search', { query: request.query }, { actor });
    }

    if (capability.runtimeStatus !== 'APPROVAL_REQUIRED') {
      return {
        success: false,
        toolId: 'browser_workflow',
        error: `CONFIGURATION_REQUIRED: ${request.action} is defined but no verified runtime adapter is bound for this browser workflow.`,
        errorCode: 'TOOL_ERROR',
        structuredOutput: {
          request,
          capability,
          honestStatus: 'No browser action, form action, upload, download, OCR, or extraction was executed.',
        },
      };
    }

    return executeEdithTool('playwright_browser_agent', {
      url: request.url,
      action: 'title',
    }, { actor });
  }
}

export const browserWorkflowService = new BrowserWorkflowService();
