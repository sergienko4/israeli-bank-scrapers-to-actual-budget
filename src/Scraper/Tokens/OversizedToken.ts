/**
 * Discards a stored long-term token the provider would reject before a request.
 *
 * <p>Scraper 10.1.0 validates `otpLongTermToken` at its public boundary. The
 * importer re-sends the token it stored, so one oversized value would make
 * every run fail with `GENERIC` and never reach the bank. The token is removed
 * by digest, so a token minted since is never deleted; a store that cannot
 * remove it costs a warning, never the scrape.
 */

import type { ILogger } from '../../Logger/ILogger.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import { MAX_OTP_LONG_TERM_TOKEN_CHARS } from '../ProviderLimits.js';
import type { IBankTokenStore, TokenRetirement } from './BankTokenStore.js';
import tokenDigest from './TokenDigest.js';

/** The store and account one stored-token discard acts on. */
export interface IStoredTokenRemoval {
  /** The account's key in the token store. */
  readonly storeKey: string;
  readonly store: IBankTokenStore;
  readonly logger: ILogger;
}

/**
 * Removes one stored token whose digest the caller already holds.
 * @param params - Store, account key and logger for this discard.
 * @param token - The stored token to remove.
 * @returns Whether the file was replaced, or why it was not.
 */
function removeStoredToken(
  params: IStoredTokenRemoval, token: string,
): Procedure<TokenRetirement> {
  try {
    const digest = tokenDigest(token);
    return params.store.removeMatching(params.storeKey, digest);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(detail);
  }
}

/**
 * Drops a stored token the provider would reject before it sends anything.
 *
 * <p>Leaving it in place would fail every later run the same way, so the
 * token is removed and the caller behaves as though the entry had none.
 * @param params - Store, account key and logger for this discard.
 * @param token - The oversized stored token.
 * @returns True once the discard was attempted.
 */
export function dropOversizedStoredToken(
  params: IStoredTokenRemoval, token: string,
): true {
  const reason = `The stored long-term token for ${params.storeKey} is longer than `
    + `the provider accepts (${String(MAX_OTP_LONG_TERM_TOKEN_CHARS)} characters)`;
  const removed = removeStoredToken(params, token);
  if (!removed.success) {
    params.logger.warn(
      `  ⚠️  ${reason}, so it is not sent; removing it failed: ${removed.message}`,
    );
    return true;
  }
  params.logger.warn(`  ⚠️  ${reason}, so it is removed and not sent again`);
  return true;
}
