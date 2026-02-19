/**
 * Webhook notification channel — supports Slack, Discord, and plain JSON
 * Zero external dependencies (native fetch)
 * OCP: add new formats by adding entries to the formatters map
 */

import { WebhookConfig, WebhookFormat } from '../../types/index.js';
import { ImportSummary, BankMetrics } from '../MetricsService.js';
import { INotifier } from './INotifier.js';

export class WebhookNotifier implements INotifier {
  private url: string;
  private format: WebhookFormat;

  constructor(config: WebhookConfig) {
    this.url = config.url;
    this.format = config.format || 'plain';
  }

  async sendSummary(summary: ImportSummary): Promise<void> {
    const body = this.formatSummary(summary);
    await this.post(body);
  }

  async sendError(error: string): Promise<void> {
    const body = this.formatError(error);
    await this.post(body);
  }

  async sendMessage(text: string): Promise<void> {
    const body = this.formatMessage(text);
    await this.post(body);
  }

  // ─── Format dispatch (OCP map) ───

  private formatSummary(summary: ImportSummary): string {
    const formatters: Record<WebhookFormat, (s: ImportSummary) => string> = {
      slack: (s) => this.slackSummary(s),
      discord: (s) => this.discordSummary(s),
      plain: (s) => this.plainSummary(s),
    };
    return formatters[this.format](summary);
  }

  private formatError(error: string): string {
    const formatters: Record<WebhookFormat, (e: string) => string> = {
      slack: (e) => JSON.stringify({ text: `🚨 *Import Failed*\n${e}` }),
      discord: (e) => JSON.stringify({ content: `🚨 **Import Failed**\n${e}` }),
      plain: (e) => JSON.stringify({ event: 'error', message: e }),
    };
    return formatters[this.format](error);
  }

  private formatMessage(text: string): string {
    const formatters: Record<WebhookFormat, (t: string) => string> = {
      slack: (t) => JSON.stringify({ text: t }),
      discord: (t) => JSON.stringify({ content: t }),
      plain: (t) => JSON.stringify({ event: 'message', message: t }),
    };
    return formatters[this.format](text);
  }

  // ─── Slack format ───

  private slackSummary(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const banks = summary.banks.map(b => this.slackBankLine(b)).join('\n');
    const text = `${icon} *Import Summary*\n${summary.successfulBanks}/${summary.totalBanks} banks | ${summary.totalTransactions} txns | ${dur}s\n${banks}`;
    return JSON.stringify({ text });
  }

  private slackBankLine(b: BankMetrics): string {
    const icon = b.status === 'success' ? '✅' : '❌';
    const dur = b.duration ? `${(b.duration / 1000).toFixed(1)}s` : '';
    return `${icon} ${b.bankName}: ${b.transactionsImported} txns ${dur}${b.error ? ` — ${b.error}` : ''}`;
  }

  // ─── Discord format ───

  private discordSummary(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const banks = summary.banks.map(b => this.slackBankLine(b)).join('\n');
    const content = `${icon} **Import Summary**\n${summary.successfulBanks}/${summary.totalBanks} banks | ${summary.totalTransactions} txns | ${dur}s\n${banks}`;
    return JSON.stringify({ content });
  }

  // ─── Plain JSON format ───

  private plainSummary(summary: ImportSummary): string {
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

  private async post(body: string): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webhook error ${response.status}: ${text}`);
    }
  }
}
