/**
 * Live strategy provider setup helpers.
 * @internal
 */

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { createScraper } from '@sergienko4/israeli-bank-scrapers';

import type { IAuthFlowCaptureParams } from '../../Tokens/AuthFlowCapture.js';
import {
  attachAuthFlowCapture, buildTokenStoreKey, isApiDirectBank,
} from '../../Tokens/AuthFlowCapture.js';
import { NO_LOGIN } from '../../Tokens/BankTokenRecords.js';
import loginFingerprint from '../../Tokens/LoginFingerprint.js';
import { attachDeviceAuth } from '../../Tokens/PepperDeviceState.js';
import type { AttemptLogin } from './AttemptLogin.js';
import credentialsFor from './AttemptLogin.js';
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
 * Lifecycle callbacks are attached here: the token capture for the API-direct
 * banks, whose logins mint a durable token, and Pepper's device login, which
 * keeps the state that replaced its long-term token. The retriever is attached
 * for exactly the banks the token capture skips, since the API-direct ones read
 * it from the credentials.
 * The capture and the token resolver share one parameter bundle, so the
 * token an attempt sends is read under the key and login it is stored under;
 * the resolver also reads the tokens that were not accepted before.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Configured provider scraper and credentials, the watches on the
 *   token and device state they carry, and whether its login callback stores
 *   a durable token.
 */
export function initScrape(deps: LiveDeps, scrapeOpts: LiveOpts): IInitializedLiveScrape {
  const retriever = resolveOtpRetriever(deps, scrapeOpts);
  const options = buildScraperOptions(scrapeOpts, retriever);
  const captureParams = buildTokenCaptureParams(deps, scrapeOpts);
  const hooks = attachLoginHooks(options, captureParams, { scrapeOpts, retriever });
  const scraper = prepareScraper(scrapeOpts, options);
  const login = attemptLoginOf(deps, { scrapeOpts, retriever }, captureParams);
  return { scraper, ...login, ...hooks };
}

/** The attempt a login hook is attached for: its options and its OTP retriever. */
interface ILoginHookSource {
  readonly scrapeOpts: LiveOpts;
  readonly retriever: OtpRetriever;
}

/**
 * Builds the credentials one attempt logs in with, reading its token and the
 * tokens that were not accepted before.
 * @param deps - Strategy dependencies exposing the refused-token list.
 * @param source - The attempt's options and OTP retriever.
 * @param captureParams - Account key, login, store and logger for this attempt.
 * @returns The attempt's credentials and the watch on the token they carry.
 */
function attemptLoginOf(
  deps: LiveDeps, source: ILoginHookSource, captureParams: IAuthFlowCaptureParams,
): AttemptLogin {
  const context = { capture: captureParams, refusals: deps.refusedTokens };
  return credentialsFor(context, source.scrapeOpts.bankConfig, source.retriever);
}

/**
 * Attaches the callbacks that keep an API-direct login across runs: the
 * token capture, and Pepper's device login.
 * @param options - Provider options that receive the callbacks.
 * @param captureParams - Account key, login, store and logger for this attempt.
 * @param source - The attempt's options and OTP retriever.
 * @returns Whether the login callback stores a durable token, and the watch
 *   on the device state the attempt sent.
 */
function attachLoginHooks(
  options: ScraperOptions, captureParams: IAuthFlowCaptureParams, source: ILoginHookSource,
): Pick<IInitializedLiveScrape, 'hasTokenCapture' | 'deviceWatch'> {
  const hasTokenCapture = attachAuthFlowCapture(options, captureParams);
  const { accountKey } = source.scrapeOpts;
  const canAskForOtp = source.retriever !== undefined;
  const deviceWatch = attachDeviceAuth(options, captureParams, { accountKey, canAskForOtp });
  return { hasTokenCapture, deviceWatch };
}

/**
 * Assembles provider options including start date and OTP retriever.
 * The OTP retriever is conditionally attached based on bank type to avoid
 * double prompts for banks that read from credentials (oneZero, pepper, payBox).
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param otpRetriever - Optional OTP retriever attached for 2FA banks.
 * @returns Provider options passed to createScraper().
 */
export function buildScraperOptions(
  scrapeOpts: LiveOpts, otpRetriever: OtpRetriever,
): ScraperOptions {
  const options = buildBaseScraperOptions(scrapeOpts);
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
 * Deliberately carries only `companyId` and `startDate`. Provider 8.7.0
 * deprecated `navigationRetryCount` and `storeFailureScreenShotPath`, and
 * provider 10.0.0 removed browser-era options (`args`, `defaultTimeout`,
 * `prepareBrowser`) now that all scrapers run over direct HTTP.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Provider options without OTP-specific callbacks.
 */
export function buildBaseScraperOptions(scrapeOpts: LiveOpts): ScraperOptions {
  return {
    companyId: scrapeOpts.companyType, startDate: scrapeOpts.startDate,
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
 * Creates the provider scraper instance for the bank attempt.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param options - Provider options assembled for createScraper().
 * @returns Provider scraper instance ready for scraping.
 */
export function prepareScraper(scrapeOpts: LiveOpts, options: ScraperOptions): ProviderScraper {
  scrapeOpts.logger.info(`  🔧 Creating scraper for ${scrapeOpts.bankId}...`);
  return createScraper(options);
}