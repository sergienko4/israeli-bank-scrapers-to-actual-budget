/**
 * ReceiptMenuPresenter — stateless module that renders the inline
 * keyboards used by the receipt-import conversation.
 *
 * Handles only the visual layout (keyboard rows + static labels).
 * The handler keeps orchestration (state mutation, API fetching,
 * error reset+reply).
 */

import type { Procedure } from '../../Types/Index.js';
import { escapeHtml } from '../Notifications/TelegramFormatter.js';
import type TelegramNotifier from '../Notifications/TelegramNotifier.js';
import type { IPayeeMatch } from './ReceiptPayeeMatcher.js';

/** Single Actual Budget entity addressable in a menu. */
export interface IMenuEntry {
  readonly id: string;
  readonly name: string;
}

/** Inputs for {@link sendEntityMenu}. */
interface IEntityMenuOptions {
  readonly title: string;
  readonly callbackPrefix: string;
  readonly entries: readonly IMenuEntry[];
}

/**
 * Renders the smart-match confirmation menu offering "Use these"
 * or "Choose different" against a previously-matched payee.
 * @param notifier - Notifier capable of sending inline keyboards.
 * @param match - Previously-matched account+category names + ids.
 * @returns Procedure indicating the menu was sent.
 */
export async function presentSmartMatch(
  notifier: TelegramNotifier, match: IPayeeMatch,
): Promise<Procedure<{ status: string }>> {
  const text = '🔍 <b>Found previous import:</b>\n' +
    `Account: ${escapeHtml(match.accName)}\n` +
    `Category: ${escapeHtml(match.catName)}`;
  const keyboard = [
    [
      { text: '✅ Use these', callback_data: 'receipt_confirm' },
      { text: '📋 Choose different', callback_data: 'receipt_choose' },
    ],
    [{ text: '❌ Cancel', callback_data: 'receipt_cancel' }],
  ];
  return await notifier.sendInlineMenu(text, keyboard);
}

/**
 * Renders the account-selection menu.
 * @param notifier - Notifier capable of sending inline keyboards.
 * @param accounts - Accounts fetched from Actual Budget.
 * @returns Procedure indicating the menu was sent.
 */
export async function presentAccountMenu(
  notifier: TelegramNotifier, accounts: readonly IMenuEntry[],
): Promise<Procedure<{ status: string }>> {
  return await sendEntityMenu(notifier, {
    title: '📋 <b>Select account:</b>',
    callbackPrefix: 'receipt_acc',
    entries: accounts,
  });
}

/**
 * Renders the category-selection menu.
 * @param notifier - Notifier capable of sending inline keyboards.
 * @param categories - Categories fetched from Actual Budget.
 * @returns Procedure indicating the menu was sent.
 */
export async function presentCategoryMenu(
  notifier: TelegramNotifier, categories: readonly IMenuEntry[],
): Promise<Procedure<{ status: string }>> {
  return await sendEntityMenu(notifier, {
    title: '📋 <b>Select category:</b>',
    callbackPrefix: 'receipt_cat',
    entries: categories,
  });
}

/**
 * Builds and sends a one-entry-per-row inline keyboard with a
 * final cancel row.
 * @param notifier - Notifier capable of sending inline keyboards.
 * @param opts - Menu options: title, callback prefix, entries.
 * @returns Procedure indicating the menu was sent.
 */
async function sendEntityMenu(
  notifier: TelegramNotifier, opts: IEntityMenuOptions,
): Promise<Procedure<{ status: string }>> {
  const rows = opts.entries.map(e => [{
    text: e.name,
    callback_data: `${opts.callbackPrefix}:${e.id}`,
  }]);
  rows.push([{ text: '❌ Cancel', callback_data: 'receipt_cancel' }]);
  return await notifier.sendInlineMenu(opts.title, rows);
}
