/**
 * Formats validation results into a human-readable report and summary line.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan) so the
 * orchestrator does not own the presentation concern.
 */
import type { IValidationResult } from './ValidationResult.js';

export type { IValidationResult } from './ValidationResult.js';

/**
 * Generates a summary line counting failures and warnings from the results.
 * @param results - Array of IValidationResult objects to summarise.
 * @returns Summary string like "Result: 2 errors, 1 warning" or "All checks passed ✓".
 */
function summarizeCounts(results: IValidationResult[]): string {
  const fails = results.filter(r => r.status === 'fail').length;
  const warns = results.filter(r => r.status === 'warn').length;
  if (fails === 0 && warns === 0) return 'All checks passed ✓';
  const parts: string[] = [];
  if (fails > 0) parts.push(`${String(fails)} error${fails > 1 ? 's' : ''}`);
  if (warns > 0) parts.push(`${String(warns)} warning${warns > 1 ? 's' : ''}`);
  return `Result: ${parts.join(', ')}`;
}

/**
 * Formats a list of IValidationResult objects into a human-readable report string.
 * @param results - Array of validation results to format.
 * @returns Multi-line report string with pass/fail/warn lines and a summary.
 */
export function formatReport(results: IValidationResult[]): string {
  const sep = '='.repeat(40);
  const lines = ['Config Validation Report', sep];
  for (const r of results) {
    const statusLabel = r.status === 'fail' ? 'FAIL' : 'WARN';
    const label = r.status === 'pass' ? 'PASS' : statusLabel;
    lines.push(`[${label}] ${r.message}`);
  }
  const countsSummary = summarizeCounts(results);
  lines.push(sep, countsSummary);
  return lines.join('\n');
}
