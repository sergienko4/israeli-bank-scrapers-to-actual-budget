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
 * Formats a single validation result into its `[LABEL] message` report line.
 * @param r - The IValidationResult to render.
 * @returns A line like `[PASS] Bank "x" — known institution`.
 */
function formatResultLine(r: IValidationResult): string {
  const statusLabel = r.status === 'fail' ? 'FAIL' : 'WARN';
  const label = r.status === 'pass' ? 'PASS' : statusLabel;
  return `[${label}] ${r.message}`;
}

/**
 * Formats a list of IValidationResult objects into a human-readable report string.
 * @param results - Array of validation results to format.
 * @returns Multi-line report string with pass/fail/warn lines and a summary.
 */
export function formatReport(results: IValidationResult[]): string {
  const sep = '='.repeat(40);
  const bodyLines = results.map(formatResultLine);
  const summary = summarizeCounts(results);
  const lines = ['Config Validation Report', sep, ...bodyLines, sep, summary];
  return lines.join('\n');
}
