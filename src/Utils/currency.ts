/**
 * Currency conversion utilities
 */

/** Convert currency units to cents (integer arithmetic for accuracy) */
// eslint-disable-next-line no-restricted-syntax -- pure arithmetic, no logging needed
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert cents back to currency units */
// eslint-disable-next-line no-restricted-syntax -- pure arithmetic, no logging needed
export function fromCents(cents: number): number {
  return cents / 100;
}
