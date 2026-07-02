/**
 * Offline checks for the notifications configuration section.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan).
 * Skips entirely when notifications are disabled — caller does not need
 * to guard against that case.
 */
import type { IImporterConfig, INotificationConfig } from '../../Types/Index.js';
import { fail, type IValidationResult,pass } from './ValidationResult.js';

export type { IValidationResult } from './ValidationResult.js';

/**
 * Builds the botToken format validation result.
 * @param tg - The Telegram config whose botToken is checked.
 * @returns Pass when the token matches `<id>:<rest>`, else fail.
 */
function tokenResult(tg: NonNullable<INotificationConfig['telegram']>): IValidationResult {
  const isTokenValid = /^\d+:.+$/.test(tg.botToken);
  return isTokenValid
    ? pass('telegram.botToken', 'Telegram botToken format valid')
    : fail('telegram.botToken',
      'Invalid botToken format — expected "123456:ABCdef..."');
}

/**
 * Builds the chatId presence validation result.
 * @param tg - The Telegram config whose chatId is checked.
 * @returns Pass when chatId is set, else fail.
 */
function chatIdResult(tg: NonNullable<INotificationConfig['telegram']>): IValidationResult {
  return tg.chatId
    ? pass('telegram.chatId', 'Telegram chatId is set')
    : fail('telegram.chatId', 'Telegram chatId is missing');
}

/**
 * Validates Telegram bot token format and chat ID presence offline.
 * @param tg - The Telegram config to check.
 * @returns Array of IValidationResult objects for botToken and chatId.
 */
function checkTelegramOffline(
  tg: NonNullable<INotificationConfig['telegram']>
): IValidationResult[] {
  const token = tokenResult(tg);
  const chat = chatIdResult(tg);
  return [token, chat];
}

/**
 * Validates webhook URL presence and format offline.
 * @param wh - The webhook config to check.
 * @returns A IValidationResult for the webhook URL.
 */
function checkWebhookOffline(
  wh: NonNullable<INotificationConfig['webhook']>
): IValidationResult {
  if (!wh.url) return fail('webhook.url', 'Webhook URL is missing');
  return wh.url.startsWith('http')
    ? pass('webhook.url', `Webhook URL format valid: ${wh.url}`)
    : fail('webhook.url',
      `Invalid webhook URL "${wh.url}" — must start with http://`);
}

/**
 * Aggregates results from all enabled notification channels.
 * @param notifications - Notifications config (already verified as enabled by caller).
 * @returns Combined IValidationResult[] from Telegram and webhook checks.
 */
function aggregateChannelResults(
  notifications: NonNullable<IImporterConfig['notifications']>
): IValidationResult[] {
  const { telegram, webhook } = notifications;
  const telegramResults = telegram ? checkTelegramOffline(telegram) : [];
  const webhookResults = webhook ? [checkWebhookOffline(webhook)] : [];
  return [...telegramResults, ...webhookResults];
}

/**
 * Runs offline notification checks when notifications are enabled. Requires at
 * least one channel (Telegram or webhook) once enabled, so an enabled block with
 * no configured channel is reported as misconfigured rather than silently no-op.
 * @param notifications - Optional notifications config block to check.
 * @returns Array of IValidationResult objects for Telegram and webhook.
 */
export function checkNotificationsOffline(
  notifications?: IImporterConfig['notifications']
): IValidationResult[] {
  if (!notifications?.enabled) return [];
  if (!notifications.telegram && !notifications.webhook) {
    return [fail('notifications',
      'Enable at least one notification channel (Telegram or webhook) when notifications are on')];
  }
  return aggregateChannelResults(notifications);
}
