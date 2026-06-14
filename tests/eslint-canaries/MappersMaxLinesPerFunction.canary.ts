/**
 * Canary fixture — must trigger `max-lines-per-function: 10` on every
 * lint run so the PR 16 ESLint Section 7m guard for the Mappers/ cluster
 * cannot silently regress.
 *
 * Pattern mirrors `ProcessAllBanksBankMaxLinesPerFunction.canary.ts`
 * (PR 15) and `ReceiptMaxLinesPerFunction.canary.ts` (PR 14): a single
 * function body exceeds the 10-LoC cap so ESLint emits exactly one
 * `max-lines-per-function` error against the canary file every time the
 * harness at `config/check-eslint-canaries.mjs` runs it. If the rule is
 * relaxed or the file is silently dropped from the canary list, the
 * harness fails CI.
 *
 * NOTE: blank lines + comments are not counted (skipBlankLines + skipComments
 * are both true in Section 7m). The body below is 12 effective LoC.
 */

/**
 * Synthetic forward-mapper helper whose body exceeds 10 effective LoC.
 * Returns a count derived from a placeholder envelope so the value can
 * be inspected if the harness ever logs the canary output.
 * @returns Synthetic accumulated count (never used at runtime).
 */
export function oversizedMapperStageSample(): number {
  const accounts = [1, 2, 3, 4, 5];
  const window = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const signPolicy = 'flip-credit';
  const strategy = 'live';
  const attemptCount = 1;
  const tally = accounts.reduce((sum, n) => sum + n, 0);
  const meta = { window, signPolicy, strategy, attemptCount };
  const checksum = tally + meta.attemptCount;
  const envelope = { meta, accounts, tally, checksum };
  const summary = `tally=${envelope.tally} sum=${envelope.checksum}`;
  if (summary.length === 0) return 0;
  return checksum;
}
