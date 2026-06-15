/**
 * Webhook notification channel — supports Slack, Discord, and plain JSON.
 * Zero external dependencies (native fetch).
 * Transport only: payload presentation lives in the ./Webhook formatter cluster.
 * OCP: add a new payload format by adding a module under ./Webhook and a
 * branch to its dispatch table — never inline formatting here.
 */

import { NetworkError } from '../../Errors/ErrorTypes.js';
import type { IWebhookConfig, WebhookFormat } from '../../Types/Index.js';
import type { IImportSummary } from '../MetricsService.js';
import type { INotifier } from './INotifier.js';
import {
  formatWebhookError, formatWebhookMessage, formatWebhookSummary,
} from './Webhook/Index.js';

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
    const body = formatWebhookSummary(this._format, summary);
    await this.post(body);
  }

  /**
   * Formats and posts an error notification to the webhook URL.
   * @param error - The error message string to include in the payload.
   */
  public async sendError(error: string): Promise<void> {
    const body = formatWebhookError(this._format, error);
    await this.post(body);
  }

  /**
   * Formats and posts a plain message to the webhook URL.
   * @param text - The message text to include in the payload.
   */
  public async sendMessage(text: string): Promise<void> {
    const body = formatWebhookMessage(this._format, text);
    await this.post(body);
  }

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
