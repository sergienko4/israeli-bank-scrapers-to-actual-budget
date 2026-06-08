/**
 * TelegramNotifierFactory — registered with NotifierRegistry.
 *
 * Replaces the legacy `if (config.telegram) push(new TelegramNotifier(...))`
 * branch in NotificationService.
 */
import type { INotificationConfig } from '../../Types/Index.js';
import type { INotifier } from './INotifier.js';
import type { INotifierFactory } from './INotifierFactory.js';
import TelegramNotifier from './TelegramNotifier.js';

/**
 * Factory that creates a TelegramNotifier when the config contains a telegram block.
 *
 * `create` is only invoked after `applies` returns true (the registry loop
 * guarantees this), so the inner `config.telegram` access is guarded.
 */
const TELEGRAM_NOTIFIER_FACTORY: INotifierFactory = {
  name: 'telegram',
  /**
   * Decides whether this factory should produce a notifier for the given config.
   * @param config - Notification config block.
   * @returns True if `config.telegram` is truthy.
   */
  applies(config: INotificationConfig): boolean {
    return Boolean(config.telegram);
  },
  /**
   * Builds the TelegramNotifier instance. Caller must have checked {@link applies}.
   * @param config - Notification config block (must contain telegram).
   * @returns A new TelegramNotifier wired to config.telegram and maxTransactions.
   */
  create(config: INotificationConfig): INotifier {
    const telegram = config.telegram;
    if (!telegram) throw new TypeError('TelegramNotifierFactory.create called without telegram block');
    return new TelegramNotifier(telegram, config.maxTransactions);
  },
  /**
   * Returns the log line printed when this notifier is registered.
   * @param _config - Notification config block (unused for telegram).
   * @returns Stable status string for logger.info().
   */
  describe(_config: INotificationConfig): string {
    return '📱 Telegram notifications enabled';
  },
};

export default TELEGRAM_NOTIFIER_FACTORY;
