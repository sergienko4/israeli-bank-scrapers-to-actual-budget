/**
 * Public dispatch entry-point for the webhook formatter cluster.
 * Selects the payload format (slack/discord/plain) for each message kind
 * and delegates to the corresponding format module.
 */
import type { WebhookFormat } from '../../../Types/Index.js';
import type { IImportSummary } from '../../MetricsService.js';
import { discordError, discordMessage, discordSummary } from './DiscordFormat.js';
import { plainError, plainMessage, plainSummary } from './PlainFormat.js';
import { slackError, slackMessage, slackSummary } from './SlackFormat.js';

/**
 * Formats an import summary into a webhook JSON payload for the given format.
 * @param format - The webhook payload format (slack/discord/plain).
 * @param summary - The ImportSummary to format.
 * @returns JSON string ready to POST.
 */
export function formatWebhookSummary(format: WebhookFormat, summary: IImportSummary): string {
  const dispatch: Record<WebhookFormat, (s: IImportSummary) => string> = {
    slack: slackSummary, discord: discordSummary, plain: plainSummary,
  };
  return dispatch[format](summary);
}

/**
 * Formats an error message into a webhook JSON payload for the given format.
 * @param format - The webhook payload format (slack/discord/plain).
 * @param error - The error message to include.
 * @returns JSON string ready to POST.
 */
export function formatWebhookError(format: WebhookFormat, error: string): string {
  const dispatch: Record<WebhookFormat, (e: string) => string> = {
    slack: slackError, discord: discordError, plain: plainError,
  };
  return dispatch[format](error);
}

/**
 * Formats a plain message into a webhook JSON payload for the given format.
 * @param format - The webhook payload format (slack/discord/plain).
 * @param text - The message text to include.
 * @returns JSON string ready to POST.
 */
export function formatWebhookMessage(format: WebhookFormat, text: string): string {
  const dispatch: Record<WebhookFormat, (t: string) => string> = {
    slack: slackMessage, discord: discordMessage, plain: plainMessage,
  };
  return dispatch[format](text);
}
