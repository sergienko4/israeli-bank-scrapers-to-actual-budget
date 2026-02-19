/**
 * Currency conversion utilities
 */

/** Convert currency units to cents (integer arithmetic for accuracy) */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert cents back to currency units */
export function fromCents(cents: number): number {
  return cents / 100;
}
