/**
 * Public dispatch entry-point for the Telegram formatter cluster.
 * Selects the appropriate format style (default/compact/ledger/emoji)
 * and delegates to the corresponding format module.
 */
import type { MessageFormat } from '../../../Types/Index.js';
import type { IImportSummary } from '../../MetricsService.js';
import { formatCompact } from './CompactFormat.js';
import { formatDefault } from './DefaultFormat.js';
import { formatEmoji } from './EmojiFormat.js';
import { formatLedger } from './LedgerFormat.js';
import type { IFormatOpts } from './Types.js';

export type { IFormatOpts } from './Types.js';

/**
 * Builds the format-style dispatch table keyed by MessageFormat.
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns Keyed record of named format functions.
 */
function buildFormatDispatch(
  summary: IImportSummary, opts: IFormatOpts
): Record<string, () => string> {
  return {
    /**
     * Formats as compact style (A).
     * @returns HTML compact message.
     */
    compact: () => formatCompact(summary, opts),
    /**
     * Formats as ledger style (B).
     * @returns HTML ledger message.
     */
    ledger: () => formatLedger(summary, opts),
    /**
     * Formats as emoji style (C).
     * @returns HTML emoji message.
     */
    emoji: () => formatEmoji(summary, opts),
    /**
     * Formats as default summary style (D).
     * @returns HTML summary message.
     */
    summary: () => formatDefault(summary),
  };
}

/**
 * Formats an import summary into an HTML Telegram message using the configured format.
 * @param summary - The ImportSummary to format.
 * @param format - The MessageFormat key (summary/compact/ledger/emoji).
 * @param opts - Transaction display options.
 * @returns HTML-formatted string ready to send to Telegram.
 */
export function formatSummaryMessage(
  summary: IImportSummary, format: MessageFormat, opts: IFormatOpts
): string {
  const dispatch = buildFormatDispatch(summary, opts);
  const formatter = dispatch[format] ?? dispatch.summary;
  return formatter();
}

export { escapeHtml } from './Shared.js';
