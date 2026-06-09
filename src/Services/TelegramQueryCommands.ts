/**
 * TelegramQueryCommands — read-only / informational Telegram commands.
 *
 * Owns the simple handlers (status / logs / help / watch / check_config /
 * import_receipt) that format a response from injected data sources and
 * send it via the notifier. No import-pipeline orchestration lives here.
 */

import type { ILogger } from '../Logger/ILogger.js';
import { LogFileReader } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { ReceiptImportHandler } from './ReceiptImportHandler.js';
import type { IAuditQuery } from './Telegram/AuditQuery.js';
import {
  buildHelpLines, buildHistoryLines, buildLogsFooter, buildLogsHeader, buildStatusLines,
} from './Telegram/ReplyBuilders.js';
import { parseLogCount, truncateForTelegram } from './TelegramCommandFormatters.js';

/** Options for constructing a {@link TelegramQueryCommands}. */
export interface IQueryCommandsOptions {
  /** Notifier for sending Telegram messages. */
  readonly notifier: INotifier;
  /** Mediator used for last-run / is-importing snapshots. */
  readonly mediator: ImportMediator;
  /** Audit query helper for recent-history snapshots. */
  readonly auditQuery: IAuditQuery;
  /** Directory containing log files. */
  readonly logDir: string;
  /** Optional callback to run spending watch rules. */
  readonly runWatch?: () => Promise<string>;
  /** Optional callback to validate the configuration. */
  readonly runValidate?: () => Promise<string>;
  /** Optional receipt import handler for /import_receipt. */
  readonly receiptHandler?: ReceiptImportHandler;
  /** Logger for non-fatal reply failures. */
  readonly logger: ILogger;
}

/** Handlers for read-only / informational Telegram commands. */
export class TelegramQueryCommands {
  private readonly _notifier: INotifier;
  private readonly _mediator: ImportMediator;
  private readonly _auditQuery: IAuditQuery;
  private readonly _logDir: string;
  private readonly _runWatch?: () => Promise<string>;
  private readonly _runValidate?: () => Promise<string>;
  private readonly _receiptHandler?: ReceiptImportHandler;
  private readonly _logger: ILogger;

  /**
   * Creates a query-commands bundle wired to its data sources.
   *
   * @param opts - Options bundle (notifier, mediator, audit query, log dir, optional callbacks, logger).
   */
  constructor(opts: IQueryCommandsOptions) {
    this._notifier = opts.notifier;
    this._mediator = opts.mediator;
    this._auditQuery = opts.auditQuery;
    this._logDir = opts.logDir;
    this._runWatch = opts.runWatch;
    this._runValidate = opts.runValidate;
    this._receiptHandler = opts.receiptHandler;
    this._logger = opts.logger;
  }

  /**
   * Sends import status and recent audit history.
   *
   * @returns Procedure indicating the status message was sent.
   */
  public async status(): Promise<Procedure<{ status: string }>> {
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
   *
   * @param countArg - Optional string number of entries (default 50).
   * @returns Procedure indicating the logs were sent.
   */
  public async logs(countArg?: string): Promise<Procedure<{ status: string }>> {
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
   *
   * @returns Procedure indicating the watch command result.
   */
  public async watch(): Promise<Procedure<{ status: string }>> {
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
   *
   * @returns Procedure indicating the config check result.
   */
  public async checkConfig(): Promise<Procedure<{ status: string }>> {
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
   * Sends the list of available bot commands.
   *
   * @returns Procedure indicating the help message was sent.
   */
  public async help(): Promise<Procedure<{ status: string }>> {
    const hasReceipt = Boolean(this._receiptHandler);
    const lines = buildHelpLines(hasReceipt);
    const message = lines.join('\n');
    await this.reply(message);
    return succeed({ status: 'help-sent' });
  }

  /**
   * Starts the receipt import flow.
   *
   * @returns Procedure indicating the prompt was sent.
   */
  public async importReceipt(): Promise<Procedure<{ status: string }>> {
    if (!this._receiptHandler) {
      await this.reply('❌ Receipt import is not configured.');
      return succeed({ status: 'not-configured' });
    }
    return await this._receiptHandler.start();
  }

  /**
   * Sends a message to Telegram, catching any send failures.
   *
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
}

export default TelegramQueryCommands;
