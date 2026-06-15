/**
 * Discord webhook payload formatters.
 * Renders summary, error, and message events as Discord `content` payloads.
 */
import type { IImportSummary } from '../../MetricsService.js';
import bankLine from './Shared.js';

/**
 * Formats the import summary as a Discord-style content payload.
 * @param summary - The IImportSummary to format.
 * @returns JSON string with a Discord `content` field.
 */
export function discordSummary(summary: IImportSummary): string {
  const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const banks = summary.banks.map(bankLine).join('\n');
  const header = `${icon} **Import Summary**\n` +
    `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
    `${String(summary.totalTransactions)} txns | ${dur}s`;
  const content = `${header}\n${banks}`;
  return JSON.stringify({ content });
}

/**
 * Formats an error message as a Discord-style content payload.
 * @param error - The error message to include.
 * @returns JSON string with a Discord `content` field.
 */
export function discordError(error: string): string {
  return JSON.stringify({ content: `🚨 **Import Failed**\n${error}` });
}

/**
 * Formats a plain message as a Discord-style content payload.
 * @param text - The message text to include.
 * @returns JSON string with a Discord `content` field.
 */
export function discordMessage(text: string): string {
  return JSON.stringify({ content: text });
}
