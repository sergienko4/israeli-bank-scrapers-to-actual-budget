/**
 * Per-attempt memoisation for OTP retrievers whose bank asks for the same
 * delivered code more than once during a single login.
 *
 * PayBox's api-direct login runs three steps and two of them
 * (`identity.pinValidation`, then `identity.loginBySms`) carry a
 * `preHook: { awaitCredsField: 'otpCodeRetriever' }`. The bank only ever
 * sends one SMS, so both hooks want the SAME digits. Up to 8.6.4 the provider
 * called our retriever once per hook, so the user was asked twice, back to
 * back, for a code they had already given.
 *
 * Since 8.6.5 the provider memoises a hook's value for the whole login
 * (`reuse` defaults to `per-flow`, and PayBox's hooks do not override it), so
 * it asks once per SMS and this cache normally sees a single call. It stays as
 * a guard: if a later release, or a hook set to `per-step`, calls the retriever
 * again, the user is still asked only once.
 *
 * The cache lives on the retriever instance, and `initScrape` builds a fresh
 * retriever for every scrape attempt, so no attempt replays another attempt's
 * code.
 * @internal
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../../Logger/ILogger.js';
import type { IOptionalOtpRetriever, IOtpRetriever } from './Types.js';

/**
 * Provider ids whose login flow invokes `otpCodeRetriever` more than once for
 * a single delivered code. Built from the CompanyTypes enum rather than string
 * literals: the enum values are camelCase (`payBox`), so a hand-written
 * PascalCase literal silently never matches and disables the cache.
 */
const OTP_REPLAY_BANKS = new Set<string>([CompanyTypes.PayBox]);

/** Mutable holder for the in-flight or resolved OTP retrieval of one attempt. */
interface IOtpCacheBox {
  /** Retrieval issued by the first call, replayed by later calls. */
  code?: Promise<string>;
}

/**
 * Reports whether a bank replays one OTP code across several login steps.
 * @param companyId - CompanyTypes value for the bank being scraped.
 * @returns True when the retriever must be memoised for this bank.
 */
export function needsOtpReplayCache(companyId: string): boolean {
  return OTP_REPLAY_BANKS.has(companyId);
}

/**
 * Awaits an already-issued retrieval instead of prompting the user again.
 * @param pending - Retrieval issued by an earlier call in this attempt.
 * @param logger - Logger used to report the replay.
 * @returns The code resolved by the first retrieval.
 */
async function replayPending(
  pending: Promise<string>, logger: ILogger,
): Promise<string> {
  logger.info('  🔁 Reusing the OTP code already entered for this login');
  return await pending;
}

/**
 * Awaits a retrieval and drops it from the cache when it rejects.
 * @param pending - Retrieval issued by the current call.
 * @param box - Cache holder cleared on failure so a later call can prompt.
 * @returns The resolved OTP code.
 */
async function awaitOrClear(
  pending: Promise<string>, box: IOtpCacheBox,
): Promise<string> {
  try {
    return await pending;
  } catch (error: unknown) {
    box.code = undefined;
    throw error;
  }
}

/**
 * Returns the cached code, or prompts once and caches the retrieval.
 * @param box - Cache holder scoped to a single scrape attempt.
 * @param retriever - Underlying retriever that prompts the user.
 * @param logger - Logger used to report a replayed code.
 * @returns The OTP code for this attempt.
 */
async function resolveCached(
  box: IOtpCacheBox, retriever: IOtpRetriever, logger: ILogger,
): Promise<string> {
  if (box.code) return await replayPending(box.code, logger);
  const pending = retriever();
  box.code = pending;
  return await awaitOrClear(pending, box);
}

/**
 * Wraps a retriever so repeat calls within one attempt reuse the first code.
 * @param retriever - Underlying retriever that prompts the user.
 * @param logger - Logger used to report a replayed code.
 * @returns Retriever that prompts once and replays the resolved code.
 */
export function memoizeOtpRetriever(
  retriever: IOtpRetriever, logger: ILogger,
): IOtpRetriever {
  const box: IOtpCacheBox = {};
  /**
   * Retriever exposed to the provider; each call shares one cache box.
   * @returns The OTP digits, prompting the user only on the first call.
   */
  return async (): Promise<string> => await resolveCached(box, retriever, logger);
}

/**
 * Applies the replay cache only for banks known to ask twice for one code.
 * @param retriever - Resolved OTP retriever, or absent when 2FA is off.
 * @param companyId - CompanyTypes value for the bank being scraped.
 * @param logger - Logger used to report a replayed code.
 * @returns Memoised retriever for replay banks, otherwise the input unchanged.
 */
export function applyOtpReplayCache(
  retriever: IOptionalOtpRetriever, companyId: string, logger: ILogger,
): IOptionalOtpRetriever {
  if (!retriever || !needsOtpReplayCache(companyId)) return retriever;
  return memoizeOtpRetriever(retriever, logger);
}
