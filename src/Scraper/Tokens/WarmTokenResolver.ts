/**
 * Resolves the long-term token one API-direct attempt sends, and the watch on it.
 *
 * <p>The choice policy lives in {@link chooseToken}. This module reads the
 * refusal list, warns when a cold login cannot ask for a code, registers the
 * sent value with the masker, and tags the attempt with the token's digest.
 * Pepper never asks here: its enrolled-device state replaced its long-term
 * token, and `PepperDeviceState` chooses what it sends.
 */

import { registerSecretValues } from '../../Logger/SecretValues.js';
import type { IBankConfig } from '../../Types/Index.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import { NO_TOKEN, requiresColdOtp } from './BankTokenRecords.js';
import type { IRefusalView, IRefusedTokens } from './RefusedTokens.js';
import { chooseToken, type ITokenChoice } from './StoredTokenChoice.js';
import tokenDigest from './TokenDigest.js';
import type { WarmTokenDecision } from './WarmTokenWatch.js';
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
function warn(params: Pick<IAuthFlowCaptureParams, 'logger'>, message: string): true {
  params.logger.warn(`  ⚠️  ${message}`);
  return true;
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
function warnIfStuck(
  params: Pick<IAuthFlowCaptureParams, 'companyType' | 'storeKey' | 'logger'>,
  canAskForOtp: boolean,
): boolean {
  if (canAskForOtp || !requiresColdOtp(params.companyType)) return false;
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
function decisionOf(sent: ITokenChoice): WarmTokenDecision {
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
  const params = { ...context.capture, refused };
  const sent = chooseToken(params, request.bankConfig.otpLongTermToken);
  if (sent.source === 'none') warnIfStuck(params, request.canAskForOtp);
  else registerSecretValues([sent.token]);
  const bankConfig = withToken(request.bankConfig, sent.token);
  return { bankConfig, decision: decisionOf(sent) };
}
