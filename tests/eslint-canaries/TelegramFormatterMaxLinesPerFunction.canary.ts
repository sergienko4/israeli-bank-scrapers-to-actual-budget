// expect: src/Services/Notifications/Telegram/**/*.ts
// expect: tests/eslint-canaries/TelegramFormatterMaxLinesPerFunction.canary.ts

/**
 * Canary fixture that must trigger `max-lines-per-function: 10` for the
 * Telegram/ formatter cluster. If this file stops failing, Section 7r no
 * longer protects the split TelegramFormatter seam.
 * @internal
 */

/**
 * Synthetic Telegram formatter whose body exceeds 10 effective LoC.
 * @returns Synthetic checksum, never used at runtime.
 */
export function oversizedTelegramFormatterSample(): number {
  const bankCount = 3;
  const accountCount = 4;
  const transactionCount = bankCount * accountCount;
  const balanceChecksum = 2000;
  const debitChecksum = 55;
  const creditChecksum = 175;
  const rangeDays = 14;
  const checksum = transactionCount + balanceChecksum + debitChecksum + creditChecksum + rangeDays;
  const summary = 'telegram-fmt=' + String(checksum);
  if (summary.length === 0) return 0;
  return checksum;
}
