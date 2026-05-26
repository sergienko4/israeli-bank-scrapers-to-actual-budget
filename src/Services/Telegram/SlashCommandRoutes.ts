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

/**
 * Builds the route table for slash commands + scan_all + the scan: prefix.
 * @param h - Bound handler bundle (closing over the handler instance state).
 * @returns Frozen, ordered array of routes (exact entries first).
 */
export function buildSlashCommandRoutes(
  h: ISlashHandlers,
): readonly ICommandRoute[] {
  const routes: ICommandRoute[] = [
    makeExactRoute('/scan', h.handleScan),
    makeExactRoute('/import', h.handleScan),
    makeExactRoute('/status', h.handleStatus),
    makeExactRoute('/logs', h.handleLogs),
    makeExactRoute('/watch', h.handleWatch),
    makeExactRoute('/check_config', h.handleCheckConfig),
    makeExactRoute('/preview', h.handlePreview),
    makeExactRoute('/help', h.handleHelp),
    makeExactRoute('/retry', h.handleRetry),
    makeExactRoute('/start', h.handleHelp),
    makeExactRoute('/import_receipt', h.handleImportReceipt),
    makeExactRoute('scan_all', h.handleScanAll),
    makePrefixRoute(SCAN_PREFIX, h.handleScan),
  ];
  return Object.freeze(routes);
}
