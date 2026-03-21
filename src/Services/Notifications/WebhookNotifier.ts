/**
 * Webhook notification channel — supports Slack, Discord, and plain JSON
 * Zero external dependencies (native fetch)
 * OCP: add new formats by adding entries to the formatters map
 */

import { NetworkError } from '../../Errors/ErrorTypes.js';
import type { IWebhookConfig, WebhookFormat } from '../../Types/Index.js';
import type { IBankMetrics,IImportSummary } from '../MetricsService.js';
import type { INotifier } from './INotifier.js';

/** Webhook notification channel — posts import events as JSON to a configurable URL. */
export default class WebhookNotifier implements INotifier {
  private readonly _url: string;
  private readonly _format: WebhookFormat;

  /**
   * Creates a WebhookNotifier from the given webhook configuration.
   * @param config - Webhook URL and format (slack, discord, or plain).
   */
  constructor(config: IWebhookConfig) {
    this._url = config.url;
    this._format = config.format || 'plain';
  }

  /**
   * Formats and posts an import summary to the webhook URL.
   * @param summary - The ImportSummary to send.
   */
  public async sendSummary(summary: IImportSummary): Promise<void> {
    const body = this.formatSummary(summary);
    await this.post(body);
  }

  /**
   * Formats and posts an error notification to the webhook URL.
   * @param error - The error message string to include in the payload.
   */
  public async sendError(error: string): Promise<void> {
    const body = this.formatError(error);
    await this.post(body);
  }

  /**
   * Formats and posts a plain message to the webhook URL.
   * @param text - The message text to include in the payload.
   */
  public async sendMessage(text: string): Promise<void> {
    const body = this.formatMessage(text);
    await this.post(body);
  }

  /**
   * Dispatches summary formatting to the correct format handler.
   * @param summary - The ImportSummary to format.
   * @returns JSON string ready to POST.
   */
  private formatSummary(summary: IImportSummary): string {
    const formatters: Record<WebhookFormat, (s: IImportSummary) => string> = {
      /**
       * Formats summary for Slack.
       * @param s - The ImportSummary.
       * @returns Slack JSON payload string.
       */
      slack: (s) => WebhookNotifier.slackSummary(s),
      /**
       * Formats summary for Discord.
       * @param s - The ImportSummary.
       * @returns Discord JSON payload string.
       */
      discord: (s) => WebhookNotifier.discordSummary(s),
      /**
       * Formats summary as plain JSON.
       * @param s - The ImportSummary.
       * @returns Plain JSON payload string.
       */
      plain: (s) => WebhookNotifier.plainSummary(s),
    };
    return formatters[this._format](summary);
  }

  /**
   * Formats an error message for the configured webhook format.
   * @param error - The error message to include.
   * @returns JSON string ready to POST.
   */
  private formatError(error: string): string {
    const formatters: Record<WebhookFormat, (e: string) => string> = {
      /**
       * Formats error for Slack.
       * @param e - Error message string.
       * @returns Slack JSON payload string.
       */
      slack: (e) => JSON.stringify({ text: `🚨 *Import Failed*\n${e}` }),
      /**
       * Formats error for Discord.
       * @param e - Error message string.
       * @returns Discord JSON payload string.
       */
      discord: (e) => JSON.stringify({ content: `🚨 **Import Failed**\n${e}` }),
      /**
       * Formats error as plain JSON.
       * @param e - Error message string.
       * @returns Plain JSON payload string.
       */
      plain: (e) => JSON.stringify({ event: 'error', message: e }),
    };
    return formatters[this._format](error);
  }

  /**
   * Formats a plain message for the configured webhook format.
   * @param text - The message text to include.
   * @returns JSON string ready to POST.
   */
  private formatMessage(text: string): string {
    const formatters: Record<WebhookFormat, (t: string) => string> = {
      /**
       * Formats message for Slack.
       * @param t - Message text.
       * @returns Slack JSON payload string.
       */
      slack: (t) => JSON.stringify({ text: t }),
      /**
       * Formats message for Discord.
       * @param t - Message text.
       * @returns Discord JSON payload string.
       */
      discord: (t) => JSON.stringify({ content: t }),
      /**
       * Formats message as plain JSON.
       * @param t - Message text.
       * @returns Plain JSON payload string.
       */
      plain: (t) => JSON.stringify({ event: 'message', message: t }),
    };
    return formatters[this._format](text);
  }

  // ─── Slack format ───

  /**
   * Formats the import summary as a Slack-style text payload.
   * @param summary - The ImportSummary to format.
   * @returns JSON string with a Slack `text` field.
   */
  private static slackSummary(summary: IImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const banks = summary.banks.map(b => WebhookNotifier.slackBankLine(b)).join('\n');
    const header = `${icon} *Import Summary*\n` +
      `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
      `${String(summary.totalTransactions)} txns | ${dur}s`;
    const text = `${header}\n${banks}`;
    return JSON.stringify({ text });
  }

  /**
   * Formats a single bank result as a Slack-style text line.
   * @param b - The IBankMetrics to format.
   * @returns Text line with status icon, name, transaction count, and optional error.
   */
  private static slackBankLine(b: IBankMetrics): string {
    const icon = b.status === 'success' ? '✅' : '❌';
    const dur = b.duration ? `${(b.duration / 1000).toFixed(1)}s` : '';
    const errSuffix = b.error ? ` — ${b.error}` : '';
    return `${icon} ${b.bankName}: ${String(b.transactionsImported)} txns ${dur}${errSuffix}`;
  }

  // ─── Discord format ───

  /**
   * Formats the import summary as a Discord-style content payload.
   * @param summary - The IImportSummary to format.
   * @returns JSON string with a Discord `content` field.
   */
  private static discordSummary(summary: IImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const banks = summary.banks.map(b => WebhookNotifier.slackBankLine(b)).join('\n');
    const header = `${icon} **Import Summary**\n` +
      `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
      `${String(summary.totalTransactions)} txns | ${dur}s`;
    const content = `${header}\n${banks}`;
    return JSON.stringify({ content });
  }

  // ─── Plain JSON format ───

  /**
   * Formats the import summary as a plain structured JSON event payload.
   * @param summary - The ImportSummary to serialize.
   * @returns JSON string with an `event: 'import_complete'` payload.
   */
  private static plainSummary(summary: IImportSummary): string {
    return JSON.stringify({
      event: 'import_complete',
      totalBanks: summary.totalBanks,
      successfulBanks: summary.successfulBanks,
      failedBanks: summary.failedBanks,
      totalTransactions: summary.totalTransactions,
      totalDuplicates: summary.totalDuplicates,
      duration: summary.totalDuration,
      successRate: summary.successRate,
      banks: summary.banks.map(b => ({
        name: b.bankName, status: b.status,
        transactions: b.transactionsImported, error: b.error,
      })),
    });
  }

  // ─── HTTP POST ───

  /**
   * Posts a JSON body to the webhook URL via HTTP POST.
   * @param body - Serialized JSON string to send as the request body.
   */
  private async post(body: string): Promise<void> {
    const response = await fetch(this._url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new NetworkError(`Webhook error ${String(response.status)}: ${text}`);
    }
  }
}
