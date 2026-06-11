/**
 * Telegram bot wiring for the scheduler.
 *
 * Constructs the import mediator, the command handler, and the long-poller,
 * then connects them. The single source of truth for the configured bank
 * names lives here (getConfiguredBankNames) — both the mediator and the
 * command handler reuse it.
 */

import { getLogger } from '../Logger/Index.js';
import { AuditLogService } from '../Services/AuditLogService.js';
import { ImportMediator } from '../Services/ImportMediator.js';
import TelegramNotifier from '../Services/Notifications/TelegramNotifier.js';
import createReceiptApi from '../Services/ReceiptApiAdapter.js';
import { ReceiptImportHandler } from '../Services/ReceiptImportHandler.js';
import ReceiptOcrService from '../Services/ReceiptOcrService.js';
import { TelegramCommandHandler } from '../Services/TelegramCommandHandler.js';
import TelegramPoller from '../Services/TelegramPoller.js';
import type {
  IImporterConfig, IProcedureSuccess, ITelegramConfig, Procedure,
} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { loadFullConfig, loadLogConfig } from './ConfigBootstrap.js';
import { spawnImport } from './ImportProcessRunner.js';
import { registerNotifierCommands } from './Telegram/CommandRegistry.js';
import { getConfiguredBankNames, runConfigValidation } from './Telegram/ConfigHelpers.js';

export { buildExtraCommands, logCommandCount } from './Telegram/CommandRegistry.js';
export { getConfiguredBankNames, runConfigValidation } from './Telegram/ConfigHelpers.js';

/**
 * Creates an ImportMediator wired to spawnImport and the current config.
 *
 * @param notifierResult - Procedure with TelegramNotifier, or failure for none.
 * @returns A configured ImportMediator instance.
 */
export function createMediator(notifierResult: Procedure<TelegramNotifier>): ImportMediator {
  const notifier = notifierResult.success ? notifierResult.data : void 0;
  return new ImportMediator({
    spawnImport,
    getBankNames: getConfiguredBankNames,
    notifier: notifier ?? null,
  });
}


/**
 * Creates a ReceiptImportHandler if receipt import is enabled.
 *
 * @param notifier - The TelegramNotifier for messaging and photo download.
 * @param isEnabled - Whether receipt import is enabled.
 * @returns ReceiptImportHandler or false when disabled.
 */
export function createReceiptHandler(
  notifier: TelegramNotifier, isEnabled: boolean
): ReceiptImportHandler | false {
  if (!isEnabled) return false;
  return new ReceiptImportHandler({
    ocr: new ReceiptOcrService(),
    notifier,
    telegramNotifier: notifier,
    apiFactory: createReceiptApi,
  });
}

/** Options bag for buildCommandHandler to stay within the max-params limit. */
export interface ICommandHandlerOptions {
  /** Whether to enable receipt import via OCR. */
  enableReceipt?: boolean;
  /** Optional log directory exposed to the command handler. */
  logDir?: string;
}

/**
 * Constructs a TelegramCommandHandler wired to all scheduler callbacks.
 *
 * @param notifier - The TelegramNotifier used to send responses.
 * @param mediator - The ImportMediator that handles import requests.
 * @param options - Optional command-handler options (receipt flag, log dir).
 * @returns A configured TelegramCommandHandler instance.
 */
export function buildCommandHandler(
  notifier: TelegramNotifier,
  mediator: ImportMediator,
  options: ICommandHandlerOptions = {}
): TelegramCommandHandler {
  const receiptHandlerResult = createReceiptHandler(notifier, options.enableReceipt === true);
  const receiptHandler = receiptHandlerResult || void 0;
  return new TelegramCommandHandler({
    mediator, notifier, auditLog: new AuditLogService(),
    runValidate: runConfigValidation,
    receiptHandler,
    getBankNames: getConfiguredBankNames,
    sendScanMenu: notifier.sendScanMenu.bind(notifier),
    logDir: options.logDir,
  });
}

/**
 * Creates and starts the TelegramPoller, wiring it to the handler.
 *
 * @param telegram - Telegram bot configuration (token, chatId, etc.).
 * @param handler - The command handler to dispatch messages to.
 * @param mediator - The mediator to attach the poller to.
 * @returns Procedure indicating the poller was wired and started.
 */
export function wireAndStartPoller(
  telegram: ITelegramConfig,
  handler: TelegramCommandHandler,
  mediator: ImportMediator
): IProcedureSuccess<{ status: string }> {
  const poller = new TelegramPoller(
    telegram.botToken, telegram.chatId,
    (text) => handler.handle(text)
  );
  if (telegram.enableReceiptImport === true) {
    poller.setPhotoHandler(
      (fileId, caption) => handler.handlePhoto(fileId, caption)
    );
  }
  mediator.setPoller(poller);
  poller.start().catch((err: unknown) => {
    getLogger().error(`Telegram command listener crashed: ${errorMessage(err)}`);
  });
  return succeed({ status: 'poller-started' });
}

/**
 * Builds the TelegramCommandHandler with the receipt flag and log directory derived from config.
 *
 * @param notifier - The TelegramNotifier used by the handler.
 * @param mediator - The ImportMediator the handler will request imports through.
 * @param telegram - Telegram bot configuration (drives receipt feature flag).
 * @returns A configured TelegramCommandHandler instance.
 */
function buildHandlerWithConfig(
  notifier: TelegramNotifier, mediator: ImportMediator, telegram: ITelegramConfig
): TelegramCommandHandler {
  const isReceiptEnabled = telegram.enableReceiptImport === true;
  const logConfigResult = loadLogConfig();
  const logDir = logConfigResult.success ? logConfigResult.data.logDir : void 0;
  return buildCommandHandler(notifier, mediator, { enableReceipt: isReceiptEnabled, logDir });
}

/**
 * Creates the mediator, handler, poller, and wires them together.
 *
 * @param telegram - Telegram bot configuration (token, chatId, etc.).
 * @param config - Full importer config for detecting optional features.
 * @returns The configured ImportMediator.
 */
export async function createHandlerAndPoller(
  telegram: ITelegramConfig,
  config: IImporterConfig
): Promise<ImportMediator> {
  const notifier = new TelegramNotifier(telegram);
  await registerNotifierCommands(notifier, config);
  const notifierProcedure = succeed(notifier);
  const mediator = createMediator(notifierProcedure);
  const handler = buildHandlerWithConfig(notifier, mediator, telegram);
  wireAndStartPoller(telegram, handler, mediator);
  return mediator;
}

/**
 * Starts the Telegram command listener when listenForCommands is enabled in config.
 *
 * Errors are caught and logged so the scheduler continues in cron-only mode.
 *
 * @returns Procedure with the ImportMediator, or failure if not enabled.
 */
export async function startTelegramCommands(): Promise<Procedure<ImportMediator>> {
  const configResult = loadFullConfig();
  if (isFail(configResult)) return fail('Config not loaded');
  const config = configResult.data;
  const tg = config.notifications?.enabled ? config.notifications.telegram : void 0;
  if (!tg?.listenForCommands) return fail('Telegram commands not enabled');
  try {
    const mediator = await createHandlerAndPoller(tg, config);
    return succeed(mediator);
  } catch (error: unknown) {
    getLogger().error(`⚠️  Failed to start Telegram commands: ${errorMessage(error)}`);
    return fail('Telegram command startup failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
