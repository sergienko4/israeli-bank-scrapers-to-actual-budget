/**
 * Live strategy OTP retriever construction.
 * @internal
 */

import type {
  ILiveScrapeDependencies,
  IOptionalOtpRetriever,
  IOtpRetrieverParams,
  IResolvedLiveOpts,
} from './Types.js';

/**
 * Resolves caller-provided OTP retrieval before constructing Telegram fallback.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns OTP retriever when one is configured for this scrape.
 */
export function resolveOtpRetriever(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts,
): IOptionalOtpRetriever {
  const params = buildOtpRetrieverParams(deps, scrapeOpts);
  return scrapeOpts.otpRetriever ?? buildOtpRetriever(params);
}

/**
 * Builds the parameter bundle used by the Telegram OTP retriever factory.
 * @param deps - Strategy dependencies captured by the public facade.
 * @param scrapeOpts - Resolved scrape options for the current bank.
 * @returns Immutable OTP retriever parameter bundle.
 */
function buildOtpRetrieverParams(
  deps: ILiveScrapeDependencies, scrapeOpts: IResolvedLiveOpts,
): IOtpRetrieverParams {
  return {
    bankId: scrapeOpts.bankId, bankConfig: scrapeOpts.bankConfig,
    prompter: deps.twoFactorPrompter, logger: scrapeOpts.logger,
  };
}

/**
 * Builds a Telegram-backed OTP retriever for 2FA banks when configured.
 * @param params - Bank, prompter, and logger inputs for retriever creation.
 * @returns OTP retriever when 2FA and a prompter are both configured.
 */
export function buildOtpRetriever(params: IOtpRetrieverParams): IOptionalOtpRetriever {
  const noRetriever: IOptionalOtpRetriever = undefined;
  const hasPrompter = params.prompter !== null;
  const isRetrieverNeeded = needsOtpRetriever(params, hasPrompter);
  if (!params.prompter || !isRetrieverNeeded) return noRetriever;
  params.logger.info(`  🔐 2FA enabled for ${params.bankId} (via Telegram)`);
  return params.prompter.createOtpRetriever(params.bankId, params.bankConfig.twoFactorTimeout);
}

/**
 * Reports whether the bank needs an OTP retriever for login fallback.
 * @param params - Bank configuration inputs for retriever decisions.
 * @param hasPrompter - True when Telegram OTP prompting is configured.
 * @returns True when 2FA and prompting are both enabled.
 */
export function needsOtpRetriever(
  params: IOtpRetrieverParams, hasPrompter: boolean,
): boolean {
  return Boolean(params.bankConfig.twoFactorAuth && hasPrompter);
}