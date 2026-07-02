/**
 * Shared "at least one channel" rule for notifications, used by both the strict
 * loader validator ({@link validateNotifications}) and the offline checker
 * (`checkNotificationsOffline`) so the requirement and its user-facing
 * message stay in sync instead of drifting across two separate copies.
 */
import type { INotificationConfig } from '../../Types/Index.js';

/** Message shown when notifications are enabled but no channel is configured. */
export const NO_NOTIFICATION_CHANNEL_MESSAGE =
  'Enable at least one notification channel (Telegram or webhook) when notifications are on.';

/**
 * Whether an enabled notifications block has at least one delivery channel.
 * @param config - The notifications block to inspect.
 * @returns True when a Telegram or webhook channel is present.
 */
export function hasNotificationChannel(config: INotificationConfig): boolean {
  return config.telegram !== undefined || config.webhook !== undefined;
}
