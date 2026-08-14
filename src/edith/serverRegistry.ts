import os from 'os';
import { spawn } from 'child_process';
import {
  EdithPermissionError,
  EdithToolTimeoutError,
  EdithToolValidationError,
  EdithToolRegistry,
  type EdithToolExecutionContext,
  type EdithToolResult,
} from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { listExternalSkillProjects } from './skills/catalog';
import { createStoredTask } from './taskStore';
import { getEdithPersistenceStore } from './persistence';

export const edithToolRegistry = new EdithToolRegistry();

export const DEFAULT_LOCAL_PERMISSIONS = [
  'system:read',
  'network:read',
  'file:read',
  'system:notify',
];

const HIGH_RISK_ENABLED = process.env.EDITH_ENABLE_HIGH_RISK_TOOLS === 'true';
const HIGH_RISK_PERMISSIONS = [
  'system:exec',
  'file:write',
  'browser:control',
  'computer:control',
];

function normalizeToolRunId(toolId: string): string {
  return `toolrun-${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function recordToolRun(params: {
  id: string;
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  status: 'success' | 'error' | 'denied';
}): void {
  getEdithPersistenceStore().recordToolRun?.(params);
}

function safeResultText(result: EdithToolResult): string {
  return (result.error ?? result.result ?? JSON.stringify(result.structuredOutput ?? {})).slice(0, 4000);
}

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeHttpUrl(rawUrl: string): string {
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Only http/https URLs are allowed: ${rawUrl}`);
  }
  return parsed.toString();
}

function openUrl(url: string): void {
  const platform = os.platform();
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }

  const command = platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function highRiskUnavailable(toolId: string): EdithToolResult | null {
  if (HIGH_RISK_ENABLED) return null;
  return {
    success: false,
    toolId,
    error:
      'AUTHORIZATION_REQUIRED: High-risk tools are installed but disabled. Start the server with EDITH_ENABLE_HIGH_RISK_TOOLS=true after reviewing the requested action.',
    structuredOutput: {
      capability: 'AUTHORIZATION_REQUIRED',
      requiredEnv: 'EDITH_ENABLE_HIGH_RISK_TOOLS=true',
    },
  };
}

function runPythonModule(moduleName: string, args: string[]): Promise<EdithToolResult> {
  return new Promise((resolve) => {
    const child = spawn('python', ['-m', moduleName, ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        toolId: moduleName,
        error: `Timed out while running ${moduleName}.`,
        structuredOutput: { timeout: true },
      });
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        toolId: moduleName,
        result: (stdout || stderr || `Process exited with code ${code}`).slice(0, 8000),
        error: code === 0 ? undefined : (stderr || stdout || `Process exited with code ${code}`).slice(0, 4000),
        structuredOutput: { exitCode: code },
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        toolId: moduleName,
        error: error.message,
        structuredOutput: { capability: 'CONFIGURATION_REQUIRED' },
      });
    });
  });
}

function systemMetrics(): Record<string, unknown> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const uptime = os.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpu: { model: cpus[0]?.model ?? 'N/A', cores: cpus.length },
    memory: {
      total: `${(totalMem / 1024 ** 3).toFixed(1)} GB`,
      used: `${(usedMem / 1024 ** 3).toFixed(1)} GB`,
      free: `${(freeMem / 1024 ** 3).toFixed(1)} GB`,
      usagePercent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
    },
    uptime: `${hours}s ${minutes}d`,
    nodeVersion: process.version,
  };
}

edithToolRegistry.register({
  id: 'system_monitor',
  metadata: {
    name: 'System Monitor',
    version: '1.0.0',
    description: 'Reads local operating system, CPU, memory, uptime, and Node.js runtime metrics.',
    category: 'system',
    inputSchema: {},
    outputSchema: {
      platform: { type: 'string' },
      arch: { type: 'string' },
      hostname: { type: 'string' },
      cpu: { type: 'object' },
      memory: { type: 'object' },
      uptime: { type: 'string' },
      nodeVersion: { type: 'string' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 0,
    timeoutMs: 2000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (_args, _context): EdithToolResult => {
    const metrics = systemMetrics();
    return {
      success: true,
      toolId: 'system_monitor',
      result: JSON.stringify(metrics, null, 2),
      structuredOutput: metrics,
    };
  },
});

edithToolRegistry.register({
  id: 'open_interpreter_agent',
  metadata: {
    name: 'Open Interpreter Agent',
    version: '0.1.0',
    description: 'Runs a local Open Interpreter task when explicitly enabled for high-risk execution.',
    category: 'code',
    inputSchema: {
      prompt: { type: 'string', required: true, description: 'The local computer/code task to attempt.' },
    },
    outputSchema: {
      stdout: { type: 'string' },
      exitCode: { type: 'number' },
    },
    requiredPermissions: ['system:exec', 'file:read', 'file:write'],
    riskLevel: 5,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['open-interpreter'],
  },
  handler: async (args): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('open_interpreter_agent');
    if (unavailable) return unavailable;
    const prompt = getStringArg(args, 'prompt');
    if (!prompt) {
      return { success: false, toolId: 'open_interpreter_agent', error: 'prompt is required.' };
    }
    const result = await runPythonModule('interpreter', ['--message', prompt]);
    return { ...result, toolId: 'open_interpreter_agent' };
  },
});

edithToolRegistry.register({
  id: 'computer_control_agent',
  metadata: {
    name: 'Computer Control Agent',
    version: '0.1.0',
    description: 'High-risk placeholder for full desktop control adapters such as Computer Use, Open Interpreter, or Mark-L actions.',
    category: 'system',
    inputSchema: {
      instruction: { type: 'string', required: true, description: 'Desktop-control instruction.' },
    },
    outputSchema: {
      capability: { type: 'string' },
    },
    requiredPermissions: ['computer:control', 'system:exec'],
    riskLevel: 5,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32'],
    dependencies: ['computer-use plugin or Mark-L computer_control adapter'],
  },
  handler: (args): EdithToolResult => {
    const unavailable = highRiskUnavailable('computer_control_agent');
    if (unavailable) return unavailable;
    const instruction = getStringArg(args, 'instruction');
    if (!instruction) {
      return { success: false, toolId: 'computer_control_agent', error: 'instruction is required.' };
    }
    return {
      success: false,
      toolId: 'computer_control_agent',
      error: 'CONFIGURATION_REQUIRED: Desktop-control runtime adapter is registered but not yet bound to a local controller.',
      structuredOutput: {
        capability: 'CONFIGURATION_REQUIRED',
        instruction,
        nextAdapterOptions: ['Computer Use plugin runtime', 'Mark-L computer_control.py adapter'],
      },
    };
  },
});

edithToolRegistry.register({
  id: 'browser_use_agent',
  metadata: {
    name: 'Browser Use Agent',
    version: '0.1.0',
    description: 'Runs a browser-use style autonomous browser task when the package and high-risk mode are enabled.',
    category: 'web',
    inputSchema: {
      task: { type: 'string', required: true, description: 'Browser task to perform.' },
    },
    outputSchema: {
      stdout: { type: 'string' },
      exitCode: { type: 'number' },
    },
    requiredPermissions: ['network:read', 'browser:control'],
    riskLevel: 3,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['browser-use'],
  },
  handler: async (args): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('browser_use_agent');
    if (unavailable) return unavailable;
    const task = getStringArg(args, 'task');
    if (!task) {
      return { success: false, toolId: 'browser_use_agent', error: 'task is required.' };
    }
    return {
      success: false,
      toolId: 'browser_use_agent',
      error: 'CONFIGURATION_REQUIRED: browser-use is cataloged, but the Python adapter package is not installed/configured yet.',
      structuredOutput: {
        capability: 'CONFIGURATION_REQUIRED',
        package: 'browser-use',
        task,
      },
    };
  },
});

edithToolRegistry.register({
  id: 'playwright_browser_agent',
  metadata: {
    name: 'Playwright Browser Agent',
    version: '0.1.0',
    description: 'Foundation adapter for deterministic Playwright browser automation.',
    category: 'web',
    inputSchema: {
      url: { type: 'string', required: true, description: 'URL to inspect or open with Playwright.' },
      action: { type: 'string', required: false, description: 'open, title, or screenshot.' },
    },
    outputSchema: {
      url: { type: 'string' },
      title: { type: 'string' },
      capability: { type: 'string' },
    },
    requiredPermissions: ['network:read', 'browser:control'],
    riskLevel: 3,
    timeoutMs: 30000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['playwright'],
  },
  handler: async (args): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('playwright_browser_agent');
    if (unavailable) return unavailable;
    const rawUrl = getStringArg(args, 'url');
    if (!rawUrl) return { success: false, toolId: 'playwright_browser_agent', error: 'url is required.' };
    const url = normalizeHttpUrl(rawUrl);
    try {
      const importDependency = new Function('specifier', 'return import(specifier)') as (
        specifier: string
      ) => Promise<any>;
      const playwright = await importDependency('playwright');
      const browser = await playwright.chromium.launch({ headless: false });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      const title = await page.title();
      await browser.close();
      return {
        success: true,
        toolId: 'playwright_browser_agent',
        result: `Playwright opened ${url}\nTitle: ${title}`,
        structuredOutput: { url, title },
      };
    } catch (error) {
      return {
        success: false,
        toolId: 'playwright_browser_agent',
        error: error instanceof Error ? error.message : String(error),
        structuredOutput: { capability: 'CONFIGURATION_REQUIRED', dependency: 'playwright' },
      };
    }
  },
});

edithToolRegistry.register({
  id: 'task_create',
  metadata: {
    name: 'Create EDITH Task',
    version: '1.0.0',
    description: 'Creates a durable EDITH task record for planning and follow-up.',
    category: 'analytics',
    inputSchema: {
      title: { type: 'string', required: true },
      objective: { type: 'string', required: true },
      originalUserRequest: { type: 'string', required: true },
    },
    outputSchema: {
      task: { type: 'object' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 1000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (args): EdithToolResult => {
    const title = getStringArg(args, 'title') || 'EDITH Task';
    const objective = getStringArg(args, 'objective');
    const originalUserRequest = getStringArg(args, 'originalUserRequest') || objective;
    if (!objective || !originalUserRequest) {
      return { success: false, toolId: 'task_create', error: 'objective and originalUserRequest are required.' };
    }
    const task = createStoredTask({
      title,
      objective,
      originalUserRequest,
      riskLevel: 1,
    });
    return {
      success: true,
      toolId: 'task_create',
      result: `Görev oluşturuldu: ${task.title}\nID: ${task.id}`,
      structuredOutput: { task },
    };
  },
});

edithToolRegistry.register({
  id: 'browser_open',
  metadata: {
    name: 'Browser Open',
    version: '1.0.0',
    description: 'Opens a validated http/https URL in the default browser.',
    category: 'web',
    inputSchema: {
      url: { type: 'string', required: true, description: 'The http/https URL to open.' },
    },
    outputSchema: {
      url: { type: 'string' },
    },
    requiredPermissions: ['network:read'],
    riskLevel: 1,
    timeoutMs: 2000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (args): EdithToolResult => {
    const rawUrl = getStringArg(args, 'url');
    if (!rawUrl) {
      return { success: false, toolId: 'browser_open', error: 'url is required.' };
    }
    const url = normalizeHttpUrl(rawUrl);
    openUrl(url);
    return {
      success: true,
      toolId: 'browser_open',
      result: `Opened browser URL: ${url}`,
      structuredOutput: { url },
    };
  },
});

edithToolRegistry.register({
  id: 'browser_search',
  metadata: {
    name: 'Browser Search',
    version: '1.0.0',
    description: 'Opens a web search for the provided query in the default browser.',
    category: 'web',
    inputSchema: {
      query: { type: 'string', required: true, description: 'Search query.' },
    },
    outputSchema: {
      url: { type: 'string' },
      query: { type: 'string' },
    },
    requiredPermissions: ['network:read'],
    riskLevel: 1,
    timeoutMs: 2000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (args): EdithToolResult => {
    const query = getStringArg(args, 'query');
    if (!query) {
      return { success: false, toolId: 'browser_search', error: 'query is required.' };
    }
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    openUrl(url);
    return {
      success: true,
      toolId: 'browser_search',
      result: `Opened browser search: ${query}`,
      structuredOutput: { query, url },
    };
  },
});

edithToolRegistry.register({
  id: 'ai_skill_catalog',
  metadata: {
    name: 'AI Skill Catalog',
    version: '1.0.0',
    description: 'Lists curated external AI skill projects and their safe EDITH integration plans.',
    category: 'analytics',
    inputSchema: {},
    outputSchema: {
      projects: { type: 'array' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 0,
    timeoutMs: 1000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (): EdithToolResult => {
    const projects = listExternalSkillProjects();
    return {
      success: true,
      toolId: 'ai_skill_catalog',
      result: JSON.stringify(projects, null, 2),
      structuredOutput: { projects },
    };
  },
});

export async function executeEdithTool(
  toolId: string,
  args: Record<string, unknown>,
  context: Partial<EdithToolExecutionContext> = {}
): Promise<EdithToolResult> {
  const tool = edithToolRegistry.get(toolId);
  const executionContext: EdithToolExecutionContext = {
    actor: context.actor ?? 'local-user',
    taskId: context.taskId,
    dryRun: context.dryRun,
    authorizedPermissions:
      context.authorizedPermissions ??
      (HIGH_RISK_ENABLED
        ? [...DEFAULT_LOCAL_PERMISSIONS, ...HIGH_RISK_PERMISSIONS]
        : DEFAULT_LOCAL_PERMISSIONS),
  };

  if (!tool) {
    return { success: false, toolId, error: `Unknown EDITH tool: ${toolId}`, errorCode: 'UNKNOWN_TOOL' };
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const toolRunId = normalizeToolRunId(toolId);

  try {
    const result = await edithToolRegistry.execute(toolId, args, executionContext);
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();
    const normalizedResult: EdithToolResult = {
      ...result,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      errorCode: result.success ? undefined : result.errorCode ?? 'TOOL_ERROR',
    };
    const audit = createAuditEvent({
      actor: executionContext.actor,
      taskId: executionContext.taskId,
      action: executionContext.dryRun ? 'tool.dry_run' : 'tool.execute',
      toolId,
      authorization: 'allowed',
      riskLevel: tool.metadata.riskLevel,
      result: normalizedResult.success ? 'success' : 'error',
      message: safeResultText(normalizedResult).slice(0, 500),
    });
    appendAuditEvent(audit);
    const withAudit = { ...normalizedResult, auditEventId: audit.id };
    recordToolRun({
      id: toolRunId,
      toolId,
      toolName: tool.metadata.name,
      args,
      result: safeResultText(withAudit),
      timestamp: startedAtMs,
      status: withAudit.success ? 'success' : 'error',
    });
    return withAudit;
  } catch (error) {
    const denied = error instanceof EdithPermissionError;
    const invalid = error instanceof EdithToolValidationError;
    const timedOut = error instanceof EdithToolTimeoutError;
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();
    const audit = createAuditEvent({
      actor: executionContext.actor,
      taskId: executionContext.taskId,
      action: executionContext.dryRun ? 'tool.dry_run' : 'tool.execute',
      toolId,
      authorization: denied ? 'denied' : 'allowed',
      riskLevel: denied ? error.riskLevel : tool.metadata.riskLevel,
      result: denied ? 'denied' : 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    appendAuditEvent(audit);
    const result: EdithToolResult = {
      success: false,
      toolId,
      error: audit.message,
      auditEventId: audit.id,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      errorCode: denied
        ? 'PERMISSION_DENIED'
        : invalid
        ? 'VALIDATION_ERROR'
        : timedOut
        ? 'TIMEOUT'
        : 'TOOL_ERROR',
      structuredOutput: denied
        ? { missingPermissions: error.missingPermissions }
        : invalid
        ? { validationErrors: error.validationErrors }
        : timedOut
        ? { timeoutMs: error.timeoutMs }
        : undefined,
    };
    recordToolRun({
      id: toolRunId,
      toolId,
      toolName: tool.metadata.name,
      args,
      result: safeResultText(result),
      timestamp: startedAtMs,
      status: denied ? 'denied' : 'error',
    });
    return result;
  }
}
