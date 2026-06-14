/**
 * Live strategy result envelope helpers.
 * @internal
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { IRawScrape, Procedure } from '../../../Types/Index.js';
import { fail, succeed } from '../../../Types/Index.js';
import type { IBankScrapeStrategyOpts } from '../IBankScrapeStrategy.js';
import type { IResolvedLiveOpts } from './Types.js';

/**
 * Narrows scrape options after the registry has supplied companyType.
 * @param scrapeOpts - Raw options from the bank-scrape coordinator.
 * @returns Procedure success with companyType required, or unknown-bank failure.
 */
export function resolveLiveOpts(
  scrapeOpts: IBankScrapeStrategyOpts,
): Procedure<IResolvedLiveOpts> {
  if (!scrapeOpts.companyType) {
    return fail(`Unknown bank: ${scrapeOpts.bankId}`, { status: 'unknown-bank' });
  }
  return succeed({ ...scrapeOpts, companyType: scrapeOpts.companyType });
}

/**
 * Detects provider failures caused by a rejected OTP code.
 * @param result - Provider result returned by israeli-bank-scrapers.
 * @returns True when the provider reports INVALID_OTP.
 */
export function isInvalidOtpFailure(result: IScraperScrapingResult): boolean {
  const didFail = !result.success;
  const isOtpError = String(result.errorType) === 'INVALID_OTP';
  return didFail && isOtpError;
}

/**
 * Wraps a provider result inside the canonical raw-scrape envelope.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param raw - Provider scrape result to preserve unchanged.
 * @param attemptCount - Number of provider attempts used for this result.
 * @returns Canonical raw-scrape envelope consumed by downstream mappers.
 */
export function wrapLiveScrape(
  scrapeOpts: IResolvedLiveOpts, raw: IScraperScrapingResult, attemptCount: number,
): IRawScrape {
  return {
    bankId: scrapeOpts.bankId, companyType: scrapeOpts.companyType,
    attemptCount, strategy: 'live', raw,
  };
}

/**
 * Returns a successful Procedure carrying the wrapped provider result.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param raw - Provider scrape result to preserve unchanged.
 * @param attemptCount - Number of provider attempts used for this result.
 * @returns Procedure success with the canonical raw-scrape envelope.
 */
export function succeedRawScrape(
  scrapeOpts: IResolvedLiveOpts, raw: IScraperScrapingResult, attemptCount: number,
): Procedure<IRawScrape> {
  const envelope = wrapLiveScrape(scrapeOpts, raw, attemptCount);
  return succeed(envelope);
}