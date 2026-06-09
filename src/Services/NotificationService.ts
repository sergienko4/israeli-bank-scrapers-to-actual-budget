/**
 * NotificationService - Orchestrator that delegates to two pure modules:
 *   - {@link buildEnabledNotifiers} (gate): config → INotifier[]
 *   - {@link dispatchToAll} (dispatcher): parallel send + count
 *
 * Public API (constructor + 3 send methods) is preserved byte-identical
 * for all consumers (`Index.ts`, `LiveScrapeStrategy`, `PipelineContext`,
 * `ContextFactory`). Notification failures never break imports.
 *
 * Pattern A (validated on smallest service first per `spec.md` PR 4).
 */

import type { INotificationConfig, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { IImportSummary } from './MetricsService.js';
import type { INotifier } from './Notifications/INotifier.js';
import { dispatchToAll } from './Notifications/NotificationDispatcher.js';
import buildEnabledNotifiers from './Notifications/NotificationGate.js';

/** Orchestrates sending notifications to all configured channels (Telegram, webhook). */
export default class NotificationService {
  private readonly _notifiers: INotifier[];

  /**
   * Creates a NotificationService, building the active notifier list from
   * the {@link buildEnabledNotifiers} gate.
   *
   * @param config - Optional notification configuration with channel-specific settings.
   */
  constructor(config?: INotificationConfig) {
    this._notifiers = buildEnabledNotifiers(config);
  }

  /**
   * Sends an import summary notification to all registered channels.
   * @param summary - The ImportSummary to broadcast.
   * @returns Procedure with the count of notifiers that succeeded.
   */
  public async sendSummary(summary: IImportSummary): Promise<Procedure<{ sent: number }>> {
    return await dispatchToAll(this._notifiers, async (n) => {
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
    return await dispatchToAll(this._notifiers, async (n) => {
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
    return await dispatchToAll(this._notifiers, async (n) => {
      await n.sendMessage(text);
      return succeed({ sent: true });
    });
  }
}

