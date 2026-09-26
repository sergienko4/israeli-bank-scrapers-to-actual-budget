/**
 * Live strategy provider setup and session cleanup helpers.
 * @internal
 */

import { existsSync, rmSync } from 'node:fs';

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { createScraper } from '@sergienko4/israeli-bank-scrapers';

import { errorMessage } from '../../../Utils/Index.js';
import { buildChromeArgs, getChromeDataDir } from '../../ScraperOptionsBuilder.js';
import type { IAuthFlowCaptureParams } from '../../Tokens/AuthFlowCapture.js';
import {
  attachAuthFlowCapture, buildTokenStoreKey, isApiDirectBank,
} from '../../Tokens/AuthFlowCapture.js';
import { NO_LOGIN } from '../../Tokens/BankTokenRecords.js';
import loginFingerprint from '../../Tokens/LoginFingerprint.js';
import credentialsFor from './AttemptLogin.js';
import { BrowserRegistry } from './BrowserRegistry.js';
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
 *
 * Both lifecycle callbacks are attached here: the browser capture for every
 * bank, and the token capture for the API-direct banks, whose logins mint a
 * durable token. The retriever is attached for exactly the banks the token
 * capture skips, since the API-direct ones read it from the credentials.
 * The capture and the token resolver share one parameter bundle, so the
 * token an attempt sends is read under the key and login it is stored under.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Configured provider scraper and credentials, the watch on the
 *   token they carry, and whether its login callback stores a durable token.
 */
export function initScrape(deps: LiveDeps, scrapeOpts: LiveOpts): IInitializedLiveScrape {
  const retriever = resolveOtpRetriever(deps, scrapeOpts);
  const options = buildScraperOptions(deps, scrapeOpts, retriever);
  const captureParams = buildTokenCaptureParams(deps, scrapeOpts);
  const hasTokenCapture = attachAuthFlowCapture(options, captureParams);
  const browsers = captureBrowsers(options);
  const scraper = prepareScraper(scrapeOpts, options);
  const login = credentialsFor(captureParams, scrapeOpts.bankConfig, retriever);
  return { scraper, ...login, browsers, hasTokenCapture };
}

/**
 * Starts a browser registry and attaches the hook that fills it.
 * @param options - Provider options that receive the lifecycle hook.
 * @returns The registry the provider's browsers are recorded in.
 */
function captureBrowsers(options: ScraperOptions): BrowserRegistry {
  const browsers = new BrowserRegistry();
  attachBrowserCapture(options, browsers);
  return browsers;
}

/**
 * Provider options branch that launches and owns its browser.
 * `ScraperOptions` is a union; the external-browser branches omit the
 * lifecycle hook, so the launching branch is selected explicitly.
 */
type ILaunchingScraperOptions = Extract<ScraperOptions, { prepareBrowser?: unknown }>;

/** Provider lifecycle callback invoked immediately after a browser launches. */
type PrepareBrowserHook = NonNullable<ILaunchingScraperOptions['prepareBrowser']>;

/**
 * Provider options subset that accepts the browser lifecycle hook.
 * `companyId` is included so the type is not weak and the union assigns.
 */
export interface IBrowserHookTarget {
  companyId: ScraperOptions['companyId'];
  prepareBrowser?: PrepareBrowserHook;
}

/**
 * Builds the lifecycle hook that records each browser the provider launches.
 * @param browsers - Registry tracking browsers launched for this attempt.
 * @returns Hook the provider invokes immediately after a browser launches.
 */
function buildCaptureHook(browsers: BrowserRegistry): PrepareBrowserHook {
  return (browser: Parameters<PrepareBrowserHook>[0]): ReturnType<PrepareBrowserHook> => {
    browsers.register(browser);
    return Promise.resolve();
  };
}

/**
 * Registers every launched browser so a timed-out scrape can be reclaimed.
 * The provider abandons rather than cancels a scrape that exceeds its deadline,
 * so without this hook each retry strands a live Camoufox process.
 * @param target - Provider options object that receives the lifecycle hook.
 * @param browsers - Registry tracking browsers launched for this attempt.
 * @returns True once the capture hook is attached.
 */
export function attachBrowserCapture(
  target: IBrowserHookTarget, browsers: BrowserRegistry,
): boolean {
  target.prepareBrowser = buildCaptureHook(browsers);
  return true;
}

/**
 * Assembles provider options including start date and OTP retriever.
 * The OTP retriever is conditionally attached based on bank type to avoid
 * double prompts for banks that read from credentials (oneZero, pepper, payBox).
 * @param deps - Strategy dependencies used to resolve Chrome args.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param otpRetriever - Optional OTP retriever attached for 2FA banks.
 * @returns Provider options passed to createScraper().
 */
export function buildScraperOptions(
  deps: LiveDeps, scrapeOpts: LiveOpts, otpRetriever: OtpRetriever,
): ScraperOptions {
  const options = buildBaseScraperOptions(deps, scrapeOpts);
  attachOtpRetriever(options, otpRetriever, scrapeOpts.companyType);
  return options;
}

/**
 * Fingerprints the login an attempt logs in with.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns The fingerprint, or {@link NO_LOGIN} when the entry has no identity,
 *          which the store refuses to bind a token to.
 */
function attemptLogin(scrapeOpts: LiveOpts): string {
  const fingerprint = loginFingerprint(scrapeOpts.companyType, scrapeOpts.bankConfig);
  return fingerprint.success ? fingerprint.data : NO_LOGIN;
}

/**
 * Bundles the account key, login, token store and logger one capture needs.
 *
 * Shared by the login callback, the attempt runner's result backstop and the
 * leftover sweep, so the callback and the backstop derive the same key and
 * login, and all three apply the same bank filter.
 * @param deps - Strategy dependencies exposing the token store.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Parameter bundle accepted by the capture helpers.
 */
export function buildTokenCaptureParams(
  deps: LiveDeps, scrapeOpts: LiveOpts,
): IAuthFlowCaptureParams {
  const storeKey = buildTokenStoreKey(scrapeOpts.bankId, scrapeOpts.accountKey);
  return {
    storeKey, companyType: scrapeOpts.companyType, login: attemptLogin(scrapeOpts),
    store: deps.bankTokens, logger: scrapeOpts.logger,
  };
}

/**
 * Builds base provider options before optional OTP wiring.
 *
 * Deliberately carries neither `navigationRetryCount` nor
 * `storeFailureScreenShotPath`. Provider 8.7.0 deprecated both, and only the
 * legacy non-Pipeline scrapers ever read them; upstream's guidance is to drop
 * them rather than keep feeding options the Pipeline ignores. Scrape-level
 * retries are owned by this importer's own RetryStrategy.
 * @param deps - Strategy dependencies used to resolve proxy settings.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Provider options without OTP-specific callbacks.
 */
export function buildBaseScraperOptions(deps: LiveDeps, scrapeOpts: LiveOpts): ScraperOptions {
  const { bankConfig } = scrapeOpts;
  return {
    companyId: scrapeOpts.companyType, startDate: scrapeOpts.startDate,
    args: buildChromeArgs(deps.config.proxy), defaultTimeout: bankConfig.timeout ?? 60_000,
  };
}

/**
 * Attaches the OTP adapter expected by the provider package.
 * Only attaches for banks that use OtpHandler (beinleumi). Banks that read
 * otpCodeRetriever from credentials (OneZero, Pepper, PayBox) already have
 * it attached by buildCredentials and should NOT get it in ScraperOptions
 * to avoid double OTP prompts. Those are exactly the API-direct banks, so the
 * set is shared with the token capture rather than restated.
 * @param target - Provider options object that receives the adapter.
 * @param otpRetriever - Optional OTP retriever attached for 2FA banks.
 * @param companyId - CompanyType enum value to determine if bank uses OtpHandler.
 * @returns True when the OTP adapter was attached.
 */
export function attachOtpRetriever(
  target: ScraperOptions, otpRetriever: OtpRetriever, companyId: string,
): boolean {
  if (!otpRetriever || isApiDirectBank(companyId)) return false;
  target.otpCodeRetriever = otpRetriever;
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