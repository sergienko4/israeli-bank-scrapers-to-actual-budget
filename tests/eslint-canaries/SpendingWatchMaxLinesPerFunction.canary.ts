// expect: src/Services/SpendingWatch/**/*.ts
// expect: tests/eslint-canaries/SpendingWatchMaxLinesPerFunction.canary.ts

/**
 * Canary fixture — must trigger `max-lines-per-function: 10` on every
 * lint run so the Section 7p guard for the SpendingWatch/ service cluster
 * cannot silently regress.
 *
 * Pattern mirrors `MetricsMaxLinesPerFunction.canary.ts` (PR 18): a single
 * function body exceeds the 10-LoC cap so ESLint emits one
 * `max-lines-per-function` error against this file. If the rule is relaxed
 * or the file is dropped from the canary list, the harness fails CI.
 *
 * NOTE: blank lines + comments are not counted (skipBlankLines + skipComments
 * are both true in Section 7p). The body below is 11 effective LoC.
 */

/**
 * Synthetic spending-watch reducer whose body exceeds 10 effective LoC.
 * Returns a deterministic checksum so harness output remains inspectable
 * if ESLint ever logs this canary.
 * @returns Synthetic accumulated count (never used at runtime).
 */
export function oversizedSpendingWatchSample(): number {
  const rules = ['all-payees', 'netflix', 'groceries'];
  const activeRules = rules.slice(0, 2);
  const inactiveRules = rules.slice(2);
  const transactions = [100, 200, 300];
  const totalAmount = transactions.reduce((sum, amount) => sum + amount, 0);
  const payees = activeRules.join(',');
  const checksum = totalAmount + activeRules.length + inactiveRules.length;
  const header = `rules=${payees}`;
  const summary = `${header} checksum=${String(checksum)}`;
  if (summary.length === 0) return 0;
  return checksum;
}
