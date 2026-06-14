/**
 * Shared interface types for the Telegram formatter cluster.
 * Consumed by every format module and the public Index re-export.
 */
import type { ShowTransactions } from '../../../Types/Index.js';
import type { IAccountMetrics, IBankMetrics } from '../../MetricsService.js';

/** Options controlling which transactions appear in the formatted message. */
export interface IFormatOpts {
  /** Maximum transactions to display per account. */
  showTransactions: ShowTransactions;
  /** Cap on the number of transactions shown. */
  maxTransactions: number;
}

/** Combined context for rendering a single account's lines. */
export interface IAccountCtx {
  /** The bank this account belongs to. */
  bank: IBankMetrics;
  /** The account being rendered. */
  account: IAccountMetrics;
  /** Transaction display options. */
  opts: IFormatOpts;
}
