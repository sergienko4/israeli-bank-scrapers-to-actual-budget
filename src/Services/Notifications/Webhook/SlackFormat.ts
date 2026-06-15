/**
 * Slack webhook payload formatters.
 * Renders summary, error, and message events as Slack `text` payloads.
 */
import type { IImportSummary } from '../../MetricsService.js';
import bankLine from './Shared.js';
/**
 * Formats the import summary as a Slack-style text payload.
 * @param summary - The ImportSummary to format.
 * @returns JSON string with a Slack `text` field.
 */
export function slackSummary(summary: IImportSummary): string {
  const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const banks = summary.banks.map(bankLine).join('\n');
  const header = `${icon} *Import Summary*\n` +
    `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
    `${String(summary.totalTransactions)} txns | ${dur}s`;
  const text = `${header}\n${banks}`;
  return JSON.stringify({ text });
}

/**
 * Formats an error message as a Slack-style text payload.
 * @param error - The error message to include.
 * @returns JSON string with a Slack `text` field.
 */
export function slackError(error: string): string {
  return JSON.stringify({ text: `🚨 *Import Failed*\n${error}` });
}

/**
 * Formats a plain message as a Slack-style text payload.
 * @param text - The message text to include.
 * @returns JSON string with a Slack `text` field.
 */
export function slackMessage(text: string): string {
  return JSON.stringify({ text });
}
