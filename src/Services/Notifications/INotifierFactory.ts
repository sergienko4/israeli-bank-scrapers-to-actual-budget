/**
 * INotifierFactory — Open/Closed Principle contract for notification channels.
 *
 * Replaces the `if (config.telegram) push(new Telegram...)` / `if (config.webhook)
 * push(new Webhook...)` chain in `NotificationService` with a registry of
 * self-describing factories. Adding a new channel = registering one new
 * factory; `NotificationService` never changes.
 */
import type { INotificationConfig } from '../../Types/Index.js';
import type { INotifier } from './INotifier.js';

export interface INotifierFactory {
  /** Stable channel name used for logging (e.g. "telegram"). */
  readonly name: string;

  /**
   * Predicate that decides whether this factory should produce a notifier
   * for the given notification config.
   * @param config - The full INotificationConfig block.
   * @returns True if this channel's sub-block is present in the config.
   */
  applies(config: INotificationConfig): boolean;

  /**
   * Constructs the concrete INotifier for this channel.
   * Only called when {@link INotifierFactory.applies} returns true.
   * @param config - The full INotificationConfig block.
   * @returns A fully constructed INotifier ready to send messages.
   */
  create(config: INotificationConfig): INotifier;

  /**
   * Human-readable log line emitted after the notifier is registered.
   * @param config - The same config passed to {@link INotifierFactory.create}.
   * @returns A short user-facing message (e.g. "📱 Telegram notifications enabled").
   */
  describe(config: INotificationConfig): string;
}
