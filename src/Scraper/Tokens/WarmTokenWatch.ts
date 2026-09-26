/**
 * Warns when an API-direct login sent a long-term token and it did not log in.
 *
 * <p>Upstream reports a refused warm token only to its own logger. No result
 * field or callback says the login fell back to an SMS, so the importer reads
 * two signs it does see. The attempt's SMS-code retriever is called, which
 * happens only on a cold login. Or, with no retriever, the attempt fails with
 * `TWO_FACTOR_RETRIEVER_MISSING`. An attempt that sent no token never warns
 * here; the resolver already said why it sent none. The watch never holds the
 * token, so no warning can show it.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';

/** What one attempt sent, so its warnings can tell whether the token was accepted. */
export interface IWarmTokenWatch {
  /** The account's key in the token store, named in every warning. */
  readonly storeKey: string;
  readonly logger: ILogger;
  /** True when the attempt sent a long-term token. */
  readonly sentToken: boolean;
}

/** SMS-code retriever a cold login calls; undefined when the run cannot ask for a code. */
type Retriever = (() => Promise<string>) | undefined;

/** Whether an attempt's watched retriever has warned yet. */
interface IWarnedBox {
  hasWarned: boolean;
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
  if (!watch.sentToken || retriever === undefined) return retriever;
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
  if (!watch.sentToken || !isStuck) return false;
  watch.logger.warn(
    `${notAcceptedOf(watch)}, and this run cannot ask for an SMS code: `
    + 'turn on twoFactorAuth for one SMS login',
  );
  return true;
}
