/**
 * Telegram long-poller wiring.
 *
 * Constructs a TelegramPoller, binds text + optional photo handlers to the
 * provided command handler, attaches the poller to the mediator, and starts
 * the long-poll loop in the background. Errors thrown during start() are
 * caught and logged so the scheduler continues in cron-only mode.
 */

import { getLogger } from '../../Logger/Index.js';
import type { ImportMediator } from '../../Services/ImportMediator.js';
import type { TelegramCommandHandler } from '../../Services/TelegramCommandHandler.js';
import TelegramPoller from '../../Services/TelegramPoller.js';
import type { IProcedureSuccess, ITelegramConfig } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Creates and starts the TelegramPoller, wiring it to the handler.
 *
 * @param telegram - Telegram bot configuration (token, chatId, etc.).
 * @param handler - The command handler to dispatch messages to.
 * @param mediator - The mediator to attach the poller to.
 * @returns Procedure indicating the poller was wired and started.
 */
export default function wireAndStartPoller(
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
