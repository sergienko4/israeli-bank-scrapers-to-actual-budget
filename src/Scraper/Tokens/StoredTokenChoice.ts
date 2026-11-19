/**
 * Chooses the long-term token an API-direct login sends.
 *
 * <p>A PayBox token logs in by itself (the provider skips every login step on
 * the warm path), so the token an attempt sends decides which account it
 * imports. A token is sent only when the store vouches that it belongs to this
 * attempt's login. The order is: the entry's own stored token, then the
 * configured one while the store holds none for the entry, then none, so the
 * provider logs in cold with an SMS.
 *
 * <p>A token that was not accepted before is not sent again, by any entry,
 * while the list of tokens that were not accepted holds it, since a token logs
 * in to one account whichever entry sends it. A stored one is skipped in
 * favour of the configured one, which is checked the same way.
 *
 * <p>Every doubt about whose a token is fails closed. If the store cannot be
 * read, or the file is damaged, a configured token is never sent, because the
 * store could not say whose it is. The list of tokens that were not accepted
 * is the exception for tokens the store binds to this login: if it cannot be
 * read in full, they are sent unless what it could read names them, with a
 * warning. Retiring a token removes the record that bound it to its login, so
 * for a configured token the store binds to no login, that list is the only
 * record of whose it was; such a token is not sent unless the list was read in
 * full. Nothing here logs a token or its digest.
 *
 * <p>A token longer than the provider's public boundary accepts is never sent.
 * The provider rejects it before any bank request, so a stored one is removed
 * and a configured one earns a warning until the operator removes it.
 */

import type { ILogger } from '../../Logger/ILogger.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import {
  isLoginFingerprint, isOversizedOtpToken, MAX_OTP_LONG_TERM_TOKEN_CHARS, NO_LOGIN, NO_TOKEN,
} from './BankTokenRecords.js';
import type { IBankTokenStore, ITokenView } from './BankTokenStore.js';
import type { IRefusalView } from './RefusedTokens.js';
import tokenDigest from './TokenDigest.js';
import type { WarmTokenSource } from './WarmTokenWatch.js';

/** Account key, login, store and logger for one attempt, and the refusals it honours. */
export interface ITokenChoiceParams {
  /** The account's key in the token store. */
  readonly storeKey: string;
  /** Fingerprint of the login this attempt logs in with. */
  readonly login: string;
  readonly store: IBankTokenStore;
  readonly logger: ILogger;
  /** The tokens any entry sent that were not accepted. */
  readonly refused: IRefusalView;
}

/** The token an attempt sends, and where it came from. */
export interface ITokenChoice {
  readonly source: WarmTokenSource | 'none';
  readonly token: string;
}

/** What an attempt sends when it sends no token. */
const NOT_SENT: ITokenChoice = { source: 'none', token: NO_TOKEN };

/**
 * Warns about one attempt's token, naming the account but not the token.
 * @param params - Attempt parameters carrying the logger.
 * @param message - What to warn.
 * @returns True once logged.
 */
function warn(params: Pick<ITokenChoiceParams, 'logger'>, message: string): true {
  params.logger.warn(`  ⚠️  ${message}`);
  return true;
}

/**
 * Warns that no token is sent, and why.
 * @param params - Attempt parameters carrying the logger.
 * @param message - Why, naming the account but not the token.
 * @returns {@link NOT_SENT}, so callers can refuse in one step.
 */
function refuse(params: ITokenChoiceParams, message: string): ITokenChoice {
  warn(params, message);
  return NOT_SENT;
}

/**
 * Says at INFO which token is sent, without showing the token.
 * @param params - Attempt parameters carrying the logger and key.
 * @param source - Where the token came from: `stored` or `configured`.
 * @param token - The token to send.
 * @returns The token and its source.
 */
function send(params: ITokenChoiceParams, source: WarmTokenSource, token: string): ITokenChoice {
  params.logger.info(`  🔐 Using the ${source} long-term token for ${params.storeKey}`);
  return { source, token };
}

/**
 * Tells whether a token was not accepted before, for any entry.
 * @param params - Attempt parameters carrying the refusals.
 * @param token - A token the attempt could send.
 * @returns True when the token must not be sent.
 */
function wasRefused(params: ITokenChoiceParams, token: string): boolean {
  const digest = tokenDigest(token);
  return params.refused.has(digest);
}

/**
 * Reads the account's view of the store, turning a throw into a failure.
 * @param params - Attempt parameters carrying the store and key.
 * @returns The view, or why the store could not be read.
 */
function readView(params: ITokenChoiceParams): Procedure<ITokenView> {
  try {
    return params.store.read(params.storeKey);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(detail);
  }
}

/**
 * Says at INFO that the stored token is for another login, so none is sent.
 *
 * <p>The entry's email or phone has changed since the token was minted. That
 * token must not be sent for this login, and neither may the configured one,
 * which is at least as old.
 * @param params - Attempt parameters carrying the logger and key.
 * @returns {@link NOT_SENT}.
 */
function boundElsewhere(params: ITokenChoiceParams): ITokenChoice {
  params.logger.info(
    `  🔐 The stored long-term token for ${params.storeKey} belongs to another login; `
    + 'logging in with an SMS',
  );
  return NOT_SENT;
}

/**
 * Names an entry's configured token in a warning, without the token.
 * @param params - Attempt parameters carrying the key.
 * @returns The phrase `configured long-term token for <key>`.
 */
function configuredTokenOf(params: ITokenChoiceParams): string {
  return `configured long-term token for ${params.storeKey}`;
}

/**
 * Sends a vouched configured token unless it was not accepted before.
 * @param params - Attempt parameters carrying the key and refusals.
 * @param seed - The trimmed, non-blank configured token.
 * @returns The seed, or {@link NOT_SENT}.
 */
function sendConfigured(params: ITokenChoiceParams, seed: string): ITokenChoice {
  if (isOversizedOtpToken(seed)) {
    return refuse(
      params,
      `The ${configuredTokenOf(params)} is longer than the provider accepts `
      + `(${String(MAX_OTP_LONG_TERM_TOKEN_CHARS)} characters), so it is not sent `
      + '— remove or replace otpLongTermToken',
    );
  }
  if (!wasRefused(params, seed)) return send(params, 'configured', seed);
  return refuse(
    params,
    `The ${configuredTokenOf(params)} was not accepted before, so it is not sent `
    + '— remove or replace otpLongTermToken',
  );
}

/**
 * Drops a stored token the provider would reject before it sends anything.
 *
 * <p>Leaving it in place would fail every later run the same way, so the
 * token is removed and the configured one is considered next, then a cold
 * login. A store that cannot remove it costs a warning, never the scrape.
 * @param params - Attempt parameters carrying the store and key.
 * @param token - The oversized stored token.
 * @returns True once the discard was attempted.
 */
function dropOversizedStored(params: ITokenChoiceParams, token: string): true {
  const reason = `The stored long-term token for ${params.storeKey} is longer than `
    + `the provider accepts (${String(MAX_OTP_LONG_TERM_TOKEN_CHARS)} characters)`;
  try {
    const digest = tokenDigest(token);
    const removed = params.store.removeMatching(params.storeKey, digest);
    if (!removed.success) {
      warn(params, `${reason}, so it is not sent; removing it failed: ${removed.message}`);
      return true;
    }
  } catch (error: unknown) {
    const detail = errorMessage(error);
    warn(params, `${reason}, so it is not sent; removing it failed: ${detail}`);
    return true;
  }
  warn(params, `${reason}, so it is removed and not sent again`);
  return true;
}

/**
 * Sends a configured token the store binds to no login, only when the refusals were read in full.
 *
 * <p>Retiring a stored token removes the record that bound it to its login,
 * so the refusal list is then the only record of it. A list that could not be
 * read in full cannot say another entry did not retire this token.
 * @param params - Attempt parameters carrying the key and refusals.
 * @param seed - The trimmed, non-blank configured token.
 * @returns The seed, or {@link NOT_SENT}.
 */
function fromUnboundSeed(params: ITokenChoiceParams, seed: string): ITokenChoice {
  if (params.refused.isIntact || wasRefused(params, seed)) return sendConfigured(params, seed);
  return refuse(
    params,
    `The ${configuredTokenOf(params)} is not saved for this login, and the list of tokens `
    + 'that were not accepted could not be fully read, so it is not sent',
  );
}

/**
 * Sends a configured token only when the file is intact and binds it to no other login.
 * @param params - Attempt parameters carrying the key and login.
 * @param view - The account's view of the store.
 * @param seed - The trimmed, non-blank configured token.
 * @returns The seed, or {@link NOT_SENT}.
 */
function fromVouchedSeed(
  params: ITokenChoiceParams, view: ITokenView, seed: string,
): ITokenChoice {
  const configured = configuredTokenOf(params);
  if (!view.isIntact) {
    return refuse(params, `The token file is damaged, so the ${configured} is not sent`);
  }
  const bound = view.loginOf(seed);
  if (bound === NO_LOGIN) return fromUnboundSeed(params, seed);
  if (bound === params.login) return sendConfigured(params, seed);
  return refuse(params, `The ${configured} belongs to another login, so it is not sent`);
}

/**
 * Sends no token for an entry that configures none, warning when the file is damaged.
 *
 * <p>The damage may have cost the entry its stored token, which would explain
 * the SMS login that follows. The view cannot say whose entry was damaged, so
 * the warning does not claim it was this one.
 * @param params - Attempt parameters carrying the key and logger.
 * @param view - The account's view of the store.
 * @returns {@link NOT_SENT}.
 */
function noneConfigured(params: ITokenChoiceParams, view: ITokenView): ITokenChoice {
  if (view.isIntact) return NOT_SENT;
  return refuse(
    params, `The token file is damaged and holds no usable long-term token for ${params.storeKey}`,
  );
}

/**
 * Sends the configured token when the store holds none for the entry.
 *
 * <p>No configured token, or a blank one (the example config ships `""`), just
 * means no token, which warns only when the file is damaged. A value that is
 * not text is a config mistake, so it warns.
 * @param params - Attempt parameters carrying the key.
 * @param view - The account's view of the store.
 * @param seed - The entry's `otpLongTermToken`, as loaded.
 * @returns The trimmed seed, or {@link NOT_SENT}.
 */
function fromSeed(params: ITokenChoiceParams, view: ITokenView, seed: unknown): ITokenChoice {
  if (seed === undefined || seed === null) return noneConfigured(params, view);
  if (typeof seed !== 'string') {
    return refuse(params, `The ${configuredTokenOf(params)} is not text, so it is not sent`);
  }
  const trimmed = seed.trim();
  if (trimmed === NO_TOKEN) return noneConfigured(params, view);
  return fromVouchedSeed(params, view, trimmed);
}

/**
 * Sends the entry's stored token when it is bound to this login and was not refused.
 *
 * <p>A stored token that was not accepted before is skipped, and the configured
 * one is considered as if the store held none for the entry.
 * @param params - Attempt parameters carrying the login and refusals.
 * @param view - The account's view of the store, holding a usable record.
 * @param seed - The entry's `otpLongTermToken`, as loaded.
 * @returns The token to send, or {@link NOT_SENT}.
 */
function fromStored(
  params: ITokenChoiceParams, view: ITokenView, seed: unknown,
): ITokenChoice {
  const { record } = view;
  if (record.login !== params.login) return boundElsewhere(params);
  if (isOversizedOtpToken(record.token)) {
    dropOversizedStored(params, record.token);
    return fromSeed(params, view, seed);
  }
  if (!wasRefused(params, record.token)) return send(params, 'stored', record.token);
  warn(
    params,
    `The stored long-term token for ${params.storeKey} was not accepted before, so it is not sent`,
  );
  return fromSeed(params, view, seed);
}

/**
 * Chooses the token the store vouches for, failing closed on every doubt.
 * @param params - Attempt parameters carrying the store, key, login and refusals.
 * @param seed - The entry's `otpLongTermToken`, as loaded.
 * @returns The token to send and its source, or {@link NOT_SENT}.
 */
export function chooseToken(params: ITokenChoiceParams, seed: unknown): ITokenChoice {
  const key = params.storeKey;
  if (!isLoginFingerprint(params.login)) {
    return refuse(params, `No login identity for ${key}, so no long-term token is sent`);
  }
  const view = readView(params);
  if (!view.success) {
    return refuse(params, `Could not read the long-term token for ${key}: ${view.message}`);
  }
  if (view.data.record.token !== NO_TOKEN) return fromStored(params, view.data, seed);
  return fromSeed(params, view.data, seed);
}
