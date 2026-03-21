/**
 * NotificationService - Orchestrates sending notifications to all enabled channels
 * Follows Open/Closed Principle: Add new notifiers without modifying this class
 *
 * Design: Single `enabled` flag. Any channel with valid config present = active.
 * Notification failures never break imports (all errors caught and logged).
 */

import { getLogger } from '../Logger/Index.js';
import type { INotificationConfig, Procedure } from '../Types/Index.js';
import { fail,succeed } from '../Types/Index.js';
import type { IImportSummary } from './MetricsService.js';
import type { INotifier } from './Notifications/INotifier.js';
import TelegramNotifier from './Notifications/TelegramNotifier.js';
import WebhookNotifier from './Notifications/WebhookNotifier.js';

/** Action that calls a notifier and returns a status Procedure. */
type NotifyAction = (n: INotifier) => Promise<Procedure<{ sent: boolean }>>;

/** Orchestrates sending notifications to all configured channels (Telegram, webhook). */
export default class NotificationService {
  private readonly _notifiers: INotifier[] = [];

  /**
   * Creates a NotificationService, registering notifiers for each enabled channel.
   * @param config - Optional notification configuration with channel-specific settings.
   */
  constructor(config?: INotificationConfig) {
    if (!config?.enabled) return;
    if (config.telegram) {
      this._notifiers.push(new TelegramNotifier(config.telegram, config.maxTransactions));
      getLogger().info('📱 Telegram notifications enabled');
    }
    if (config.webhook) {
      this._notifiers.push(new WebhookNotifier(config.webhook));
      getLogger().info(`🔗 Webhook notifications enabled (${config.webhook.format || 'plain'})`);
    }
  }

  /**
   * Sends an import summary notification to all registered channels.
   * @param summary - The ImportSummary to broadcast.
   * @returns Procedure with the count of notifiers that succeeded.
   */
  public async sendSummary(summary: IImportSummary): Promise<Procedure<{ sent: number }>> {
    return this.notifyAll(async (n) => {
      await n.sendSummary(summary);
      return succeed({ sent: true });
    });
  }

  /**
   * Sends an error notification to all registered channels.
   * @param error - The error message string to broadcast.
   * @returns Procedure with the count of notifiers that succeeded.
   */
  public async sendError(error: string): Promise<Procedure<{ sent: number }>> {
    return this.notifyAll(async (n) => {
      await n.sendError(error);
      return succeed({ sent: true });
    });
  }

  /**
   * Sends a plain text message to all registered channels.
   * @param text - The text to broadcast.
   * @returns Procedure with the count of notifiers that succeeded.
   */
  public async sendMessage(text: string): Promise<Procedure<{ sent: number }>> {
    return this.notifyAll(async (n) => {
      await n.sendMessage(text);
      return succeed({ sent: true });
    });
  }

  /**
   * Runs the given action on all registered notifiers in parallel.
   * @param action - Async function to call on each INotifier.
   * @returns Procedure with the count of fulfilled notifiers.
   */
  private async notifyAll(
    action: NotifyAction
  ): Promise<Procedure<{ sent: number }>> {
    if (this._notifiers.length === 0) return succeed({ sent: 0 });
    const promises = this._notifiers.map(action);
    const results = await Promise.allSettled(promises);
    const count = NotificationService.countAndLogFailures(results);
    if (count === 0) return fail('all notifiers failed');
    return succeed({ sent: count });
  }

  /**
   * Counts fulfilled results and logs each rejected result.
   * @param results - Settled promise results from notifier calls.
   * @returns Number of fulfilled (successful) notifier calls.
   */
  private static countAndLogFailures(
    results: PromiseSettledResult<Procedure<{ sent: boolean }>>[]
  ): number {
    let fulfilled = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        fulfilled++;
      } else {
        const msg = result.reason instanceof Error
          ? result.reason.message : String(result.reason);
        getLogger().error(`⚠️  Notification failed: ${msg}`);
      }
    }
    return fulfilled;
  }
}
