/**
 * Retires a long-term token once a run proves it cannot log in with it.
 *
 * <p>A login that carries a long-term token and fails before the SMS step
 * makes upstream try a second, cold login. Upstream allows one cold login per
 * scrape, so it refuses that one and reports `this scrape has already spent
 * its one cold SMS login` instead of the first failure. Sending the same token
 * again fails the same way on every run, and the cold login it needs never
 * happens.
 *
 * <p>So the run that hits it records the token's digest as refused, and the
 * next run's resolver skips that token and logs in with an SMS code. A stored
 * token is also removed, but only while the store still holds it, so a token
 * minted since is kept. Only this exact result counts, under `GENERIC`, after
 * a sent token. Every other failure may pass, and a run that sent no token
 * cannot blame one.
 *
 * <p>Every failure here costs a warning, never the scrape result. The
 * warnings name the account but never the token or its digest.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import { BUDGET_SPENT_PATTERN } from '../../Errors/ScraperErrorMessages.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IBankTokenStore, TokenRetirement } from './BankTokenStore.js';
import type { IRefusalWrite, IRefusedTokens } from './RefusedTokens.js';
import type { IWarmTokenWatch, WarmTokenSource } from './WarmTokenWatch.js';

/** The stores a retirement records the refusal in and removes the token from. */
export interface ITokenRetirementStores {
  readonly bankTokens: IBankTokenStore;
  readonly refusedTokens: IRefusedTokens;
}

/** A token the attempt sent: where it came from and its digest. */
interface ISentDigest {
  readonly source: WarmTokenSource;
  readonly digest: string;
}

/**
 * Tells whether a result is upstream's refusal of a second cold login.
 * @param result - The attempt's provider result.
 * @returns True only for that refusal under `GENERIC`.
 */
function isBudgetFailure(result: IScraperScrapingResult): boolean {
  if (result.success || String(result.errorType) !== 'GENERIC') return false;
  const message = result.errorMessage ?? '';
  return BUDGET_SPENT_PATTERN.test(message);
}

/**
 * Records the token's digest as refused, turning a throw into a failure.
 * @param watch - The attempt's watch, carrying the key.
 * @param sent - The token's source and digest.
 * @param refusedTokens - Registry to record it in.
 * @returns Whether the file was replaced, or why the refusal was not recorded.
 */
function recordRefusal(
  watch: IWarmTokenWatch, sent: ISentDigest, refusedTokens: IRefusedTokens,
): Procedure<IRefusalWrite> {
  try {
    return refusedTokens.refuse(watch.storeKey, sent.digest);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(`Could not record the refused long-term token for ${watch.storeKey}: ${detail}`);
  }
}

/**
 * Removes the stored token while the store still holds it, turning a throw into a failure.
 * @param watch - The attempt's watch, carrying the key.
 * @param sent - The token's source and digest.
 * @param bankTokens - Store to remove it from.
 * @returns What the entry held, or why it could not be removed.
 */
function removeStored(
  watch: IWarmTokenWatch, sent: ISentDigest, bankTokens: IBankTokenStore,
): Procedure<TokenRetirement> {
  try {
    return bankTokens.removeMatching(watch.storeKey, sent.digest);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(`Could not remove the long-term token for ${watch.storeKey}: ${detail}`);
  }
}

/**
 * Warns with a failure's message.
 * @param watch - The attempt's watch, carrying the logger.
 * @param outcome - What a store returned.
 * @returns True when the store succeeded.
 */
function succeededOrWarn<T>(watch: IWarmTokenWatch, outcome: Procedure<T>): boolean {
  if (outcome.success) return true;
  watch.logger.warn(`  ⚠️  ${outcome.message}`);
  return false;
}

/**
 * Says whether the token is retired, naming the account but never the token.
 * @param watch - The attempt's watch, carrying the key and logger.
 * @param sent - The token's source.
 * @param isRecorded - Whether its refusal was saved.
 * @returns The same flag.
 */
function reportRetirement(watch: IWarmTokenWatch, sent: ISentDigest, isRecorded: boolean): boolean {
  const token = `The ${sent.source} long-term token for ${watch.storeKey}`;
  const outcome = isRecorded
    ? 'was not accepted; it is retired, so the next run logs in without it'
    : 'was not accepted and could not be retired, '
      + 'so the next run may repeat this — remove otpLongTermToken';
  watch.logger.warn(`  ⚠️  ${token} ${outcome}`);
  return isRecorded;
}

/**
 * Records the token as refused and removes its stored copy, warning on every failure.
 * @param watch - The attempt's watch, carrying the key and logger.
 * @param sent - The token's source and digest.
 * @param stores - Registry and token store.
 * @returns True when the refusal was saved.
 */
function retire(
  watch: IWarmTokenWatch, sent: ISentDigest, stores: ITokenRetirementStores,
): boolean {
  const recorded = recordRefusal(watch, sent, stores.refusedTokens);
  const isRecorded = succeededOrWarn(watch, recorded);
  if (sent.source === 'stored') {
    const removed = removeStored(watch, sent, stores.bankTokens);
    succeededOrWarn(watch, removed);
  }
  return reportRetirement(watch, sent, isRecorded);
}

/**
 * Retires the token an attempt sent when its result proves it cannot log in.
 *
 * <p>The result itself is never changed; a store that cannot record or
 * remove the token costs a warning, and the next run may send it again.
 * @param watch - The attempt's watch on the token it sent.
 * @param result - The attempt's provider result.
 * @param stores - Registry and token store.
 * @returns True when the token's refusal was saved.
 */
export default function retireRefusedToken(
  watch: IWarmTokenWatch, result: IScraperScrapingResult, stores: ITokenRetirementStores,
): boolean {
  const { decision } = watch;
  if (decision.source === 'none' || !isBudgetFailure(result)) return false;
  return retire(watch, decision, stores);
}
