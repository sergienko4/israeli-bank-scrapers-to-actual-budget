/**
 * Single owner of daysBack / startDate math previously duplicated
 * across BankScraper.computeStartDate, filterTransactionsByDate, and
 * logDateRange. Pure functions only; no logger calls or side effects.
 */

import type { IBankConfig } from '../../Types/Index.js';
import { filterByDateCutoff, formatDate } from '../../Utils/Index.js';

/** Surface exposed to BankScraper for date math. */
export interface IDateRangePolicy {
  computeStartDate(bankConfig: IBankConfig): Date;
  filterByDate<T extends { date: Date | string }>(
    txns: readonly T[], bankConfig: IBankConfig,
  ): readonly T[];
  formatDateRange(bankConfig: IBankConfig): string;
}

/**
 * Computes the cutoff start date for a bank scrape.
 * @param bankConfig - Bank config whose daysBack/startDate is read.
 * @returns Date representing the earliest transaction included.
 */
function computeStartDate(bankConfig: IBankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}

/**
 * Filters transactions to those on or after the computed start date.
 * @param txns - Transactions to filter; not mutated.
 * @param bankConfig - Bank config providing the cutoff date.
 * @returns Filtered subset (pass-through when no date filter is set).
 */
function filterByDate<T extends { date: Date | string }>(
  txns: readonly T[], bankConfig: IBankConfig,
): readonly T[] {
  if (!bankConfig.daysBack && !bankConfig.startDate) return txns;
  const startDate = computeStartDate(bankConfig);
  const cutoff = formatDate(startDate);
  return filterByDateCutoff([...txns], cutoff);
}

/**
 * Builds a human-readable date-range description for logging.
 * @param bankConfig - Bank config whose date settings are described.
 * @returns Phrase such as "last 7 days (from 2026-05-18)".
 */
function formatDateRange(bankConfig: IBankConfig): string {
  if (bankConfig.daysBack) {
    const startDate = computeStartDate(bankConfig);
    const startStr = formatDate(startDate);
    return `last ${String(bankConfig.daysBack)} days (from ${startStr})`;
  }
  if (bankConfig.startDate) return `from ${bankConfig.startDate} to today`;
  return 'bank default (usually ~1 year)';
}

/**
 * Constructs the default IDateRangePolicy used by BankScraper.
 * @returns Singleton-safe IDateRangePolicy with no external state.
 */
export function createDateRangePolicy(): IDateRangePolicy {
  return { computeStartDate, filterByDate, formatDateRange };
}
