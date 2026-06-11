/**
 * Factory for the optional ReceiptImportHandler.
 *
 * Isolated from HandlerFactory so the receipt feature's
 * service-layer dependencies (ReceiptImportHandler, ReceiptOcrService,
 * ReceiptApiAdapter) only enter the module graph when receipt import
 * is enabled at the configuration boundary.
 */

import type TelegramNotifier from '../../Services/Notifications/TelegramNotifier.js';
import createReceiptApi from '../../Services/ReceiptApiAdapter.js';
import { ReceiptImportHandler } from '../../Services/ReceiptImportHandler.js';
import ReceiptOcrService from '../../Services/ReceiptOcrService.js';

/**
 * Creates a ReceiptImportHandler when receipt import is enabled.
 *
 * @param notifier - The TelegramNotifier for messaging and photo download.
 * @param isEnabled - Whether receipt import is enabled in config.
 * @returns ReceiptImportHandler instance, or false when disabled.
 */
export default function createReceiptHandler(
  notifier: TelegramNotifier,
  isEnabled: boolean
): ReceiptImportHandler | false {
  if (!isEnabled) return false;
  return new ReceiptImportHandler({
    ocr: new ReceiptOcrService(),
    notifier,
    telegramNotifier: notifier,
    apiFactory: createReceiptApi,
  });
}
