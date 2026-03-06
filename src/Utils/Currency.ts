/**
 * Currency conversion utilities
 */
import { logger } from './UtilLogger.js';

/**
 * Convert currency units to cents using integer arithmetic for accuracy.
 * @param amount - The monetary amount in currency units (e.g. 12.34).
 * @returns The amount in cents as an integer (e.g. 1234).
 */
export function toCents(amount: number): number {
  logger.debug('toCents');
  return Math.round(amount * 100);
}

/**
 * Convert cents back to currency units.
 * @param cents - The amount in cents (e.g. 1234).
 * @returns The amount in currency units (e.g. 12.34).
 */
export function fromCents(cents: number): number {
  logger.debug('fromCents');
  return cents / 100;
}
