/**
 * Live strategy credentials for one attempt, and the watch on the token they carry.
 * @internal
 */

import type { IBankConfig } from '../../../Types/Index.js';
import buildCredentials from '../../CredentialsBuilder.js';
import type { IAuthFlowCaptureParams } from '../../Tokens/AuthFlowCapture.js';
import { isApiDirectBank } from '../../Tokens/AuthFlowCapture.js';
import { isPepper, withoutLongTermToken } from '../../Tokens/PepperDeviceState.js';
import type { ILoginContext } from '../../Tokens/WarmTokenResolver.js';
import resolveWarmToken from '../../Tokens/WarmTokenResolver.js';
import type { IWarmTokenWatch, WarmTokenDecision } from '../../Tokens/WarmTokenWatch.js';
import { NO_TOKEN_SENT, watchRetriever } from '../../Tokens/WarmTokenWatch.js';
import type { IInitializedLiveScrape, IOptionalOtpRetriever } from './Types.js';

type OtpRetriever = IOptionalOtpRetriever;

/** The credentials one attempt logs in with, and the watch on the token they carry. */
export type AttemptLogin = Pick<IInitializedLiveScrape, 'credentials' | 'tokenWatch'>;

/**
 * Builds the watch on the token one attempt sends.
 * @param captureParams - Account key and logger for this attempt.
 * @param decision - Which long-term token the attempt's credentials carry, if any.
 * @returns The attempt's token watch.
 */
function watchOf(
  captureParams: IAuthFlowCaptureParams, decision: WarmTokenDecision,
): IWarmTokenWatch {
  return { storeKey: captureParams.storeKey, logger: captureParams.logger, decision };
}

/**
 * Builds an API-direct attempt's credentials from the token the store vouches for.
 *
 * The token and the refusals are read afresh on every attempt. When a token is
 * sent, the retriever warns before a cold login asks for a code, since that
 * means it was not accepted.
 * @param context - Account key, login, store, logger and refusals for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, and the watch on their token.
 */
function warmLogin(
  context: ILoginContext, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  const canAskForOtp = retriever !== undefined;
  const chosen = resolveWarmToken(context, { bankConfig, canAskForOtp });
  const tokenWatch = watchOf(context.capture, chosen.decision);
  const watched = watchRetriever(tokenWatch, retriever);
  return { credentials: buildCredentials(chosen.bankConfig, watched), tokenWatch };
}

/** Builds one attempt's credentials, and the watch on the token they carry. */
type LoginBuilder = (
  context: ILoginContext, bankConfig: IBankConfig, retriever: OtpRetriever,
) => AttemptLogin;

/**
 * Builds a browser bank's credentials from its entry as configured.
 *
 * Browser banks never read the store, so they send no token.
 * @param context - Account key and logger for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, which carry no token.
 */
function plainLogin(
  context: ILoginContext, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  const tokenWatch = watchOf(context.capture, NO_TOKEN_SENT);
  return { credentials: buildCredentials(bankConfig, retriever), tokenWatch };
}

/**
 * Builds a Pepper attempt's credentials, which never carry a long-term token.
 *
 * Pepper logs in with the device state attached to the provider options, or
 * enrolls with an SMS code, and refuses a long-term token next to either.
 * @param context - Account key and logger for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, which carry no token.
 */
function deviceLogin(
  context: ILoginContext, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  const loginConfig = withoutLongTermToken(context.capture, bankConfig);
  return plainLogin(context, loginConfig, retriever);
}

/**
 * Picks how a bank's attempt logs in.
 * @param companyType - Provider company id of the bank being scraped.
 * @returns `deviceLogin` for Pepper, `warmLogin` for the other API-direct
 *   banks, and `plainLogin` for browser banks.
 */
function loginBuilderFor(companyType: string): LoginBuilder {
  if (isPepper(companyType)) return deviceLogin;
  if (isApiDirectBank(companyType)) return warmLogin;
  return plainLogin;
}

/**
 * Builds the credentials one attempt logs in with.
 * @param context - Account key, login, store, logger and refusals for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, and the watch on their token.
 */
export default function credentialsFor(
  context: ILoginContext, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  const build = loginBuilderFor(context.capture.companyType);
  return build(context, bankConfig, retriever);
}
