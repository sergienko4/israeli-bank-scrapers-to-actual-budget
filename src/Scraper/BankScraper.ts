/**
 * BankScraper — thin coordinator that wires Registry + Strategy + Mapper
 * + DateRangePolicy into one orchestrated scrape per bank.
 *
 * Phase-2 refactor: extracted live/mock dispatch (Strategy), bank lookup
 * (Registry), date math (DateRangePolicy), sign normalization (Mapper),
 * env-var coupling, and direct logger access. This class now contains no
 * provider-specific logic; it delegates and adapts the result back to
 * IScraperScrapingResult for backward compatibility with phase-3
 * consumers (ProcessAllBanksStep, AccountImporter).
 *
 * Note: filterTransactionsByDate / computeStartDate / isEmptyResultError /
 * logScrapeFailure are intentional back-compat re-exports consumed by
 * AccountImporter and existing tests. The actual implementations now live
 * in dedicated sibling modules (`./DateRangeShims.js`,
 * `./EmptyResultDetector.js`) — this file only re-surfaces them to keep
 * the public import path stable. Phase-3 will delete the re-exports and
 * migrate consumers to IDateRangePolicy + ICanonicalScrapeResult.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import { getScraperErrorAdvice } from '../Errors/ScraperErrorMessages.js';
import type { ILogger } from '../Logger/ILogger.js';
import { getLogger } from '../Logger/Index.js';
import type {
  IBankConfig, IProcedureSuccess, IRawScrape, ISignPolicy,
} from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { IBankRegistry } from './BankRegistry.js';
import isEmptyResult from './EmptyResultDetector.js';
import type { IScrapeResultMapper } from './Mappers/IScrapeResultMapper.js';
import type { IDateRangePolicy } from './Policies/DateRangePolicy.js';
import type { IBankScrapeStrategy } from './Strategies/IBankScrapeStrategy.js';

export { computeStartDate, filterTransactionsByDate } from './DateRangeShims.js';
export { createDateRangePolicy } from './Policies/DateRangePolicy.js';

/** Bank-scraper coordinator dependencies. */
export interface IBankScraperOpts {
  readonly registry: IBankRegistry;
  readonly strategy: IBankScrapeStrategy;
  readonly mapper: IScrapeResultMapper;
  readonly datePolicy: IDateRangePolicy;
  readonly logger: ILogger;
}

/** Coordinator: registry → strategy → mapper → legacy adapter. */
export class BankScraper {
  /**
   * Creates a BankScraper coordinator with injected collaborators.
   * @param opts - Registry + strategy + mapper + datePolicy + logger.
   */
  constructor(private readonly opts: IBankScraperOpts) {}

  /**
   * Orchestrates a full scrape for one bank: resolve → scrape → map → adapt.
   * Unknown-bank handling is delegated to the strategy: the mock strategy
   * looks up fixtures by raw bank name (no registry needed), while the live
   * strategy fails with status="unknown-bank" when companyType is missing.
   * @param bankName - User-facing bank alias from config.
   * @param bankConfig - Bank configuration block.
   * @returns Legacy IScraperScrapingResult for backward compatibility.
   */
  public async scrapeBankWithResilience(
    bankName: string, bankConfig: IBankConfig,
  ): Promise<IScraperScrapingResult> {
    const resolved = this.opts.registry.resolve(bankName);
    const entry = resolved.success ? resolved.data : null;
    const startDate = this.opts.datePolicy.computeStartDate(bankConfig);
    this.opts.logger.info(
      `  📅 Date range: ${this.opts.datePolicy.formatDateRange(bankConfig)}`);
    const rawResult = await this.opts.strategy.scrape({
      bankId: entry?.bankId ?? bankName,
      companyType: entry?.companyType,
      bankConfig, startDate, logger: this.opts.logger,
    });
    if (!rawResult.success) return BankScraper.buildFailureResult(rawResult.message);
    const signPolicy: ISignPolicy = entry?.signPolicy ?? 'preserve';
    return this.mapAndAdapt(rawResult.data, signPolicy, startDate);
  }

  /**
   * Maps a successful raw scrape through the canonical layer and back to legacy.
   * @param raw - IRawScrape envelope from the chosen strategy.
   * @param signPolicy - Sign policy resolved from the registry (or 'preserve' default).
   * @param startDate - Effective start date for this scrape window.
   * @returns Legacy IScraperScrapingResult.
   */
  private mapAndAdapt(
    raw: IRawScrape, signPolicy: ISignPolicy, startDate: Date,
  ): IScraperScrapingResult {
    const canonical = this.opts.mapper.mapToCanonical({
      raw, signPolicy, startDate, endDate: new Date(),
    });
    return this.opts.mapper.canonicalToLegacy(canonical, raw.raw);
  }

  /**
   * Builds a legacy failure result from an error message.
   * @param message - Human-readable failure description.
   * @returns IScraperScrapingResult with success=false and the message attached.
   */
  private static buildFailureResult(message: string): IScraperScrapingResult {
    return {
      success: false, errorType: undefined,
      errorMessage: message, accounts: [],
    };
  }
}

/**
 * Checks whether a scraper failure indicates "no transactions" vs. a real error.
 *
 * Back-compat shim — delegates to {@link isEmptyResult} from the dedicated
 * EmptyResultDetector module. New callers should import from
 * `./EmptyResultDetector.js` directly.
 * @param result - The IScraperScrapingResult to inspect.
 * @returns True when the error message matches a known empty-result pattern.
 */
export function isEmptyResultError(result: IScraperScrapingResult): boolean {
  return isEmptyResult(result);
}

/**
 * Logs a scraper failure with a user-friendly hint based on the error type.
 * Back-compat shim — uses module-level getLogger() since callers do not
 * thread an ILogger through; phase-3 will delete and inline at call sites.
 * @param bankName - Name of the bank that failed.
 * @param result - Failed IScraperScrapingResult containing error details.
 * @returns Successful Procedure indicating the failure was logged.
 */
export function logScrapeFailure(
  bankName: string, result: IScraperScrapingResult,
): IProcedureSuccess<{ status: string }> {
  const baseMsg = result.errorMessage ?? 'Unknown error';
  const errorType = result.errorType ?? '';
  const advice = getScraperErrorAdvice(errorType);
  const hint = advice ? `. ${advice}` : '';
  getLogger().error(`  ❌ Failed to scrape ${bankName}: ${baseMsg}${hint}`);
  return succeed({ status: 'logged' });
}
