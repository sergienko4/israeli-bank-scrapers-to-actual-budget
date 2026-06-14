/**
 * Re-exports the MetricsService public surface.
 *
 * @public
 */
export { default as MetricsService } from './Registry.js';
export type {
  IAccountMetrics,
  IAccountTransactionsRecord,
  IBankMetrics,
  IImportSummary,
  ITransactionRecord,
} from './Types.js';
