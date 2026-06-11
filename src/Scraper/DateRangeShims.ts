/**
 * DateRangeShims — back-compat helpers extracted from BankScraper.
 *
 * Hosts `computeStartDate` and `filterTransactionsByDate`, which were
 * temporary shims inside BankScraper.ts during the Phase-2 split. They are
 * still consumed at call sites (AccountImporter, DefaultScrapeResultMapper)
 * and by legacy tests, so the implementations live in this dedicated
 * module to shrink BankScraper.ts's cluster-sprawl score. BankScraper.ts
 * re-exports both names for byte-identical public surface; Phase-3 will
 * delete the re-exports and migrate callers to `IDateRangePolicy` and
 * `ICanonicalScrapeResult`.
 *
 * Internal coupling: `filterTransactionsByDate` calls `computeStartDate`,
 * so they MUST move together. This is the sole inter-shim dependency.
 */

import type { IBankConfig } from '../Types/Index.js';
import { filterByDateCutoff, formatDate } from '../Utils/Index.js';

/**
 * Computes the transaction start date based on daysBack or startDate config.
 *
 * Back-compat shim; phase-3 migrates callers to IDateRangePolicy.
 *
 * @param bankConfig - Bank config whose date settings to use.
 * @returns Computed start Date for scraping.
 */
export function computeStartDate(bankConfig: IBankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}

/**
 * Filters transactions to those on or after the bank's configured start date.
 *
 * Back-compat shim consumed by AccountImporter; phase-3 migrates it.
 *
 * @param txns - Transactions to filter; not mutated.
 * @param bankConfig - Bank config providing the cutoff date.
 * @returns Filtered array, or original if no date filter is configured.
 */
export function filterTransactionsByDate<T extends { date: Date | string }>(
  txns: T[], bankConfig: IBankConfig,
): T[] {
  if (!bankConfig.daysBack && !bankConfig.startDate) return txns;
  const startDate = computeStartDate(bankConfig);
  const cutoff = formatDate(startDate);
  return filterByDateCutoff(txns, cutoff);
}
