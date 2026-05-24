/**
 * Scraper-boundary normalizer for credit-card sign conventions.
 *
 * Israeli credit-card scrapers (visaCal, max, isracard, amex) in
 * `@sergienko4/israeli-bank-scrapers` return `chargedAmount` with the
 * source-statement sign convention (purchases positive, refunds negative).
 * The scraper's own `maybeNegateAmount` step is supposed to flip this on
 * its way out but silently fails for these four scrapers in 8.3.0.
 *
 * Actual Budget's convention is the opposite (outflows negative, inflows
 * positive). Multiplying both `chargedAmount` and `originalAmount` by -1
 * for these four banks reconciles the two conventions in both directions.
 *
 * Generic over the transaction shape so the same normalizer fits both
 * the upstream `ITransaction` type and our internal `IBankTransaction`.
 */

/** Bank keys whose transaction amounts are inverted relative to Actual Budget. */
const CREDIT_CARD_BANKS: ReadonlySet<string> = new Set([
  'visacal',
  'max',
  'isracard',
  'amex',
]);

/** Subset of transaction shape that this normalizer touches. */
export interface ISignedTxn {
  /** Amount charged in the account's primary currency. */
  chargedAmount?: number;
  /** Amount in the original currency before conversion. */
  originalAmount?: number;
}

/**
 * Returns a copy of the txn with chargedAmount and originalAmount sign-flipped.
 * Zero and undefined amounts are preserved verbatim.
 * @param txn - The transaction to normalize.
 * @returns A new txn object with flipped amounts; other fields preserved.
 */
function flipTxnSigns<T extends ISignedTxn>(txn: T): T {
  const flipped: T = { ...txn };
  const charged = txn.chargedAmount;
  if (charged !== undefined && charged !== 0) {
    flipped.chargedAmount = -charged;
  }
  const original = txn.originalAmount;
  if (original !== undefined && original !== 0) {
    flipped.originalAmount = -original;
  }
  return flipped;
}

/**
 * Normalizes scraped transaction amounts for credit-card scrapers.
 *
 * Pure function: input arrays/objects are not mutated; output is a new array.
 * For non-credit-card banks the input is returned via a shallow copy with
 * the same transaction object identities preserved.
 * @param bankName - The bank key (case-insensitive) the scrape came from.
 * @param txns - The scraped transactions; not mutated.
 * @returns A new array of transactions; credit-card amounts are flipped.
 */
export default function normalizeCreditCardSigns<T extends ISignedTxn>(
  bankName: string,
  txns: readonly T[],
): T[] {
  const lowered = bankName.toLowerCase();
  if (!CREDIT_CARD_BANKS.has(lowered)) {
    return [...txns];
  }
  return txns.map(flipTxnSigns);
}
