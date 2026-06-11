/**
 * Factory module for the Telegram side of the import pipeline.
 *
 * Constructs the ImportMediator, the optional ReceiptImportHandler, and the
 * TelegramCommandHandler that wires them together. Kept in its own module
 * so the composition root (TelegramSchedulerWiring) only orchestrates and
 * does not contain construction details.
 */

import { AuditLogService } from '../../Services/AuditLogService.js';
import { ImportMediator } from '../../Services/ImportMediator.js';
import type TelegramNotifier from '../../Services/Notifications/TelegramNotifier.js';
import createReceiptApi from '../../Services/ReceiptApiAdapter.js';
import { ReceiptImportHandler } from '../../Services/ReceiptImportHandler.js';
import ReceiptOcrService from '../../Services/ReceiptOcrService.js';
import { TelegramCommandHandler } from '../../Services/TelegramCommandHandler.js';
import type { ITelegramConfig, Procedure } from '../../Types/Index.js';
import { loadLogConfig } from '../ConfigBootstrap.js';
import { spawnImport } from '../ImportProcessRunner.js';
import { getConfiguredBankNames, runConfigValidation } from './ConfigHelpers.js';

/** Options bag for buildCommandHandler to stay within the max-params limit. */
export interface ICommandHandlerOptions {
  /** Whether to enable receipt import via OCR. */
  enableReceipt?: boolean;
  /** Optional log directory exposed to the command handler. */
  logDir?: string;
}

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
 * Builds the TelegramCommandHandler with the receipt flag and log directory derived from config.
 *
 * @param notifier - The TelegramNotifier used by the handler.
 * @param mediator - The ImportMediator the handler will request imports through.
 * @param telegram - Telegram bot configuration (drives receipt feature flag).
 * @returns A configured TelegramCommandHandler instance.
 */
export function buildHandlerWithConfig(
  notifier: TelegramNotifier, mediator: ImportMediator, telegram: ITelegramConfig
): TelegramCommandHandler {
  const isReceiptEnabled = telegram.enableReceiptImport === true;
  const logConfigResult = loadLogConfig();
  const logDir = logConfigResult.success ? logConfigResult.data.logDir : void 0;
  return buildCommandHandler(notifier, mediator, { enableReceipt: isReceiptEnabled, logDir });
}
