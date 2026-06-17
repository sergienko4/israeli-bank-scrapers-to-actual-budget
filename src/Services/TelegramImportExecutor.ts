/**
 * TelegramImportExecutor — handles import pipeline execution and result
 * reporting for Telegram commands.
 *
 * Encapsulates the core pipeline orchestration: requesting an import through
 * the mediator, waiting for batch completion, handling errors, and formatting
 * batch failure reports. The parent {@link TelegramImportCoordinator} handles
 * command routing, busy checks, and bank resolution; this executor focuses on
 * the pipeline mechanics.
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

/** Options for constructing a {@link TelegramImportExecutor}. */
export interface IImportExecutorOptions {
  /** The ImportMediator that handles import requests. */
  readonly mediator: ImportMediator;
  /** Notifier for sending Telegram messages. */
  readonly notifier: INotifier;
  /** Audit query helper for batch failure lookups. */
  readonly auditQuery: IAuditQuery;
  /** Optional audit log (forwarded to batch error reply builder). */
  readonly auditLog?: IAuditLog;
  /** Logger for non-fatal pipeline errors. */
  readonly logger: ILogger;
}

/** Arguments for {@link TelegramImportExecutor.runImportPipeline}. */
export interface IImportPipelineArgs {
  /** Optional list of banks to import (omitted for scan-all / dry-run). */
  readonly banks?: string[];
  /** Optional extra environment overrides forwarded to the mediator. */
  readonly extraEnv?: Record<string, string>;
  /** User-facing start message (sent before the import is requested). */
  readonly startMsg: string;
}

/** Executes import pipelines and reports batch results to Telegram. */
export class TelegramImportExecutor {
  private readonly _mediator: ImportMediator;
  private readonly _notifier: INotifier;
  private readonly _auditQuery: IAuditQuery;
  private readonly _auditLog?: IAuditLog;
  private readonly _logger: ILogger;

  /**
   * Creates an executor wired to the import mediator and notifier.
   *
   * @param opts - Options bundle (mediator, notifier, audit, optional auditLog, logger).
   */
  constructor(opts: IImportExecutorOptions) {
    this._mediator = opts.mediator;
    this._notifier = opts.notifier;
    this._auditQuery = opts.auditQuery;
    this._auditLog = opts.auditLog;
    this._logger = opts.logger;
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
  public async executeImport(banks?: string[]): Promise<Procedure<{ status: string }>> {
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
  public async runImportPipeline(
    args: IImportPipelineArgs,
  ): Promise<Procedure<IBatchResult>> {
    await this.reply(args.startMsg);
    try {
      const batchId = this._mediator.requestImport({
        source: 'telegram',
        banks: args.banks,
        extraEnv: args.extraEnv,
      });
      if (!batchId) {
        await this.reply(ALREADY_RUNNING);
        return fail('already-running');
      }
      return succeed(await this._mediator.waitForBatch(batchId));
    } catch (error: unknown) {
      return await this.handleImportPipelineError(error);
    }
  }

  /**
   * Sends a message to Telegram, catching any send failures.
   *
   * @param text - The message text to send.
   * @returns Procedure indicating the reply status.
   */
  public async reply(text: string): Promise<Procedure<{ status: string }>> {
    try {
      await this._notifier.sendMessage(text);
      return succeed({ status: 'reply-sent' });
    } catch (error: unknown) {
      this._logger.debug(`Failed to send reply: ${errorMessage(error)}`);
      return succeed({ status: 'reply-failed' });
    }
  }

  /**
   * Replies and logs when the mediator throws inside the import pipeline.
   *
   * @param error - The unknown error thrown by the mediator.
   * @returns A normalized `fail('import-error')` Procedure.
   */
  private async handleImportPipelineError(error: unknown): Promise<Procedure<IBatchResult>> {
    const msg = errorMessage(error);
    this._logger.error(`runImportPipeline failed: ${msg}`);
    await this.reply(`❌ Import failed: ${msg}`);
    return fail('import-error');
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
}

export default TelegramImportExecutor;
