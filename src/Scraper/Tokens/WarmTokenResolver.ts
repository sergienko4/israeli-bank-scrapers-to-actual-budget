/**
 * Chooses the long-term token an API-direct login sends.
 *
 * <p>A Pepper or PayBox token logs in by itself (the provider skips every
 * login step on the warm path), so the token an attempt sends decides which
 * account it imports. A token is sent only when the store vouches that it
 * belongs to this attempt's login. The order is: the entry's own stored token,
 * then the configured one while the store holds none for the entry, then none,
 * so the provider logs in cold with an SMS.
 *
 * <p>Every doubt fails closed. If the store cannot be read, or the file is
 * damaged, a configured token is never sent, because the store could not say
 * whose it is. Nothing here logs a token, and the token sent is registered
 * with the value masker, so no other output shows it.
 */

import { registerSecretValues } from '../../Logger/SecretValues.js';
import type { IBankConfig } from '../../Types/Index.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import type { IBankTokenRecord } from './BankTokenRecords.js';
import { isLoginFingerprint, NO_LOGIN, NO_TOKEN } from './BankTokenRecords.js';
import type { ITokenView } from './BankTokenStore.js';

/** What one attempt logs in with, beyond the capture bundle. */
export interface IWarmTokenRequest {
  /** The entry's config; its `otpLongTermToken` is the operator's seed. */
  readonly bankConfig: IBankConfig;
  /** True when the attempt has an OTP retriever, so a cold login can ask for the code. */
  readonly canAskForOtp: boolean;
}

/** Account key, login, store and logger for one attempt. */
type Params = IAuthFlowCaptureParams;

/**
 * Warns that no token is sent, and why.
 * @param params - Attempt parameters carrying the logger.
 * @param message - Why, naming the account but not the token.
 * @returns {@link NO_TOKEN}, so callers can refuse in one step.
 */
function refuse(params: Params, message: string): string {
  params.logger.warn(`  ⚠️  ${message}`);
  return NO_TOKEN;
}

/**
 * Says at INFO which token is sent, without showing the token.
 * @param params - Attempt parameters carrying the logger and key.
 * @param source - Where the token came from: `stored` or `configured`.
 * @param token - The token to send.
 * @returns The same token.
 */
function send(params: Params, source: string, token: string): string {
  params.logger.info(`  🔐 Using the ${source} long-term token for ${params.storeKey}`);
  return token;
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
 * Sends the entry's stored token when it is bound to this login.
 *
 * <p>If the token is bound to another login, the entry's email or phone has
 * changed since the token was minted. That token must not be sent for this
 * login, and neither may the configured one, which is at least as old.
 * @param params - Attempt parameters carrying the login.
 * @param record - The entry's usable stored record.
 * @returns The stored token, or {@link NO_TOKEN}.
 */
function fromRecord(params: Params, record: IBankTokenRecord): string {
  if (record.login === params.login) return send(params, 'stored', record.token);
  params.logger.info(
    `  🔐 The stored long-term token for ${params.storeKey} belongs to another login; `
    + 'logging in with an SMS',
  );
  return NO_TOKEN;
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
 * Sends a configured token only when the file is intact and binds it to no other login.
 * @param params - Attempt parameters carrying the key and login.
 * @param view - The account's view of the store.
 * @param seed - The trimmed, non-blank configured token.
 * @returns The seed, or {@link NO_TOKEN}.
 */
function fromVouchedSeed(params: Params, view: ITokenView, seed: string): string {
  const configured = configuredTokenOf(params);
  if (!view.isIntact) {
    return refuse(params, `The token file is damaged, so the ${configured} is not sent`);
  }
  const bound = view.loginOf(seed);
  const isElsewhere = bound !== NO_LOGIN && bound !== params.login;
  if (!isElsewhere) return send(params, 'configured', seed);
  return refuse(params, `The ${configured} belongs to another login, so it is not sent`);
}

/**
 * Sends the configured token when the store holds none for the entry.
 *
 * <p>No configured token, or a blank one (the example config ships `""`), just
 * means no token. A value that is not text is a config mistake, so it warns.
 * @param params - Attempt parameters carrying the key.
 * @param view - The account's view of the store.
 * @param seed - The entry's `otpLongTermToken`, as loaded.
 * @returns The trimmed seed, or {@link NO_TOKEN}.
 */
function fromSeed(params: Params, view: ITokenView, seed: unknown): string {
  if (seed === undefined || seed === null) return NO_TOKEN;
  if (typeof seed !== 'string') {
    return refuse(params, `The ${configuredTokenOf(params)} is not text, so it is not sent`);
  }
  const trimmed = seed.trim();
  if (trimmed === NO_TOKEN) return NO_TOKEN;
  return fromVouchedSeed(params, view, trimmed);
}

/**
 * Chooses the token the store vouches for, failing closed on every doubt.
 * @param params - Attempt parameters carrying the store, key and login.
 * @param seed - The entry's `otpLongTermToken`, as loaded.
 * @returns The token to send, or {@link NO_TOKEN}.
 */
function chooseToken(params: Params, seed: unknown): string {
  const key = params.storeKey;
  if (!isLoginFingerprint(params.login)) {
    return refuse(params, `No login identity for ${key}, so no long-term token is sent`);
  }
  const view = readView(params);
  if (!view.success) {
    return refuse(params, `Could not read the long-term token for ${key}: ${view.message}`);
  }
  const { record } = view.data;
  if (record.token !== NO_TOKEN) return fromRecord(params, record);
  return fromSeed(params, view.data, seed);
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
  refuse(
    params,
    `No usable long-term token for ${params.storeKey}, and this run cannot ask for an SMS code: `
    + 'turn on twoFactorAuth for one SMS login, or restore the token file',
  );
  return true;
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
 * Returns the config one API-direct attempt logs in with.
 * @param params - Account key, login, store and logger for this attempt.
 * @param request - The entry's config and whether the run can ask for an SMS code.
 * @returns A copy of the config that carries only a token the store vouches for.
 */
export default function resolveWarmToken(params: Params, request: IWarmTokenRequest): IBankConfig {
  const token = chooseToken(params, request.bankConfig.otpLongTermToken);
  if (token === NO_TOKEN) warnIfStuck(params, request.canAskForOtp);
  else registerSecretValues([token]);
  return withToken(request.bankConfig, token);
}
