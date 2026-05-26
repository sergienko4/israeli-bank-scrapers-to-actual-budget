/**
 * SlashCommandRoutes — declarative table of the 12 slash-command entries plus
 * the `scan:` prefix and the `scan_all` callback. Each route closes over an
 * injected handler function bound on the TelegramCommandHandler instance.
 *
 * Empty string ('') is used as the "no argument" sentinel — keeps return /
 * parameter type annotations free of `| undefined` (forbidden by ESLint).
 */

import type { CommandHandler, ICommandRoute } from './ICommandRoute.js';
import { makeExactRoute, makePrefixRoute } from './ICommandRoute.js';

/** Handler signature returning a Procedure carrying a status string. */
export type SlashHandler = CommandHandler;

/** Bundle of stateful handlers bound on the TelegramCommandHandler instance. */
export interface ISlashHandlers {
  /** Handles /scan, /import, and the `scan:` prefix callback. */
  readonly handleScan: SlashHandler;
  /** Handles the `scan_all` callback. */
  readonly handleScanAll: SlashHandler;
  /** Handles /status. */
  readonly handleStatus: SlashHandler;
  /** Handles /logs (optionally with a count arg). */
  readonly handleLogs: SlashHandler;
  /** Handles /watch. */
  readonly handleWatch: SlashHandler;
  /** Handles /check_config. */
  readonly handleCheckConfig: SlashHandler;
  /** Handles /preview. */
  readonly handlePreview: SlashHandler;
  /** Handles /help and /start. */
  readonly handleHelp: SlashHandler;
  /** Handles /retry. */
  readonly handleRetry: SlashHandler;
  /** Handles /import_receipt. */
  readonly handleImportReceipt: SlashHandler;
}

/** Literal prefix recognised for inline-keyboard scan callbacks. */
const SCAN_PREFIX = 'scan:';

/** Declarative table of exact-match patterns → handler bundle keys. */
const EXACT_ROUTE_DEFS: readonly (readonly [string, keyof ISlashHandlers])[] = [
  ['/scan', 'handleScan'],
  ['/import', 'handleScan'],
  ['/status', 'handleStatus'],
  ['/logs', 'handleLogs'],
  ['/watch', 'handleWatch'],
  ['/check_config', 'handleCheckConfig'],
  ['/preview', 'handlePreview'],
  ['/help', 'handleHelp'],
  ['/retry', 'handleRetry'],
  ['/start', 'handleHelp'],
  ['/import_receipt', 'handleImportReceipt'],
  ['scan_all', 'handleScanAll'],
];

/**
 * Builds the route table for slash commands + scan_all + the scan: prefix.
 * @param h - Bound handler bundle (closing over the handler instance state).
 * @returns Frozen, ordered array of routes (exact entries first).
 */
export function buildSlashCommandRoutes(
  h: ISlashHandlers,
): readonly ICommandRoute[] {
  const exactRoutes = EXACT_ROUTE_DEFS.map(([pattern, handlerKey]) =>
    makeExactRoute(pattern, h[handlerKey]),
  );
  const routes: ICommandRoute[] = [...exactRoutes, makePrefixRoute(SCAN_PREFIX, h.handleScan)];
  return Object.freeze(routes);
}
