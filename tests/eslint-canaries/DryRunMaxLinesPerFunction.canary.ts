// expect: src/Services/DryRun/**/*.ts
// expect: tests/eslint-canaries/DryRunMaxLinesPerFunction.canary.ts

/**
 * Canary fixture that must trigger `max-lines-per-function: 10` for the
 * DryRun/ helper cluster. If this file stops failing, Section 7q no
 * longer protects the split DryRunCollector seam.
 * @internal
 */

/**
 * Synthetic dry-run formatter whose body exceeds 10 effective LoC.
 * @returns Synthetic checksum, never used at runtime.
 */
export function oversizedDryRunPreviewSample(): number {
  const accountCount = 3;
  const sampleCount = 3;
  const transactionCount = accountCount * sampleCount;
  const balanceChecksum = 1000;
  const debitChecksum = 45;
  const creditChecksum = 150;
  const rangeDays = 7;
  const checksum = transactionCount + balanceChecksum + debitChecksum + creditChecksum + rangeDays;
  const summary = 'dry-run=' + String(checksum);
  if (summary.length === 0) return 0;
  return checksum;
}