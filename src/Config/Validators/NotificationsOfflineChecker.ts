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
 * Validates Telegram bot token format and chat ID presence offline.
 * @param tg - The Telegram config to check.
 * @returns Array of IValidationResult objects for botToken and chatId.
 */
function checkTelegramOffline(
  tg: NonNullable<INotificationConfig['telegram']>
): IValidationResult[] {
  const isTokenValid = /^\d+:.+$/.test(tg.botToken);
  return [
    isTokenValid
      ? pass('telegram.botToken', 'Telegram botToken format valid')
      : fail('telegram.botToken',
        'Invalid botToken format — expected "123456:ABCdef..."'),
    tg.chatId
      ? pass('telegram.chatId', 'Telegram chatId is set')
      : fail('telegram.chatId', 'Telegram chatId is missing'),
  ];
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
  const results: IValidationResult[] = [];
  if (telegram) {
    const telegramResults = checkTelegramOffline(telegram);
    results.push(...telegramResults);
  }
  if (webhook) {
    const webhookResult = checkWebhookOffline(webhook);
    results.push(webhookResult);
  }
  return results;
}

/**
 * Runs offline notification checks when notifications are enabled.
 * @param notifications - Optional notifications config block to check.
 * @returns Array of IValidationResult objects for Telegram and webhook.
 */
export function checkNotificationsOffline(
  notifications?: IImporterConfig['notifications']
): IValidationResult[] {
  if (!notifications?.enabled) return [];
  return aggregateChannelResults(notifications);
}
