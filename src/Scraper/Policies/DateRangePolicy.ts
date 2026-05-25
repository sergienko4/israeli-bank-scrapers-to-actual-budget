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
 * Checks whether bankConfig.daysBack is a usable positive integer.
 * @param value - Raw daysBack from config; may be undefined or invalid.
 * @returns True only for finite positive integers.
 */
function isValidDaysBack(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0;
}

/**
 * Checks whether bankConfig.startDate parses to a valid Date.
 * @param value - Raw startDate from config; may be empty or invalid.
 * @returns True only when value parses to a finite Date.
 */
function hasParseableStartDate(value?: string): boolean {
  if (!value) return false;
  const candidate = new Date(value);
  const timestamp = candidate.getTime();
  return !Number.isNaN(timestamp);
}

/**
 * Computes the cutoff start date for a bank scrape.
 * @param bankConfig - Bank config whose daysBack/startDate is read.
 * @returns Date representing the earliest transaction included.
 */
function computeStartDate(bankConfig: IBankConfig): Date {
  if (isValidDaysBack(bankConfig.daysBack)) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  if (bankConfig.startDate) {
    const parsed = new Date(bankConfig.startDate);
    const timestamp = parsed.getTime();
    if (!Number.isNaN(timestamp)) return parsed;
  }
  return new Date();
}

/**
 * Reports whether the config requested any date filtering at all.
 * @param bankConfig - Bank config inspected for date constraints.
 * @returns True when daysBack is valid or startDate parses.
 */
function hasDateFilter(bankConfig: IBankConfig): boolean {
  if (isValidDaysBack(bankConfig.daysBack)) return true;
  return hasParseableStartDate(bankConfig.startDate);
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
  if (!hasDateFilter(bankConfig)) return txns;
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
  if (isValidDaysBack(bankConfig.daysBack)) {
    const startDate = computeStartDate(bankConfig);
    const startStr = formatDate(startDate);
    return `last ${String(bankConfig.daysBack)} days (from ${startStr})`;
  }
  if (hasParseableStartDate(bankConfig.startDate)) {
    return `from ${String(bankConfig.startDate)} to today`;
  }
  return 'bank default (usually ~1 year)';
}

/**
 * Constructs the default IDateRangePolicy used by BankScraper.
 * @returns Singleton-safe IDateRangePolicy with no external state.
 */
export function createDateRangePolicy(): IDateRangePolicy {
  return { computeStartDate, filterByDate, formatDateRange };
}
