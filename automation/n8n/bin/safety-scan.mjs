const protectedRuntimePath = /(^|\/)(?:\.env(?:\.|$)|logs\/|backups\/|\.venv\/|data\/|database\/)|\.(?:db|sqlite|sqlite3)$/i;
const sensitiveControlPath = /(?:^|\/)(?:killSwitch|permission\w*|interactionSafety\w*|demo_execution|jev_adapter|jev_loop|demo_asset_modes|observer_config)(?:\.|\/)/i;
const liveTradingPath = /(?:^|\/)(?:trading|exchange|binance|jev)(?:\.|\/)|(?:^|\/)crypto\/(?:config|src)\//i;
const secretPatterns = [
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['OpenAI API key', /\bsk-[0-9A-Za-z_-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{20,}/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Named API credential', /\b(?:GEMINI_API_KEY|JEV_API_KEY|SUPABASE_SERVICE_ROLE_KEY|BINANCE_API_SECRET)\s*[:=]\s*["'`]?[A-Za-z0-9+/_=-]{16,}/i],
  ['Credential assignment', /(?:password|api[_-]?key|access[_-]?token|api[_-]?secret)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

export function secretTypes(content) {
  return secretPatterns.filter(([, pattern]) => pattern.test(content)).map(([label]) => label);
}

export function scanChangeMetadata({ changedPaths, stagedPaths, deletedPaths, deletionCounts, task, heldLocks }) {
  const warnings = [];
  const allowed = new Set([...(task.expected_files || []), ...(task.protected_files || [])]);
  const uniqueChanged = [...new Set(changedPaths)];
  for (const p of uniqueChanged) {
    if (!allowed.has(p)) warnings.push(`Unexpected modified file: ${p}`);
    if (protectedRuntimePath.test(p)) warnings.push(`Protected runtime or user-data path changed: ${p}`);
    if (sensitiveControlPath.test(p) && task.risk_level !== 'MANUAL_APPROVAL') warnings.push(`Sensitive control requires manual approval: ${p}`);
    if (liveTradingPath.test(p) && task.risk_level !== 'MANUAL_APPROVAL') warnings.push(`Trading path requires manual approval: ${p}`);
    if ((task.protected_files || []).includes(p) && !heldLocks.includes(p)) warnings.push(`Protected file changed without lock: ${p}`);
  }
  for (const p of stagedPaths) if (protectedRuntimePath.test(p)) warnings.push(`Protected runtime or credential path staged: ${p}`);
  for (const p of deletedPaths) warnings.push(`Unexpected deletion: ${p}`);
  for (const [p, lines] of Object.entries(deletionCounts)) if (lines >= 100) warnings.push(`Large deletion (${lines} lines): ${p}`);
  return [...new Set(warnings)];
}
