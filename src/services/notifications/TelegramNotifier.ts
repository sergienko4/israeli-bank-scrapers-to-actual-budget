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
const MAX_MESSAGE_LENGTH = 4096;

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
    await this.send(this.formatSummary(summary));
  }

  async sendMessage(text: string): Promise<void> {
    await this.send(text);
  }

  async sendError(error: string): Promise<void> {
    await this.send(['🚨 <b>Import Failed</b>', '', this.escapeHtml(error)].join('\n'));
  }

  // ─── 2FA reply polling ───

  async waitForReply(prompt: string, timeoutMs: number): Promise<string> {
    let offset = await this.getLatestOffset();
    await this.send(prompt);
    const sentAt = Math.floor(Date.now() / 1000);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.pollUpdates(offset);
      if (!result) continue;
      const reply = this.findReplyMessage(result.updates, sentAt);
      offset = result.nextOffset;
      if (reply) return reply;
    }
    throw new Error('2FA timeout: no reply received');
  }

  private async pollUpdates(offset: number): Promise<{ updates: TelegramApiResponse; nextOffset: number } | null> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${offset}&timeout=5`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as TelegramApiResponse;
    const lastId = data.result?.length ? data.result[data.result.length - 1].update_id : offset - 1;
    return { updates: data, nextOffset: lastId + 1 };
  }

  private findReplyMessage(data: TelegramApiResponse, sentAt: number): string | null {
    for (const update of data.result ?? []) {
      const msg = update.message;
      if (!msg?.text || String(msg.chat.id) !== this.chatId) continue;
      if (msg.date < sentAt || msg.text.startsWith('/')) continue;
      return msg.text;
    }
    return null;
  }

  private async getLatestOffset(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as TelegramApiResponse;
    return data.result?.length ? data.result[data.result.length - 1].update_id + 1 : 0;
  }

  // ─── Send with truncation ───

  private truncateMessage(text: string): string {
    return text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n\n... (truncated)' : text;
  }

  private async send(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text: this.truncateMessage(text), parse_mode: 'HTML' })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }

  // ─── Format dispatch ───

  private formatSummary(summary: ImportSummary): string {
    switch (this.format) {
      case 'compact': return this.formatCompact(summary);
      case 'ledger': return this.formatLedger(summary);
      case 'emoji': return this.formatEmoji(summary);
      case 'summary':
      default: return this.formatDefault(summary);
    }
  }

  // ─── Shared format helpers ───

  private buildHeader(summary: ImportSummary): string {
    return `${summary.failedBanks === 0 ? '✅' : '⚠️'} <b>Import Summary</b>`;
  }

  private bankIcon(bank: BankMetrics): string {
    return bank.status === 'success' ? '✅' : '❌';
  }

  private appendBankFooter(lines: string[], bank: BankMetrics): void {
    if (!bank.accounts?.length) { lines.push(''); lines.push(`${this.bankIcon(bank)} <b>${bank.bankName}</b>`); }
    if (bank.error) lines.push(`❌ ${this.escapeHtml(bank.error)}`);
  }

  // ─── Format D: Summary (default) ───

  private formatDefault(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      this.buildHeader(summary), '',
      `🏦 Banks: ${summary.successfulBanks}/${summary.totalBanks} (${summary.successRate.toFixed(0)}%)`,
      `📥 Transactions: ${summary.totalTransactions} imported`,
      `🔄 Duplicates: ${summary.totalDuplicates} skipped`,
      `⏱ Duration: ${dur}s`,
    ];
    if (summary.banks.length > 0) { lines.push(''); summary.banks.forEach(b => this.appendDefaultBank(lines, b)); }
    return lines.join('\n');
  }

  private appendDefaultBank(lines: string[], bank: BankMetrics): void {
    const d = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
    lines.push(`${this.bankIcon(bank)} ${bank.bankName}: ${bank.transactionsImported} txns ${d}`);
    this.appendReconciliation(lines, bank);
    if (bank.error) lines.push(`   ❌ ${this.escapeHtml(bank.error)}`);
  }

  // ─── Format A: Compact ───

  private formatCompact(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      this.buildHeader(summary),
      `${summary.successfulBanks}/${summary.totalBanks} banks | ${summary.totalTransactions} txns | ${dur}s`,
    ];
    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) this.appendCompactAccount(lines, bank, account);
      this.appendBankFooter(lines, bank);
    }
    return lines.join('\n');
  }

  private appendCompactAccount(lines: string[], bank: BankMetrics, account: AccountMetrics): void {
    lines.push('');
    lines.push(`${this.bankIcon(bank)} <b>${bank.bankName}</b> · ${account.accountNumber}`);
    for (const txn of this.getTransactions(account)) {
      lines.push(`${this.fmtDate(txn.date)}  ${this.escapeHtml(txn.description)}`);
      lines.push(`       <b>${this.fmtAmount(txn.amount)}</b>`);
    }
    this.appendBalance(lines, account, bank);
  }

  // ─── Format B: Ledger ───

  private formatLedger(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      this.buildHeader(summary),
      `${summary.totalTransactions} transactions · ${dur}s`,
    ];
    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) this.appendLedgerAccount(lines, bank, account);
      this.appendBankFooter(lines, bank);
    }
    return lines.join('\n');
  }

  private appendLedgerAccount(lines: string[], bank: BankMetrics, account: AccountMetrics): void {
    lines.push('');
    lines.push(`${this.bankIcon(bank)} <b>${bank.bankName}</b> · ${account.accountNumber}`);
    const txns = this.getTransactions(account);
    if (txns.length > 0) this.appendLedgerTransactions(lines, txns);
    this.appendBalance(lines, account, bank);
  }

  private appendLedgerTransactions(lines: string[], txns: TransactionRecord[]): void {
    lines.push('<code>');
    for (const txn of txns) {
      const desc = this.escapeHtml(txn.description.length > 18 ? txn.description.slice(0, 18) + '..' : txn.description);
      lines.push(`${this.fmtDate(txn.date)} ${desc}`);
      lines.push(`${''.padStart(6)}${this.fmtAmount(txn.amount).padStart(9)}`);
    }
    lines.push('</code>');
  }

  // ─── Format C: Emoji ───

  private formatEmoji(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const dup = summary.totalDuplicates > 0 ? ` · ${summary.totalDuplicates} dup` : '';
    const lines: string[] = [
      this.buildHeader(summary), '',
      `📊 ${summary.successfulBanks}/${summary.totalBanks} banks · ${summary.totalTransactions} txns${dup} · ${dur}s`,
    ];
    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) this.appendEmojiAccount(lines, bank, account);
      this.appendBankFooter(lines, bank);
    }
    return lines.join('\n');
  }

  private appendEmojiAccount(lines: string[], bank: BankMetrics, account: AccountMetrics): void {
    lines.push('');
    lines.push(`💳 <b>${bank.bankName}</b>`);
    for (const txn of this.getTransactions(account)) {
      lines.push(`${txn.amount >= 0 ? '📥' : '📤'} <b>${this.fmtAmount(txn.amount)}</b>  ${this.escapeHtml(txn.description)}`);
    }
    if (account.balance !== undefined) lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
    this.appendReconciliation(lines, bank);
  }

  // ─── Shared helpers ───

  private appendBalance(lines: string[], account: AccountMetrics, bank: BankMetrics): void {
    if (account.balance !== undefined) lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
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
    return account.newTransactions;
  }

  private fmtAmount(cents: number): string {
    return `${cents >= 0 ? '+' : ''}${(cents / 100).toFixed(2)}`;
  }

  private fmtDate(date: string): string {
    const parts = date.split('-');
    return `${parts[2]}/${parts[1]}`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
