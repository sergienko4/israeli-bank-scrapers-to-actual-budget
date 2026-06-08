/**
 * NotifierRegistry — single source of truth for which notifier channels exist.
 *
 * Iterated by `NotificationService` constructor instead of the legacy
 * `if (config.telegram) ... if (config.webhook) ...` chain. Adding a new
 * notifier (e.g., Slack) is one new factory + one registry entry — no edits
 * to NotificationService.
 */
import type { INotifierFactory } from './INotifierFactory.js';
import TELEGRAM_NOTIFIER_FACTORY from './TelegramNotifierFactory.js';
import WEBHOOK_NOTIFIER_FACTORY from './WebhookNotifierFactory.js';

/**
 * Registry of notifier factories iterated by NotificationService.
 *
 * Legacy order preserved (telegram → webhook) so log line order and
 * summary-broadcast order remain stable.
 */
const NOTIFIER_REGISTRY: readonly INotifierFactory[] = [
  TELEGRAM_NOTIFIER_FACTORY,
  WEBHOOK_NOTIFIER_FACTORY,
];

export default NOTIFIER_REGISTRY;
