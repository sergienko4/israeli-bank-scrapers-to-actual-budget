/* eslint-disable max-lines */
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

import type {
  TelegramConfig, MessageFormat, ShowTransactions, TelegramApiResponse
} from '../../Types/Index.js';
import type {
  ImportSummary, BankMetrics, AccountMetrics, TransactionRecord
} from '../MetricsService.js';
import type { INotifier } from './INotifier.js';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_MAX_TRANSACTIONS = 5;
const MAX_TRANSACTIONS_LIMIT = 25;
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;
const MAX_DESCRIPTION_LENGTH = 256;

/**
 * Validates a bot command name and description against Telegram Bot API limits.
 * @param command - The command string (1-32 lowercase alphanumeric/underscore characters).
 * @param description - The command description (1-256 characters).
 * @returns True if both the command and description meet Telegram's requirements.
 */
function isValidBotCommand(command: string, description: string): boolean {
  return COMMAND_PATTERN.test(command)
    && description.length >= 1
    && description.length <= MAX_DESCRIPTION_LENGTH;
}

/** Telegram notification channel — formats and sends import summaries via the Bot API. */
export class TelegramNotifier implements INotifier {
  private botToken: string;
  private chatId: string;
  private format: MessageFormat;
  private showTransactions: ShowTransactions;
  private maxTransactions: number;

  /**
   * Creates a TelegramNotifier from the given config.
   * @param config - Telegram bot token, chat ID, message format, and transaction display mode.
   * @param maxTransactions - Override for the max transactions shown per account.
   */
  constructor(config: TelegramConfig, maxTransactions?: number) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.format = config.messageFormat || 'summary';
    this.showTransactions = config.showTransactions || 'new';
    this.maxTransactions = Math.min(
      Math.max(maxTransactions ?? DEFAULT_MAX_TRANSACTIONS, 1),
      MAX_TRANSACTIONS_LIMIT
    );
  }

  /**
   * Formats and sends an import summary message to the configured Telegram chat.
   * @param summary - The ImportSummary to format and send.
   */
  async sendSummary(summary: ImportSummary): Promise<void> {
    await this.send(this.formatSummary(summary));
  }

  /**
   * Sends a plain HTML text message to the configured Telegram chat.
   * @param text - The HTML-formatted text to send.
   */
  async sendMessage(text: string): Promise<void> {
    await this.send(text);
  }

  /**
   * Sends an error notification with a fixed header to the configured Telegram chat.
   * @param error - The error message string to include.
   */
  async sendError(error: string): Promise<void> {
    await this.send(['🚨 <b>Import Failed</b>', '', this.escapeHtml(error)].join('\n'));
  }

  /**
   * Sends an inline keyboard menu with a button per bank and an "All banks" button.
   * @param banks - List of bank names to display as inline keyboard buttons.
   */
  async sendScanMenu(banks: string[]): Promise<void> {
    const allRow = [{ text: '🏦 All banks', callback_data: 'scan_all' }];
    const bankRows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < banks.length; i += 2) {
      bankRows.push(banks.slice(i, i + 2).map(b => ({ text: b, callback_data: `scan:${b}` })));
    }
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: '🏦 <b>Select bank to import:</b>',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [allRow, ...bankRows] },
      }),
    });
  }

  // ─── 2FA reply polling ───

  /**
   * Sends a prompt and polls for the next non-command reply from the chat.
   * @param prompt - HTML-formatted message to send before waiting.
   * @param timeoutMs - Maximum milliseconds to wait before throwing a timeout error.
   * @returns The text content of the first valid reply message.
   */
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
      if (!reply) continue;
      if (!this.looksLikeOtp(reply)) {
        await this.sendMessage('⚠️ Please send the numeric OTP code from your SMS (4–8 digits).');
        continue;
      }
      return reply;
    }
    throw new Error('2FA timeout: no reply received');
  }

  // ─── Bot command registration ───

  /**
   * Registers the bot's command list with Telegram via setMyCommands.
   * @param extras - Additional commands to include beyond the built-in set.
   */
  async registerCommands(
    extras: Array<{ command: string; description: string }> = []
  ): Promise<void> {
    const commands = [
      { command: 'scan', description: 'Run bank import now' },
      { command: 'status', description: 'Show last run info + history' },
      ...extras.filter(c => isValidBotCommand(c.command, c.description)),
      { command: 'logs', description: 'Show recent log entries' },
      { command: 'help', description: 'List available commands' },
    ];
    await this.sendBotCommands(commands);
  }

  /**
   * Fetches pending updates from Telegram starting at the given offset.
   * @param offset - The update_id offset to pass to getUpdates.
   * @returns Object with updates and the next offset, or null on HTTP failure.
   */
  private async pollUpdates(
    offset: number
  ): Promise<{ updates: TelegramApiResponse; nextOffset: number } | null> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${offset}&timeout=5`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as TelegramApiResponse;
    const lastId = data.result?.length
      ? data.result[data.result.length - 1].update_id
      : offset - 1;
    return { updates: data, nextOffset: lastId + 1 };
  }

  /**
   * Searches updates for the first non-command reply from the configured chat after the prompt.
   * @param data - The TelegramApiResponse to search through.
   * @param sentAt - Unix timestamp of when the prompt was sent; earlier messages are skipped.
   * @returns The message text of the first valid reply, or null if none found.
   */
  private findReplyMessage(data: TelegramApiResponse, sentAt: number): string | null {
    for (const update of data.result ?? []) {
      const msg = update.message;
      if (!msg?.text || String(msg.chat.id) !== this.chatId) continue;
      if (msg.date < sentAt || msg.text.startsWith('/')) continue;
      return msg.text;
    }
    return null;
  }

  /**
   * Fetches the latest update_id from Telegram to use as the starting offset.
   * @returns The next offset (latest update_id + 1), or 0 on failure.
   */
  private async getLatestOffset(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as TelegramApiResponse;
    return data.result?.length ? data.result[data.result.length - 1].update_id + 1 : 0;
  }

  /**
   * Returns true when the text contains 4-8 digit characters (typical OTP length).
   * @param text - The Telegram reply text to test.
   * @returns True if the text looks like an OTP code.
   */
  private looksLikeOtp(text: string): boolean {
    const digits = text.replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 8;
  }

  /**
   * Sends the command list to Telegram via the setMyCommands API endpoint.
   * @param commands - Array of command+description objects to register.
   */
  private async sendBotCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/setMyCommands`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`setMyCommands failed: ${response.status} ${body}`);
    }
  }

  // ─── Send with truncation ───

  /**
   * Truncates a message to Telegram's 4096-character limit, closing open HTML tags.
   * @param text - The full message text that may exceed the limit.
   * @returns Safely truncated message with all HTML tags properly closed.
   */
  private truncateMessage(text: string): string {
    if (text.length <= MAX_MESSAGE_LENGTH) return text;
    const cut = this.trimPartialTag(text.slice(0, MAX_MESSAGE_LENGTH - 30));
    return this.closeUnclosedTags(cut + '\n\n... (truncated)');
  }

  /**
   * Removes a partially-cut HTML tag from the end of a truncated string.
   * @param text - The truncated string that may end mid-tag.
   * @returns String with any partial opening tag removed.
   */
  private trimPartialTag(text: string): string {
    const lastOpen = text.lastIndexOf('<');
    const lastClose = text.lastIndexOf('>');
    return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
  }

  /**
   * Appends closing tags for any HTML tags left open in the string.
   * @param text - The potentially truncated HTML string to fix.
   * @returns String with all unclosed HTML tags properly closed.
   */
  private closeUnclosedTags(text: string): string {
    const openTags: string[] = [];
    const tagRegex = /<(\/?)(\w+)[^>]*>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      if (match[1] === '/') { if (openTags.length > 0) openTags.pop(); }
      else { openTags.push(match[2]); }
    }
    return text + openTags.reverse().map(t => `</${t}>`).join('');
  }

  /**
   * Sends an HTML-parsed message to the configured Telegram chat.
   * @param text - HTML-formatted message text to send (will be truncated if needed).
   */
  private async send(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId, text: this.truncateMessage(text), parse_mode: 'HTML'
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }

  // ─── Format dispatch ───

  /**
   * Dispatches to the correct format method based on the configured message format.
   * @param summary - The ImportSummary to format.
   * @returns Formatted HTML message string.
   */
  private formatSummary(summary: ImportSummary): string {
    const formatters: Record<MessageFormat, (s: ImportSummary) => string> = {
      /**
       * Formats as compact style (A).
       * @param s - The ImportSummary to format.
       * @returns HTML-formatted compact string.
       */
      compact: (s) => this.formatCompact(s),
      /**
       * Formats as ledger style (B).
       * @param s - The ImportSummary to format.
       * @returns HTML-formatted ledger string.
       */
      ledger: (s) => this.formatLedger(s),
      /**
       * Formats as emoji style (C).
       * @param s - The ImportSummary to format.
       * @returns HTML-formatted emoji string.
       */
      emoji: (s) => this.formatEmoji(s),
      /**
       * Formats as default summary style (D).
       * @param s - The ImportSummary to format.
       * @returns HTML-formatted summary string.
       */
      summary: (s) => this.formatDefault(s),
    };
    return (formatters[this.format] ?? formatters.summary)(summary);
  }

  // ─── Shared format helpers ───

  /**
   * Builds the bold header line with success/warning icon for the import summary.
   * @param summary - The ImportSummary used to choose the icon.
   * @returns HTML header string.
   */
  private buildHeader(summary: ImportSummary): string {
    return `${summary.failedBanks === 0 ? '✅' : '⚠️'} <b>Import Summary</b>`;
  }

  /**
   * Returns a status icon for a bank based on its import result.
   * @param bank - The BankMetrics to check.
   * @returns '✅' for success or '❌' for failure.
   */
  private bankIcon(bank: BankMetrics): string {
    return bank.status === 'success' ? '✅' : '❌';
  }

  /**
   * Appends a bank-level footer line and error message when no accounts were reported.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The BankMetrics whose footer to build.
   */
  private appendBankFooter(lines: string[], bank: BankMetrics): void {
    if (!bank.accounts?.length) {
      lines.push('');
      lines.push(`${this.bankIcon(bank)} <b>${this.escapeHtml(bank.bankName)}</b>`);
    }
    if (bank.error) lines.push(`❌ ${this.escapeHtml(bank.error)}`);
  }

  // ─── Format D: Summary (default) ───

  /**
   * Formats the import summary in the default "summary" style.
   * @param summary - The ImportSummary to format.
   * @returns HTML-formatted summary string.
   */
  private formatDefault(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      this.buildHeader(summary), '',
      `🏦 Banks: ${summary.successfulBanks}/${summary.totalBanks} ` +
        `(${summary.successRate.toFixed(0)}%)`,
      `📥 Transactions: ${summary.totalTransactions} imported`,
      `🔄 Duplicates: ${summary.totalDuplicates} skipped`,
      `⏱ Duration: ${dur}s`,
    ];
    if (summary.banks.length > 0) {
      lines.push('');
      summary.banks.forEach(b => this.appendDefaultBank(lines, b));
    }
    return lines.join('\n');
  }

  /**
   * Appends a single bank line to the default summary format output.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The BankMetrics to format.
   */
  private appendDefaultBank(lines: string[], bank: BankMetrics): void {
    const d = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
    const name = this.escapeHtml(bank.bankName);
    lines.push(`${this.bankIcon(bank)} ${name}: ${bank.transactionsImported} txns ${d}`);
    this.appendReconciliation(lines, bank);
    if (bank.error) lines.push(`   ❌ ${this.escapeHtml(bank.error)}`);
  }

  // ─── Format A: Compact ───

  /**
   * Formats the import summary in the compact "A" style with per-transaction lines.
   * @param summary - The ImportSummary to format.
   * @returns HTML-formatted compact message string.
   */
  private formatCompact(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const lines: string[] = [
      this.buildHeader(summary),
      `${summary.successfulBanks}/${summary.totalBanks} banks | ` +
        `${summary.totalTransactions} txns | ${dur}s`,
    ];
    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) this.appendCompactAccount(lines, bank, account);
      this.appendBankFooter(lines, bank);
    }
    return lines.join('\n');
  }

  /**
   * Appends compact-format transaction lines for a single account.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The bank this account belongs to.
   * @param account - The account whose transactions to format.
   */
  private appendCompactAccount(
    lines: string[], bank: BankMetrics, account: AccountMetrics
  ): void {
    lines.push('');
    lines.push(
      `${this.bankIcon(bank)} <b>${this.escapeHtml(bank.bankName)}</b>` +
      ` · ${this.escapeHtml(account.accountName ?? account.accountNumber)}`
    );
    for (const txn of this.getTransactions(account)) {
      lines.push(`${this.fmtDate(txn.date)}  ${this.escapeHtml(txn.description)}`);
      lines.push(`       <b>${this.fmtAmount(txn.amount)}</b>`);
    }
    this.appendBalance(lines, account, bank);
  }

  // ─── Format B: Ledger ───

  /**
   * Formats the import summary in the ledger "B" style with monospace table layout.
   * @param summary - The ImportSummary to format.
   * @returns HTML-formatted ledger message string.
   */
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

  /**
   * Appends ledger-format transaction lines for a single account.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The bank this account belongs to.
   * @param account - The account whose transactions to format.
   */
  private appendLedgerAccount(
    lines: string[], bank: BankMetrics, account: AccountMetrics
  ): void {
    lines.push('');
    lines.push(
      `${this.bankIcon(bank)} <b>${this.escapeHtml(bank.bankName)}</b>` +
      ` · ${this.escapeHtml(account.accountName ?? account.accountNumber)}`
    );
    const txns = this.getTransactions(account);
    if (txns.length > 0) this.appendLedgerTransactions(lines, txns);
    this.appendBalance(lines, account, bank);
  }

  /**
   * Appends monospace-formatted transaction rows inside a &lt;code&gt; block.
   * @param lines - Mutable array of message lines to append to.
   * @param txns - Transactions to render in table format.
   */
  private appendLedgerTransactions(lines: string[], txns: TransactionRecord[]): void {
    lines.push('<code>');
    for (const txn of txns) {
      const raw = txn.description.length > 18
        ? txn.description.slice(0, 18) + '..' : txn.description;
      const desc = this.escapeHtml(raw);
      lines.push(`${this.fmtDate(txn.date)} ${desc}`);
      lines.push(`${''.padStart(6)}${this.fmtAmount(txn.amount).padStart(9)}`);
    }
    lines.push('</code>');
  }

  // ─── Format C: Emoji ───

  /**
   * Formats the import summary in the emoji "C" style with directional icons per transaction.
   * @param summary - The ImportSummary to format.
   * @returns HTML-formatted emoji message string.
   */
  private formatEmoji(summary: ImportSummary): string {
    const dur = (summary.totalDuration / 1000).toFixed(1);
    const dup = summary.totalDuplicates > 0 ? ` · ${summary.totalDuplicates} dup` : '';
    const lines: string[] = [
      this.buildHeader(summary), '',
      `📊 ${summary.successfulBanks}/${summary.totalBanks} banks · ` +
        `${summary.totalTransactions} txns${dup} · ${dur}s`,
    ];
    for (const bank of summary.banks) {
      for (const account of bank.accounts || []) this.appendEmojiAccount(lines, bank, account);
      this.appendBankFooter(lines, bank);
    }
    return lines.join('\n');
  }

  /**
   * Appends emoji-format transaction lines for a single account.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The bank this account belongs to.
   * @param account - The account whose transactions to format.
   */
  private appendEmojiAccount(
    lines: string[], bank: BankMetrics, account: AccountMetrics
  ): void {
    lines.push('');
    lines.push(
      `💳 <b>${this.escapeHtml(bank.bankName)}</b>` +
      ` · ${this.escapeHtml(account.accountName ?? account.accountNumber)}`
    );
    for (const txn of this.getTransactions(account)) {
      const dir = txn.amount >= 0 ? '📥' : '📤';
      lines.push(
        `${dir} <b>${this.fmtAmount(txn.amount)}</b>  ${this.escapeHtml(txn.description)}`
      );
    }
    if (account.balance !== undefined) {
      lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
    }
    this.appendReconciliation(lines, bank);
  }

  // ─── Shared helpers ───

  /**
   * Appends the account balance and reconciliation status lines.
   * @param lines - Mutable array of message lines to append to.
   * @param account - The account whose balance to display.
   * @param bank - The bank whose reconciliation status to display.
   */
  private appendBalance(lines: string[], account: AccountMetrics, bank: BankMetrics): void {
    if (account.balance !== undefined) {
      lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
    }
    this.appendReconciliation(lines, bank);
  }

  /**
   * Appends a reconciliation status line when one exists for the bank.
   * @param lines - Mutable array of message lines to append to.
   * @param bank - The bank whose reconciliation status to check.
   */
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

  /**
   * Returns the transactions to display for an account, filtered by showTransactions setting.
   * @param account - The account whose transactions to retrieve.
   * @returns Sliced array of TransactionRecord objects up to maxTransactions.
   */
  private getTransactions(account: AccountMetrics): TransactionRecord[] {
    if (this.showTransactions === 'none') return [];
    const txns = this.showTransactions === 'all'
      ? [...account.newTransactions, ...account.existingTransactions]
      : account.newTransactions;
    return txns.slice(0, this.maxTransactions);
  }

  /**
   * Formats a cent amount as a signed decimal string (e.g. "+12.34" or "-5.67").
   * @param cents - The amount in cents to format.
   * @returns Signed decimal string with 2 decimal places.
   */
  private fmtAmount(cents: number): string {
    return `${cents >= 0 ? '+' : ''}${(cents / 100).toFixed(2)}`;
  }

  /**
   * Formats a YYYY-MM-DD date string to DD/MM for compact display.
   * @param date - YYYY-MM-DD formatted date string.
   * @returns Two-part date string like "15/03".
   */
  private fmtDate(date: string): string {
    const parts = date.split('-');
    return `${parts[2]}/${parts[1]}`;
  }

  /**
   * Escapes HTML special characters to prevent Telegram parse errors.
   * @param text - Raw text that may contain &, <, or > characters.
   * @returns HTML-safe string with special characters escaped.
   */
  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
