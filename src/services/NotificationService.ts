/**
 * NotificationService - Orchestrates sending notifications to all enabled channels
 * Follows Open/Closed Principle: Add new notifiers without modifying this class
 *
 * Design: Single `enabled` flag. Any channel with valid config present = active.
 * Notification failures never break imports (all errors caught and logged).
 */

import { NotificationConfig } from '../types/index.js';
import { ImportSummary } from './MetricsService.js';
import { INotifier } from './notifications/INotifier.js';
import { TelegramNotifier } from './notifications/TelegramNotifier.js';
import { WebhookNotifier } from './notifications/WebhookNotifier.js';
import { getLogger } from '../logger/index.js';

export class NotificationService {
  private notifiers: INotifier[] = [];

  constructor(config?: NotificationConfig) {
    if (!config?.enabled) return;
    if (config.telegram) {
      this.notifiers.push(new TelegramNotifier(config.telegram, config.maxTransactions));
      getLogger().info('📱 Telegram notifications enabled');
    }
    if (config.webhook) {
      this.notifiers.push(new WebhookNotifier(config.webhook));
      getLogger().info(`🔗 Webhook notifications enabled (${config.webhook.format || 'plain'})`);
    }
  }

  async sendSummary(summary: ImportSummary): Promise<void> {
    await this.notifyAll(n => n.sendSummary(summary));
  }

  async sendError(error: string): Promise<void> {
    await this.notifyAll(n => n.sendError(error));
  }

  async sendMessage(text: string): Promise<void> {
    await this.notifyAll(n => n.sendMessage(text));
  }

  private async notifyAll(action: (n: INotifier) => Promise<void>): Promise<void> {
    if (this.notifiers.length === 0) return;
    const results = await Promise.allSettled(this.notifiers.map(action));
    for (const result of results) {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        getLogger().error(`⚠️  Notification failed: ${msg}`);
      }
    }
  }
}
