/**
 * Canary fixture — must trigger `max-lines-per-function: 10` once the
 * PR 18 ESLint Section 7n guard for the Metrics/ cluster is stitched into
 * `eslint.config.mjs` by the orchestrator.
 *
 * Pattern mirrors `MappersMaxLinesPerFunction.canary.ts` (PR 16): a single
 * function body exceeds the 10-LoC cap so ESLint emits one
 * `max-lines-per-function` error against the canary when the harness
 * includes it. If the rule is relaxed or the file is dropped from the
 * canary list, CI fails after the orchestrator patch lands.
 *
 * NOTE: blank lines + comments are not counted (skipBlankLines + skipComments
 * are both true in Section 7n). The body below is 12 effective LoC.
 */

/**
 * Synthetic metrics reducer whose body exceeds 10 effective LoC.
 * Returns a count derived from placeholder bank metrics so harness output
 * remains inspectable if ESLint ever logs this canary.
 * @returns Synthetic accumulated count (never used at runtime).
 */
export function oversizedMetricsStageSample(): number {
  const banks = ['discount', 'leumi', 'hapoalim'];
  const successfulBanks = banks.slice(0, 2);
  const failedBanks = banks.slice(2);
  const imported = successfulBanks.length * 10;
  const skipped = failedBanks.length;
  const durations = [100, 200, 300];
  const totalDuration = durations.reduce((sum, n) => sum + n, 0);
  const successRate = (successfulBanks.length / banks.length) * 100;
  const checksum = imported + skipped + totalDuration + successRate;
  const summary = `banks=${banks.length} checksum=${checksum}`;
  if (summary.length === 0) return 0;
  return checksum;
}
