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

/**
 * Returns all configured bank names from the live config.
 *
 * Single source of truth used by both the mediator and the command handler.
 *
 * @returns Array of bank name strings (empty array if config cannot be loaded).
 */
export function getConfiguredBankNames(): string[] {
  const cfg = loadFullConfig();
  if (!cfg.success) {
    getLogger().warn(`getBankNames: config load failed — ${cfg.message}`);
    return [];
  }
  return Object.keys(cfg.data.banks);
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
 * Logs how many bot commands will be registered including extra commands.
 *
 * @param extras - Additional commands beyond the built-in set.
 * @returns A successful Procedure indicating the count was logged.
 */
export function logCommandCount(
  extras: { command: string; description: string }[]
): IProcedureSuccess<{ status: string }> {
  const cmdNames = extras.map(c => c.command).join(', /');
  getLogger().info(
    `📋 Registering ${String(4 + extras.length)} bot commands` +
    (extras.length ? ` (including /${cmdNames})` : '')
  );
  return succeed({ status: 'logged' });
}

/**
 * Builds the list of extra bot commands beyond the built-in set based on config features.
 *
 * @param config - Full importer config used to detect enabled optional features.
 * @returns Array of extra command+description objects to register with Telegram.
 */
export function buildExtraCommands(
  config: IImporterConfig
): { command: string; description: string }[] {
  const extras: { command: string; description: string }[] = [
    { command: 'retry', description: 'Re-import only last failed banks' },
    { command: 'check_config', description: 'Check configuration (offline + online)' },
    { command: 'preview', description: 'Dry run: scrape banks without importing' },
  ];
  const watchLen = config.spendingWatch?.length ?? 0;
  if (watchLen > 0) {
    extras.push({ command: 'watch', description: 'Check spending watch rules' });
  }
  if (config.notifications?.telegram?.enableReceiptImport) {
    extras.push({ command: 'import_receipt', description: 'Import from receipt photo (OCR)' });
  }
  return extras;
}

/**
 * Lazily imports ConfigLoader and ConfigValidator and runs all validation checks.
 *
 * The lazy import is preserved from the original implementation to minimise the
 * blast radius of this refactor; there is no circular dependency today.
 *
 * @returns Formatted validation report string for display in Telegram.
 */
export async function runConfigValidation(): Promise<string> {
  const configLoaderModule = await import('../Config/ConfigLoader.js');
  const configValidatorModule = await import('../Config/ConfigValidator.js');
  const loader = new configLoaderModule.ConfigLoader();
  const rawResult = loader.loadRaw();
  if (isFail(rawResult)) {
    return `[FAIL] Cannot load config: ${rawResult.message}`;
  }
  const validator = new configValidatorModule.ConfigValidator();
  const results = await validator.validateAll(rawResult.data);
  return configValidatorModule.ConfigValidator.formatReport(results);
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
    /**
     * Delegates scan menu display to the notifier.
     *
     * @param banks - Bank names for the inline keyboard.
     * @returns Procedure indicating the menu was sent.
     */
    sendScanMenu: async (banks) => {
      await notifier.sendScanMenu(banks);
      return succeed({ status: 'menu-sent' });
    },
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
  const extras = buildExtraCommands(config);
  logCommandCount(extras);
  await notifier.registerCommands(extras);
  const notifierProcedure = succeed(notifier);
  const mediator = createMediator(notifierProcedure);
  const isReceiptEnabled = telegram.enableReceiptImport === true;
  const logConfigResult = loadLogConfig();
  const logDir = logConfigResult.success ? logConfigResult.data.logDir : void 0;
  const handler = buildCommandHandler(notifier, mediator, {
    enableReceipt: isReceiptEnabled, logDir,
  });
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
