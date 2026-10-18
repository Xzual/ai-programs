import { parseBrowserWorkflowRequest, type BrowserToolId, type BrowserParseResult, type ParsedBrowserWorkflowRequest } from '../../src/edith/browserOperatorContract';

/** Shared syntax-only registered defaults; this function grants no runtime authority. */
export function normalizeRegisteredBrowserArgs(
  toolId: BrowserToolId,
  args: Readonly<Record<string, unknown>>,
  dryRun: boolean,
): BrowserParseResult<ParsedBrowserWorkflowRequest> {
  let action = args.action;
  if (toolId === 'browser_search') action = action === undefined || action === 'search' ? 'search' : '__invalid__';
  if (toolId === 'browser_open') action = action === undefined || action === 'navigate' ? 'navigate' : '__invalid__';
  if (toolId === 'playwright_browser_agent') action = action === 'open' ? 'navigate' : action ?? 'title';
  return parseBrowserWorkflowRequest({ ...args, action,
    verificationGoal: args.verificationGoal ?? (toolId === 'browser_workflow' ? undefined : 'Verify requested owned browser action.'),
    ...(dryRun ? { dryRun: true } : {}),
  });
}
