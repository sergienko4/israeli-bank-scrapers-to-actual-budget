/**
 * Telegram bot composition root for the scheduler.
 *
 * Orchestrates startup of the Telegram-driven import path:
 * - Loads config and resolves the Telegram bot section
 * - Constructs notifier / mediator / handler via HandlerFactory
 * - Wires the long-poller to the mediator
 *
 * All construction details live in dedicated sibling modules under
 * ./Telegram/. This file only composes them.
 */

import { getLogger } from '../Logger/Index.js';
import type { ImportMediator } from '../Services/ImportMediator.js';
import TelegramNotifier from '../Services/Notifications/TelegramNotifier.js';
import type { TelegramCommandHandler } from '../Services/TelegramCommandHandler.js';
import TelegramPoller from '../Services/TelegramPoller.js';
import type {
  IImporterConfig, IProcedureSuccess, ITelegramConfig, Procedure,
} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { loadFullConfig } from './ConfigBootstrap.js';
import { registerNotifierCommands } from './Telegram/CommandRegistry.js';
import {
  buildHandlerWithConfig, createMediator,
} from './Telegram/HandlerFactory.js';

export { buildExtraCommands, logCommandCount } from './Telegram/CommandRegistry.js';
export { getConfiguredBankNames, runConfigValidation } from './Telegram/ConfigHelpers.js';
export {
  buildCommandHandler, createMediator, createReceiptHandler,
  type ICommandHandlerOptions,
} from './Telegram/HandlerFactory.js';

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
  await registerNotifierCommands(notifier, config);
  const notifierProcedure: Procedure<TelegramNotifier> = succeed(notifier);
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
