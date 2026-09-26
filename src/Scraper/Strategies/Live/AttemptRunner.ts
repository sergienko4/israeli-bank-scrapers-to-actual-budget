/**
 * Live strategy attempt orchestration and OTP-retry flow.
 * @internal
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { IRetryStrategy } from '../../../Resilience/RetryStrategy.js';
import type { IBankConfig, IRawScrape, Procedure } from '../../../Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../../../Types/Index.js';
import { captureResultToken, isApiDirectBank, sweepTokenLeftovers } from '../../Tokens/AuthFlowCapture.js';
import type { IWarmTokenWatch } from '../../Tokens/WarmTokenWatch.js';
import { warnIfNotAccepted } from '../../Tokens/WarmTokenWatch.js';
import type { IBankScrapeStrategyOpts } from '../IBankScrapeStrategy.js';
import { RetryableProviderFailure, throwIfRetryable } from './ProviderFailure.js';
import {
  isInvalidOtpFailure,
  resolveLiveOpts,
  succeedRawScrape,
} from './ResultEnvelope.js';
import { buildTokenCaptureParams, initScrape } from './ScraperSetup.js';
import type {
  ILiveScrapeDependencies,
  IResolvedLiveOpts,
  ITimeoutScrapeParams,
} from './Types.js';


/**
 * Runs a live scrape and preserves the public Procedure contract.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Raw scrape options from the bank-scrape coordinator.
 * @returns Procedure success with raw scrape data, or typed failure.
 */
export default async function runLiveScrape(
  deps: ILiveScrapeDependencies,
  scrapeOpts: IBankScrapeStrategyOpts,
): Promise<Procedure<IRawScrape>> {
  const resolved = resolveLiveOpts(scrapeOpts);
  if (!resolved.success) return resolved;
  startScrape(deps, resolved.data);
  return await runWithOtpRetry(deps, resolved.data);
}

/**
 * Announces the scrape and clears staged token files a killed run left behind.
 *
 * Only API-direct banks sweep, and the sweep only ever warns, so it cannot
 * cost the scrape.
 * @param deps - Strategy dependencies exposing the token store.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns True when the token store was swept.
 */
function startScrape(deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts): boolean {
  scrapeOpts.logger.info(`  🔍 Scraping transactions from ${scrapeOpts.bankId}...`);
  const captureParams = buildTokenCaptureParams(deps, scrapeOpts);
  return sweepTokenLeftovers(captureParams);
}

/**
 * Runs the first attempt and handles a rejected OTP code.
 *
 * A browser bank gets one more attempt with a new code; an API-direct bank
 * does not.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Procedure success with one-attempt or retried scrape data.
 */
async function runWithOtpRetry(
  deps: ILiveScrapeDependencies,
  scrapeOpts: IResolvedLiveOpts,
): Promise<Procedure<IRawScrape>> {
  const first = await executeAttempt(deps, scrapeOpts);
  if (!isInvalidOtpFailure(first)) return succeedRawScrape(scrapeOpts, first, 1);
  if (isApiDirectBank(scrapeOpts.companyType)) return await refuseOtpRetry(deps, scrapeOpts, first);
  return await handleOtpReject(deps, scrapeOpts);
}

/**
 * Ends an API-direct bank's run on a rejected code, without asking for another.
 *
 * An API-direct bank sends one SMS code per run. A retry would be a new login,
 * and a new login sends a second SMS.
 * @param deps - Strategy dependencies exposing the notifier.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param rejected - The attempt's INVALID_OTP result.
 * @returns Procedure success wrapping the rejection, with attemptCount 1.
 */
async function refuseOtpRetry(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts, rejected: IScraperScrapingResult,
): Promise<Procedure<IRawScrape>> {
  const { bankId } = scrapeOpts;
  scrapeOpts.logger.warn(`  ⚠️  OTP rejected for ${bankId} — this run asks for no new code`);
  await deps.notificationService.sendMessage(`⚠️ OTP for <b>${bankId}</b> was rejected. `
    + 'This run asks for no new code; the next run can ask for a new one.');
  return succeedRawScrape(scrapeOpts, rejected, 1);
}

/**
 * Wraps the provider result produced after an OTP rejection retry.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Procedure success with attemptCount set to 2.
 */
async function handleOtpReject(
  deps: ILiveScrapeDependencies,
  scrapeOpts: IResolvedLiveOpts,
): Promise<Procedure<IRawScrape>> {
  const retried = await retryAfterOtpReject(deps, scrapeOpts);
  return succeedRawScrape(scrapeOpts, retried, 2);
}

/**
 * Executes a single provider scrape attempt through retry + timeout policies.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Provider scrape result returned by israeli-bank-scrapers.
 */
async function executeAttempt(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts,
): Promise<IScraperScrapingResult> {
  const { hasTokenCapture, tokenWatch, ...prepared } = initScrape(deps, scrapeOpts);
  const retryStrategy = pickRetryStrategy(deps, scrapeOpts.bankConfig, hasTokenCapture);
  const label = `Scraping ${scrapeOpts.bankId}`;
  const params = { deps, ...prepared, logger: scrapeOpts.logger, label };
  const result = await runAttemptThenSeal(retryStrategy, params);
  return settleToken(deps, scrapeOpts, { result, tokenWatch });
}

/** An attempt's provider result, and the watch on the token it sent. */
interface IFinishedAttempt {
  readonly result: IScraperScrapingResult;
  readonly tokenWatch: IWarmTokenWatch;
}

/**
 * Acts on what an attempt's result says about its token.
 *
 * Warns when a sent token did not log in and the run could not ask for a
 * code, then stores any token the result carried.
 * @param deps - Strategy dependencies exposing the token store.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param attempt - The attempt's result and token watch.
 * @returns The attempt's result, unchanged.
 */
function settleToken(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts, attempt: IFinishedAttempt,
): IScraperScrapingResult {
  warnIfNotAccepted(attempt.tokenWatch, attempt.result);
  return keepMintedToken(deps, scrapeOpts, attempt.result);
}

/**
 * Stores the durable token an attempt's result carried.
 *
 * Runs only when the attempt returns a result. A failure the retry policy
 * turns into an error skips it; the login callback has already stored any
 * token minted before that failure. A store failure is a warning, never an
 * error.
 * @param deps - Strategy dependencies exposing the token store.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param result - Provider result of the attempt.
 * @returns The same result, unchanged.
 */
function keepMintedToken(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts, result: IScraperScrapingResult,
): IScraperScrapingResult {
  const captureParams = buildTokenCaptureParams(deps, scrapeOpts);
  captureResultToken(result, captureParams);
  return result;
}

/**
 * Runs the retry loop, then seals the registry because no retry can follow.
 *
 * Every retry reclaims its own browsers, but a scrape abandoned by the timeout
 * keeps running and can launch one after the final reclaim has already
 * happened. Sealing closes what the attempt still holds and closes anything
 * arriving later on the spot, so nothing outlives the attempt.
 * @param retryStrategy - Retry policy applied around the timed scrape.
 * @param params - Timeout wrapper inputs carrying the browser registry.
 * @returns Provider scrape result returned by israeli-bank-scrapers.
 */
async function runAttemptThenSeal(
  retryStrategy: IRetryStrategy, params: ITimeoutScrapeParams,
): Promise<IScraperScrapingResult> {
  try {
    return await runRetries(retryStrategy, params);
  } finally {
    await sealBrowsers(params);
  }
}

/**
 * Runs the retry loop and restores the provider result once it is exhausted.
 *
 * Transient provider failures are thrown so the retry strategy counts them;
 * when the budget runs out the original result is returned here, keeping the
 * envelope contract identical to a failure that never retried.
 * @param retryStrategy - Retry policy applied around the timed scrape.
 * @param params - Timeout wrapper inputs carrying the browser registry.
 * @returns Provider scrape result returned by israeli-bank-scrapers.
 */
async function runRetries(
  retryStrategy: IRetryStrategy, params: ITimeoutScrapeParams,
): Promise<IScraperScrapingResult> {
  const wrapped = buildTimeoutWrappedScrape(params);
  try {
    return await retryStrategy.execute(wrapped, params.label);
  } catch (error: unknown) {
    return restoreProviderResult(error);
  }
}

/**
 * Restores the provider's own result after the retry budget is spent.
 * @param error - Value thrown out of the retry strategy.
 * @returns The provider result carried by an exhausted retry loop.
 * @throws The original error when it did not come from a provider failure.
 */
function restoreProviderResult(error: unknown): IScraperScrapingResult {
  if (error instanceof RetryableProviderFailure) return error.result;
  throw error;
}

/**
 * Selects the single-try policy for any attempt whose tries must not overlap.
 *
 * The timeout abandons a try rather than cancelling it, so a retry runs beside
 * the try it replaced. A 2FA login owns its OTP cadence. A login that mints a
 * durable token revokes the one before it, so a timed-out try's late callback
 * would store a token the bank no longer honours once a retry had logged in.
 * With one try per attempt, and no INVALID_OTP retry for a bank that mints
 * tokens, tokens reach the store in the order they were minted.
 * @param deps - Strategy dependencies exposing retry policies.
 * @param bankConfig - Bank config whose twoFactorAuth flag is inspected.
 * @param hasTokenCapture - Whether the attempt's login callback stores a token.
 * @returns Retry policy used for this live scrape attempt.
 */
function pickRetryStrategy(
  deps: ILiveScrapeDependencies, bankConfig: IBankConfig, hasTokenCapture: boolean,
): IRetryStrategy {
  const isSingleTry = Boolean(bankConfig.twoFactorAuth) || hasTokenCapture;
  return isSingleTry ? deps.noRetryStrategy : deps.retryStrategy;
}

/**
 * Returns the zero-arg callback expected by the retry strategy.
 * @param params - Timeout wrapper inputs for the provider call.
 * @returns Callback that invokes the provider through the timeout wrapper.
 */
function buildTimeoutWrappedScrape(
  params: ITimeoutScrapeParams,
): () => Promise<IScraperScrapingResult> {
  return (): Promise<IScraperScrapingResult> => wrapScrapePromise(params);
}

/**
 * Applies the configured timeout deadline around provider scraping.
 * Every attempt reclaims its own browsers, so a timed-out or failed retry
 * cannot strand a Camoufox process and exhaust container memory.
 * @param params - Timeout wrapper inputs for the provider call.
 * @returns Provider scrape result subject to the configured timeout.
 */
async function wrapScrapePromise(params: ITimeoutScrapeParams): Promise<IScraperScrapingResult> {
  const timeoutMs = DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs;
  try {
    const scraping = params.scraper.scrape(params.credentials);
    const result = await params.deps.timeoutWrapper.wrap(scraping, timeoutMs, params.label);
    return throwIfRetryable(result);
  } finally {
    await reclaimBrowsers(params);
  }
}

/**
 * Closes browsers the provider left running after the attempt settled.
 * @param params - Timeout wrapper inputs carrying the browser registry.
 * @returns Number of still-running browsers reclaimed by this attempt.
 */
async function reclaimBrowsers(params: ITimeoutScrapeParams): Promise<number> {
  const reclaimed = await params.browsers.closeAll(params.logger);
  return reportReclaimed(reclaimed, params);
}

/**
 * Closes browsers still held once the attempt can no longer retry.
 * @param params - Timeout wrapper inputs carrying the browser registry.
 * @returns Number of still-running browsers reclaimed by the seal.
 */
async function sealBrowsers(params: ITimeoutScrapeParams): Promise<number> {
  const reclaimed = await params.browsers.seal(params.logger);
  return reportReclaimed(reclaimed, params);
}

/**
 * Reports how many browsers a reclaim closed, staying silent when none did.
 * @param reclaimed - Number of browsers the reclaim had to close.
 * @param params - Timeout wrapper inputs carrying the logger and label.
 * @returns The reclaimed count, unchanged, for the caller to surface.
 */
function reportReclaimed(reclaimed: number, params: ITimeoutScrapeParams): number {
  if (reclaimed > 0) {
    const count = String(reclaimed);
    params.logger.info(`  🧹 Reclaimed ${count} abandoned browser(s) after ${params.label}`);
  }
  return reclaimed;
}

/**
 * Notifies the user that OTP was rejected before running one more attempt.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Provider scrape result from the retry attempt.
 */
async function retryAfterOtpReject(
  deps: ILiveScrapeDependencies,
  scrapeOpts: IResolvedLiveOpts,
): Promise<IScraperScrapingResult> {
  scrapeOpts.logger.warn(`  ⚠️  OTP rejected — requesting a new code for ${scrapeOpts.bankId}`);
  const message = buildOtpRejectMessage(scrapeOpts.bankId);
  await deps.notificationService.sendMessage(message);
  return await executeAttempt(deps, scrapeOpts);
}

/**
 * Builds the Telegram notification shown after an INVALID_OTP response.
 * @param bankId - Bank identifier shown in the notification.
 * @returns HTML-safe notification text for the configured notifier.
 */
function buildOtpRejectMessage(bankId: string): string {
  return `⚠️ OTP for <b>${bankId}</b> was rejected. `
    + 'A new code will be requested — please check your SMS.';
}
