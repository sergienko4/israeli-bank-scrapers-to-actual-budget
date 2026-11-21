/**
 * Retires a long-term token once a run proves it cannot be used again.
 *
 * <p>A login that carries a long-term token and fails before the SMS step
 * makes upstream try a second, cold login. Upstream allows one cold login per
 * scrape, so it refuses that one and reports `this scrape has already spent
 * its one cold login` instead of the first failure. Sending the same token
 * again fails the same way on every run, and the cold login it needs never
 * happens.
 *
 * <p>A warm login is resolved entirely from the token, so the provider cannot
 * see that the bank has already revoked the session. The first authenticated
 * data call then fails: PayBox answers its `getKey` key exchange with a
 * business-level 404, reported as `getKey missing key material`. Replaying that
 * token fails identically, so it is retired too.
 *
 * <p>So the run that hits either failure records the token's digest as
 * refused, and the next run's resolver skips that token and logs in with an
 * SMS code. A stored token is removed, but only while the store still holds
 * that digest, so a token minted since is kept. A configured token that the
 * warm login just persisted is removed the same way; the budget failure runs
 * before any login succeeds, so it only removes what was already stored.
 * Only these exact results count, under `GENERIC`, after a sent token. Every
 * other failure may pass, and a run that sent no token cannot blame one.
 *
 * <p>Every failure here costs a warning, never the scrape result. The
 * warnings name the account but never the token or its digest.
 */

import { type IScraperScrapingResult, ScraperErrorTypes } from '@sergienko4/israeli-bank-scrapers';

import { BUDGET_SPENT_PATTERN, WARM_SESSION_REJECTED_PATTERN } from '../../Errors/ScraperErrorMessages.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import { NO_TOKEN } from './BankTokenRecords.js';
import type { IBankTokenStore, TokenRetirement } from './BankTokenStore.js';
import type { IRefusalWrite, IRefusedTokens } from './RefusedTokens.js';
import tokenDigest from './TokenDigest.js';
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

/** The stores a retirement uses, and whether a stored copy of the token may exist. */
interface IRetirementPlan extends ITokenRetirementStores {
  readonly shouldRemoveStoredCopy: boolean;
}

/** The attempt whose published token a warm-session refusal retires. */
export interface ICapturedRetirement {
  readonly watch: IWarmTokenWatch;
  readonly captured: string;
  readonly result: IScraperScrapingResult;
}

/**
 * Tells whether a result is one of the failures the importer retires a token for.
 *
 * <p>Two failures qualify: upstream's refusal of the second cold login it
 * needed, and the first authenticated call refusing the session a warm login
 * resolved. Both arrive under `GENERIC`; a timeout or a network error that
 * happens to quote the wording must not retire a token.
 * @param result - The attempt's provider result.
 * @returns `budget` or `warm-session` for the two failures, or false.
 */
function rejectionOf(result: IScraperScrapingResult): 'budget' | 'warm-session' | false {
  if (result.success || result.errorType !== ScraperErrorTypes.Generic) return false;
  const message = result.errorMessage ?? '';
  if (BUDGET_SPENT_PATTERN.test(message)) return 'budget';
  return WARM_SESSION_REJECTED_PATTERN.test(message) ? 'warm-session' : false;
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
 * Records the token as refused and, when the plan says so, removes its stored copy.
 * @param watch - The attempt's watch, carrying the key and logger.
 * @param sent - The token's source and digest.
 * @param plan - Registry, token store, and whether a stored copy may exist.
 * @returns True when the refusal was saved.
 */
function retire(
  watch: IWarmTokenWatch, sent: ISentDigest, plan: IRetirementPlan,
): boolean {
  const recorded = recordRefusal(watch, sent, plan.refusedTokens);
  const isRecorded = succeededOrWarn(watch, recorded);
  if (plan.shouldRemoveStoredCopy) {
    const removed = removeStored(watch, sent, plan.bankTokens);
    succeededOrWarn(watch, removed);
  }
  return reportRetirement(watch, sent, isRecorded);
}

/**
 * Retires the token an attempt sent when its result proves it cannot be used.
 *
 * <p>The result itself is never changed; a store that cannot record or
 * remove the token costs a warning, and the next run may send it again. A
 * configured token is removed only for the warm-session refusal: the budget
 * failure happens before any login succeeds, so it cannot have persisted one.
 * @param watch - The attempt's watch on the token it sent.
 * @param result - The attempt's provider result.
 * @param stores - Registry and token store.
 * @returns True when the token's refusal was saved.
 */
export default function retireRefusedToken(
  watch: IWarmTokenWatch, result: IScraperScrapingResult, stores: ITokenRetirementStores,
): boolean {
  const { decision } = watch;
  const rejection = rejectionOf(result);
  if (decision.source === 'none' || rejection === false) return false;
  const shouldRemoveStoredCopy = decision.source === 'stored' || rejection === 'warm-session';
  return retire(watch, decision, { ...stores, shouldRemoveStoredCopy });
}

/**
 * Retires the envelope the login callback published during this attempt.
 *
 * <p>PayBox re-wraps a warm session into a new `v1.` envelope on every login,
 * so the callback's string differs from the one the attempt sent while both
 * unwrap to the same session. The store therefore holds a digest the sent
 * token's retirement cannot remove. A cold login's published token is a
 * genuinely new session; when the bank refuses it at the first data call it is
 * dead as well. Both are retired here, without a second operator warning: the
 * refusal warning already names the account.
 * @param request - The attempt's watch, the published token, and its result.
 * @param stores - Registry and token store.
 * @returns True when a captured copy was retired.
 */
export function retireCapturedToken(
  request: ICapturedRetirement, stores: ITokenRetirementStores,
): boolean {
  const { watch, captured, result } = request;
  if (captured === NO_TOKEN || rejectionOf(result) !== 'warm-session') return false;
  const digest = tokenDigest(captured);
  if (watch.decision.source !== 'none' && watch.decision.digest === digest) return false;
  const sent: ISentDigest = { source: 'stored', digest };
  const recorded = recordRefusal(watch, sent, stores.refusedTokens);
  succeededOrWarn(watch, recorded);
  const removed = removeStored(watch, sent, stores.bankTokens);
  succeededOrWarn(watch, removed);
  return recorded.success;
}
