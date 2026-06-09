/**
 * TelegramImportCoordinator — orchestrates the import pipeline triggered
 * by /scan, /scan_all, /preview and /retry commands.
 *
 * Pure orchestration: takes the mediator/notifier/audit dependencies in the
 * constructor and exposes 4 high-level commands. All business logic lives
 * here (busy-check, batch error formatting, bank resolution, scan-menu
 * routing); the parent {@link TelegramCommandHandler} keeps only the
 * declarative-routing seam.
 */

import type { ILogger } from '../Logger/ILogger.js';
import type { IBatchResult, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { IAuditLog } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { IAuditQuery } from './Telegram/AuditQuery.js';
import { buildBatchErrorReply } from './Telegram/ReplyBuilders.js';

const ALREADY_RUNNING = '⏳ Import already running. Please wait.';

/** Options for constructing a {@link TelegramImportCoordinator}. */
export interface IImportCoordinatorOptions {
  /** The ImportMediator that handles import requests. */
  readonly mediator: ImportMediator;
  /** Notifier for sending Telegram messages. */
  readonly notifier: INotifier;
  /** Audit query helper for batch failure lookups. */
  readonly auditQuery: IAuditQuery;
  /** Optional audit log (forwarded to batch error reply builder). */
  readonly auditLog?: IAuditLog;
  /** Optional callback returning all configured bank names. */
  readonly getBankNames?: () => string[];
  /** Optional inline-keyboard menu sender (when no bankArg supplied). */
  readonly sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;
  /** Logger for non-fatal pipeline errors. */
  readonly logger: ILogger;
}

/** Internal arguments for {@link TelegramImportCoordinator.runImportPipeline}. */
interface IImportPipelineArgs {
  /** Optional list of banks to import (omitted for scan-all / dry-run). */
  readonly banks?: string[];
  /** Optional extra environment overrides forwarded to the mediator. */
  readonly extraEnv?: Record<string, string>;
  /** User-facing start message (sent before the import is requested). */
  readonly startMsg: string;
}

/** Coordinates import-pipeline triggers for the Telegram command handler. */
export class TelegramImportCoordinator {
  private readonly _mediator: ImportMediator;
  private readonly _notifier: INotifier;
  private readonly _auditQuery: IAuditQuery;
  private readonly _auditLog?: IAuditLog;
  private readonly _getBankNames?: () => string[];
  private readonly _sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;
  private readonly _logger: ILogger;

  /**
   * Creates a coordinator wired to the import mediator and notifier.
   *
   * @param opts - Options bundle (mediator, notifier, audit, optional bank/menu helpers, logger).
   */
  constructor(opts: IImportCoordinatorOptions) {
    this._mediator = opts.mediator;
    this._notifier = opts.notifier;
    this._auditQuery = opts.auditQuery;
    this._auditLog = opts.auditLog;
    this._getBankNames = opts.getBankNames;
    this._sendScanMenu = opts.sendScanMenu;
    this._logger = opts.logger;
  }

  /**
   * Imports all configured banks.
   *
   * @returns Procedure indicating the scan-all result. Status mirrors the
   *   underlying import pipeline: `import-complete` on success, `already-running`
   *   when busy, or `import-error` when the pipeline surfaced a mediator failure.
   */
  public async scanAll(): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    return await this.executeImport();
  }

  /**
   * Shows the inline-keyboard bank menu (when no bankArg) or starts a
   * targeted import.
   *
   * @param bankArg - Optional bank name or comma-separated list ('' when none).
   * @returns Procedure indicating the scan result.
   */
  public async scanWith(bankArg?: string): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    const wasMenuSent = await this.maybeSendScanMenu(bankArg);
    if (wasMenuSent) return succeed({ status: 'menu-sent' });
    return await this.scanWithResolvedBanks(bankArg);
  }

  /**
   * Runs a dry-run import without writing to Actual Budget.
   *
   * @returns Procedure indicating the preview result. Status is `preview-complete`
   *   on success, `already-running` when busy, or `import-error` when the pipeline
   *   surfaces a mediator failure (no longer masked as `already-running`).
   */
  public async preview(): Promise<Procedure<{ status: string }>> {
    if (await this.sendBusyReplyIfRunning()) {
      return succeed({ status: 'already-running' });
    }
    const piped = await this.runImportPipeline({
      extraEnv: { DRY_RUN: 'true' },
      startMsg: '🔍 Starting dry run — no changes will be made...',
    });
    if (!piped.success) return succeed({ status: piped.message });
    const dur = (piped.data.totalDurationMs / 1000).toFixed(0);
    await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
    return succeed({ status: 'preview-complete' });
  }

  /**
   * Re-imports only the banks that failed in the last run.
   *
   * @returns Procedure indicating the retry result.
   */
  public async retry(): Promise<Procedure<{ status: string }>> {
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
   * Sends the inline scan menu when no bank arg is supplied.
   * Whitespace-only `bankArg` is treated as "no argument".
   *
   * @param bankArg - Original bank argument (empty/whitespace/undefined triggers menu).
   * @returns True when the menu was actually sent.
   */
  private async maybeSendScanMenu(bankArg?: string): Promise<boolean> {
    const normalized = bankArg?.trim();
    if (normalized || !this._sendScanMenu || !this._getBankNames) return false;
    const banks = this._getBankNames();
    if (banks.length === 0) return false;
    const sendResult = await this._sendScanMenu(banks);
    return sendResult.success;
  }

  /**
   * Resolves the bank argument and either replies with an error or imports.
   *
   * @param bankArg - Bank argument (possibly empty/undefined).
   * @returns Procedure indicating the import result. On a resolved import the
   *   status mirrors the underlying pipeline (`import-complete` / `already-running`
   *   / `import-error`); on an unknown-bank arg the status is `error-sent`.
   */
  private async scanWithResolvedBanks(
    bankArg?: string,
  ): Promise<Procedure<{ status: string }>> {
    const banks = bankArg ? this.resolveBanks(bankArg) : undefined;
    if (typeof banks === 'string') {
      await this.reply(banks);
      return succeed({ status: 'error-sent' });
    }
    return await this.executeImport(banks);
  }

  /**
   * Resolves a comma-separated bank argument to matched names.
   *
   * @param bankArg - Comma-separated bank name string.
   * @returns Array of resolved bank names, or an error string.
   */
  private resolveBanks(bankArg: string): string[] | string {
    const requested = bankArg.split(',').map(b => b.trim()).filter(Boolean);
    const available = this._getBankNames?.() ?? [];
    if (!available.length) return requested;
    const resolved = requested.map(
      r => available.find(a => a.toLowerCase() === r.toLowerCase()) ?? r,
    );
    const unknown = resolved.filter(r => !available.includes(r));
    if (unknown.length) return `❌ Unknown bank: "${unknown[0]}". Available: ${available.join(', ')}`;
    return resolved;
  }

  /**
   * Requests an import and reports the batch result.
   *
   * @param banks - Optional list of banks to import.
   * @returns Procedure indicating the import completion status. Status is
   *   `import-complete` on success, `already-running` when the mediator refused
   *   because another batch is in flight, or `import-error` when the pipeline
   *   surfaced a mediator exception (no longer masked as `already-running`).
   */
  private async executeImport(banks?: string[]): Promise<Procedure<{ status: string }>> {
    const label = banks ? ` (${banks.join(', ')})` : '';
    const piped = await this.runImportPipeline({
      banks,
      startMsg: `⏳ Starting import...${label}`,
    });
    if (!piped.success) return succeed({ status: piped.message });
    if (piped.data.failureCount > 0) {
      const errorReply = this.batchErrorReply(piped.data);
      await this.reply(errorReply);
    }
    return succeed({ status: 'import-complete' });
  }

  /**
   * Sends the start message, requests an import, and waits for completion.
   * Common pipeline shared by scanAll/scanWith/preview/retry.
   *
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
   *
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
   *
   * @returns True when busy (caller should short-circuit), false otherwise.
   */
  private async sendBusyReplyIfRunning(): Promise<boolean> {
    if (!this._mediator.isImporting()) return false;
    await this.reply(ALREADY_RUNNING);
    return true;
  }

  /**
   * Builds the failure reply for a completed batch using the audit log.
   *
   * @param batch - Completed batch result with failureCount > 0.
   * @returns Multi-line Telegram-ready error reply.
   */
  private batchErrorReply(batch: IBatchResult): string {
    const freshResult = this._auditQuery.getFreshEntryFor(batch);
    const entry = freshResult.success ? freshResult.data : undefined;
    return buildBatchErrorReply({ batch, entry, auditLog: this._auditLog });
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

export default TelegramImportCoordinator;
