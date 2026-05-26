/**
 * TelegramCommandHandler — thin facade over the declarative command router.
 * Owns the stateful handler methods (mediator/notifier/receipt interactions)
 * and delegates routing to CommandRouter via a frozen ICommandRoute table.
 */

import type { ILogger } from '../Logger/ILogger.js';
import { getLogger, LogFileReader } from '../Logger/Index.js';
import type { IBatchResult, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { IAuditLog } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { ReceiptImportHandler } from './ReceiptImportHandler.js';
import type { IAuditQuery } from './Telegram/AuditQuery.js';
import { createAuditQuery } from './Telegram/AuditQuery.js';
import CommandRouter from './Telegram/CommandRouter.js';
import type { ICommandRoute } from './Telegram/ICommandRoute.js';
import buildReceiptCommandRoutes from './Telegram/ReceiptCommandRoutes.js';
import {
  buildBatchErrorReply,
  buildHelpLines,
  buildHistoryLines,
  buildLogsFooter,
  buildLogsHeader,
  buildStatusLines,
} from './Telegram/ReplyBuilders.js';
import { buildSlashCommandRoutes, type ISlashHandlers } from './Telegram/SlashCommandRoutes.js';
import { parseLogCount, truncateForTelegram } from './TelegramCommandFormatters.js';

const ALREADY_RUNNING = '⏳ Import already running. Please wait.';

/** Internal arguments for {@link TelegramCommandHandler.runImportPipeline}. */
interface IImportPipelineArgs {
  /** Optional list of banks to import (omitted for scan-all / dry-run). */
  readonly banks?: string[];
  /** Optional extra environment overrides forwarded to the mediator. */
  readonly extraEnv?: Record<string, string>;
  /** User-facing start message (sent before the import is requested). */
  readonly startMsg: string;
}

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
  /** Optional logger override (defaults to getLogger()). */
  readonly logger?: ILogger;
}

/** Handles bot commands dispatched from TelegramPoller. */
export class TelegramCommandHandler {
  private readonly _mediator: ImportMediator;
  private readonly _notifier: INotifier;
  private readonly _auditLog?: IAuditLog;
  private readonly _auditQuery: IAuditQuery;
  private readonly _runWatch?: () => Promise<string>;
  private readonly _runValidate?: () => Promise<string>;
  private readonly _getBankNames?: () => string[];
  private readonly _sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;
  private readonly _logDir: string;
  private readonly _receiptHandler?: ReceiptImportHandler;
  private readonly _logger: ILogger;
  private readonly _router: CommandRouter;

  /**
   * Creates a TelegramCommandHandler wired to the declarative route registry.
   * @param opts - Options including mediator, notifier, optional features and logger.
   */
  constructor(opts: ICommandHandlerOptions) {
    this._mediator = opts.mediator;
    this._notifier = opts.notifier;
    this._auditLog = opts.auditLog;
    this._auditQuery = createAuditQuery(opts.auditLog);
    this._runWatch = opts.runWatch;
    this._runValidate = opts.runValidate;
    this._getBankNames = opts.getBankNames;
    this._sendScanMenu = opts.sendScanMenu;
    this._logDir = opts.logDir ?? './logs';
    this._receiptHandler = opts.receiptHandler;
    this._logger = opts.logger ?? getLogger();
    this._router = new CommandRouter(this.buildRoutes());
  }

  /**
   * Routes an incoming message or callback to the correct handler.
   * @param text - The raw message text or callback_data string.
   * @returns Procedure indicating the command was handled.
   */
  public async handle(text: string): Promise<Procedure<{ status: string }>> {
    return await this._router.dispatch(text);
  }

  /**
   * Handles an incoming photo message.
   * @param fileId - Telegram file_id of the photo.
   * @param _caption - Optional caption text (reserved for future use).
   * @returns Procedure indicating the processing result.
   */
  public async handlePhoto(
    fileId: string, _caption?: string,
  ): Promise<Procedure<{ status: string }>> {
    if (!this._receiptHandler) return succeed({ status: 'receipt-not-configured' });
    return await this._receiptHandler.handlePhoto(fileId);
  }

  /**
   * Assembles the immutable route table consumed by the CommandRouter.
   * Order matters within match kind: receipt prefix routes are listed AFTER
   * receipt exact routes (and the router consults exact matches first anyway).
   * @returns Frozen array of routes.
   */
  private buildRoutes(): readonly ICommandRoute[] {
    const handlers = this.boundSlashHandlers();
    const slash = buildSlashCommandRoutes(handlers);
    const receipt = buildReceiptCommandRoutes(this._receiptHandler);
    const merged = [...slash, ...receipt];
    return Object.freeze(merged);
  }

  /**
   * Returns the bound ISlashHandlers bundle for this instance.
   * Methods are bound so `this` resolves correctly when invoked by the router.
   * @returns Frozen handler bundle.
   */
  private boundSlashHandlers(): ISlashHandlers {
    return {
      handleScan: this.handleScan.bind(this),
      handleScanAll: this.handleScanAll.bind(this),
      handleStatus: this.handleStatus.bind(this),
      handleLogs: this.handleLogs.bind(this),
      handleWatch: this.handleWatch.bind(this),
      handleCheckConfig: this.handleCheckConfig.bind(this),
      handlePreview: this.handlePreview.bind(this),
      handleHelp: this.handleHelp.bind(this),
      handleRetry: this.handleRetry.bind(this),
      handleImportReceipt: this.handleImportReceipt.bind(this),
    };
  }

  /**
   * Imports all configured banks.
   * @returns Procedure indicating the scan-all result.
   */
  private async handleScanAll(): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    await this.executeImport();
    return succeed({ status: 'scan-all-started' });
  }

  /**
   * Shows bank menu or starts a targeted import.
   * @param bankArg - Optional bank name or comma-separated list ('' when none).
   * @returns Procedure indicating the scan result.
   */
  private async handleScan(
    bankArg?: string,
  ): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    const wasMenuSent = await this.maybeSendScanMenu(bankArg);
    if (wasMenuSent) return succeed({ status: 'menu-sent' });
    return await this.scanWithResolvedBanks(bankArg);
  }

  /**
   * Sends the inline scan menu when no bank arg is supplied.
   * @param bankArg - Original bank argument (empty/undefined triggers menu).
   * @returns True when the menu was actually sent, false otherwise.
   */
  private async maybeSendScanMenu(
    bankArg?: string,
  ): Promise<boolean> {
    if (bankArg || !this._sendScanMenu || !this._getBankNames) return false;
    const banks = this._getBankNames();
    if (banks.length === 0) return false;
    const sendResult = await this._sendScanMenu(banks);
    return sendResult.success;
  }

  /**
   * Resolves the bank argument and either replies with an error or imports.
   * @param bankArg - Bank argument (possibly empty/undefined).
   * @returns Procedure indicating the import result.
   */
  private async scanWithResolvedBanks(
    bankArg?: string,
  ): Promise<Procedure<{ status: string }>> {
    const banks = bankArg ? this.resolveBanks(bankArg) : undefined;
    if (typeof banks === 'string') {
      await this.reply(banks);
      return succeed({ status: 'error-sent' });
    }
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
    banks?: string[],
  ): Promise<Procedure<{ status: string }>> {
    const label = banks ? ` (${banks.join(', ')})` : '';
    const piped = await this.runImportPipeline({
      banks,
      startMsg: `⏳ Starting import...${label}`,
    });
    if (!piped.success) return succeed({ status: 'already-running' });
    if (piped.data.failureCount > 0) {
      const errorReply = this.batchErrorReply(piped.data);
      await this.reply(errorReply);
    }
    return succeed({ status: 'import-complete' });
  }

  /**
   * Sends the start message, requests an import, and waits for completion.
   * Common pipeline shared by /scan, /scan_all, /retry, and /preview.
   * Any thrown error from the mediator surfaces as a normalized failure.
   * @param args - Pipeline arguments (banks, optional extraEnv, start message).
   * @returns Procedure carrying the completed batch, or fail when busy/error.
   */
  private async runImportPipeline(
    args: IImportPipelineArgs,
  ): Promise<Procedure<IBatchResult>> {
    await this.reply(args.startMsg);
    try {
      const batchId = this._mediator.requestImport({
        source: 'telegram', banks: args.banks, extraEnv: args.extraEnv,
      });
      if (!batchId) { await this.reply(ALREADY_RUNNING); return fail('already-running'); }
      return succeed(await this._mediator.waitForBatch(batchId));
    } catch (error: unknown) {
      return await this.handleImportPipelineError(error);
    }
  }

  /**
   * Replies and logs when the mediator throws inside the import pipeline.
   * @param error - The unknown error thrown by the mediator.
   * @returns A normalized `fail('import-error')` Procedure.
   */
  private async handleImportPipelineError(
    error: unknown,
  ): Promise<Procedure<IBatchResult>> {
    const msg = errorMessage(error);
    this._logger.error(`runImportPipeline failed: ${msg}`);
    await this.reply(`❌ Import failed: ${msg}`);
    return fail('import-error');
  }

  /**
   * Replies with the already-running message when an import is in flight.
   * @returns True when busy (caller should short-circuit), false otherwise.
   */
  private async sendBusyReplyIfRunning(): Promise<boolean> {
    if (!this._mediator.isImporting()) return false;
    await this.reply(ALREADY_RUNNING);
    return true;
  }

  /**
   * Builds the failure reply for a completed batch using the audit log.
   * @param batch - Completed batch result with failureCount > 0.
   * @returns Multi-line Telegram-ready error reply.
   */
  private batchErrorReply(batch: IBatchResult): string {
    const freshResult = this._auditQuery.getFreshEntryFor(batch);
    const entry = freshResult.success ? freshResult.data : undefined;
    return buildBatchErrorReply({ batch, entry, auditLog: this._auditLog });
  }

  /**
   * Sends import status and recent audit history.
   * @returns Procedure indicating the status message was sent.
   */
  private async handleStatus(): Promise<Procedure<{ status: string }>> {
    const header = buildStatusLines({
      lastTime: this._mediator.getLastRunTime(),
      lastResult: this._mediator.getLastResult(),
      isImporting: this._mediator.isImporting(),
    });
    const recent = this._auditQuery.getRecent(5);
    const history = buildHistoryLines(recent);
    const message = [...header, ...history].join('\n');
    await this.reply(message);
    return succeed({ status: 'status-sent' });
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
    if (entries.length === 0) {
      await this.reply('📋 No log entries yet.');
      return succeed({ status: 'no-logs' });
    }
    const header = buildLogsHeader(entries.length);
    const footer = buildLogsFooter();
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
    try {
      const message = await this._runWatch();
      await this.reply(message || '✅ All spending within limits.');
    } catch (error: unknown) {
      await this.reply(`❌ Watch error: ${errorMessage(error)}`);
    }
    return succeed({ status: 'watch-complete' });
  }

  /**
   * Runs offline and online config validation.
   * @returns Procedure indicating the config check result.
   */
  private async handleCheckConfig(): Promise<Procedure<{ status: string }>> {
    if (!this._runValidate) {
      await this.reply('⚙️ Config validation unavailable.');
      return succeed({ status: 'validate-unavailable' });
    }
    await this.reply('🔍 Validating configuration...');
    try {
      const report = await this._runValidate();
      await this.reply(`<pre>${report}</pre>`);
    } catch (error: unknown) {
      await this.reply(`❌ Validation error: ${errorMessage(error)}`);
    }
    return succeed({ status: 'config-checked' });
  }

  /**
   * Runs a dry-run import without writing to Actual Budget.
   * @returns Procedure indicating the preview result.
   */
  private async handlePreview(): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    const piped = await this.runImportPipeline({
      extraEnv: { DRY_RUN: 'true' },
      startMsg: '🔍 Starting dry run — no changes will be made...',
    });
    if (!piped.success) return succeed({ status: 'already-running' });
    const dur = (piped.data.totalDurationMs / 1000).toFixed(0);
    await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
    return succeed({ status: 'preview-complete' });
  }

  /**
   * Re-imports only the banks that failed in the last run.
   * @returns Procedure indicating the retry result.
   */
  private async handleRetry(): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    const failed = this._auditQuery.getLastFailedBanks();
    if (!failed.length) {
      await this.reply('✅ No failed banks to retry. Last run was successful.');
      return succeed({ status: 'nothing-to-retry' });
    }
    await this.reply(`🔄 Retrying ${String(failed.length)} failed bank(s): ${failed.join(', ')}...`);
    await this.executeImport([...failed]);
    return succeed({ status: 'retry-started' });
  }

  /**
   * Sends the list of available bot commands.
   * @returns Procedure indicating the help message was sent.
   */
  private async handleHelp(): Promise<Procedure<{ status: string }>> {
    const hasReceipt = Boolean(this._receiptHandler);
    const lines = buildHelpLines(hasReceipt);
    const message = lines.join('\n');
    await this.reply(message);
    return succeed({ status: 'help-sent' });
  }

  /**
   * Sends a message to Telegram, catching any send failures.
   * @param text - The message text to send.
   * @returns Procedure indicating the reply status.
   */
  private async reply(text: string): Promise<Procedure<{ status: string }>> {
    try {
      await this._notifier.sendMessage(text);
      return succeed({ status: 'reply-sent' });
    } catch (error: unknown) {
      this._logger.debug(`Failed to send reply: ${errorMessage(error)}`);
      return succeed({ status: 'reply-failed' });
    }
  }

  /**
   * Starts the receipt import flow.
   * @returns Procedure indicating the prompt was sent.
   */
  private async handleImportReceipt(): Promise<Procedure<{ status: string }>> {
    if (!this._receiptHandler) {
      await this.reply('❌ Receipt import is not configured.');
      return succeed({ status: 'not-configured' });
    }
    return await this._receiptHandler.start();
  }
}
