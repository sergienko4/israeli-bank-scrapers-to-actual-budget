/**
 * WebhookNotifierFactory — registered with NotifierRegistry.
 *
 * Replaces the legacy `if (config.webhook) push(new WebhookNotifier(...))`
 * branch in NotificationService.
 */
import type { INotificationConfig } from '../../Types/Index.js';
import type { INotifier } from './INotifier.js';
import type { INotifierFactory } from './INotifierFactory.js';
import WebhookNotifier from './WebhookNotifier.js';

/**
 * Factory that creates a WebhookNotifier when the config contains a webhook block.
 *
 * `create` is only invoked after `applies` returns true (the registry loop
 * guarantees this), so the inner `config.webhook` access is guarded.
 */
const WEBHOOK_NOTIFIER_FACTORY: INotifierFactory = {
  name: 'webhook',
  /**
   * Decides whether this factory should produce a notifier for the given config.
   * @param config - Notification config block.
   * @returns True if `config.webhook` is truthy.
   */
  applies(config: INotificationConfig): boolean {
    return Boolean(config.webhook);
  },
  /**
   * Builds the WebhookNotifier instance. Caller must have checked {@link applies}.
   * @param config - Notification config block (must contain webhook).
   * @returns A new WebhookNotifier wired to config.webhook.
   */
  create(config: INotificationConfig): INotifier {
    const webhook = config.webhook;
    if (!webhook) throw new TypeError('WebhookNotifierFactory.create called without webhook block');
    return new WebhookNotifier(webhook);
  },
  /**
   * Returns the log line printed when this notifier is registered.
   * @param config - Notification config block (used to read webhook.format).
   * @returns Stable status string for logger.info() including the format.
   */
  describe(config: INotificationConfig): string {
    const format = config.webhook?.format || 'plain';
    return `🔗 Webhook notifications enabled (${format})`;
  },
};

export default WEBHOOK_NOTIFIER_FACTORY;
