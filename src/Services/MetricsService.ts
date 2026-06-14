/**
 * Compatibility facade for legacy `MetricsService` imports. The real
 * implementation lives in `./Metrics/Index.ts`; this barrel preserves
 * the public path so 12 production + 8 test consumers keep working
 * without an import migration.
 * @public
 */
export type {
  IAccountMetrics,
  IAccountTransactionsRecord,
  IBankMetrics,
  IImportSummary,
  ITransactionRecord,
} from './Metrics/Index.js';
export { MetricsService } from './Metrics/Index.js';
