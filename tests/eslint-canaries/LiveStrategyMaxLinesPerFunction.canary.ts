// expect: src/Scraper/Strategies/Live/**/*.ts
// expect: tests/eslint-canaries/LiveStrategyMaxLinesPerFunction.canary.ts

/**
 * Canary fixture — must trigger `max-lines-per-function: 10` on every
 * lint run so the PR 19 ESLint Section 7o guard for the Live/ strategy
 * cluster cannot silently regress.
 *
 * Pattern mirrors `MappersMaxLinesPerFunction.canary.ts` (PR 16): a
 * single function body exceeds the 10-LoC cap so ESLint emits exactly
 * one `max-lines-per-function` error against the canary file every time
 * the harness at `config/check-eslint-canaries.mjs` runs it. If the rule
 * is relaxed or the file is silently dropped from the canary list, the
 * harness fails CI.
 *
 * NOTE: blank lines + comments are not counted (skipBlankLines +
 * skipComments are both true in Section 7o). The body below is 12
 * effective LoC. This file MUST fail max-lines-per-function:10 to prove
 * the rule fires.
 * @internal
 */

/**
 * Synthetic live-strategy helper whose body exceeds 10 effective LoC.
 * Returns a count derived from a placeholder attempt envelope so the
 * value can be inspected if the harness ever logs the canary output.
 * @returns Synthetic accumulated count (never used at runtime).
 */
export function oversizedLiveStrategySample(): number {
  const bankId = 'discount';
  const strategy = 'live';
  const attemptCount = 1;
  const timeoutMs = 600000;
  const hasOtpRetriever = true;
  const shouldClearSession = false;
  const retryKind = 'standard';
  const envelope = { bankId, strategy, attemptCount };
  const flags = { hasOtpRetriever, shouldClearSession, retryKind };
  const checksum = timeoutMs + envelope.attemptCount;
  const summary = `${flags.retryKind}:${checksum}`;
  if (summary.length === 0) return 0;
  return checksum;
}