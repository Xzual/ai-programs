const unverified = /\b(?:not tested|not run|skipped|unknown)\b/i;

export function reportWarnings(task, report) {
  const warnings = [];
  if (!report || report.status !== 'completed') warnings.push('Specialist report did not complete');
  if (!report || !Array.isArray(report.tests_run) || !Array.isArray(report.tests_passed) || !Array.isArray(report.tests_failed) || !Array.isArray(report.blockers)) {
    warnings.push('Specialist test evidence missing');
    return warnings;
  }
  if (report.tests_failed.length) warnings.push('Specialist reported failed tests');
  if (report.blockers.length) warnings.push('Specialist reported blockers');
  if (report.commit_hash !== undefined && report.commit_hash !== null) warnings.push('Specialist reported an unauthorized commit');
  if (report.push_status !== undefined && !['not_started', 'skipped'].includes(report.push_status)) warnings.push('Specialist reported an unauthorized push');
  for (const command of task.tests) {
    if (!report.tests_run.includes(command)) warnings.push(`Required test not run: ${command}`);
    if (!report.tests_passed.some(result => result.includes(command) && !unverified.test(result))) warnings.push(`Required test has no passing evidence: ${command}`);
  }
  return warnings;
}
