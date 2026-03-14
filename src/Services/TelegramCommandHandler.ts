/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /watch, /logs, /help
 */

import type { INotifier } from './Notifications/INotifier.js';
import type { IAuditLog, AuditEntry } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { BatchResult } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger, LogFileReader } from '../Logger/Index.js';
import { getScraperErrorAdvice } from '../Errors/ScraperErrorMessages.js';

const MAX_TELEGRAM_LENGTH = 4096;
const DEFAULT_LOG_COUNT = 50;
const ALREADY_RUNNING = '⏳ Import already running. Please wait.';

/** Options for constructing a TelegramCommandHandler. */
export interface CommandHandlerOptions {
  /** The ImportMediator that handles import requests. */
  readonly mediator: ImportMediator;
  /** Notifier for sending Telegram messages. */
  readonly notifier: INotifier;
  /** Optional audit log for recording import history. */
  readonly auditLog?: IAuditLog;
  /** Optional callback to run spending watch rules. */
  readonly runWatch?: () => Promise<string | null>;
  /** Optional callback to validate the configuration. */
  readonly runValidate?: () => Promise<string>;
  /** Optional callback to get all configured bank names. */
  readonly getBankNames?: () => string[];
  /** Optional callback to display the inline keyboard scan menu. */
  readonly sendScanMenu?: (banks: string[]) => Promise<void>;
  /** Directory containing log files. */
  readonly logDir?: string;
}

/** Handles bot commands dispatched from TelegramPoller (scan, status, logs, help, etc.). */
export class TelegramCommandHandler {
  private readonly mediator: ImportMediator;
  private readonly notifier: INotifier;
  private readonly auditLog?: IAuditLog;
  private readonly runWatch?: () => Promise<string | null>;
  private readonly runValidate?: () => Promise<string>;
  private readonly getBankNames?: () => string[];
  private readonly sendScanMenu?: (banks: string[]) => Promise<void>;
  private readonly logDir: string;

  /**
   * Creates a TelegramCommandHandler with the provided command callbacks and configuration.
   * @param opts - Options including mediator, notifier, audit log, and optional features.
   */
  constructor(opts: CommandHandlerOptions) {
    this.mediator = opts.mediator;
    this.notifier = opts.notifier;
    this.auditLog = opts.auditLog;
    this.runWatch = opts.runWatch;
    this.runValidate = opts.runValidate;
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
    if (command === 'scan_all') { await this.handleScanAll(); return; }
    if (command.startsWith('scan:')) { await this.handleScan(command.slice(5)); return; }
    const handler = this.buildHandlers(arg)[command];
    if (handler) await handler();
  }

  /**
   * Builds the command → handler dispatch map for slash commands.
   * @param arg - Optional argument parsed from the user's message.
   * @returns Record mapping command strings to async handler functions.
   */
  private buildHandlers(arg?: string): Record<string, () => Promise<void>> {
    return this.commandMap(arg);
  }

  /**
   * Returns the slash-command dispatch map wired to handler methods.
   * @param arg - Optional argument from the user's message.
   * @returns Record mapping command strings to handler functions.
   */
  private commandMap(arg?: string): Record<string, () => Promise<void>> {
    return {
      '/scan': this.handleScan.bind(this, arg),
      '/import': this.handleScan.bind(this, arg),
      '/status': this.handleStatus.bind(this),
      '/logs': this.handleLogs.bind(this, arg),
      '/watch': this.handleWatch.bind(this),
      '/check_config': this.handleCheckConfig.bind(this),
      '/preview': this.handlePreview.bind(this),
      '/help': this.handleHelp.bind(this),
      '/retry': this.handleRetry.bind(this),
      '/start': this.handleHelp.bind(this),
    };
  }

  /** Handles the scan_all callback — imports all configured banks. */
  private async handleScanAll(): Promise<void> {
    if (this.mediator.isImporting()) {
      await this.reply(ALREADY_RUNNING);
      return;
    }
    await this.executeImport(undefined);
  }

  /**
   * Handles the /scan command — shows bank menu or starts a targeted import.
   * @param bankArg - Optional bank name or comma-separated list to limit the import scope.
   */
  private async handleScan(bankArg?: string): Promise<void> {
    if (this.mediator.isImporting()) {
      await this.reply(ALREADY_RUNNING);
      return;
    }
    if (!bankArg && this.sendScanMenu && this.getBankNames) {
      const banks = this.getBankNames();
      if (banks.length > 0) { await this.sendScanMenu(banks); return; }
    }
    const banks = bankArg ? this.resolveBanks(bankArg) : undefined;
    if (typeof banks === 'string') { await this.reply(banks); return; }
    await this.executeImport(banks);
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
   * Requests an import via the mediator and reports the batch result.
   * @param banks - Optional list of banks to import; undefined imports all.
   */
  private async executeImport(banks?: string[]): Promise<void> {
    const label = banks ? ` (${banks.join(', ')})` : '';
    await this.reply(`⏳ Starting import...${label}`);
    const batchId = this.mediator.requestImport({ source: 'telegram', banks });
    if (!batchId) { await this.reply(ALREADY_RUNNING); return; }
    const result = await this.mediator.waitForBatch(batchId);
    if (result.failureCount > 0) {
      await this.reply(this.buildBatchErrorReply(result));
    }
  }

  /**
   * Builds a detailed error reply from a BatchResult and the most recent audit entry.
   * @param batch - The completed BatchResult with failure information.
   * @returns Multi-line error reply text with failed bank details.
   */
  private buildBatchErrorReply(batch: BatchResult): string {
    const dur = (batch.totalDurationMs / 1000).toFixed(0);
    const entry = this.auditLog?.getRecent(1)[0];
    if (!entry || !this.isFreshEntry(entry, batch)) {
      return `❌ Import failed (${dur}s). Use /logs for details.`;
    }
    return this.formatFailedBanks(entry, dur);
  }

  /**
   * Checks whether an audit entry was recorded during or after the current batch.
   * @param entry - The audit log entry to check.
   * @param batch - The BatchResult whose timing to compare against.
   * @returns True if the entry timestamp is at or after the batch start time.
   */
  private isFreshEntry(entry: AuditEntry, batch: BatchResult): boolean {
    const batchStartMs = Date.now() - batch.totalDurationMs;
    return new Date(entry.timestamp).getTime() >= batchStartMs;
  }

  /**
   * Formats the failed-banks section of an error reply from an audit entry.
   * @param entry - The audit entry containing bank failure details.
   * @param dur - Human-readable duration string for display.
   * @returns Multi-line formatted string listing failed banks and their errors.
   */
  private formatFailedBanks(entry: AuditEntry, dur: string): string {
    if (entry.failedBanks === 0) {
      return `❌ Import failed (${dur}s). Use /logs for details.`;
    }
    const failed = entry.banks.filter(b => b.status === 'failure');
    const header = `❌ Import failed (${dur}s) — ` +
      `${entry.failedBanks}/${entry.totalBanks} banks had errors:`;
    const lines = [header, ...failed.map(b => this.formatBankError(b))];
    lines.push('', 'Use /logs for details or /status for history.');
    return lines.join('\n');
  }

  /**
   * Formats a single failed bank entry with error details and actionable advice.
   * @param bank - The bank object from the audit entry with name and optional error.
   * @returns Formatted bullet-point string with error and optional advice line.
   */
  private formatBankError(bank: AuditEntry['banks'][number]): string {
    const line = `• ${bank.name}${bank.error ? `: ${bank.error.slice(0, 80)}` : ''}`;
    const advice = bank.error ? getScraperErrorAdvice(bank.error) : undefined;
    const streak = this.getFailureStreak(bank.name);
    return [line, ...this.buildErrorAnnotations(advice, streak)].join('\n');
  }

  /**
   * Builds annotation lines for a bank error (advice + consecutive failure warning).
   * @param advice - Optional actionable advice string from ScraperErrorMessages.
   * @param streak - Number of consecutive failures for this bank.
   * @returns Array of annotation lines to append after the error line.
   */
  private buildErrorAnnotations(advice: string | undefined, streak: number): string[] {
    const lines: string[] = [];
    if (advice) lines.push(`  💡 ${advice}`);
    if (streak >= 5) lines.push('  🚨 Failed 5+ times in a row — check credentials');
    else if (streak >= 3) lines.push(`  ⚠️ Failed ${streak} times in a row`);
    return lines;
  }

  /**
   * Returns the consecutive failure count for a bank from the audit log.
   * @param bankName - The bank to check.
   * @returns Number of consecutive recent failures, or 0.
   */
  private getFailureStreak(bankName: string): number {
    return this.auditLog?.getConsecutiveFailures(bankName) ?? 0;
  }

  /** Sends the current import status and recent audit history to Telegram. */
  private async handleStatus(): Promise<void> {
    const lines: string[] = ['📊 <b>Status</b>', ''];
    const lastTime = this.mediator.getLastRunTime();
    const lastResult = this.mediator.getLastResult();
    const label = lastResult ? (lastResult.failureCount === 0 ? 'success' : 'failed') : null;
    lines.push(lastTime
      ? `Last run: ${this.timeSince(lastTime)} ago (${label})`
      : 'No imports run yet');
    lines.push(`Currently: ${this.mediator.isImporting() ? '⏳ importing...' : '✅ idle'}`);
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
    if (this.mediator.isImporting()) {
      await this.reply(ALREADY_RUNNING);
      return;
    }
    await this.reply('🔍 Starting dry run — no changes will be made...');
    const batchId = this.mediator.requestImport({
      source: 'telegram', extraEnv: { DRY_RUN: 'true' },
    });
    if (!batchId) { await this.reply(ALREADY_RUNNING); return; }
    const result = await this.mediator.waitForBatch(batchId);
    const dur = (result.totalDurationMs / 1000).toFixed(0);
    await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
  }

  /** Re-imports only the banks that failed in the last run. */
  private async handleRetry(): Promise<void> {
    if (this.mediator.isImporting()) { await this.reply(ALREADY_RUNNING); return; }
    const failed = this.auditLog?.getLastFailedBanks() ?? [];
    if (!failed.length) {
      await this.reply('✅ No failed banks to retry. Last run was successful.');
      return;
    }
    await this.reply(`🔄 Retrying ${failed.length} failed bank(s): ${failed.join(', ')}...`);
    await this.executeImport(failed);
  }

  /** Sends the list of available bot commands to Telegram. */
  private async handleHelp(): Promise<void> {
    const lines = [
      '🤖 <b>Available Commands</b>', '',
      '/scan - Run bank import now',
      '/retry - Re-import only last failed banks',
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
