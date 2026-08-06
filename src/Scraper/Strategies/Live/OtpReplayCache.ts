/**
 * Per-attempt memoisation for OTP retrievers whose bank asks for the same
 * delivered code more than once during a single login.
 *
 * PayBox's api-direct login runs three steps and two of them
 * (`identity.pinValidation`, then `identity.loginBySms`) carry a
 * `preHook: { awaitCredsField: 'otpCodeRetriever' }`. Each hook AES-encrypts
 * the digits into the request body at `/pin` under a different IV and then
 * scrubs the plaintext from the flow carry, so the provider cannot reuse the
 * value and calls our retriever a second time. The bank only ever sends one
 * SMS, so both hooks want the SAME digits -- without memoisation the user is
 * prompted twice, back to back, for a code they already supplied.
 *
 * The cache lives on the retriever instance and a fresh retriever is built per
 * scrape attempt in `initScrape`, so the INVALID_OTP retry path still prompts
 * for a genuinely new code.
 * @internal
 */

import type { ILogger } from '../../../Logger/ILogger.js';
import type { IOptionalOtpRetriever, IOtpRetriever } from './Types.js';

/**
 * Provider ids whose login flow invokes `otpCodeRetriever` more than once for
 * a single delivered code. Values must match CompanyTypes enum string values.
 */
const OTP_REPLAY_BANKS = new Set(['PayBox']);

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
