/**
 * TelegramImportCoordinator — orchestrates command routing and bank
 * resolution for Telegram import commands.
 *
 * Handles /scan, /scan_all, /preview and /retry commands by routing to the
 * appropriate pipeline, resolving bank arguments, and managing the scan menu.
 * Pipeline execution is delegated to {@link TelegramImportExecutor}; the
 * parent {@link TelegramCommandHandler} keeps only the declarative-routing
 * seam.
 */

import type { ILogger } from '../Logger/ILogger.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { IAuditLog } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { IAuditQuery } from './Telegram/AuditQuery.js';
import { TelegramImportExecutor } from './TelegramImportExecutor.js';

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

/** Coordinates command routing and bank resolution for Telegram imports. */
export class TelegramImportCoordinator {
  private readonly _mediator: ImportMediator;
  private readonly _executor: TelegramImportExecutor;
  private readonly _auditQuery: IAuditQuery;
  private readonly _getBankNames?: () => string[];
  private readonly _sendScanMenu?: (banks: string[]) => Promise<Procedure<{ status: string }>>;

  /**
   * Creates a coordinator wired to the import mediator, notifier, and audit.
   *
   * @param opts - Options bundle (mediator, notifier, audit, optional bank/menu helpers, logger).
   */
  constructor(opts: IImportCoordinatorOptions) {
    this._mediator = opts.mediator;
    this._auditQuery = opts.auditQuery;
    this._executor = new TelegramImportExecutor({
      mediator: opts.mediator,
      notifier: opts.notifier,
      auditQuery: opts.auditQuery,
      auditLog: opts.auditLog,
      logger: opts.logger,
    });
    this._getBankNames = opts.getBankNames;
    this._sendScanMenu = opts.sendScanMenu;
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
    return await this._executor.executeImport();
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
    const piped = await this._executor.runImportPipeline({
      extraEnv: { DRY_RUN: 'true' },
      startMsg: '🔍 Starting dry run — no changes will be made...',
    });
    if (!piped.success) return succeed({ status: piped.message });
    const dur = (piped.data.totalDurationMs / 1000).toFixed(0);
    await this._executor.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
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
      await this._executor.reply('✅ No failed banks to retry. Last run was successful.');
      return succeed({ status: 'nothing-to-retry' });
    }
    await this._executor.reply(`🔄 Retrying ${String(failed.length)} failed bank(s): ${failed.join(', ')}...`);
    await this._executor.executeImport([...failed]);
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
      await this._executor.reply(banks);
      return succeed({ status: 'error-sent' });
    }
    return await this._executor.executeImport(banks);
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
   * Replies with the already-running message when an import is in flight.
   *
   * @returns True when busy (caller should short-circuit), false otherwise.
   */
  private async sendBusyReplyIfRunning(): Promise<boolean> {
    if (!this._mediator.isImporting()) return false;
    await this._executor.reply(ALREADY_RUNNING);
    return true;
  }
}

export default TelegramImportCoordinator;
