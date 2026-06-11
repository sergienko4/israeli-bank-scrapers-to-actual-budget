/**
 * Telegram bot command registry — single source of truth for what commands the bot exposes.
 *
 * Builds the extra-commands list from feature flags in importer config, logs how many
 * commands will be registered, and submits the list to the notifier. Kept separate from
 * mediator/handler/poller wiring so feature-flag changes can be validated in isolation.
 */

import ConfigurationError from '../../Errors/ConfigurationError.js';
import { getLogger } from '../../Logger/Index.js';
import type TelegramNotifier from '../../Services/Notifications/TelegramNotifier.js';
import type { IImporterConfig, IProcedureSuccess } from '../../Types/Index.js';
import { isFail, succeed } from '../../Types/Index.js';

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

export interface IBotCommand { command: string; description: string }

const BASE_EXTRA_COMMANDS: readonly IBotCommand[] = [
  { command: 'retry', description: 'Re-import only last failed banks' },
  { command: 'check_config', description: 'Check configuration (offline + online)' },
  { command: 'preview', description: 'Dry run: scrape banks without importing' },
];

const WATCH_COMMAND: IBotCommand = {
  command: 'watch', description: 'Check spending watch rules',
};

const RECEIPT_COMMAND: IBotCommand = {
  command: 'import_receipt', description: 'Import from receipt photo (OCR)',
};

/**
 * Builds the list of extra bot commands beyond the built-in set based on config features.
 *
 * @param config - Full importer config used to detect enabled optional features.
 * @returns Array of extra command+description objects to register with Telegram.
 */
export function buildExtraCommands(config: IImporterConfig): IBotCommand[] {
  const extras: IBotCommand[] = [...BASE_EXTRA_COMMANDS];
  if ((config.spendingWatch?.length ?? 0) > 0) extras.push(WATCH_COMMAND);
  if (config.notifications?.telegram?.enableReceiptImport) extras.push(RECEIPT_COMMAND);
  return extras;
}

/**
 * Registers the notifier's command list and throws if registration fails.
 *
 * @param notifier - The TelegramNotifier instance to register commands with.
 * @param config - Full importer config used to derive the extra-commands list.
 * @returns Procedure indicating commands were registered.
 */
export async function registerNotifierCommands(
  notifier: TelegramNotifier, config: IImporterConfig
): Promise<IProcedureSuccess<{ status: string }>> {
  const extras = buildExtraCommands(config);
  logCommandCount(extras);
  const registerResult = await notifier.registerCommands(extras);
  if (isFail(registerResult)) throw new ConfigurationError(registerResult.message);
  return succeed({ status: 'registered' });
}
