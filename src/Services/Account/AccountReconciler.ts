/**
 * AccountReconciler — runs the balance-reconciliation flow for a single account.
 *
 * Encapsulates the rules that decide WHEN to reconcile (target.reconcile flag and
 * a known balance), the call into ReconciliationService, the log message lookup,
 * and the per-bank metrics recording. AccountImporter delegates to this helper so
 * the orchestration class stays focused on flow control.
 */
import { getLogger } from '../../Logger/Index.js';
import type { IBankTarget } from '../../Types/Index.js';
import { isFail } from '../../Types/Index.js';
import type { MetricsService } from '../MetricsService.js';
import type { ReconciliationService } from '../ReconciliationService.js';

/**
 * Formats a reconciliation message with the signed ILS adjustment amount.
 * @param diff - The reconciliation diff in cents.
 * @returns Formatted reconciliation log string.
 */
const FORMAT_CREATED = (diff: number): string =>
  `     ✅ Reconciled: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)} ILS`;

/**
 * Returns the "already balanced" status message.
 * @returns Log string for a balanced account.
 */
const FORMAT_SKIPPED = (): string => '     ✅ Already balanced';

/**
 * Returns the "already reconciled today" status message.
 * @returns Log string for an already-reconciled account.
 */
const FORMAT_ALREADY_RECONCILED = (): string => '     ✅ Already reconciled today';

/** Status-keyed log-message lookup for reconciliation outcomes (OCP — add without branching). */
const RECONCILIATION_MESSAGES = new Map<string, (diff: number) => string>([
  ['created', FORMAT_CREATED],
  ['skipped', FORMAT_SKIPPED],
  ['already-reconciled', FORMAT_ALREADY_RECONCILED],
]);

/**
 * Banks known to return unreliable or missing balance data.
 * API-direct flows (oneZero, pepper, payBox) may return balance:0
 * when balance is unknown, which would incorrectly zero out accounts.
 */
const UNRELIABLE_BALANCE_BANKS = new Set(['oneZero', 'pepper', 'payBox', 'paybox']);

/** Context passed to AccountReconciler.reconcileIfConfigured. */
export interface IReconcileCtx {
  /** Actual Budget account ID to reconcile. */
  actualAccountId: string;
  /** Scraped balance in currency units, or undefined when unknown. */
  balance: number | undefined;
  /** Currency code (e.g. 'ILS') for the reconciliation transaction. */
  currency: string;
  /** Bank name for metrics tagging. */
  bankName: string;
}

/** Services injected into AccountReconciler. */
export interface IAccountReconcilerOpts {
  /** Reconciliation service for balance-adjustment transactions. */
  reconciliationService: ReconciliationService;
  /** Metrics service for per-bank reconciliation recording. */
  metrics: MetricsService;
}

/** Runs the per-account balance reconciliation flow with side-effecting log + metrics. */
export class AccountReconciler {
  /**
   * Creates an AccountReconciler with the given service dependencies.
   * @param opts - All services needed for the reconciliation flow.
   */
  constructor(private readonly opts: IAccountReconcilerOpts) {}

  /**
   * Runs reconciliation when the target's reconcile flag is true and balance is known.
   * @param target - The IBankTarget whose reconcile flag and account ID are used.
   * @param ctx - Context with the actual account ID, balance, currency, and bank name.
   */
  public async reconcileIfConfigured(target: IBankTarget, ctx: IReconcileCtx): Promise<void> {
    if (!target.reconcile || ctx.balance === undefined) return;
    if (UNRELIABLE_BALANCE_BANKS.has(ctx.bankName) && ctx.balance === 0) {
      getLogger().info('     ⚠️  Skipping reconcile: balance=0 from API-direct bank (unreliable)');
      return;
    }
    getLogger().info('     🔄 Reconciling account balance...');
    const result = await this.opts.reconciliationService.reconcile(
      ctx.actualAccountId, ctx.balance, ctx.currency,
    );
    if (isFail(result)) {
      getLogger().error(`     ❌ Reconciliation error: ${result.message}`);
      return;
    }
    this.opts.metrics.recordReconciliation(ctx.bankName, result.data.status, result.data.diff);
    AccountReconciler.logReconciliationOutcome(result.data.status, result.data.diff);
  }

  /**
   * Looks up the status-specific log message and emits it; warns on unknown statuses.
   * @param status - The reconciliation outcome status returned by ReconciliationService.
   * @param diff - The reconciliation diff in cents (signed) used by the formatter.
   */
  private static logReconciliationOutcome(status: string, diff: number): void {
    const messageBuilder = RECONCILIATION_MESSAGES.get(status);
    if (messageBuilder === undefined) {
      getLogger().warn(`     ⚠️  Unknown reconciliation status: ${status}`);
      return;
    }
    const formattedMessage = messageBuilder(diff);
    getLogger().info(formattedMessage);
  }
}
