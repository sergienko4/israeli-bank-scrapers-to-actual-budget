/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /watch, /logs, /help
 */

import { getLogger, LogFileReader } from '../Logger/Index.js';
import type { IBatchResult, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { IAuditLog } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { ReceiptImportHandler } from './ReceiptImportHandler.js';
import {
  formatAuditEntry, formatFailedBanks,
  isFreshEntry, parseLogCount, timeSince,
  truncateForTelegram} from './TelegramCommandFormatters.js';

const ALREADY_RUNNING = '⏳ Import already running. Please wait.';

/** Options for constructing a TelegramCommandHandler. */
export interface ICommandHandlerOptions {
  /** The ImportMediator that handles import requests. */
  readonly mediator: ImportMediator;
  /** Notifier for sending Telegram messages. */
  readonly notifier: INotifier;
  /** Optional audit log for recording import history. */
  readonly auditLog?: IAuditLog;
  /** Optional callback to run spending watch rules. */
  readonly runWatch?: () => Promise<string>;
  /** Optional callback to validate the configuration. */
  readonly runValidate?: () => Promise<string>;
  /** Optional callback to get all configured bank names. */
  readonly getBankNames?: () => string[];
  /** Optional callback to display the inline keyboard scan menu. */
  readonly sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;
  /** Directory containing log files. */
  readonly logDir?: string;
  /** Optional receipt import handler for photo receipt processing. */
  readonly receiptHandler?: ReceiptImportHandler;
}

/** Handles bot commands dispatched from TelegramPoller. */
export class TelegramCommandHandler {
  private readonly _mediator: ImportMediator;
  private readonly _notifier: INotifier;
  private readonly _auditLog?: IAuditLog;
  private readonly _runWatch?: () => Promise<string>;
  private readonly _runValidate?: () => Promise<string>;
  private readonly _getBankNames?: () => string[];
  private readonly _sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;
  private readonly _logDir: string;
  private readonly _receiptHandler?: ReceiptImportHandler;

  /**
   * Creates a TelegramCommandHandler with the provided options.
   * @param opts - Options including mediator, notifier, and features.
   */
  constructor(opts: ICommandHandlerOptions) {
    this._mediator = opts.mediator;
    this._notifier = opts.notifier;
    this._auditLog = opts.auditLog;
    this._runWatch = opts.runWatch;
    this._runValidate = opts.runValidate;
    this._getBankNames = opts.getBankNames;
    this._sendScanMenu = opts.sendScanMenu;
    this._logDir = opts.logDir ?? './logs';
    this._receiptHandler = opts.receiptHandler;
  }

  /**
   * Routes an incoming message or callback to the correct handler.
   * @param text - The raw message text or callback_data string.
   * @returns Procedure indicating the command was handled.
   */
  public async handle(text: string): Promise<Procedure<{ status: string }>> {
    const raw = text.trim().split(/\s+/);
    const command = raw[0].toLowerCase();
    const arg = raw.slice(1).join(' ').trim() || void 0;
    return this.dispatchCommand(command, arg);
  }

  /**
   * Handles an incoming photo message.
   * @param fileId - Telegram file_id of the photo.
   * @param _caption - Optional caption text (reserved for future use).
   * @returns Procedure indicating the processing result.
   */
  public async handlePhoto(
    fileId: string, _caption?: string
  ): Promise<Procedure<{ status: string }>> {
    if (!this._receiptHandler) return succeed({ status: 'receipt-not-configured' });
    return this._receiptHandler.handlePhoto(fileId);
  }

  /**
   * Dispatches a parsed command to its handler method.
   * @param command - Lowercase command string to route.
   * @param arg - Optional argument from the user's message.
   * @returns Procedure indicating the command was handled.
   */
  private async dispatchCommand(
    command: string, arg?: string
  ): Promise<Procedure<{ status: string }>> {
    if (this._receiptHandler && command.startsWith('receipt_')) {
      return this.routeReceiptCallback(command);
    }
    if (command.startsWith('scan:')) {
      const bankName = command.slice(5);
      return this.handleScan(bankName);
    }
    const handlers = this.commandMap(arg);
    if (command in handlers) await handlers[command]();
    return succeed({ status: 'handled' });
  }

  /**
   * Returns the slash-command dispatch map.
   * @param arg - Optional argument from the user's message.
   * @returns Record mapping command strings to handler functions.
   */
  private commandMap(
    arg?: string
  ): Record<string, () => Promise<Procedure<{ status: string }>>> {
    return {
      scan_all: this.handleScanAll.bind(this),
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
      '/import_receipt': this.handleImportReceipt.bind(this),
    };
  }

  /**
   * Imports all configured banks.
   * @returns Procedure indicating the scan-all result.
   */
  private async handleScanAll(): Promise<Procedure<{ status: string }>> {
    if (this._mediator.isImporting()) { await this.reply(ALREADY_RUNNING); return succeed({ status: 'already-running' }); }
    await this.executeImport();
    return succeed({ status: 'scan-all-started' });
  }

  /**
   * Shows bank menu or starts a targeted import.
   * @param bankArg - Optional bank name or comma-separated list.
   * @returns Procedure indicating the scan result.
   */
  private async handleScan(
    bankArg?: string
  ): Promise<Procedure<{ status: string }>> {
    if (this._mediator.isImporting()) {
      await this.reply(ALREADY_RUNNING);
      return succeed({ status: 'already-running' });
    }
    if (!bankArg && this._sendScanMenu && this._getBankNames) {
      const banks = this._getBankNames();
      if (banks.length > 0) { await this._sendScanMenu(banks); return succeed({ status: 'menu-sent' }); }
    }
    const banks = bankArg ? this.resolveBanks(bankArg) : void 0;
    if (typeof banks === 'string') { await this.reply(banks); return succeed({ status: 'error-sent' }); }
    await this.executeImport(banks);
    return succeed({ status: 'scan-started' });
  }

  /**
   * Resolves a comma-separated bank argument to matched names.
   * @param bankArg - Comma-separated bank name string.
   * @returns Array of resolved bank names, or an error string.
   */
  private resolveBanks(bankArg: string): string[] | string {
    const requested = bankArg.split(',').map(b => b.trim()).filter(Boolean);
    const available = this._getBankNames?.() ?? [];
    if (!available.length) return requested;
    /**
     * Case-insensitive match against available banks.
     * @param r - The requested bank name to match.
     * @returns The matched available bank name, or the original.
     */
    const match = (r: string): string =>
      available.find(a => a.toLowerCase() === r.toLowerCase()) ?? r;
    const resolved = requested.map(match);
    const unknown = resolved.filter(r => !available.includes(r));
    if (unknown.length) return `❌ Unknown bank: "${unknown[0]}". Available: ${available.join(', ')}`;
    return resolved;
  }

  /**
   * Requests an import and reports the batch result.
   * @param banks - Optional list of banks to import.
   * @returns Procedure indicating the import completion status.
   */
  private async executeImport(
    banks?: string[]
  ): Promise<Procedure<{ status: string }>> {
    const label = banks ? ` (${banks.join(', ')})` : '';
    await this.reply(`⏳ Starting import...${label}`);
    const batchId = this._mediator.requestImport({ source: 'telegram', banks });
    if (!batchId) { await this.reply(ALREADY_RUNNING); return succeed({ status: 'already-running' }); }
    const result = await this._mediator.waitForBatch(batchId);
    if (result.failureCount > 0) {
      const errorReply = this.buildBatchErrorReply(result);
      await this.reply(errorReply);
    }
    return succeed({ status: 'import-complete' });
  }

  /**
   * Builds a detailed error reply from a IBatchResult.
   * @param batch - The completed IBatchResult with failure information.
   * @returns Multi-line error reply text with failed bank details.
   */
  private buildBatchErrorReply(batch: IBatchResult): string {
    const dur = (batch.totalDurationMs / 1000).toFixed(0);
    const recentResult = this._auditLog?.getRecent(1);
    const entry = recentResult?.success ? recentResult.data[0] : void 0;
    if (!entry || !isFreshEntry(entry, batch)) {
      return `❌ Import failed (${dur}s). Use /logs for details.`;
    }
    return formatFailedBanks(entry, dur, this._auditLog);
  }

  /**
   * Sends import status and recent audit history.
   * @returns Procedure indicating the status message was sent.
   */
  private async handleStatus(): Promise<Procedure<{ status: string }>> {
    const lines = this.buildStatusLines();
    this.appendRecentHistory(lines);
    const statusMessage = lines.join('\n');
    await this.reply(statusMessage);
    return succeed({ status: 'status-sent' });
  }

  /**
   * Assembles the header and last-run lines for /status.
   * @returns Array of message lines with status information.
   */
  private buildStatusLines(): string[] {
    const lines: string[] = ['📊 <b>Status</b>', ''];
    const lastTime = this._mediator.getLastRunTime();
    const lastResult = this._mediator.getLastResult();
    const resultLabel = lastResult?.failureCount === 0 ? 'success' : 'failed';
    const label = lastResult ? ` (${resultLabel})` : '';
    const runLine = lastTime ? `Last run: ${timeSince(lastTime)} ago${label}` : 'No imports run yet';
    const currentLine = `Currently: ${this._mediator.isImporting() ? '⏳ importing...' : '✅ idle'}`;
    lines.push(runLine, currentLine);
    return lines;
  }

  /**
   * Appends the 5 most recent audit entries to the lines array.
   * @param lines - Mutable array of message lines to append to.
   * @returns Procedure indicating whether history was appended.
   */
  private appendRecentHistory(lines: string[]): Procedure<{ status: string }> {
    if (!this._auditLog) return succeed({ status: 'no-audit-log' });
    const recentResult = this._auditLog.getRecent(5);
    if (!recentResult.success || recentResult.data.length === 0) return succeed({ status: 'no-history' });
    lines.push('', '<b>Recent imports:</b>');
    for (const entry of [...recentResult.data].reverse()) {
      const formatted = formatAuditEntry(entry);
      lines.push(formatted);
    }
    return succeed({ status: 'history-appended' });
  }

  /**
   * Reads recent log entries from files and sends them.
   * @param countArg - Optional string number of entries (default 50).
   * @returns Procedure indicating the logs were sent.
   */
  private async handleLogs(countArg?: string): Promise<Procedure<{ status: string }>> {
    const reader = new LogFileReader(this._logDir);
    const logCount = parseLogCount(countArg);
    const entries = reader.getRecent(logCount);
    if (entries.length === 0) { await this.reply('📋 No log entries yet.'); return succeed({ status: 'no-logs' }); }
    const header = `📋 <b>Recent Logs</b> (${String(entries.length)} entries)\n\n<pre>`;
    const footer = '</pre>';
    const body = truncateForTelegram(entries, header.length + footer.length);
    await this.reply(header + body + footer);
    return succeed({ status: 'logs-sent' });
  }

  /**
   * Runs spending watch rules or explains automatic mode.
   * @returns Procedure indicating the watch command result.
   */
  private async handleWatch(): Promise<Procedure<{ status: string }>> {
    if (!this._runWatch) {
      await this.reply('🔔 Spending watch runs automatically after each import.\nOn-demand /watch is coming soon.\n\nUse /scan to trigger an import with spending watch.');
      return succeed({ status: 'watch-unavailable' });
    }
    await this.reply('🔍 Checking spending rules...');
    try { const message = await this._runWatch(); await this.reply(message || '✅ All spending within limits.'); }
    catch (error: unknown) { await this.reply(`❌ Watch error: ${errorMessage(error)}`); }
    return succeed({ status: 'watch-complete' });
  }

  /**
   * Runs offline and online config validation.
   * @returns Procedure indicating the config check result.
   */
  private async handleCheckConfig(): Promise<Procedure<{ status: string }>> {
    if (!this._runValidate) { await this.reply('⚙️ Config validation unavailable.'); return succeed({ status: 'validate-unavailable' }); }
    await this.reply('🔍 Validating configuration...');
    try { const report = await this._runValidate(); await this.reply(`<pre>${report}</pre>`); }
    catch (error: unknown) { await this.reply(`❌ Validation error: ${errorMessage(error)}`); }
    return succeed({ status: 'config-checked' });
  }

  /**
   * Runs a dry-run import without writing to Actual Budget.
   * @returns Procedure indicating the preview result.
   */
  private async handlePreview(): Promise<Procedure<{ status: string }>> {
    if (this._mediator.isImporting()) { await this.reply(ALREADY_RUNNING); return succeed({ status: 'already-running' }); }
    await this.reply('🔍 Starting dry run — no changes will be made...');
    const batchId = this._mediator.requestImport({ source: 'telegram', extraEnv: { DRY_RUN: 'true' } });
    if (!batchId) { await this.reply(ALREADY_RUNNING); return succeed({ status: 'already-running' }); }
    const result = await this._mediator.waitForBatch(batchId);
    const dur = (result.totalDurationMs / 1000).toFixed(0);
    await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
    return succeed({ status: 'preview-complete' });
  }

  /**
   * Re-imports only the banks that failed in the last run.
   * @returns Procedure indicating the retry result.
   */
  private async handleRetry(): Promise<Procedure<{ status: string }>> {
    if (this._mediator.isImporting()) { await this.reply(ALREADY_RUNNING); return succeed({ status: 'already-running' }); }
    const failedResult = this._auditLog?.getLastFailedBanks();
    const failed = failedResult?.success ? failedResult.data : [];
    if (!failed.length) { await this.reply('✅ No failed banks to retry. Last run was successful.'); return succeed({ status: 'nothing-to-retry' }); }
    await this.reply(`🔄 Retrying ${String(failed.length)} failed bank(s): ${failed.join(', ')}...`);
    await this.executeImport(failed);
    return succeed({ status: 'retry-started' });
  }

  /**
   * Sends the list of available bot commands.
   * @returns Procedure indicating the help message was sent.
   */
  private async handleHelp(): Promise<Procedure<{ status: string }>> {
    const lines = [
      '🤖 <b>Available Commands</b>', '',
      '/scan - Run bank import now', '/retry - Re-import only last failed banks',
      '/preview - Dry run: scrape without importing', '/status - Show last run info + history',
      '/check_config - Check configuration (offline + online)', '/watch - Spending watch info (runs after each import)',
      '/import_receipt - Import from receipt photo',
      '/logs - Show recent log entries', '/logs 100 - Show last 100 entries (max 150)', '/help - Show this message',
    ];
    const helpMessage = lines.join('\n');
    await this.reply(helpMessage);
    return succeed({ status: 'help-sent' });
  }

  /**
   * Sends a message to Telegram, catching any send failures.
   * @param text - The message text to send.
   * @returns Procedure indicating the reply status.
   */
  private async reply(text: string): Promise<Procedure<{ status: string }>> {
    try { await this._notifier.sendMessage(text); return succeed({ status: 'reply-sent' }); }
    catch (error: unknown) { getLogger().debug(`Failed to send reply: ${errorMessage(error)}`); return succeed({ status: 'reply-failed' }); }
  }

  /**
   * Starts the receipt import flow.
   * @returns Procedure indicating the prompt was sent.
   */
  private async handleImportReceipt(): Promise<Procedure<{ status: string }>> {
    if (!this._receiptHandler) { await this.reply('❌ Receipt import is not configured.'); return succeed({ status: 'not-configured' }); }
    return this._receiptHandler.start();
  }

  /**
   * Routes receipt_* callbacks to the ReceiptImportHandler.
   * @param command - The callback_data string starting with 'receipt_'.
   * @returns Procedure indicating the callback was handled.
   */
  private async routeReceiptCallback(command: string): Promise<Procedure<{ status: string }>> {
    const handler = this._receiptHandler;
    if (!handler) return succeed({ status: 'no-handler' });
    if (command === 'receipt_confirm') return handler.onConfirm();
    if (command === 'receipt_choose') return handler.onChooseDifferent();
    if (command === 'receipt_cancel') return handler.onCancel();
    if (command.startsWith('receipt_acc:')) { const accountId = command.slice(12); return handler.onAccountSelected(accountId); }
    if (command.startsWith('receipt_cat:')) { const categoryId = command.slice(12); return handler.onCategorySelected(categoryId); }
    return succeed({ status: 'unknown-receipt-callback' });
  }
}
