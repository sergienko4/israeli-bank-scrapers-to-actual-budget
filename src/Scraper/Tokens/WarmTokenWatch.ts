/**
 * Warns when an API-direct login sent a long-term token and it did not log in.
 *
 * <p>Upstream reports a refused warm token only to its own logger. No result
 * field or callback says the login fell back to an SMS, so the importer reads
 * two signs it does see. The attempt's SMS-code retriever is called, which
 * happens only on a cold login. Or, with no retriever, the attempt fails with
 * `TWO_FACTOR_RETRIEVER_MISSING`. An attempt that sent no token never warns
 * here; the resolver already said why it sent none. The watch names where the
 * token came from and holds its digest, never the token, so no warning can
 * show it.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';

/** Where a long-term token an attempt sent came from. */
export type WarmTokenSource = 'stored' | 'configured';

/** Which long-term token an attempt sent: none, or its source and digest, never the token. */
export type WarmTokenDecision =
  | { readonly source: 'none' }
  | { readonly source: WarmTokenSource; readonly digest: string };

/** The decision of an attempt that sent no long-term token. */
export const NO_TOKEN_SENT: WarmTokenDecision = Object.freeze({ source: 'none' });

/** What one attempt sent, so its warnings can tell whether the token was accepted. */
export interface IWarmTokenWatch {
  /** The account's key in the token store, named in every warning. */
  readonly storeKey: string;
  readonly logger: ILogger;
  /** Which long-term token the attempt sent, if any. */
  readonly decision: WarmTokenDecision;
}

/** SMS-code retriever a cold login calls; undefined when the run cannot ask for a code. */
export type Retriever = (() => Promise<string>) | undefined;

/** Whether an attempt's watched retriever has warned yet. */
interface IWarnedBox {
  hasWarned: boolean;
}

/**
 * Tells whether an attempt sent a long-term token.
 * @param watch - The attempt's watch.
 * @returns True when its credentials carried a token.
 */
export function hasSentToken(watch: IWarmTokenWatch): boolean {
  return watch.decision.source !== 'none';
}

/**
 * Names an attempt's token in a warning, without the token.
 * @param watch - The attempt's watch.
 * @returns The phrase `The long-term token for <key> was not accepted`.
 */
function notAcceptedOf(watch: IWarmTokenWatch): string {
  return `  ⚠️  The long-term token for ${watch.storeKey} was not accepted`;
}

/**
 * Warns on the first code request only, however often the login asks.
 * @param watch - The attempt's watch.
 * @param box - Whether this attempt has warned yet.
 * @returns True when this call logged the warning.
 */
function warnOnce(watch: IWarmTokenWatch, box: IWarnedBox): boolean {
  if (box.hasWarned) return false;
  box.hasWarned = true;
  watch.logger.warn(`${notAcceptedOf(watch)}, so this run logs in with an SMS code`);
  return true;
}

/**
 * Wraps an attempt's retriever so a cold login after a sent token warns first.
 * @param watch - The attempt's watch.
 * @param retriever - The attempt's retriever, if it can ask for a code.
 * @returns The watched retriever, or the same one when there is nothing to watch.
 */
export function watchRetriever(watch: IWarmTokenWatch, retriever: Retriever): Retriever {
  if (!hasSentToken(watch) || retriever === undefined) return retriever;
  const box: IWarnedBox = { hasWarned: false };
  return async (): Promise<string> => {
    warnOnce(watch, box);
    return await retriever();
  };
}

/**
 * Warns, with the fix, when a sent token did not log in and no code could be asked for.
 * @param watch - The attempt's watch.
 * @param result - The attempt's provider result.
 * @returns True when the warning was logged.
 */
export function warnIfNotAccepted(watch: IWarmTokenWatch, result: IScraperScrapingResult): boolean {
  const isStuck = String(result.errorType) === 'TWO_FACTOR_RETRIEVER_MISSING';
  if (!hasSentToken(watch) || !isStuck) return false;
  watch.logger.warn(
    `${notAcceptedOf(watch)}, and this run cannot ask for an SMS code: `
    + 'turn on twoFactorAuth for one SMS login',
  );
  return true;
}
