import type { BrowserWorkflowRequest, EdithToolResult } from './core';
import { executeEdithTool } from './serverRegistry';

export interface BrowserWorkflowCapability {
  action: BrowserWorkflowRequest['action'];
  toolPath: string[];
  sideEffects: 'none' | 'browser_navigation' | 'file_read' | 'file_write' | 'form_input';
  requiresUrl: boolean;
  requiresQuery: boolean;
  requiresFilePath: boolean;
  verification: string;
}

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
        verification: 'Search query is validated and recorded before dispatch.',
      },
      {
        action: 'navigate',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Page title or URL evidence must be returned by the adapter.',
      },
      {
        action: 'extract',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Extracted text artifact is required before completion.',
      },
      {
        action: 'screenshot',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'browser_navigation',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Screenshot artifact path and page URL must be recorded.',
      },
      {
        action: 'download_pdf',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'file_write',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Downloaded file path, mime type, and size must be recorded.',
      },
      {
        action: 'read_pdf',
        toolPath: ['vision_observe', 'playwright_browser_agent'],
        sideEffects: 'file_read',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Read-only PDF observation must be created; no form or file mutation.',
      },
      {
        action: 'upload_file',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'form_input',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: true,
        verification: 'Upload target, file path, and confirmation state must be recorded before submit.',
      },
      {
        action: 'fill_form',
        toolPath: ['playwright_browser_agent'],
        sideEffects: 'form_input',
        requiresUrl: true,
        requiresQuery: false,
        requiresFilePath: false,
        verification: 'Selectors are validated; form submission requires explicit permission and post-action evidence.',
      },
    ];
  }

  async run(request: BrowserWorkflowRequest, actor = 'edith-browser-workflow'): Promise<EdithToolResult> {
    if (request.dryRun) {
      const capability = this.capabilities().find((item) => item.action === request.action);
      return {
        success: true,
        toolId: 'browser_workflow',
        result: `Dry-run accepted for browser workflow: ${request.action}.`,
        structuredOutput: {
          request,
          capability,
          verification: 'SCHEMA_ONLY',
          plannedTools: capability?.toolPath ?? (request.action === 'search' ? ['browser_search'] : ['playwright_browser_agent']),
        },
      };
    }

    if (request.action === 'search') {
      if (!request.query) {
        return { success: false, toolId: 'browser_workflow', error: 'query is required for search.', errorCode: 'VALIDATION_ERROR' };
      }
      return executeEdithTool('browser_search', { query: request.query }, { actor });
    }

    if (!request.url) {
      return { success: false, toolId: 'browser_workflow', error: 'url is required for this browser workflow.', errorCode: 'VALIDATION_ERROR' };
    }

    return executeEdithTool('playwright_browser_agent', {
      url: request.url,
      action: request.action === 'screenshot' ? 'screenshot' : 'title',
    }, { actor });
  }
}

export const browserWorkflowService = new BrowserWorkflowService();
