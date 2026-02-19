/**
 * Telegram notification channel using native fetch() (Node.js 22+)
 * Zero external dependencies - uses Telegram Bot API directly
 */

import { TelegramConfig } from '../../types/index.js';
import { ImportSummary } from '../MetricsService.js';
import { INotifier } from './INotifier.js';

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramNotifier implements INotifier {
  private botToken: string;
  private chatId: string;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
  }

  async sendSummary(summary: ImportSummary): Promise<void> {
    const message = this.formatSummary(summary);
    await this.send(message);
  }

  async sendError(error: string): Promise<void> {
    const message = `🚨 <b>Import Failed</b>\n\n${this.escapeHtml(error)}`;
    await this.send(message);
  }

  private async send(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }

  private formatSummary(summary: ImportSummary): string {
    const status = summary.failedBanks === 0 ? '✅' : '⚠️';
    const duration = (summary.totalDuration / 1000).toFixed(1);

    const lines: string[] = [
      `${status} <b>Import Summary</b>`,
      '',
      `Banks: ${summary.successfulBanks}/${summary.totalBanks} successful (${summary.successRate.toFixed(0)}%)`,
      `Transactions: ${summary.totalTransactions} imported, ${summary.totalDuplicates} duplicates`,
      `Duration: ${duration}s`,
    ];

    if (summary.banks.length > 0) {
      lines.push('', '<b>Banks:</b>');
      for (const bank of summary.banks) {
        const icon = bank.status === 'success' ? '✅' : '❌';
        const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : 'N/A';
        const skipped = bank.transactionsSkipped > 0 ? `, ${bank.transactionsSkipped} dup` : '';
        lines.push(`  ${icon} ${bank.bankName}: ${bank.transactionsImported} txns${skipped} (${dur})`);

        if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount !== undefined) {
          const sign = bank.reconciliationAmount > 0 ? '+' : '';
          lines.push(`     🔄 Reconciled: ${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`);
        } else if (bank.reconciliationStatus === 'skipped') {
          lines.push(`     ✅ Balance matched`);
        } else if (bank.reconciliationStatus === 'already-reconciled') {
          lines.push(`     ✅ Already reconciled`);
        }

        if (bank.error) {
          lines.push(`     ❌ ${this.escapeHtml(bank.error)}`);
        }
      }
    }

    return lines.join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
