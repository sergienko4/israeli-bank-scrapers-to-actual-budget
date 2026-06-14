// expect: src/Services/Receipt/Ocr/**/*.ts
// expect: tests/eslint-canaries/OcrParsingMaxLinesPerFunction.canary.ts

/**
 * Canary fixture that must trigger `max-lines-per-function: 10` for the
 * Receipt Ocr/ sub-cluster (Section 7s). If this file stops failing, Section
 * 7s no longer protects the split OcrParsing seam.
 *
 * The function below has 12 effective body lines (11 const + 1 return,
 * counted with skipBlankLines + skipComments), so the rule MUST report
 * >= 1 error when this file is linted.
 *
 * Any new file landing under src/Services/Receipt/Ocr/ MUST keep every
 * function at <= 10 effective LoC. Split into SRP helpers per
 * CLAUDE.md / coding-principle-guidlines.md.
 * @internal
 */

/**
 * Synthetic OCR parser whose body exceeds 10 effective LoC.
 * @returns Synthetic checksum, never used at runtime.
 */
export function oversizedOcrParsingSample(): number {
  const accountCount = 3;
  const sampleCount = 3;
  const transactionCount = accountCount * sampleCount;
  const balanceChecksum = 1000;
  const debitChecksum = 45;
  const creditChecksum = 150;
  const rangeDays = 7;
  const checksum = transactionCount + balanceChecksum + debitChecksum + creditChecksum + rangeDays;
  const summary = 'ocr-parsing=' + String(checksum);
  if (summary.length === 0) return 0;
  return checksum;
}
