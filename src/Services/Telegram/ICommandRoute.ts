/**
 * ICommandRoute — declarative shape for one Telegram command/callback route.
 * Used by CommandRouter to dispatch parsed commands to handlers.
 */

import type { Procedure } from '../../Types/Index.js';

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
