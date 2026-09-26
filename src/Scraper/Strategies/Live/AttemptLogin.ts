/**
 * Live strategy credentials for one attempt, and the watch on the token they carry.
 * @internal
 */

import type { IBankConfig } from '../../../Types/Index.js';
import buildCredentials from '../../CredentialsBuilder.js';
import type { IAuthFlowCaptureParams } from '../../Tokens/AuthFlowCapture.js';
import { isApiDirectBank } from '../../Tokens/AuthFlowCapture.js';
import resolveWarmToken from '../../Tokens/WarmTokenResolver.js';
import type { IWarmTokenWatch } from '../../Tokens/WarmTokenWatch.js';
import { watchRetriever } from '../../Tokens/WarmTokenWatch.js';
import type { IInitializedLiveScrape, IOptionalOtpRetriever } from './Types.js';

type OtpRetriever = IOptionalOtpRetriever;

/** The credentials one attempt logs in with, and the watch on the token they carry. */
export type AttemptLogin = Pick<IInitializedLiveScrape, 'credentials' | 'tokenWatch'>;

/**
 * Builds the watch on the token one attempt sends.
 * @param captureParams - Account key and logger for this attempt.
 * @param sentToken - Whether the attempt's credentials carry a long-term token.
 * @returns The attempt's token watch.
 */
function watchOf(captureParams: IAuthFlowCaptureParams, sentToken: boolean): IWarmTokenWatch {
  return { storeKey: captureParams.storeKey, logger: captureParams.logger, sentToken };
}

/**
 * Builds an API-direct attempt's credentials from the token the store vouches for.
 *
 * The token is read afresh on every attempt. When one is sent, the retriever
 * warns before a cold login asks for a code, since that means it was not accepted.
 * @param captureParams - Account key, login, store and logger for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, and whether they carry a token.
 */
function warmLogin(
  captureParams: IAuthFlowCaptureParams, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  const canAskForOtp = retriever !== undefined;
  const loginConfig = resolveWarmToken(captureParams, { bankConfig, canAskForOtp });
  const tokenWatch = watchOf(captureParams, loginConfig.otpLongTermToken !== undefined);
  const watched = watchRetriever(tokenWatch, retriever);
  return { credentials: buildCredentials(loginConfig, watched), tokenWatch };
}

/**
 * Builds the credentials one attempt logs in with.
 *
 * API-direct entries go through `warmLogin`. Browser banks never read
 * the store, so their entry is used as configured and sends no token.
 * @param captureParams - Account key, login, store and logger for this attempt.
 * @param bankConfig - The entry as configured.
 * @param retriever - The attempt's OTP retriever, when it can ask for an SMS code.
 * @returns Provider credentials for this attempt, and whether they carry a token.
 */
export default function credentialsFor(
  captureParams: IAuthFlowCaptureParams, bankConfig: IBankConfig, retriever: OtpRetriever,
): AttemptLogin {
  if (isApiDirectBank(captureParams.companyType)) {
    return warmLogin(captureParams, bankConfig, retriever);
  }
  const tokenWatch = watchOf(captureParams, false);
  return { credentials: buildCredentials(bankConfig, retriever), tokenWatch };
}
