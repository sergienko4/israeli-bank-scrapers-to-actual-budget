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
 * <p>A token that was not accepted before is never sent again, by any entry,
 * since a token logs in to one account whichever entry sends it. A stored one
 * is skipped in favour of the configured one, which is checked the same way.
 *
 * <p>Pepper never asks here: its enrolled-device state replaced its long-term
 * token, and `PepperDeviceState` chooses what it sends.
 *
 * <p>Every doubt about whose a token is fails closed. If the store cannot be
 * read, or the file is damaged, a configured token is never sent, because the
 * store could not say whose it is. The list of tokens that were not accepted
 * is the exception for tokens the store binds to this login: if it cannot be
 * read in full, they are sent as before, with a warning. Retiring a token
 * removes the record that bound it to its login, so for a configured token the
 * store binds to no login, that list is the only record of whose it was; such
 * a token is not sent unless the list was read in full.
 * Nothing here logs a token or its digest, and the token sent is registered
 * with the value masker, so no other output shows it.
 */

import { registerSecretValues } from '../../Logger/SecretValues.js';
import type { IBankConfig } from '../../Types/Index.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import { isLoginFingerprint, NO_LOGIN, NO_TOKEN } from './BankTokenRecords.js';
import type { ITokenView } from './BankTokenStore.js';
import type { IRefusalView, IRefusedTokens } from './RefusedTokens.js';
import tokenDigest from './TokenDigest.js';
import type { WarmTokenDecision, WarmTokenSource } from './WarmTokenWatch.js';
import { NO_TOKEN_SENT } from './WarmTokenWatch.js';

/** What one attempt logs in with, beyond the capture bundle. */
export interface IWarmTokenRequest {
  /** The entry's config; its `otpLongTermToken` is the operator's seed. */
  readonly bankConfig: IBankConfig;
  /** True when the attempt has an OTP retriever, so a cold login can ask for the code. */
  readonly canAskForOtp: boolean;
}

/** What one attempt's login reads its token from. */
export interface ILoginContext {
  /** Account key, login, token store and logger for the attempt. */
  readonly capture: IAuthFlowCaptureParams;
  /** The tokens any entry sent that were not accepted. */
  readonly refusals: IRefusedTokens;
}

/** The config one attempt logs in with, and which token it carries. */
export interface IWarmTokenChoice {
  readonly bankConfig: IBankConfig;
  readonly decision: WarmTokenDecision;
}

/** Account key, login, store and logger for one attempt, and the refusals it honours. */
type Params = IAuthFlowCaptureParams & { readonly refused: IRefusalView };

/** The token an attempt sends, and where it came from. */
interface ISentToken {
  readonly source: WarmTokenSource | 'none';
  readonly token: string;
}

/** What an attempt sends when it sends no token. */
const NOT_SENT: ISentToken = { source: 'none', token: NO_TOKEN };

/** A refusal view that names no token and vouches for none, for a list that could not be read. */
const NO_REFUSALS: IRefusalView = {
  /**
   * Names no token.
   * @returns False.
   */
  has: (): boolean => false,
  isIntact: false,
};

/**
 * Warns about one attempt's token, naming the account but not the token.
 * @param params - Attempt parameters carrying the logger.
 * @param message - What to warn.
 * @returns True once logged.
 */
function warn(params: Pick<Params, 'logger'>, message: string): true {
  params.logger.warn(`  ⚠️  ${message}`);
  return true;
}

/**
 * Warns that no token is sent, and why.
 * @param params - Attempt parameters carrying the logger.
 * @param message - Why, naming the account but not the token.
 * @returns {@link NOT_SENT}, so callers can refuse in one step.
 */
function refuse(params: Params, message: string): ISentToken {
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
function send(params: Params, source: WarmTokenSource, token: string): ISentToken {
  params.logger.info(`  🔐 Using the ${source} long-term token for ${params.storeKey}`);
  return { source, token };
}

/**
 * Tells whether a token was not accepted before, for any entry.
 * @param params - Attempt parameters carrying the refusals.
 * @param token - A token the attempt could send.
 * @returns True when the token must not be sent.
 */
function wasRefused(params: Params, token: string): boolean {
  const digest = tokenDigest(token);
  return params.refused.has(digest);
}

/**
 * Reads the account's view of the store, turning a throw into a failure.
 * @param params - Attempt parameters carrying the store and key.
 * @returns The view, or why the store could not be read.
 */
function readView(params: Params): Procedure<ITokenView> {
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
function boundElsewhere(params: Params): ISentToken {
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
function configuredTokenOf(params: Params): string {
  return `configured long-term token for ${params.storeKey}`;
}

/**
 * Sends a vouched configured token unless it was not accepted before.
 * @param params - Attempt parameters carrying the key and refusals.
 * @param seed - The trimmed, non-blank configured token.
 * @returns The seed, or {@link NOT_SENT}.
 */
function sendConfigured(params: Params, seed: string): ISentToken {
  if (!wasRefused(params, seed)) return send(params, 'configured', seed);
  return refuse(
    params,
    `The ${configuredTokenOf(params)} was not accepted before, so it is not sent `
    + '— remove or replace otpLongTermToken',
  );
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
function fromUnboundSeed(params: Params, seed: string): ISentToken {
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
function fromVouchedSeed(params: Params, view: ITokenView, seed: string): ISentToken {
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
function noneConfigured(params: Params, view: ITokenView): ISentToken {
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
function fromSeed(params: Params, view: ITokenView, seed: unknown): ISentToken {
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
function fromStored(params: Params, view: ITokenView, seed: unknown): ISentToken {
  const { record } = view;
  if (record.login !== params.login) return boundElsewhere(params);
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
function chooseToken(params: Params, seed: unknown): ISentToken {
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

/**
 * Reads the refusals, turning a throw into a failure.
 * @param context - The attempt's capture parameters and refusal list.
 * @returns The list's view, or why it could not be read.
 */
function tryReadRefusals(context: ILoginContext): Procedure<IRefusalView> {
  try {
    return context.refusals.read();
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(detail);
  }
}

/**
 * Reads the refusals once for the attempt, warning when they cannot be trusted.
 *
 * <p>A list that cannot be read names no token, and a damaged one still skips
 * the tokens it can name. Either way the warning says so, and since the list
 * was not read in full, a configured token the store binds to no login is
 * not sent.
 * @param context - The attempt's capture parameters and refusal list.
 * @returns The refusals the attempt honours.
 */
function readRefusals(context: ILoginContext): IRefusalView {
  const { capture } = context;
  const read = tryReadRefusals(context);
  if (!read.success) {
    const key = capture.storeKey;
    const what = `which long-term tokens for ${key} were not accepted before`;
    warn(capture, `Could not read ${what}, so none is skipped: ${read.message}`);
    return NO_REFUSALS;
  }
  if (!read.data.isIntact) {
    warn(
      capture,
      'The list of long-term tokens that were not accepted is damaged, '
      + 'so only the ones it still holds are skipped',
    );
  }
  return read.data;
}

/**
 * Warns how to recover when a cold login is due but cannot ask for the code.
 *
 * <p>Without a retriever the provider fails the cold login, so the warning
 * names both fixes.
 * @param params - Attempt parameters carrying the key and logger.
 * @param canAskForOtp - Whether the attempt has an OTP retriever.
 * @returns True when the warning was logged.
 */
function warnIfStuck(params: Params, canAskForOtp: boolean): boolean {
  if (canAskForOtp) return false;
  return warn(
    params,
    `No usable long-term token for ${params.storeKey}, and this run cannot ask for an SMS code: `
    + 'turn on twoFactorAuth for one SMS login, or restore the token file',
  );
}

/**
 * Copies a config entry with its long-term token replaced.
 *
 * <p>No token is an `undefined` field, which the credentials builder treats
 * as absent, so a refused configured token never reaches the provider.
 * @param bankConfig - The entry's config; never modified.
 * @param token - The token to send, or {@link NO_TOKEN} for none.
 * @returns A new config whose `otpLongTermToken` is the token, or undefined.
 */
function withToken(bankConfig: IBankConfig, token: string): IBankConfig {
  const otpLongTermToken = token === NO_TOKEN ? undefined : token;
  return { ...bankConfig, otpLongTermToken };
}

/**
 * Tags what an attempt sent with the digest of the token, never the token.
 * @param sent - The token the attempt sends, and its source.
 * @returns The decision the attempt's watch carries.
 */
function decisionOf(sent: ISentToken): WarmTokenDecision {
  if (sent.source === 'none') return NO_TOKEN_SENT;
  const digest = tokenDigest(sent.token);
  return { source: sent.source, digest };
}

/**
 * Returns the config one API-direct attempt logs in with, and which token it carries.
 * @param context - Account key, login, store, logger and refusals for this attempt.
 * @param request - The entry's config and whether the run can ask for an SMS code.
 * @returns A copy of the config that carries only a token the store vouches for
 *   and that was not refused, and the decision the attempt's watch carries.
 */
export default function resolveWarmToken(
  context: ILoginContext, request: IWarmTokenRequest,
): IWarmTokenChoice {
  const refused = readRefusals(context);
  const params: Params = { ...context.capture, refused };
  const sent = chooseToken(params, request.bankConfig.otpLongTermToken);
  if (sent.source === 'none') warnIfStuck(params, request.canAskForOtp);
  else registerSecretValues([sent.token]);
  const bankConfig = withToken(request.bankConfig, sent.token);
  return { bankConfig, decision: decisionOf(sent) };
}
