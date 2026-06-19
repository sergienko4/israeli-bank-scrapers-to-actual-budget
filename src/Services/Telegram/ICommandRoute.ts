/**
 * ICommandRoute — declarative shape for one Telegram command/callback route.
 * Used by CommandRouter to dispatch parsed commands to handlers.
 */

import type { Procedure } from '../../Types/Index.js';
import { extractPrefixPayload } from './CommandCallbackParser.js';

/** Match mode for a declarative command route. */
export type CommandMatchMode = 'exact' | 'prefix';

/** Handler signature for a route entry. Receives the parsed argument string. */
export type CommandHandler = (
  arg: string,
) => Promise<Procedure<{ status: string }>>;

/**
 * Declarative route entry — a tuple of (pattern, matcher, parser, handler).
 * `arg` is always a string: empty string ('') means "no argument supplied".
 * Likewise `parse` returns '' to indicate "no payload after the prefix".
 */
export interface ICommandRoute {
  /** How `pattern` should be matched against the incoming command. */
  readonly match: CommandMatchMode;
  /** Literal pattern (e.g. '/scan' or 'receipt_acc:'). */
  readonly pattern: string;
  /** Optional payload extractor. Returns '' when no payload is present. */
  readonly parse?: (raw: string) => string;
  /** Handler invoked when this route matches. */
  readonly handle: CommandHandler;
}

/**
 * Builds an exact-match route. Used by both slash and receipt route definitions.
 * @param pattern - Literal pattern to match (e.g. '/status').
 * @param handler - Handler invoked with the parsed argument.
 * @returns Frozen ICommandRoute entry.
 */
export function makeExactRoute(
  pattern: string,
  handler: CommandHandler,
): ICommandRoute {
  return Object.freeze({
    match: 'exact' as const,
    pattern,
    handle: handler,
  });
}

/**
 * Builds a prefix-match route with standard payload extraction.
 * @param prefix - Literal prefix to match (e.g. 'scan:' or 'receipt_acc:').
 * @param handler - Handler invoked with the extracted payload ('' when missing).
 * @returns Frozen ICommandRoute entry.
 */
export function makePrefixRoute(prefix: string, handler: CommandHandler): ICommandRoute {
  return Object.freeze({
    match: 'prefix' as const,
    pattern: prefix,
    parse: prefixParser(prefix),
    handle: handler,
  });
}

/**
 * Builds the standard payload extractor closure for a prefix route.
 * @param prefix - Literal prefix whose trailing payload should be extracted.
 * @returns A parser returning the payload after `prefix`, or '' when missing.
 */
function prefixParser(prefix: string): (raw: string) => string {
  return (raw: string): string => extractPrefixPayload(raw, prefix);
}
