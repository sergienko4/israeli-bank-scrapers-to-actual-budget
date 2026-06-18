/**
 * Validators for notification channels (telegram, webhook).
 *
 * Iterated by `validateNotifications` in `ConfigLoaderValidator.ts` instead
 * of the legacy `if (config.telegram) ... if (config.webhook) ...` chain.
 * Adding a new channel is one registry entry — no edits to the dispatcher.
 *
 * Channel-specific validation logic (botToken format, URL format,
 * enum fields) lives here rather than in the dispatcher so each
 * registry entry is fully self-contained and the dispatcher has zero
 * channel-specific knowledge.
 */
import type { INotificationConfig, Procedure } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import type { IBlockValidator } from './IBlockValidator.js';

/**
 * Validates that an enum-style string field is one of the allowed values.
 * @param value - The field value (may be `false` when unset).
 * @param allowed - The permitted string values.
 * @param fieldName - Display name used in error messages.
 * @returns Procedure success when value is allowed or unset.
 */
function validateEnumField(
  value: string | false, allowed: string[], fieldName: string
): Procedure<{ valid: true }> {
  if (value && !allowed.includes(value)) {
    return fail(
      `Invalid ${fieldName} "${value}". Must be one of: ${allowed.join(', ')}`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates the Telegram bot token format and presence.
 * @param botToken - The bot token string to validate.
 * @returns Procedure success when format matches `<id>:<rest>`.
 */
function validateBotToken(botToken: string): Procedure<{ valid: true }> {
  if (!botToken) return fail('Telegram botToken is required');
  if (!/^\d+:.+$/.test(botToken)) {
    return fail('Invalid botToken format. Expected: "123456789:ABCdef..."');
  }
  return succeed({ valid: true as const });
}

const MESSAGE_FORMATS = ['summary', 'compact', 'ledger', 'emoji'];
const SHOW_TX_VALUES = ['new', 'all', 'none'];

/**
 * Returns the first failing procedure, or success when all pass.
 * @param results - Procedures to inspect in order.
 * @returns The first failure, else success.
 */
function firstFailure(...results: Procedure<{ valid: true }>[]): Procedure<{ valid: true }> {
  for (const r of results) if (isFail(r)) return r;
  return succeed({ valid: true as const });
}

/**
 * Validates the Telegram channel config (botToken, chatId, format enums).
 * @param telegram - The Telegram block to validate.
 * @returns Procedure success on valid config, else failure message.
 */
function validateTelegramConfig(
  telegram: NonNullable<INotificationConfig['telegram']>
): Procedure<{ valid: true }> {
  const tokenResult = validateBotToken(telegram.botToken);
  if (isFail(tokenResult)) return tokenResult;
  if (!telegram.chatId) return fail('Telegram chatId is required');
  const format = validateEnumField(telegram.messageFormat || false, MESSAGE_FORMATS, 'messageFormat');
  const show = validateEnumField(telegram.showTransactions || false, SHOW_TX_VALUES, 'showTransactions');
  return firstFailure(format, show);
}

const WEBHOOK_FORMATS = ['slack', 'discord', 'plain'];

/**
 * Validates that a webhook URL is present and uses an http(s) scheme.
 * @param url - The webhook URL to validate (may be undefined).
 * @returns Procedure success when the URL is present and well-formed.
 */
function validateWebhookUrl(url?: string): Procedure<{ valid: true }> {
  if (!url) return fail('Webhook url is required when webhook notifications are configured');
  const hasScheme = url.startsWith('http://') || url.startsWith('https://');
  if (!hasScheme) {
    return fail(`Invalid webhook url format. Must start with http:// or https://, got: ${url}`);
  }
  return succeed({ valid: true as const });
}

/**
 * Validates the webhook URL and format enum.
 * @param webhook - The webhook block to validate.
 * @returns Procedure success on valid config, else failure message.
 */
function validateWebhookConfig(
  webhook: NonNullable<INotificationConfig['webhook']>
): Procedure<{ valid: true }> {
  const urlResult = validateWebhookUrl(webhook.url);
  if (isFail(urlResult)) return urlResult;
  const format = validateEnumField(webhook.format || false, WEBHOOK_FORMATS, 'webhook format');
  if (isFail(format)) return format;
  return succeed({ valid: true as const });
}

const TELEGRAM_CHANNEL_VALIDATOR: IBlockValidator<INotificationConfig> = {
  name: 'telegram',
  /**
   * Decides whether the telegram channel should be validated.
   * @param config - The parent INotificationConfig.
   * @returns True if `config.telegram` is truthy.
   */
  applies(config: INotificationConfig): boolean {
    return Boolean(config.telegram);
  },
  /**
   * Validates the telegram block when present.
   * @param config - The parent INotificationConfig.
   * @returns Procedure success when block is absent or valid, else failure.
   */
  validate(config: INotificationConfig): Procedure<{ valid: true }> {
    const block = config.telegram;
    if (!block) return succeed({ valid: true as const });
    return validateTelegramConfig(block);
  },
};

const WEBHOOK_CHANNEL_VALIDATOR: IBlockValidator<INotificationConfig> = {
  name: 'webhook',
  /**
   * Decides whether the webhook channel should be validated.
   * @param config - The parent INotificationConfig.
   * @returns True if `config.webhook` is truthy.
   */
  applies(config: INotificationConfig): boolean {
    return Boolean(config.webhook);
  },
  /**
   * Validates the webhook block when present.
   * @param config - The parent INotificationConfig.
   * @returns Procedure success when block is absent or valid, else failure.
   */
  validate(config: INotificationConfig): Procedure<{ valid: true }> {
    const block = config.webhook;
    if (!block) return succeed({ valid: true as const });
    return validateWebhookConfig(block);
  },
};

/**
 * Registry of notification-channel validators iterated by validateNotifications.
 *
 * Legacy order preserved (telegram → webhook) so failure messages remain stable.
 */
const NOTIFICATION_CHANNEL_VALIDATORS: readonly IBlockValidator<INotificationConfig>[] = [
  TELEGRAM_CHANNEL_VALIDATOR,
  WEBHOOK_CHANNEL_VALIDATOR,
];

export default NOTIFICATION_CHANNEL_VALIDATORS;
