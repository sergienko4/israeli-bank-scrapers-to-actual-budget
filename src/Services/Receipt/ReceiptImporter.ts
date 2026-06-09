/**
 * ReceiptImporter — writes a confirmed receipt into Actual Budget
 * and sends the user-visible confirmation message.
 *
 * Stateless module. The handler validates state machine invariants
 * and orchestrates reset/state transitions; this module owns
 * payload construction, the AB write call, name resolution for the
 * confirmation message, and the formatted reply.
 */

import { getLogger } from '../../Logger/Index.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import { escapeHtml } from '../Notifications/TelegramFormatter.js';
import type { IReceiptActualApi } from './Types.js';

/** Plain reply notifier (subset of INotifier). */
export interface IReplyNotifier {
  sendMessage: (text: string) => Promise<unknown>;
}

/** A receipt ready to import, with the user's account+category choices. */
export interface IReceiptImportRequest {
  readonly date?: string;
  readonly amount?: number;
  readonly merchant?: string;
  readonly memo?: string;
  readonly accountId: string;
  readonly categoryId: string;
}

/** Normalized receipt fields used for the AB payload and the confirmation. */
interface IReceiptFields {
  readonly dateStr: string;
  readonly cents: number;
  readonly merchant: string;
  readonly amountStr: string;
}

/** Parameters for {@link sendConfirmation}. */
interface IConfirmationOptions {
  readonly fields: IReceiptFields;
  readonly accName: string;
  readonly catName: string;
}

/**
 * Validates, writes, and confirms a receipt import.
 * @param api - Connected Actual Budget API.
 * @param notifier - Reply channel for user-visible status messages.
 * @param req - Receipt fields plus selected account+category.
 * @returns Procedure indicating import outcome.
 */
export default async function importReceipt(
  api: IReceiptActualApi, notifier: IReplyNotifier, req: IReceiptImportRequest,
): Promise<Procedure<{ status: string }>> {
  if (!req.date || req.amount === undefined) {
    await safeReply(notifier, '❌ Missing date or amount.');
    return fail('missing fields');
  }
  try { return await runImport(api, notifier, req); }
  catch (error: unknown) {
    const msg = errorMessage(error);
    await safeReply(notifier, `❌ Import failed: ${escapeHtml(msg)}`);
    return fail(`import failed: ${msg}`);
  }
}

/**
 * Runs the import after validation: write + resolve names + confirm.
 * @param api - Connected Actual Budget API.
 * @param notifier - Reply channel for the confirmation message.
 * @param req - Validated receipt import request.
 * @returns Procedure indicating success.
 */
async function runImport(
  api: IReceiptActualApi, notifier: IReplyNotifier, req: IReceiptImportRequest,
): Promise<Procedure<{ status: string }>> {
  const fields = extractFields(req);
  await writeTransaction(api, req, fields);
  const accName = await resolveName(api, 'accounts', req.accountId);
  const catName = await resolveName(api, 'categories', req.categoryId);
  getLogger().info('Receipt import completed');
  getLogger().debug(`Receipt import: ${fields.merchant} -> ${accName} / ${catName}`);
  await sendConfirmation(notifier, { fields, accName, catName });
  return succeed({ status: 'receipt-imported' });
}

/**
 * Builds the AB transaction payload and sends it via importTransactions.
 * @param api - Connected Actual Budget API.
 * @param req - Validated receipt import request (provides ids + memo).
 * @param fields - Normalized receipt fields (date/cents/merchant).
 * @returns Procedure indicating the write completed.
 */
async function writeTransaction(
  api: IReceiptActualApi, req: IReceiptImportRequest, fields: IReceiptFields,
): Promise<Procedure<{ status: string }>> {
  const payload = [{
    account: req.accountId,
    date: fields.dateStr, amount: fields.cents,
    payee_name: fields.merchant,
    imported_payee: fields.merchant,
    category: req.categoryId,
    notes: req.memo ?? '',
    cleared: false,
  }];
  await api.importTransactions(req.accountId, payload);
  return succeed({ status: 'written' });
}

/**
 * Sends the user-visible import confirmation message.
 * @param notifier - Reply channel.
 * @param opts - Confirmation inputs: fields + resolved acc/cat names.
 * @returns Procedure indicating reply outcome.
 */
async function sendConfirmation(
  notifier: IReplyNotifier, opts: IConfirmationOptions,
): Promise<Procedure<{ status: string }>> {
  const safeAmt = escapeHtml(opts.fields.amountStr);
  const safeMerchant = escapeHtml(opts.fields.merchant);
  const safeAcc = escapeHtml(opts.accName);
  const safeCat = escapeHtml(opts.catName);
  const msg = `✅ <b>Imported:</b>\n💰 ${safeAmt}\n` +
    `🏪 ${safeMerchant}\n🏦 ${safeAcc} / ${safeCat}\n` +
    `📅 ${escapeHtml(opts.fields.dateStr)}`;
  return await safeReply(notifier, msg);
}

/**
 * Normalizes optional receipt fields into the shape needed by AB.
 * Missing date falls back to today; missing amount becomes 0.
 * @param req - Receipt import request (may have optional fields).
 * @returns Normalized fields ready for payload + display.
 */
function extractFields(req: IReceiptImportRequest): IReceiptFields {
  const dateStr = req.date ?? new Date().toISOString().slice(0, 10);
  const cents = Math.round((req.amount ?? 0) * -100);
  const merchant = req.merchant ?? 'Receipt';
  const amountStr = String(req.amount ?? 0);
  return { dateStr, cents, merchant, amountStr };
}

/**
 * Resolves an account or category display name by UUID.
 * @param api - Connected Actual Budget API.
 * @param table - Either 'accounts' or 'categories'.
 * @param id - UUID to resolve.
 * @returns The resolved display name or 'Unknown' on error / miss.
 */
async function resolveName(
  api: IReceiptActualApi, table: 'accounts' | 'categories', id: string,
): Promise<string> {
  try {
    const items = table === 'accounts' ? await api.getAccounts() : await api.getCategories();
    return items.find(i => i.id === id)?.name ?? 'Unknown';
  } catch (error: unknown) {
    getLogger().debug(`Resolve name error: ${errorMessage(error)}`);
    return 'Unknown';
  }
}

/**
 * Sends a reply via the notifier, swallowing transport errors.
 * @param notifier - Reply channel.
 * @param text - Message text (already HTML-safe).
 * @returns Procedure indicating reply sent or failed.
 */
async function safeReply(
  notifier: IReplyNotifier, text: string,
): Promise<Procedure<{ status: string }>> {
  try { await notifier.sendMessage(text); return succeed({ status: 'reply-sent' }); }
  catch (error: unknown) {
    getLogger().debug(`Reply error: ${errorMessage(error)}`);
    return succeed({ status: 'reply-failed' });
  }
}
