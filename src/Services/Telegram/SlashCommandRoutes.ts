/**
 * SlashCommandRoutes — declarative table of the 12 slash-command entries plus
 * the `scan:` prefix and the `scan_all` callback. Each route closes over an
 * injected handler function bound on the TelegramCommandHandler instance.
 *
 * Empty string ('') is used as the "no argument" sentinel — keeps return /
 * parameter type annotations free of `| undefined` (forbidden by ESLint).
 */

import type { Procedure } from '../../Types/Index.js';
import { extractPrefixPayload } from './CommandCallbackParser.js';
import type { CommandHandler, ICommandRoute } from './ICommandRoute.js';

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
    exact('/scan', h.handleScan),
    exact('/import', h.handleScan),
    exact('/status', h.handleStatus),
    exact('/logs', h.handleLogs),
    exact('/watch', h.handleWatch),
    exact('/check_config', h.handleCheckConfig),
    exact('/preview', h.handlePreview),
    exact('/help', h.handleHelp),
    exact('/retry', h.handleRetry),
    exact('/start', h.handleHelp),
    exact('/import_receipt', h.handleImportReceipt),
    exact('scan_all', h.handleScanAll),
    scanPrefixRoute(h.handleScan),
  ];
  return Object.freeze(routes);
}

/**
 * Builds an exact-match route bound to the supplied handler.
 * The router forwards the parsed `arg` (whitespace remainder) to the handler.
 * @param pattern - Exact command literal (e.g. `/scan`).
 * @param fn - Bound handler function.
 * @returns Frozen ICommandRoute entry.
 */
function exact(
  pattern: string,
  fn: SlashHandler,
): ICommandRoute {
  return Object.freeze({
    match: 'exact' as const,
    pattern,
    /**
     * Invokes the bound handler with the parsed argument.
     * @param arg - Command argument string ('' when none).
     * @returns Procedure result from the bound handler.
     */
    handle: async (arg: string): Promise<Procedure<{ status: string }>> => await fn(arg),
  });
}

/**
 * Builds the `scan:` prefix route. Payload extraction uses
 * {@link extractPrefixPayload} so no magic numbers leak in.
 * @param fn - Bound handleScan.
 * @returns Frozen ICommandRoute entry for the `scan:` prefix.
 */
function scanPrefixRoute(
  fn: SlashHandler,
): ICommandRoute {
  return Object.freeze({
    match: 'prefix' as const,
    pattern: SCAN_PREFIX,
    /**
     * Extracts the bank name following the `scan:` prefix.
     * @param raw - Trimmed raw command string.
     * @returns Bank name payload, or '' when missing.
     */
    parse: (raw: string): string => extractPrefixPayload(raw, SCAN_PREFIX),
    /**
     * Invokes handleScan with the resolved bank name.
     * @param arg - Bank name payload ('' when missing).
     * @returns Procedure result from handleScan.
     */
    handle: async (arg: string): Promise<Procedure<{ status: string }>> => await fn(arg),
  });
}
