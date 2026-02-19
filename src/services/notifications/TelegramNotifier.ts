/**
 * Telegram notification channel using native fetch() (Node.js 22+)
 * Zero external dependencies - uses Telegram Bot API directly
 *
 * Message formats (set via config.messageFormat):
 *   "summary"  (D) - Banks overview, no transaction details
 *   "compact"  (A) - Date + description + amount per transaction
 *   "ledger"   (B) - Monospace table layout
 *   "emoji"    (C) - Emoji indicators for deposits/payments
 */

import { TelegramConfig, MessageFormat, ShowTransactions, TelegramApiResponse } from '../../types/index.js';
import { ImportSummary, BankMetrics, AccountMetrics, TransactionRecord } from '../MetricsService.js';
import { INotifier } from './INotifier.js';

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramNotifier implements INotifier {
  private botToken: string;
  private chatId: string;
  private format: MessageFormat;
  private showTransactions: ShowTransactions;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.format = config.messageFormat || 'summary';
    this.showTransactions = config.showTransactions || 'new';
  }

  async sendSummary(summary: ImportSummary): Promise<void> {
    const message = this.formatSummary(summary);
    await this.send(message);
  }

  async sendMessage(text: string): Promise<void> {
    await this.send(text);
  }

  async waitForReply(prompt: string, timeoutMs: number): Promise<string> {
    await this.send(prompt);

    const startTime = Date.now();
    let offset = await this.getLatestOffset();

    while (Date.now() - startTime < timeoutMs) {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${offset}&timeout=5`;
      const response = await fetch(url);
      if (!response.ok) continue;

      const data = await response.json() as TelegramApiResponse;
      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (msg?.text && String(msg.chat.id) === this.chatId) {
          return msg.text;
        }
      }
    }

    throw new Error('2FA timeout: no reply received');
  }

  private async getLatestOffset(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as TelegramApiResponse;
    return data.result?.length ? data.result[data.result.length - 1].update_id + 1 : 0;
  }

  async sendError(error: string): Promise<void> {
    const message = [
      '🚨 <b>Import Failed</b>',
      '',
      this.escapeHtml(error)
    ].join('\n');
    await this.send(message);
  }

  private async send(text: string): Promise<void> {
    const MAX_LENGTH = 4096;
    const message = text.length > MAX_LENGTH
      ? text.slice(0, MAX_LENGTH - 20) + '\n\n... (truncated)'
      : text;

    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }

  private formatSummary(summary: ImportSummary): string {
    switch (this.format) {
      case 'compact': return this.formatCompact(summary);
      case 'ledger': return this.formatLedger(summary);
      case 'emoji': return this.formatEmoji(summary);
      case 'summary':
      default: return this.formatDefault(summary);
    }
  }

  // ─── Format D: Summary (default) ───
  private formatDefault(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      `${icon} <b>Import Summary</b>`,
      '',
      `🏦 Banks: ${summary.successfulBanks}/${summary.totalBanks} (${summary.successRate.toFixed(0)}%)`,
      `📥 Transactions: ${summary.totalTransactions} imported`,
      `🔄 Duplicates: ${summary.totalDuplicates} skipped`,
      `⏱ Duration: ${dur}s`,
    ];

    if (summary.banks.length > 0) {
      lines.push('');
      for (const bank of summary.banks) {
        const bi = bank.status === 'success' ? '✅' : '❌';
        const d = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
        lines.push(`${bi} ${bank.bankName}: ${bank.transactionsImported} txns ${d}`);
        this.appendReconciliation(lines, bank);
        if (bank.error) lines.push(`   ❌ ${this.escapeHtml(bank.error)}`);
      }
    }
    return lines.join('\n');
  }

  // ─── Format A: Compact ───
  private formatCompact(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      `${icon} <b>Import Summary</b>`,
      `${summary.successfulBanks}/${summary.totalBanks} banks | ${summary.totalTransactions} txns | ${dur}s`,
    ];

    for (const bank of summary.banks) {
      const bi = bank.status === 'success' ? '✅' : '❌';
      for (const account of bank.accounts || []) {
        lines.push('');
        lines.push(`${bi} <b>${bank.bankName}</b> · ${account.accountNumber}`);

        const txns = this.getTransactions(account);
        for (const txn of txns) {
          const amt = this.fmtAmount(txn.amount);
          lines.push(`${this.fmtDate(txn.date)}  ${this.escapeHtml(txn.description)}`);
          lines.push(`       <b>${amt}</b>`);
        }

        this.appendBalance(lines, account, bank);
      }
      if (!bank.accounts?.length) {
        lines.push('');
        lines.push(`${bi} <b>${bank.bankName}</b>`);
      }
      if (bank.error) lines.push(`❌ ${this.escapeHtml(bank.error)}`);
    }
    return lines.join('\n');
  }

  // ─── Format B: Ledger ───
  private formatLedger(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      `${icon} <b>Import Summary</b>`,
      `${summary.totalTransactions} transactions · ${dur}s`,
    ];

    for (const bank of summary.banks) {
      const bi = bank.status === 'success' ? '✅' : '❌';
      for (const account of bank.accounts || []) {
        lines.push('');
        lines.push(`${bi} <b>${bank.bankName}</b> · ${account.accountNumber}`);

        const txns = this.getTransactions(account);
        if (txns.length > 0) {
          lines.push('<code>');
          for (const txn of txns) {
            const d = this.fmtDate(txn.date);
            const desc = txn.description.length > 18
              ? txn.description.slice(0, 18) + '..'
              : txn.description;
            const amt = this.fmtAmount(txn.amount).padStart(9);
            lines.push(`${d} ${desc}`);
            lines.push(`${''.padStart(6)}${amt}`);
          }
          lines.push('</code>');
        }

        this.appendBalance(lines, account, bank);
      }
      if (!bank.accounts?.length) {
        lines.push('');
        lines.push(`${bi} <b>${bank.bankName}</b>`);
      }
      if (bank.error) lines.push(`❌ ${this.escapeHtml(bank.error)}`);
    }
    return lines.join('\n');
  }

  // ─── Format C: Emoji ───
  private formatEmoji(summary: ImportSummary): string {
    const icon = summary.failedBanks === 0 ? '✅' : '⚠️';
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const dup = summary.totalDuplicates > 0 ? ` · ${summary.totalDuplicates} dup` : '';
    const lines: string[] = [
      `${icon} <b>Import Summary</b>`,
      '',
      `📊 ${summary.successfulBanks}/${summary.totalBanks} banks · ${summary.totalTransactions} txns${dup} · ${dur}s`,
    ];

    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) {
        lines.push('');
        lines.push(`💳 <b>${bank.bankName}</b>`);

        const txns = this.getTransactions(account);
        for (const txn of txns) {
          const ti = txn.amount >= 0 ? '📥' : '📤';
          lines.push(`${ti} <b>${this.fmtAmount(txn.amount)}</b>  ${this.escapeHtml(txn.description)}`);
        }

        if (account.balance !== undefined) {
          lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
        }
        this.appendReconciliation(lines, bank);
      }
      if (!bank.accounts?.length) {
        const bi = bank.status === 'success' ? '✅' : '❌';
        lines.push('');
        lines.push(`${bi} <b>${bank.bankName}</b>`);
      }
      if (bank.error) lines.push(`❌ ${this.escapeHtml(bank.error)}`);
    }
    return lines.join('\n');
  }

  // ─── Helpers ───
  private appendBalance(lines: string[], account: AccountMetrics, bank: BankMetrics): void {
    if (account.balance !== undefined) {
      lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
    }
    this.appendReconciliation(lines, bank);
  }

  private appendReconciliation(lines: string[], bank: BankMetrics): void {
    if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount !== undefined) {
      const sign = bank.reconciliationAmount > 0 ? '+' : '';
      lines.push(`🔄 Reconciled: ${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`);
    } else if (bank.reconciliationStatus === 'skipped') {
      lines.push(`✅ Balance matched`);
    } else if (bank.reconciliationStatus === 'already-reconciled') {
      lines.push(`✅ Already reconciled`);
    }
  }

  private getTransactions(account: AccountMetrics): TransactionRecord[] {
    if (this.showTransactions === 'none') return [];
    if (this.showTransactions === 'all') return [...account.newTransactions, ...account.existingTransactions];
    return account.newTransactions; // 'new' (default)
  }

  private fmtAmount(cents: number): string {
    const sign = cents >= 0 ? '+' : '';
    return `${sign}${(cents / 100).toFixed(2)}`;
  }

  private fmtDate(date: string): string {
    const parts = date.split('-');
    return `${parts[2]}/${parts[1]}`; // DD/MM
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
