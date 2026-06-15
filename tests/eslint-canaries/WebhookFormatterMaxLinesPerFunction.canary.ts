// expect: src/Services/Notifications/Webhook/**/*.ts
// expect: tests/eslint-canaries/WebhookFormatterMaxLinesPerFunction.canary.ts

/**
 * Canary fixture that must trigger `max-lines-per-function: 10` for the
 * Webhook/ formatter cluster. If this file stops failing, Section 7u no
 * longer protects the split WebhookNotifier seam.
 * @internal
 */

/**
 * Synthetic webhook formatter whose body exceeds 10 effective LoC.
 * @returns Synthetic checksum, never used at runtime.
 */
export function oversizedWebhookFormatterSample(): number {
  const bankCount = 3;
  const accountCount = 4;
  const transactionCount = bankCount * accountCount;
  const successSum = 2000;
  const failSum = 55;
  const dupSum = 175;
  const durationDays = 14;
  const checksum = transactionCount + successSum + failSum + dupSum + durationDays;
  const payload = 'webhook-fmt=' + String(checksum);
  if (payload.length === 0) return 0;
  return checksum;
}
