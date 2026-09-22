/**
 * Live strategy attempt orchestration and OTP-retry flow.
 * @internal
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { IRetryStrategy } from '../../../Resilience/RetryStrategy.js';
import type { IBankConfig, IRawScrape, Procedure } from '../../../Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../../../Types/Index.js';
import { captureResultToken, isApiDirectBank } from '../../Tokens/AuthFlowCapture.js';
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
  resolved.data.logger.info(`  🔍 Scraping transactions from ${resolved.data.bankId}...`);
  return await runWithOtpRetry(deps, resolved.data);
}

/**
 * Runs the first attempt and dispatches the OTP-retry path when needed.
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

/** Phrase the operator-advice table matches to explain the refusal. */
const OTP_REFUSAL_REASON = 'one SMS login per scrape is allowed; start a new scrape to try again';

/**
 * Ends the run after a rejected OTP instead of spending a second SMS login.
 *
 * This is a policy, not a provider constraint. An `INVALID_OTP` is raised
 * while validating the code, before the login chain mints anything, so a
 * retry would revoke nothing; scraper 8.7.3's own one-cold-login cap is
 * per-scrape and a retry opens a new scrape with a fresh budget. The choice
 * made here is that one rejected code costs one run, so an unattended
 * schedule cannot sit in a prompt-and-reject loop sending SMS after SMS.
 *
 * The provider's bare `INVALID_OTP` would otherwise be rendered as "enter it
 * quickly next time", so the reason is attached to the message the operator
 * sees and pushed to the notifier, which the retry path also does.
 * @param deps - Strategy dependencies exposing the notification service.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param first - Provider result carrying the INVALID_OTP failure.
 * @returns Procedure success wrapping the single attempt that was made.
 */
async function refuseOtpRetry(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts, first: IScraperScrapingResult,
): Promise<Procedure<IRawScrape>> {
  scrapeOpts.logger.warn(`  ⚠️  OTP rejected for ${scrapeOpts.bankId} — ${OTP_REFUSAL_REASON}`);
  const message = buildOtpRefusalMessage(scrapeOpts.bankId);
  await deps.notificationService.sendMessage(message);
  const explained = explainOtpRefusal(first);
  return succeedRawScrape(scrapeOpts, explained, 1);
}

/**
 * Restates the failure so the advice table can explain the refusal.
 * @param first - Provider result carrying the INVALID_OTP failure.
 * @returns The same result with the refusal reason added to its message.
 */
function explainOtpRefusal(first: IScraperScrapingResult): IScraperScrapingResult {
  const original = first.errorMessage ?? 'INVALID_OTP';
  return { ...first, errorMessage: `${original} — ${OTP_REFUSAL_REASON}` };
}

/**
 * Builds the notification shown when an OTP rejection ends the run.
 * @param bankId - Bank identifier shown in the notification.
 * @returns HTML-safe notification text for the configured notifier.
 */
function buildOtpRefusalMessage(bankId: string): string {
  return `⚠️ OTP for <b>${bankId}</b> was rejected. `
    + 'No new code will be requested this run — start a new scrape to try again.';
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
  const initialized = initScrape(deps, scrapeOpts);
  const retryStrategy = pickRetryStrategy(deps, scrapeOpts.bankConfig);
  const label = `Scraping ${scrapeOpts.bankId}`;
  const params = { deps, ...initialized, logger: scrapeOpts.logger, label };
  const result = await runAttemptThenSeal(retryStrategy, params);
  return persistDurableToken(deps, scrapeOpts, result);
}

/**
 * Persists the durable token the result carried, then returns it unchanged.
 *
 * The completion callback is the primary capture path; this covers the case
 * where the provider populated the public field without firing it. Storing a
 * token can never change the scrape's outcome, so the result passes through.
 * @param deps - Strategy dependencies exposing the token store.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @param result - Provider scrape result to inspect.
 * @returns The same provider result, unmodified.
 */
function persistDurableToken(
  deps: ILiveScrapeDependencies,
  scrapeOpts: IResolvedLiveOpts,
  result: IScraperScrapingResult,
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
 * Selects no-retry for 2FA banks because OTP flows own retry cadence.
 * @param deps - Strategy dependencies exposing retry policies.
 * @param bankConfig - Bank config whose twoFactorAuth flag is inspected.
 * @returns Retry policy used for this live scrape attempt.
 */
function pickRetryStrategy(
  deps: ILiveScrapeDependencies,
  bankConfig: IBankConfig,
): IRetryStrategy {
  return bankConfig.twoFactorAuth ? deps.noRetryStrategy : deps.retryStrategy;
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
