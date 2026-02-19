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

export class NotificationService {
  private notifiers: INotifier[] = [];

  constructor(config?: NotificationConfig) {
    if (!config?.enabled) {
      return;
    }

    if (config.telegram) {
      this.notifiers.push(new TelegramNotifier(config.telegram));
      console.log('📱 Telegram notifications enabled');
    }
  }

  async sendSummary(summary: ImportSummary): Promise<void> {
    if (this.notifiers.length === 0) return;

    const results = await Promise.allSettled(
      this.notifiers.map(n => n.sendSummary(summary))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error('⚠️  Notification failed:', msg);
      }
    }
  }

  async sendError(error: string): Promise<void> {
    if (this.notifiers.length === 0) return;

    const results = await Promise.allSettled(
      this.notifiers.map(n => n.sendError(error))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error('⚠️  Notification failed:', msg);
      }
    }
  }
}
