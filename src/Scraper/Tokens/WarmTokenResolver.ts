/**
 * Resolves which long-term token a warm start should replay.
 *
 * <p>Two sources can supply one. `config.otpLongTermToken` is the bootstrap
 * seed an operator pastes once; the token store holds whatever the most
 * recent successful login captured. The store wins whenever it holds a value,
 * because the bank re-mints the artifact on every cold login and revokes the
 * one it replaces — so a config seed goes stale the first time a cold login
 * runs, while the stored copy is by construction the live one.
 *
 * <p>Neither value is ever logged. Which source was used is logged, because
 * that single fact is what distinguishes "warm start is working" from "the
 * operator's seed is being replayed forever" during triage.
 */

import type { IBankConfig } from '../../Types/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import { isApiDirectBank } from './AuthFlowCapture.js';

/**
 * Collaborators the resolver needs beyond the bank config itself.
 *
 * <p>Deliberately the same bundle the capture path uses. Both sides must
 * address the identical store key, and an earlier defect — writing under one
 * identifier and reading under another — survived unit tests precisely
 * because the two paths built their keys independently. Sharing one bundle
 * makes that divergence unrepresentable.
 */
export type IWarmTokenParams = IAuthFlowCaptureParams;

/**
 * Returns a bank config whose warm-start token is the freshest one available.
 *
 * <p>The input is never mutated: the caller's config is shared with the rest
 * of the run, and a token written into it would outlive this scrape.
 *
 * <p>The lookup key is `params.storeKey`, the one the capture path writes
 * under. Reading `bankConfig.id` instead would silently miss every stored
 * token whenever the two differ.
 * @param bankConfig - Bank config carrying the operator's bootstrap seed.
 * @param params - Token store, bank identity and logger for this bank.
 * @returns The same config when nothing changes, or a copy carrying the token.
 */
export function withWarmToken(
  bankConfig: IBankConfig, params: IWarmTokenParams,
): IBankConfig {
  if (!isApiDirectBank(params.companyType)) return bankConfig;
  const stored = params.store.read(params.storeKey);
  if (stored.length === 0) return reportSeed(bankConfig, params);
  params.logger.info(
    `  🔑 Replaying the stored long-term token for ${params.bankId} — no SMS expected`,
  );
  return { ...bankConfig, otpLongTermToken: stored };
}

/**
 * Reports that the run is falling back to the operator's config seed.
 * @param bankConfig - Bank config carrying the operator's bootstrap seed.
 * @param params - Token store, bank identity and logger for this bank.
 * @returns The caller's config, unchanged.
 */
function reportSeed(bankConfig: IBankConfig, params: IWarmTokenParams): IBankConfig {
  const seed = bankConfig.otpLongTermToken ?? '';
  if (seed.length > 0) {
    params.logger.info(`  🔑 Using the configured long-term token for ${params.bankId}`);
    return bankConfig;
  }
  params.logger.info(
    `  📩 No long-term token for ${params.bankId} yet — expect one SMS this run`,
  );
  return bankConfig;
}
