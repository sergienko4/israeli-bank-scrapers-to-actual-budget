/** Owns bank-metrics state and exposes the MetricsService public class.
 * @internal */
import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { printImportSummary } from './Serializer.js';
import buildImportSummary from './Summary.js';
import type { IAccountTransactionsRecord, IBankMetrics, IImportSummary } from './Types.js';
/** Tracks metrics for import runs and individual banks. */
export default class MetricsService {
  private readonly _banks = new Map<string, IBankMetrics>();
  private _importStartTime = 0;
  /** Starts import tracking.
   * @returns started status. */
  public startImport(): Procedure<{ status: 'started' }> {
    this._importStartTime = Date.now();
    this._banks.clear();
    return succeed({ status: 'started' as const });
  }
  /** Starts bank tracking.
   * @param bankName bank name.
   * @returns tracking status. */
  public startBank(bankName: string): Procedure<{ status: 'tracking' }> {
    const startTime = Date.now();
    const metrics = { bankName, startTime, status: 'pending' as const,
      transactionsImported: 0, transactionsSkipped: 0, accounts: [] };
    this._banks.set(bankName, metrics);
    return succeed({ status: 'tracking' as const });
  }
  /** Records account transactions.
   * @param bankName bank name.
   * @param record account metrics.
   * @returns recorded status. */
  public recordAccountTransactions(
    bankName: string, record: IAccountTransactionsRecord
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    metrics.accounts.push({ ...record });
    return succeed({ status: 'recorded' as const });
  }
  /** Records bank success.
   * @param bankName bank name.
   * @param transactionsImported imported count.
   * @param transactionsSkipped skipped count.
   * @returns recorded status. */
  public recordBankSuccess(
    bankName: string, transactionsImported: number, transactionsSkipped: number
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    MetricsService.success(metrics, transactionsImported, transactionsSkipped);
    return succeed({ status: 'recorded' as const });
  }
  /** Records bank failure.
   * @param bankName bank name.
   * @param error failure cause.
   * @returns recorded status. */
  public recordBankFailure(bankName: string, error: Error): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    MetricsService.completeFailure(metrics, error);
    return succeed({ status: 'recorded' as const });
  }
  /** Records reconciliation status.
   * @param bankName bank name.
   * @param status reconciliation status.
   * @param amount optional amount.
   * @returns recorded status. */
  public recordReconciliation(
    bankName: string, status: NonNullable<IBankMetrics['reconciliationStatus']>, amount?: number
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    metrics.reconciliationStatus = status;
    metrics.reconciliationAmount = amount;
    return succeed({ status: 'recorded' as const });
  }
  /** Returns import summary.
   * @returns import summary. */
  public getSummary(): Procedure<IImportSummary> {
    const values = this._banks.values();
    const banks = Array.from(values);
    const summary = buildImportSummary(banks);
    return succeed(summary);
  }
  /** Prints import summary.
   * @returns printed status. */
  public printSummary(): Procedure<{ status: 'printed' }> {
    const summaryResult = this.getSummary();
    if (!summaryResult.success) return fail(summaryResult.message);
    const importDuration = Date.now() - this._importStartTime;
    printImportSummary(summaryResult.data, importDuration);
    return succeed({ status: 'printed' as const });
  }
  /** Returns bank metrics.
   * @param bankName bank name.
   * @returns bank metrics. */
  public getBankMetrics(bankName: string): Procedure<IBankMetrics> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    return succeed(metrics);
  }
  /** Checks failure state.
   * @returns failure flag. */
  public hasFailures(): Procedure<boolean> {
    const values = this._banks.values();
    const banks = Array.from(values);
    const hasFailed = banks.some(bank => bank.status === 'failure');
    return succeed(hasFailed);
  }
  /** Returns error breakdown.
   * @returns grouped errors. */
  public getErrorBreakdown(): Procedure<Record<string, number>> {
    const breakdown: Record<string, number> = {};
    for (const bank of this._banks.values()) {
      if (bank.status === 'failure' && bank.error) {
        breakdown[bank.error] = (breakdown[bank.error] || 0) + 1;
      }
    }
    return succeed(breakdown);
  }
  /** Completes a successful bank.
   * @param metrics bank metrics.
   * @param imported imported count.
   * @param skipped skipped count.
   * @returns completed metrics. */
  private static success(metrics: IBankMetrics, imported: number, skipped: number): IBankMetrics {
    MetricsService.finishMetrics(metrics, 'success');
    metrics.transactionsImported = imported;
    metrics.transactionsSkipped = skipped;
    return metrics;
  }
  /** Completes a failed bank.
   * @param metrics bank metrics.
   * @param error failure cause.
   * @returns completed metrics. */
  private static completeFailure(metrics: IBankMetrics, error: Error): IBankMetrics {
    MetricsService.finishMetrics(metrics, 'failure');
    const safeMsg = error.message ? MetricsService.redactSensitive(error.message) : '';
    metrics.error = safeMsg ? `${error.name}: ${safeMsg}` : error.name;
    return metrics;
  }
  /** Redacts sensitive credential patterns from a free-text string.
   * Matches `key=value` / `key: value` where key is a known sensitive
   * keyword; replaces value with `[REDACTED]`. Does not redact bare
   * keyword occurrences (e.g. `AuthenticationError` is preserved) per
   * `logging-pii-guidlines.md` §1 preventive-masking rule.
   * @param text input string to redact.
   * @returns redacted string. */
  private static redactSensitive(text: string): string {
    const re = /\b(password|token|secret|auth(?:orization)?|creditcard|cvv)\s*[=:]\s*\S+/gi;
    return text.replace(re, (_match, key: string) => `${key}=[REDACTED]`);
  }
  /** Marks metrics complete.
   * @param metrics bank metrics.
   * @param status final status.
   * @returns completed metrics. */
  private static finishMetrics(metrics: IBankMetrics, status: IBankMetrics['status']): IBankMetrics {
    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    metrics.status = status;
    return metrics;
  }
}
