/**
 * ReceiptImportHandler — multi-step conversation for importing receipt photos.
 * State machine: idle -> awaiting_photo -> awaiting_selection -> importing.
 */

import { getLogger } from '../Logger/Index.js';
import type { IReceiptData, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { INotifier } from './Notifications/INotifier.js';
import { escapeHtml } from './Notifications/TelegramFormatter.js';
import type TelegramNotifier from './Notifications/TelegramNotifier.js';
import ReceiptOcrService from './ReceiptOcrService.js';

/** Actual Budget API surface needed by ReceiptImportHandler. */
export interface IReceiptActualApi {
  /** Fetches all accounts from Actual Budget. */
  getAccounts: () => Promise<{ id: string; name: string }[]>;
  /** Fetches all categories from Actual Budget. */
  getCategories: () => Promise<{ id: string; name: string }[]>;
  /** Imports transactions into an Actual Budget account. */
  importTransactions: (
    accountId: string,
    transactions: { account: string; date: string; [key: string]: unknown }[]
  ) => Promise<unknown>;
  /** Builds an AQL query for the given table. */
  q: (table: string) => {
    filter: (f: unknown) => {
      select: (s: string[]) => {
        orderBy: (o: unknown) => unknown;
      };
    };
  };
  /** Executes an AQL query. */
  aqlQuery: (query: unknown) => Promise<unknown>;
}

/** Options for constructing a ReceiptImportHandler. */
export interface IReceiptHandlerOptions {
  /** OCR service for receipt text extraction. */
  readonly ocr: ReceiptOcrService;
  /** Basic notifier for sending text replies. */
  readonly notifier: INotifier;
  /** Extended notifier for photo download and menus. */
  readonly telegramNotifier: TelegramNotifier;
  /** Optional Actual Budget API (set later via setApi). */
  readonly api?: IReceiptActualApi;
  /** Lazy API factory — connects to Actual Budget on demand. */
  readonly apiFactory?: () => Promise<IReceiptActualApi>;
}

/** Receipt import conversation state. */
interface IReceiptState {
  phase: 'idle' | 'awaiting_photo' | 'awaiting_selection';
  flowId: number;
  receipt?: IReceiptData;
  selectedAccount?: string;
  selectedCategory?: string;
  timeoutHandle?: ReturnType<typeof globalThis.setTimeout>;
}

/** Named account + category match from a previous transaction. */
interface IPayeeMatch { accId: string; accName: string; catId: string; catName: string }

const RECEIPT_TIMEOUT_MS = 120000;

/** Handles the multi-step receipt import conversation via Telegram. */
export class ReceiptImportHandler {
  private static _nextFlowId = 1;
  private _state: IReceiptState = { phase: 'idle', flowId: 0 };
  private readonly _apiFactory?: () => Promise<IReceiptActualApi>;
  private _api?: IReceiptActualApi;
  private readonly _ocr: ReceiptOcrService;
  private readonly _notifier: INotifier;
  private readonly _telegramNotifier: TelegramNotifier;

  /**
   * Creates a ReceiptImportHandler.
   * @param opts - Handler options with OCR, notifier, and optional API.
   */
  constructor(opts: IReceiptHandlerOptions) {
    this._ocr = opts.ocr;
    this._notifier = opts.notifier;
    this._telegramNotifier = opts.telegramNotifier;
    this._api = opts.api;
    this._apiFactory = opts.apiFactory;
  }

  /**
   * Sets the Actual Budget API after connection is established.
   * @param api - The Actual Budget API instance.
   */
  public setApi(api: IReceiptActualApi): void { this._api = api; }

  /**
   * Starts the receipt import flow.
   * @returns Procedure indicating the prompt was sent.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this.reset();
    const flowId = ReceiptImportHandler._nextFlowId++;
    this._state = { phase: 'awaiting_photo', flowId };
    this.startTimeout();
    await this.reply('📸 Send a photo of your receipt (timeout: 2 min)');
    return succeed({ status: 'awaiting-photo' });
  }

  /**
   * Processes an incoming photo during the receipt import flow.
   * @param fileId - Telegram file_id of the largest photo resolution.
   * @returns Procedure indicating the processing result.
   */
  public async handlePhoto(fileId: string): Promise<Procedure<{ status: string }>> {
    if (this._state.phase !== 'awaiting_photo') {
      await this.reply('💡 Use /import_receipt first, then send a photo.');
      return succeed({ status: 'unexpected-photo' });
    }
    const flowId = this._state.flowId;
    await this.reply('⏳ Processing receipt...');
    if (this._state.flowId !== flowId) return fail('flow cancelled');
    return this.processPhoto(fileId);
  }

  /**
   * Handles account selection callback.
   * @param accountId - Selected Actual Budget account UUID.
   * @returns Procedure indicating the next step.
   */
  public async onAccountSelected(accountId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedAccount = accountId;
    return this.showCategoryMenu();
  }

  /**
   * Handles category selection and triggers import.
   * @param categoryId - Selected Actual Budget category UUID.
   * @returns Procedure indicating the import result.
   */
  public async onCategorySelected(categoryId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedCategory = categoryId;
    return this.executeImport();
  }

  /**
   * Confirms the smart-matched account+category and imports.
   * @returns Procedure indicating the import result.
   */
  public async onConfirm(): Promise<Procedure<{ status: string }>> { return this.executeImport(); }

  /**
   * Shows full account+category menus instead of smart match.
   * @returns Procedure indicating the menu was sent.
   */
  public async onChooseDifferent(): Promise<Procedure<{ status: string }>> {
    return this.showAccountMenu();
  }

  /**
   * Cancels the receipt import flow.
   * @returns Procedure indicating cancellation.
   */
  public async onCancel(): Promise<Procedure<{ status: string }>> {
    this.reset();
    await this.reply('❌ Receipt import cancelled.');
    return succeed({ status: 'cancelled' });
  }

  /**
   * Whether the handler is currently awaiting a photo.
   * @returns True when the state machine is waiting for a photo.
   */
  public get isAwaitingPhoto(): boolean { return this._state.phase === 'awaiting_photo'; }

  // ─── Private ───

  /**
   * Ensures the Actual Budget API is connected, using the factory if needed.
   * @returns True if the API is available, false otherwise.
   */
  private async ensureApi(): Promise<boolean> {
    if (this._api) return true;
    if (!this._apiFactory) return false;
    try {
      this._api = await this._apiFactory();
      return true;
    } catch (error: unknown) {
      getLogger().debug(`API connect failed: ${errorMessage(error)}`);
      return false;
    }
  }

  /**
   * Downloads and OCRs the photo, then shows results.
   * @param fileId - Telegram file_id to download.
   * @returns Procedure indicating processing result.
   */
  private async processPhoto(fileId: string): Promise<Procedure<{ status: string }>> {
    const flowId = this._state.flowId;
    const photoResult = await this._telegramNotifier.downloadPhoto(fileId);
    if (this._state.flowId !== flowId) return fail('flow cancelled');
    if (isFail(photoResult)) return this.failWithMessage(photoResult.message);
    return this.ocrAndParse(photoResult.data, flowId);
  }

  /**
   * Runs OCR and parsing on the image buffer.
   * @param buffer - Raw image bytes.
   * @param flowId - Flow token to check for cancellation.
   * @returns Procedure indicating parse result.
   */
  private async ocrAndParse(
    buffer: Buffer, flowId: number
  ): Promise<Procedure<{ status: string }>> {
    const ocrResult = await this._ocr.recognize(buffer);
    if (this._state.flowId !== flowId) return fail('flow cancelled');
    if (isFail(ocrResult)) return this.failWithMessage(ocrResult.message);
    const parseResult = ReceiptOcrService.parseReceipt(ocrResult.data.text);
    if (isFail(parseResult)) return this.failWithMessage(parseResult.message);
    this._state.receipt = parseResult.data;
    return this.showReceiptAndMatch(parseResult.data);
  }

  /**
   * Shows extracted receipt data and tries smart matching.
   * @param receipt - Parsed receipt data.
   * @returns Procedure indicating menu display result.
   */
  private async showReceiptAndMatch(receipt: IReceiptData): Promise<Procedure<{ status: string }>> {
    const header = ReceiptImportHandler.buildReceiptHeader(receipt);
    await this.reply(header);
    this._state.phase = 'awaiting_selection';
    const isApiReady = await this.ensureApi();
    if (!isApiReady) {
      getLogger().info('Smart matching unavailable — API not connected');
      return this.showAccountMenu();
    }
    const match = await this.findPayeeMatch(receipt.merchant);
    if (match) return this.showSmartMatch(match);
    return this.showAccountMenu();
  }

  /**
   * Builds the HTML header showing extracted receipt fields.
   * @param receipt - Parsed receipt data.
   * @returns HTML-escaped header string.
   */
  private static buildReceiptHeader(receipt: IReceiptData): string {
    const d = escapeHtml(receipt.date ?? 'N/A');
    const a = receipt.amount === undefined ? 'N/A' : String(receipt.amount);
    const m = escapeHtml(receipt.merchant ?? 'N/A');
    return `📸 <b>Receipt detected:</b>\n📅 Date: ${d}\n💰 Amount: ${escapeHtml(a)}\n🏪 Payee: ${m}`;
  }

  /**
   * Queries for a previous transaction with the same payee.
   * @param merchant - Merchant name to search for.
   * @returns Match data or false if not found.
   */
  private async findPayeeMatch(merchant?: string): Promise<IPayeeMatch | false> {
    if (!merchant || !this._api) return false;
    try { return await this.queryPayeeMatch(merchant); }
    catch (err: unknown) { getLogger().debug(`payee match: ${errorMessage(err)}`); return false; }
  }

  /**
   * Executes the AQL query for a payee match.
   * @param merchant - Merchant name to search for.
   * @returns Match data or false if not found.
   */
  private async queryPayeeMatch(merchant: string): Promise<IPayeeMatch | false> {
    if (!this._api) return false;
    const safeMerchant = merchant.replaceAll('%', String.raw`\%`).replaceAll('_', String.raw`\_`);
    const query = this._api.q('transactions')
      .filter({ imported_payee: { $like: `%${safeMerchant}%` }, category: { $ne: null } })
      .select(['account', 'category'])
      .orderBy({ date: 'desc' });
    const raw = await this._api.aqlQuery(query);
    const data = (raw as { data?: { account: string; category: string }[] } | null)?.data;
    if (!data || data.length === 0) return false;
    return await this.resolveMatchNames(data[0]);
  }

  /**
   * Resolves account and category names for a matched transaction.
   * @param txn - The matched transaction with account and category IDs.
   * @param txn.account - The Actual Budget account UUID.
   * @param txn.category - The Actual Budget category UUID.
   * @returns Named match or false if names cannot be resolved.
   */
  private async resolveMatchNames(
    txn: { account: string; category: string }
  ): Promise<IPayeeMatch | false> {
    if (!this._api) return false;
    const accounts = await this._api.getAccounts();
    const categories = await this._api.getCategories();
    const acc = accounts.find(a => a.id === txn.account);
    const cat = categories.find(c => c.id === txn.category);
    if (!acc || !cat) return false;
    return { accId: acc.id, accName: acc.name, catId: cat.id, catName: cat.name };
  }

  /**
   * Shows smart match buttons (confirm / choose different / cancel).
   * @param match - The suggested account and category match.
   * @returns Procedure indicating menu was sent.
   */
  private async showSmartMatch(match: IPayeeMatch): Promise<Procedure<{ status: string }>> {
    this._state.selectedAccount = match.accId;
    this._state.selectedCategory = match.catId;
    const text = '🔍 <b>Found previous import:</b>\n' +
      `Account: ${escapeHtml(match.accName)}\nCategory: ${escapeHtml(match.catName)}`;
    const keyboard = [
      [{ text: '✅ Use these', callback_data: 'receipt_confirm' }, { text: '📋 Choose different', callback_data: 'receipt_choose' }],
      [{ text: '❌ Cancel', callback_data: 'receipt_cancel' }],
    ];
    return this._telegramNotifier.sendInlineMenu(text, keyboard);
  }

  /**
   * Shows account selection inline keyboard.
   * @returns Procedure indicating menu was sent.
   */
  private async showAccountMenu(): Promise<Procedure<{ status: string }>> {
    const hasApi = await this.ensureApi();
    if (!hasApi || !this._api) { this.reset(); await this.reply('❌ Actual Budget API not connected'); return fail('API not available'); }
    try {
      const accounts = await this._api.getAccounts();
      const rows = accounts.map(a => [{ text: a.name, callback_data: `receipt_acc:${a.id}` }]);
      rows.push([{ text: '❌ Cancel', callback_data: 'receipt_cancel' }]);
      return await this._telegramNotifier.sendInlineMenu('📋 <b>Select account:</b>', rows);
    } catch (error: unknown) { getLogger().debug(`API error: ${errorMessage(error)}`); this.reset(); await this.reply('❌ Cannot reach Actual Budget'); return fail('API error'); }
  }

  /**
   * Shows category selection inline keyboard.
   * @returns Procedure indicating menu was sent.
   */
  private async showCategoryMenu(): Promise<Procedure<{ status: string }>> {
    const hasApi = await this.ensureApi();
    if (!hasApi || !this._api) { this.reset(); await this.reply('❌ Actual Budget API not connected'); return fail('API not available'); }
    try {
      const categories = await this._api.getCategories();
      const rows = categories.map(c => [{ text: c.name, callback_data: `receipt_cat:${c.id}` }]);
      rows.push([{ text: '❌ Cancel', callback_data: 'receipt_cancel' }]);
      return await this._telegramNotifier.sendInlineMenu('📋 <b>Select category:</b>', rows);
    } catch (error: unknown) { getLogger().debug(`Category fetch error: ${errorMessage(error)}`); this.reset(); await this.reply('❌ Cannot fetch categories'); return fail('API error'); }
  }

  /**
   * Imports the receipt transaction into Actual Budget.
   * @returns Procedure indicating the import result.
   */
  private async executeImport(): Promise<Procedure<{ status: string }>> {
    const st = this._state;
    if (!st.receipt || !st.selectedAccount || !st.selectedCategory) { this.reset(); return fail('incomplete receipt state'); }
    if (!st.receipt.date || st.receipt.amount === undefined) { await this.reply('❌ Missing date or amount.'); this.reset(); return fail('missing fields'); }
    try {
      return await this.doImport(st);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      await this.reply(`❌ Import failed: ${escapeHtml(msg)}`);
      this.reset(); return fail(`import failed: ${msg}`);
    }
  }

  /**
   * Performs the actual import and sends confirmation.
   * @param st - Current receipt state with all fields populated.
   * @returns Procedure indicating success.
   */
  private async doImport(
    st: IReceiptState
  ): Promise<Procedure<{ status: string }>> {
    const fields = ReceiptImportHandler.extractFields(st);
    const writeResult = await this.writeToActualBudget(st, fields);
    if (isFail(writeResult)) {
      const msg = escapeHtml(writeResult.message);
      await this.reply(`❌ ${msg}`);
      this.reset(); return fail(writeResult.message);
    }
    const accName = await this.resolveName('accounts', st.selectedAccount ?? '');
    const catName = await this.resolveName('categories', st.selectedCategory ?? '');
    getLogger().info('Receipt import completed');
    getLogger().debug(`Receipt import: ${fields.merchant} -> ${accName} / ${catName}`);
    await this.sendImportConfirmation(fields, accName, catName);
    this.reset();
    return succeed({ status: 'receipt-imported' });
  }

  /**
   * Writes the receipt transaction to Actual Budget via API.
   * @param st - Receipt state with account and category selections.
   * @param fields - Extracted receipt fields.
   * @param fields.dateStr - Transaction date (YYYY-MM-DD).
   * @param fields.cents - Amount in cents (negative for expense).
   * @param fields.merchant - Merchant/payee name.
   * @returns Procedure indicating write success or failure.
   */
  private async writeToActualBudget(
    st: IReceiptState,
    fields: { dateStr: string; cents: number; merchant: string }
  ): Promise<Procedure<{ status: string }>> {
    if (!this._api || !st.selectedAccount) return fail('API not connected — cannot write to budget');
    const payload = [{
      account: st.selectedAccount,
      date: fields.dateStr, amount: fields.cents,
      payee_name: fields.merchant,
      imported_payee: fields.merchant,
      category: st.selectedCategory,
      notes: st.receipt?.memo ?? '',
      cleared: false,
    }];
    await this._api.importTransactions(st.selectedAccount, payload);
    return succeed({ status: 'written' });
  }

  /**
   * Sends the import confirmation message to Telegram.
   * @param fields - Extracted receipt fields.
   * @param fields.amountStr - Display amount string.
   * @param fields.merchant - Merchant/payee name.
   * @param fields.dateStr - Transaction date.
   * @param accName - Resolved account name.
   * @param catName - Resolved category name.
   */
  private async sendImportConfirmation(
    fields: { amountStr: string; merchant: string; dateStr: string },
    accName: string, catName: string
  ): Promise<void> {
    const safeAmt = escapeHtml(fields.amountStr);
    const safeMerchant = escapeHtml(fields.merchant);
    const safeAcc = escapeHtml(accName);
    const safeCat = escapeHtml(catName);
    const msg = `✅ <b>Imported:</b>\n💰 ${safeAmt}\n` +
      `🏪 ${safeMerchant}\n🏦 ${safeAcc} / ${safeCat}\n` +
      `📅 ${escapeHtml(fields.dateStr)}`;
    await this.reply(msg);
  }

  /**
   * Extracts and normalizes receipt fields from state.
   * @param st - The receipt state to extract fields from.
   * @returns Normalized receipt fields with defaults applied.
   */
  private static extractFields(st: IReceiptState): {
    dateStr: string; cents: number; merchant: string; amountStr: string;
  } {
    const receipt = st.receipt;
    const dateStr = receipt?.date ?? new Date().toISOString().slice(0, 10);
    const cents = Math.round((receipt?.amount ?? 0) * -100);
    const merchant = receipt?.merchant ?? 'Receipt';
    const amountStr = String(receipt?.amount ?? 0);
    return { dateStr, cents, merchant, amountStr };
  }

  /**
   * Resolves a name from accounts or categories by ID.
   * @param table - 'accounts' or 'categories'.
   * @param id - UUID to look up.
   * @returns The resolved name or 'Unknown'.
   */
  private async resolveName(table: string, id: string): Promise<string> {
    if (!this._api) return 'Unknown';
    try {
      const items = table === 'accounts'
        ? await this._api.getAccounts()
        : await this._api.getCategories();
      return items.find(i => i.id === id)?.name ?? 'Unknown';
    } catch (error: unknown) { getLogger().debug(`Resolve name error: ${errorMessage(error)}`); return 'Unknown'; }
  }

  /**
   * Sends a text reply via the notifier.
   * @param text - HTML text to send.
   * @returns Procedure indicating the reply result.
   */
  private async reply(text: string): Promise<Procedure<{ status: string }>> {
    try { await this._notifier.sendMessage(text); }
    catch (error: unknown) { getLogger().debug(`Reply error: ${errorMessage(error)}`); return succeed({ status: 'reply-failed' }); }
    return succeed({ status: 'reply-sent' });
  }

  /**
   * Resets state, sends error to Telegram, returns failure.
   * @param msg - The error message to display and return.
   * @returns Procedure failure with the message.
   */
  private async failWithMessage(msg: string): Promise<Procedure<{ status: string }>> {
    this.reset(); await this.reply(`❌ ${escapeHtml(msg)}`); return fail(msg);
  }

  /** Resets the state machine to idle. */
  private reset(): void {
    if (this._state.timeoutHandle) globalThis.clearTimeout(this._state.timeoutHandle);
    this._state = { phase: 'idle', flowId: 0 };
  }

  /** Starts the 2-minute timeout for the receipt flow. */
  private startTimeout(): void {
    this._state.timeoutHandle = globalThis.setTimeout(() => {
      if (this._state.phase !== 'idle') {
        this.reset();
        this.reply('⏰ Receipt import timed out.').catch((_err: unknown) => { /* non-critical */ });
      }
    }, RECEIPT_TIMEOUT_MS);
  }
}
