/**
 * Currency conversion utilities
 */

/**
 * Convert currency units to cents using integer arithmetic for accuracy.
 * @param amount - The monetary amount in currency units (e.g. 12.34).
 * @returns The amount in cents as an integer (e.g. 1234).
 */
// eslint-disable-next-line no-restricted-syntax -- pure arithmetic, no logging needed
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert cents back to currency units.
 * @param cents - The amount in cents (e.g. 1234).
 * @returns The amount in currency units (e.g. 12.34).
 */
// eslint-disable-next-line no-restricted-syntax -- pure arithmetic, no logging needed
export function fromCents(cents: number): number {
  return cents / 100;
}
