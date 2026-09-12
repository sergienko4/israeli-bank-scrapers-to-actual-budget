/**
 * Reports incomplete provider date-window coverage without retaining account data.
 */

import type {
  IScraperScrapingResult,
  IWindowCoverage,
} from '@sergienko4/israeli-bank-scrapers';

import type { ILogger, LogContext } from '../Logger/ILogger.js';

type CoverageStatus = IWindowCoverage['status'];
type CoverageCounts = Record<CoverageStatus, number>;

/** Aggregate coverage fields safe for structured logging. */
interface IWindowCoverageSummary extends LogContext {
  readonly assessedAccounts: number;
  readonly coveredAccounts: number;
  readonly lowerBoundReachedAccounts: number;
  readonly unprovenAccounts: number;
}

/**
 * Counts each assessed account by its provider-reported coverage state.
 * @param result - Successful provider result before canonical mapping.
 * @returns Aggregate counts without account identifiers or transaction data.
 */
function summarizeCoverage(result: IScraperScrapingResult): IWindowCoverageSummary {
  const counts: CoverageCounts = { covered: 0, lowerBoundReached: 0, unproven: 0 };
  for (const account of result.accounts ?? []) {
    const coverage = account.windowCoverage;
    if (coverage === undefined) continue;
    counts[coverage.status] += 1;
  }
  return {
    assessedAccounts: counts.covered + counts.lowerBoundReached + counts.unproven,
    coveredAccounts: counts.covered,
    lowerBoundReachedAccounts: counts.lowerBoundReached,
    unprovenAccounts: counts.unproven,
  };
}

/**
 * Reports whether at least one assessed account has degraded window coverage.
 * @param summary - Aggregate account coverage counts.
 * @returns True when the requested window is incomplete or cannot be proven.
 */
function hasDegradedCoverage(summary: IWindowCoverageSummary): boolean {
  return summary.lowerBoundReachedAccounts > 0 || summary.unprovenAccounts > 0;
}

/**
 * Emits one PII-safe warning when the provider cannot prove complete coverage.
 * @param bankId - Stable bank identifier for operational filtering.
 * @param result - Successful provider result before account metadata is adapted.
 * @param logger - Structured logger for the current scrape.
 * @returns True when degraded coverage caused a warning.
 */
export default function reportWindowCoverage(
  bankId: string,
  result: IScraperScrapingResult,
  logger: ILogger,
): boolean {
  const summary = summarizeCoverage(result);
  if (!hasDegradedCoverage(summary)) return false;
  logger.warn(
    'Scraper window coverage is incomplete; importing available transactions',
    { eventName: 'scrape_window_coverage_incomplete', bankId, ...summary },
  );
  return true;
}
