/**
 * Live strategy provider setup and session cleanup helpers.
 * @internal
 */

import { existsSync, rmSync } from 'node:fs';

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { createScraper } from '@sergienko4/israeli-bank-scrapers';

import { errorMessage } from '../../../Utils/Index.js';
import buildCredentials from '../../CredentialsBuilder.js';
import { buildChromeArgs, getChromeDataDir } from '../../ScraperOptionsBuilder.js';
import { resolveOtpRetriever } from './OtpRetriever.js';
import type {
  IInitializedLiveScrape,
  ILiveProviderScraper,
  ILiveScrapeDependencies,
  IOptionalOtpRetriever,
  IResolvedLiveOpts,
} from './Types.js';

type LiveDeps = ILiveScrapeDependencies;
type LiveOpts = IResolvedLiveOpts;
type OtpRetriever = IOptionalOtpRetriever;
type ProviderScraper = ILiveProviderScraper;

/**
 * Builds the provider scraper and credentials for one live attempt.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Configured provider scraper and credentials.
 */
export function initScrape(deps: LiveDeps, scrapeOpts: LiveOpts): IInitializedLiveScrape {
  const retriever = resolveOtpRetriever(deps, scrapeOpts);
  const options = buildScraperOptions(deps, scrapeOpts, retriever);
  const scraper = prepareScraper(scrapeOpts, options);
  const credentials = buildCredentials(scrapeOpts.bankConfig, retriever);
  return { scraper, credentials };
}

/**
 * Assembles provider options including start date and OTP retriever.
 * @param deps - Strategy dependencies used to resolve Chrome args.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param otpRetriever - Optional OTP retriever attached for 2FA banks.
 * @returns Provider options passed to createScraper().
 */
export function buildScraperOptions(
  deps: LiveDeps, scrapeOpts: LiveOpts, otpRetriever: OtpRetriever,
): ScraperOptions {
  const options = buildBaseScraperOptions(deps, scrapeOpts);
  attachOtpRetriever(options, otpRetriever);
  return options;
}

/**
 * Builds base provider options before optional OTP wiring.
 * @param deps - Strategy dependencies used to resolve proxy settings.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Provider options without OTP-specific callbacks.
 */
export function buildBaseScraperOptions(deps: LiveDeps, scrapeOpts: LiveOpts): ScraperOptions {
  const options: ScraperOptions = {
    companyId: scrapeOpts.companyType, startDate: scrapeOpts.startDate,
    args: buildChromeArgs(deps.config.proxy),
    defaultTimeout: scrapeOpts.bankConfig.timeout ?? 60_000,
  };
  const navRetry = scrapeOpts.bankConfig.navigationRetryCount;
  if (navRetry !== undefined) options.navigationRetryCount = navRetry;
  return options;
}

/**
 * Attaches the OTP adapter expected by the provider package.
 * @param target - Provider options object that receives the adapter.
 * @param otpRetriever - Optional OTP retriever attached for 2FA banks.
 * @returns True when the OTP adapter was attached.
 */
export function attachOtpRetriever(target: ScraperOptions, otpRetriever: OtpRetriever): boolean {
  if (!otpRetriever) return false;
  /**
   * Delegates provider OTP lookup to the configured retriever.
   * @returns OTP code provided by the injected retriever.
   */
  target.otpCodeRetriever = (): Promise<string> => otpRetriever();
  return true;
}

/**
 * Clears stale browser state when requested before creating the scraper.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param options - Provider options assembled for createScraper().
 * @returns Provider scraper instance ready for scraping.
 */
export function prepareScraper(scrapeOpts: LiveOpts, options: ScraperOptions): ProviderScraper {
  if (scrapeOpts.bankConfig.clearSession) {
    clearBankSession(scrapeOpts.bankId, scrapeOpts.logger);
  }
  scrapeOpts.logger.info(`  🔧 Creating scraper for ${scrapeOpts.bankId}...`);
  return createScraper(options);
}

/**
 * Removes a bank-specific Chrome profile directory when it exists.
 * @param bankId - Bank identifier whose profile directory is cleared.
 * @param logger - Logger used to report cleanup and warning events.
 * @returns True when an existing profile directory was removed.
 */
export function clearBankSession(bankId: string, logger: LiveOpts['logger']): boolean {
  const bankDir = getChromeDataDir(bankId);
  if (!existsSync(bankDir)) return false;
  logger.info(`  🧹 Clearing browser session for ${bankId}`);
  return removeBankSession(bankDir, bankId, logger);
}

/**
 * Deletes the profile directory while preserving a warning trail on failure.
 * @param bankDir - Chrome profile directory to remove.
 * @param bankId - Bank identifier included in cleanup warnings.
 * @param logger - Logger used to report failed cleanup.
 * @returns True when removal completed without an exception.
 */
function removeBankSession(bankDir: string, bankId: string, logger: LiveOpts['logger']): boolean {
  try {
    rmSync(bankDir, { recursive: true, force: true });
    return true;
  } catch (error: unknown) {
    const msg = errorMessage(error);
    logger.warn(`  ⚠️  Failed to clear session for ${bankId}: ${msg}`);
    return false;
  }
}