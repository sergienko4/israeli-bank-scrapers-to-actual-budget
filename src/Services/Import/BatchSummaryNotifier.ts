/**
 * BatchSummaryNotifier — single-purpose dispatcher for aggregate
 * batch-completion summaries.
 *
 * Extracted from ImportMediator so the icon/format/null-notifier
 * concerns are isolated from job-orchestration logic. The notifier
 * dependency is injected (per P6 DI rule) so this module never
 * imports a concrete Telegram/Webhook implementation — it only
 * knows the INotifier contract.
 *
 * Returns Procedure<{ status }> per P1 (Result Pattern) so failure
 * modes (`no-notifier` / `notifier-threw` / `sent`) are explicit
 * rather than swallowed silently.
 */

import { getLogger } from '../../Logger/Index.js';
import type { IBatchResult, Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { INotifier } from '../Notifications/INotifier.js';

/** Sends aggregate batch summaries through an injected notifier. */
export default class BatchSummaryNotifier {
  /**
   * Creates a BatchSummaryNotifier bound to an optional notifier.
   * @param _notifier - INotifier instance, or null to disable summaries.
   */
  constructor(private readonly _notifier: INotifier | null) {}

  /**
   * Sends an aggregate summary notification for the completed batch.
   * @param batch - The IBatchResult to summarize.
   * @returns Procedure with status: `no-notifier`, `sent`, or `notifier-threw`.
   */
  public async send(
    batch: IBatchResult
  ): Promise<Procedure<{ status: string }>> {
    if (!this._notifier) return succeed({ status: 'no-notifier' });
    const msg = BatchSummaryNotifier.formatMessage(batch);
    try {
      await this._notifier.sendMessage(msg);
      return succeed({ status: 'sent' });
    } catch (err: unknown) {
      getLogger().debug(
        `Failed to send batch summary: ${errorMessage(err)}`
      );
      return succeed({ status: 'notifier-threw' });
    }
  }

  /**
   * Formats the batch result into a single-line summary message.
   * Pure (no I/O, no side effects) so the format can be unit-tested
   * independently of the notifier dispatch.
   * @param batch - The IBatchResult to format.
   * @returns The summary line ready for sendMessage.
   */
  private static formatMessage(batch: IBatchResult): string {
    const dur = (batch.totalDurationMs / 1000).toFixed(0);
    const icon = batch.failureCount === 0 ? '\u2705' : '\u26a0\ufe0f';
    const ok = batch.successCount;
    const total = batch.jobs.length;
    return `${icon} Batch complete: ${String(ok)}/${String(total)} banks OK (${dur}s)`;
  }
}
