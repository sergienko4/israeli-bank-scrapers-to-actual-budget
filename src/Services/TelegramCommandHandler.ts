/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /watch, /logs, /help
 */

import type { INotifier } from './Notifications/INotifier.js';
import type { IAuditLog, AuditEntry } from './AuditLogService.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger, LogFileReader } from '../Logger/Index.js';

const MAX_TELEGRAM_LENGTH = 4096;
const DEFAULT_LOG_COUNT = 50;

export interface CommandHandlerOptions {
  runImport: (banks?: string[]) => Promise<number>;
  notifier: INotifier;
  auditLog?: IAuditLog;
  runWatch?: () => Promise<string | null>;
  runValidate?: () => Promise<string>;
  runPreview?: () => Promise<number>;
  getBankNames?: () => string[];
  sendScanMenu?: (banks: string[]) => Promise<void>;
  logDir?: string;
}

/** Handles bot commands dispatched from TelegramPoller (scan, status, logs, help, etc.). */
export class TelegramCommandHandler {
  private runImport: (banks?: string[]) => Promise<number>;
  private notifier: INotifier;
  private auditLog?: IAuditLog;
  private runWatch?: () => Promise<string | null>;
  private runValidate?: () => Promise<string>;
  private runPreview?: () => Promise<number>;
  private getBankNames?: () => string[];
  private sendScanMenu?: (banks: string[]) => Promise<void>;
  private logDir: string;
  private importPromise: Promise<void> | null = null;
  private lastRunTime: Date | null = null;
  private lastRunResult: string | null = null;

  /**
   * Creates a TelegramCommandHandler with the provided command callbacks and configuration.
   * @param opts - Options including import runner, notifier, audit log, and optional features.
   */
  constructor(opts: CommandHandlerOptions) {
    this.runImport = opts.runImport;
    this.notifier = opts.notifier;
    this.auditLog = opts.auditLog;
    this.runWatch = opts.runWatch;
    this.runValidate = opts.runValidate;
    this.runPreview = opts.runPreview;
    this.getBankNames = opts.getBankNames;
    this.sendScanMenu = opts.sendScanMenu;
    this.logDir = opts.logDir ?? './logs';
  }

  /**
   * Routes an incoming message or callback query text to the correct command handler.
   * @param text - The raw message text or callback_data string to dispatch.
   */
  async handle(text: string): Promise<void> {
    const raw = text.trim().split(/\s+/);
    const command = raw[0].toLowerCase();
    const arg = raw.slice(1).join(' ').trim() || undefined;
    // Callback query data: "scan:bankName" or "scan_all"
    if (command === 'scan_all') { await this.handleScanAll(); return; }
    if (command.startsWith('scan:')) { await this.handleScan(command.slice(5)); return; }
    const handlers: Record<string, () => Promise<void>> = {
      /**
       * Handles /scan command.
       * @returns Promise resolving when the command is processed.
       */
      '/scan': () => this.handleScan(arg),
      /**
       * Handles /import alias for /scan.
       * @returns Promise resolving when the command is processed.
       */
      '/import': () => this.handleScan(arg),
      /**
       * Handles /status command.
       * @returns Promise resolving when the command is processed.
       */
      '/status': () => this.handleStatus(),
      /**
       * Handles /logs command.
       * @returns Promise resolving when the command is processed.
       */
      '/logs': () => this.handleLogs(arg),
      /**
       * Handles /watch command.
       * @returns Promise resolving when the command is processed.
       */
      '/watch': () => this.handleWatch(),
      /**
       * Handles /check_config command.
       * @returns Promise resolving when the command is processed.
       */
      '/check_config': () => this.handleCheckConfig(),
      /**
       * Handles /preview command.
       * @returns Promise resolving when the command is processed.
       */
      '/preview': () => this.handlePreview(),
      /**
       * Handles /help command.
       * @returns Promise resolving when the command is processed.
       */
      '/help': () => this.handleHelp(),
      /**
       * Handles /start command (alias for /help).
       * @returns Promise resolving when the command is processed.
       */
      '/start': () => this.handleHelp(),
    };
    const handler = handlers[command];
    if (handler) await handler();
  }

  /** Handles the scan_all callback — imports all configured banks. */
  private async handleScanAll(): Promise<void> {
    if (this.importPromise) { await this.reply('⏳ Import already running. Please wait.'); return; }
    this.importPromise = this.executeImport(undefined);
    await this.importPromise;
  }

  /**
   * Handles the /scan command — shows bank menu or starts a targeted import.
   * @param bankArg - Optional bank name or comma-separated list to limit the import scope.
   */
  private async handleScan(bankArg?: string): Promise<void> {
    if (this.importPromise) { await this.reply('⏳ Import already running. Please wait.'); return; }
    if (!bankArg && this.sendScanMenu && this.getBankNames) {
      const banks = this.getBankNames();
      if (banks.length > 0) { await this.sendScanMenu(banks); return; }
    }
    const banks = bankArg ? this.resolveBanks(bankArg) : undefined;
    if (typeof banks === 'string') { await this.reply(banks); return; }
    this.importPromise = this.executeImport(banks);
    await this.importPromise;
  }

  /**
   * Resolves a comma-separated bank argument to matched available bank names.
   * @param bankArg - Comma-separated bank name string from the user's command.
   * @returns Array of resolved bank names, or an error string if any are unknown.
   */
  private resolveBanks(bankArg: string): string[] | string {
    const requested = bankArg.split(',').map(b => b.trim()).filter(Boolean);
    const available = this.getBankNames?.() ?? [];
    if (!available.length) return requested; // no validation if getBankNames not provided
    /**
     * Case-insensitively matches a requested bank name against the available list.
     * @param r - The requested bank name to match.
     * @returns The matched available bank name, or the original if unmatched.
     */
    const match = (r: string): string =>
      available.find(a => a.toLowerCase() === r.toLowerCase()) ?? r;
    const resolved = requested.map(match);
    const unknown = resolved.filter(r => !available.includes(r));
    if (unknown.length) {
      return `❌ Unknown bank: "${unknown[0]}". Available: ${available.join(', ')}`;
    }
    return resolved;
  }

  /**
   * Runs the import pipeline and reports success/failure back to Telegram.
   * @param banks - Optional list of banks to import; undefined imports all.
   */
  private async executeImport(banks?: string[]): Promise<void> {
    const label = banks ? ` (${banks.join(', ')})` : '';
    await this.reply(`⏳ Starting import...${label}`);
    const start = Date.now();
    try {
      const exitCode = await this.runImport(banks);
      const dur = ((Date.now() - start) / 1000).toFixed(0);
      this.lastRunTime = new Date();
      this.lastRunResult = exitCode === 0 ? 'success' : 'failed';
      if (exitCode !== 0) {
        await this.reply(this.buildErrorReply(dur));
      }
    } finally {
      this.importPromise = null;
    }
  }

  /**
   * Builds a detailed error reply message using the most recent audit log entry.
   * @param dur - Human-readable duration string for the failed import.
   * @returns Multi-line error reply text with failed bank details.
   */
  private buildErrorReply(dur: string): string {
    const entry = this.auditLog?.getRecent(1)[0];
    if (!entry || entry.failedBanks === 0) {
      return `❌ Import failed (${dur}s). Use /logs for details.`;
    }
    const failed = entry.banks.filter(b => b.status === 'failed');
    const header = `❌ Import failed (${dur}s) — ` +
      `${entry.failedBanks}/${entry.totalBanks} banks had errors:`;
    const lines = [header];
    for (const b of failed) {
      lines.push(`• ${b.name}${b.error ? `: ${b.error.slice(0, 80)}` : ''}`);
    }
    lines.push('', 'Use /logs for details or /status for history.');
    return lines.join('\n');
  }

  /** Sends the current import status and recent audit history to Telegram. */
  private async handleStatus(): Promise<void> {
    const lines: string[] = ['📊 <b>Status</b>', ''];
    lines.push(this.lastRunTime
      ? `Last run: ${this.timeSince(this.lastRunTime)} ago (${this.lastRunResult})`
      : 'No imports run yet');
    lines.push(`Currently: ${this.importPromise ? '⏳ importing...' : '✅ idle'}`);
    this.appendRecentHistory(lines);
    await this.reply(lines.join('\n'));
  }

  /**
   * Appends the 5 most recent audit entries to the status message lines.
   * @param lines - Mutable array of message lines to append audit history to.
   */
  private appendRecentHistory(lines: string[]): void {
    if (!this.auditLog) return;
    const recent = this.auditLog.getRecent(5);
    if (recent.length === 0) return;
    lines.push('', '<b>Recent imports:</b>');
    recent.reverse().forEach(e => lines.push(this.formatAuditEntry(e)));
  }

  /**
   * Formats a single audit log entry as a one-line status summary.
   * @param entry - The AuditEntry to format.
   * @returns Formatted string with date, transaction count, and bank success rate.
   */
  private formatAuditEntry(entry: AuditEntry): string {
    const date = entry.timestamp.split('T')[0];
    const time = entry.timestamp.split('T')[1]?.slice(0, 5) || '';
    const dur = `${(entry.totalDuration / 1000).toFixed(0)}s`;
    const icon = entry.failedBanks === 0 ? '✅' : '⚠️';
    return (
      `${icon} ${date} ${time} — ` +
      `${entry.totalTransactions} txns, ${entry.successfulBanks}/${entry.totalBanks} banks, ${dur}`
    );
  }

  /**
   * Reads recent log entries from files and sends them to Telegram.
   * @param countArg - Optional string number of entries to retrieve (default 50, max 150).
   */
  private async handleLogs(countArg?: string): Promise<void> {
    const reader = new LogFileReader(this.logDir);
    const entries = reader.getRecent(this.parseLogCount(countArg));
    if (entries.length === 0) { await this.reply('📋 No log entries yet.'); return; }
    const header = `📋 <b>Recent Logs</b> (${entries.length} entries)\n\n<pre>`;
    const footer = '</pre>';
    const body = this.truncateForTelegram(entries, header.length + footer.length);
    await this.reply(header + body + footer);
  }

  /**
   * Parses an optional count argument string to a bounded integer.
   * @param arg - Optional string argument from the user (e.g. "100").
   * @returns Integer count between 1 and 150, defaulting to 50.
   */
  private parseLogCount(arg?: string): number {
    if (!arg) return DEFAULT_LOG_COUNT;
    const n = parseInt(arg, 10);
    return isNaN(n) ? DEFAULT_LOG_COUNT : Math.min(Math.max(n, 1), 150);
  }

  /**
   * Truncates a list of log entries to fit within Telegram's message size limit.
   * @param entries - Array of log line strings to truncate.
   * @param reservedLength - Number of characters already used by header/footer wrappers.
   * @returns Truncated log string with an omission notice if needed.
   */
  private truncateForTelegram(entries: string[], reservedLength: number): string {
    const maxLength = MAX_TELEGRAM_LENGTH - reservedLength - 20;
    const text = entries.join('\n');
    if (text.length <= maxLength) return text;
    const trimmed = text.slice(-maxLength);
    const firstNewline = trimmed.indexOf('\n');
    const clean = firstNewline > 0 ? trimmed.slice(firstNewline + 1) : trimmed;
    return '...(earlier entries omitted)\n' + clean;
  }

  /** Handles the /watch command — runs the spending watch or explains it runs automatically. */
  private async handleWatch(): Promise<void> {
    if (!this.runWatch) {
      await this.reply(
        '🔔 Spending watch runs automatically after each import.\n' +
        'On-demand /watch is coming soon.\n\n' +
        'Use /scan to trigger an import with spending watch.'
      );
      return;
    }
    await this.reply('🔍 Checking spending rules...');
    try {
      const message = await this.runWatch();
      await this.reply(message ?? '✅ All spending within limits.');
    } catch (error: unknown) {
      await this.reply(`❌ Watch error: ${errorMessage(error)}`);
    }
  }

  /** Handles the /check_config command — runs offline and online config validation. */
  private async handleCheckConfig(): Promise<void> {
    if (!this.runValidate) {
      await this.reply('⚙️ Config validation unavailable.');
      return;
    }
    await this.reply('🔍 Validating configuration...');
    try {
      const report = await this.runValidate();
      await this.reply(`<pre>${report}</pre>`);
    } catch (error: unknown) {
      await this.reply(`❌ Validation error: ${errorMessage(error)}`);
    }
  }

  /** Handles the /preview command — runs a dry-run import without writing to Actual Budget. */
  private async handlePreview(): Promise<void> {
    if (!this.runPreview) {
      await this.reply('🔍 Preview mode unavailable.');
      return;
    }
    if (this.importPromise) { await this.reply('⏳ Import already running. Please wait.'); return; }
    await this.reply('🔍 Starting dry run — no changes will be made...');
    this.importPromise = this.executePreview(this.runPreview);
    await this.importPromise;
  }

  /**
   * Runs the preview function and reports completion or error to Telegram.
   * @param run - Async function that executes the dry-run import.
   */
  private async executePreview(run: () => Promise<number>): Promise<void> {
    const start = Date.now();
    try {
      await run();
      const dur = ((Date.now() - start) / 1000).toFixed(0);
      await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
    } catch (error: unknown) {
      await this.reply(`❌ Preview error: ${errorMessage(error)}`);
    } finally {
      this.importPromise = null;
    }
  }

  /** Sends the list of available bot commands to Telegram. */
  private async handleHelp(): Promise<void> {
    const lines = [
      '🤖 <b>Available Commands</b>', '',
      '/scan - Run bank import now',
      '/preview - Dry run: scrape without importing',
      '/status - Show last run info + history',
      '/check_config - Check configuration (offline + online)',
      '/watch - Spending watch info (runs after each import)',
      '/logs - Show recent log entries',
      '/logs 100 - Show last 100 entries (max 150)',
      '/help - Show this message',
    ];
    await this.reply(lines.join('\n'));
  }

  /**
   * Sends a message to Telegram, catching and logging any send failures.
   * @param text - The message text to send.
   */
  private async reply(text: string): Promise<void> {
    try { await this.notifier.sendMessage(text); }
    catch (error: unknown) {
      getLogger().debug(`Failed to send reply: ${errorMessage(error)}`);
    }
  }

  /**
   * Returns a human-readable string describing how long ago the given date was.
   * @param date - The Date to compare against the current time.
   * @returns Duration string like "45s", "5m", or "2h".
   */
  private timeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
