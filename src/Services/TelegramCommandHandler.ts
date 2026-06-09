/**
 * TelegramCommandHandler — thin facade over the declarative command router.
 *
 * Wires three pieces:
 *   1. {@link TelegramImportCoordinator} — owns scan/preview/retry pipelines.
 *   2. {@link TelegramQueryCommands}     — owns status/logs/help/watch/etc.
 *   3. {@link CommandRouter}             — declarative slash+receipt routing.
 *
 * The public API ({@link TelegramCommandHandler.handle},
 * {@link TelegramCommandHandler.handlePhoto}) is unchanged from prior
 * releases. All business logic now lives in the two helper modules; this
 * class is exclusively a constructor + route assembler + bound-handler
 * factory.
 */

import type { ILogger } from '../Logger/ILogger.js';
import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { IAuditLog } from './AuditLogService.js';
import type { ImportMediator } from './ImportMediator.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { ReceiptImportHandler } from './ReceiptImportHandler.js';
import { createAuditQuery } from './Telegram/AuditQuery.js';
import CommandRouter from './Telegram/CommandRouter.js';
import type { ICommandRoute } from './Telegram/ICommandRoute.js';
import buildReceiptCommandRoutes from './Telegram/ReceiptCommandRoutes.js';
import { buildSlashCommandRoutes, type ISlashHandlers } from './Telegram/SlashCommandRoutes.js';
import { TelegramImportCoordinator } from './TelegramImportCoordinator.js';
import { TelegramQueryCommands } from './TelegramQueryCommands.js';

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
  /** Optional callback to display the inline keyboard scan menu. Returns a Procedure indicating whether the menu was sent. */
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
  private readonly _import: TelegramImportCoordinator;
  private readonly _query: TelegramQueryCommands;
  private readonly _receiptHandler?: ReceiptImportHandler;
  private readonly _router: CommandRouter;

  /**
   * Creates a TelegramCommandHandler wired to the declarative route registry.
   *
   * @param opts - Options including mediator, notifier, optional features and logger.
   */
  constructor(opts: ICommandHandlerOptions) {
    const logger = opts.logger ?? getLogger();
    const auditQuery = createAuditQuery(opts.auditLog);
    this._receiptHandler = opts.receiptHandler;
    this._import = TelegramCommandHandler.buildImport(opts, auditQuery, logger);
    this._query = TelegramCommandHandler.buildQuery(opts, auditQuery, logger);
    this._router = new CommandRouter(this.buildRoutes());
  }

  /**
   * Builds the import-pipeline coordinator from constructor options.
   *
   * @param opts - The handler options bundle.
   * @param auditQuery - Pre-built audit query helper.
   * @param logger - Logger instance shared with the query module.
   * @returns A fully-wired {@link TelegramImportCoordinator}.
   */
  private static buildImport(
    opts: ICommandHandlerOptions,
    auditQuery: ReturnType<typeof createAuditQuery>,
    logger: ILogger,
  ): TelegramImportCoordinator {
    return new TelegramImportCoordinator({
      mediator: opts.mediator,
      notifier: opts.notifier,
      auditQuery,
      auditLog: opts.auditLog,
      getBankNames: opts.getBankNames,
      sendScanMenu: opts.sendScanMenu,
      logger,
    });
  }

  /**
   * Builds the read-only / informational query-commands bundle.
   *
   * @param opts - The handler options bundle.
   * @param auditQuery - Pre-built audit query helper.
   * @param logger - Logger instance shared with the import module.
   * @returns A fully-wired {@link TelegramQueryCommands}.
   */
  private static buildQuery(
    opts: ICommandHandlerOptions,
    auditQuery: ReturnType<typeof createAuditQuery>,
    logger: ILogger,
  ): TelegramQueryCommands {
    return new TelegramQueryCommands({
      notifier: opts.notifier,
      mediator: opts.mediator,
      auditQuery,
      logDir: opts.logDir ?? './logs',
      runWatch: opts.runWatch,
      runValidate: opts.runValidate,
      receiptHandler: opts.receiptHandler,
      logger,
    });
  }

  /**
   * Routes an incoming message or callback to the correct handler.
   *
   * @param text - The raw message text or callback_data string.
   * @returns Procedure indicating the command was handled.
   */
  public async handle(text: string): Promise<Procedure<{ status: string }>> {
    return await this._router.dispatch(text);
  }

  /**
   * Handles an incoming photo message.
   *
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
   *
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
   * Each entry forwards to either the import coordinator or the query
   * commands module so the router can invoke them by name.
   *
   * @returns Frozen handler bundle.
   */
  private boundSlashHandlers(): ISlashHandlers {
    return {
      handleScan: this._import.scanWith.bind(this._import),
      handleScanAll: this._import.scanAll.bind(this._import),
      handlePreview: this._import.preview.bind(this._import),
      handleRetry: this._import.retry.bind(this._import),
      handleStatus: this._query.status.bind(this._query),
      handleLogs: this._query.logs.bind(this._query),
      handleWatch: this._query.watch.bind(this._query),
      handleCheckConfig: this._query.checkConfig.bind(this._query),
      handleHelp: this._query.help.bind(this._query),
      handleImportReceipt: this._query.importReceipt.bind(this._query),
    };
  }
}
