import type { EdithRegisteredTool, EdithRiskLevel } from './core';

export function legacyToolForPermission(toolId: string, args: Record<string, unknown> = {}): EdithRegisteredTool | undefined {
  const action = String(args.action ?? '').toLowerCase();
  const policies: Record<string, { permissions: string[]; riskLevel: EdithRiskLevel; category: EdithRegisteredTool['metadata']['category'] }> = {
    list_dir: { permissions: ['file:read'], riskLevel: 1, category: 'file' },
    read_file: { permissions: ['file:read'], riskLevel: 1, category: 'file' },
    export_markdown: { permissions: ['system:notify'], riskLevel: 1, category: 'file' },
    schedule_reminder: { permissions: ['system:notify'], riskLevel: 1, category: 'reminder' },
    summarize_analytics: { permissions: ['system:read'], riskLevel: 1, category: 'analytics' },
    web_search: { permissions: ['network:read'], riskLevel: 1, category: 'web' },
    system_monitor: { permissions: ['system:read'], riskLevel: 1, category: 'system' },
    weather_report: { permissions: ['network:read'], riskLevel: 1, category: 'web' },
    file_processor: { permissions: ['file:read'], riskLevel: 2, category: 'file' },
    code_helper: action === 'run'
      ? { permissions: ['file:read', 'system:exec'], riskLevel: 4, category: 'code' }
      : { permissions: ['file:read'], riskLevel: 2, category: 'code' },
    dev_agent: { permissions: ['file:write'], riskLevel: 4, category: 'code' },
    youtube_control: { permissions: ['network:read'], riskLevel: 1, category: 'media' },
    background_monitor: action === 'add' || action === 'remove'
      ? { permissions: ['file:write'], riskLevel: 3, category: 'monitor' }
      : { permissions: ['file:read', 'network:read'], riskLevel: 1, category: 'monitor' },
    screen_processor: { permissions: ['system:read'], riskLevel: 2, category: 'vision' },
    flight_finder: { permissions: ['network:read'], riskLevel: 1, category: 'web' },
    browser_control: { permissions: ['network:read', 'browser:control'], riskLevel: 4, category: 'browser' },
  };
  const policy = policies[toolId];
  if (!policy) return undefined;
  return {
    id: toolId,
    metadata: {
      name: `Legacy ${toolId}`,
      version: 'legacy',
      description: `Legacy /api/tools/execute adapter for ${toolId}.`,
      category: policy.category,
      inputSchema: {},
      outputSchema: {},
      requiredPermissions: policy.permissions,
      riskLevel: policy.riskLevel,
      timeoutMs: 30_000,
      retryLimit: 0,
      supportsDryRun: false,
      supportsRollback: false,
      platforms: ['win32', 'darwin', 'linux'],
      dependencies: [],
    },
    handler: () => ({ success: true, toolId }),
  };
}
