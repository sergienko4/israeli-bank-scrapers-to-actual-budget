/**
 * ReceiptImportFlow — the receipt-import engine.
 *
 * Owns Actual Budget API connection, inline-menu rendering, smart-match,
 * the photo OCR pipeline, and transaction import. Carved out of
 * ReceiptImportHandler so the handler stays a thin Telegram conversation
 * adapter (state machine + public callbacks) while this engine concentrates
 * the Actual Budget API and Receipt sub-module orchestration.
 *
 * The engine reads and mutates the live conversation state through an
 * injected {@link IReceiptFlowContext}, so it never imports the handler and
 * the dependency graph stays one-way (handler -> flow).
 */

import { getLogger } from '../../Logger/Index.js';
import type { IReceiptData, Procedure } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { INotifier } from '../Notifications/INotifier.js';
import { escapeHtml } from '../Notifications/TelegramFormatter.js';
import type TelegramNotifier from '../Notifications/TelegramNotifier.js';
import type ReceiptOcrService from '../ReceiptOcrService.js';
import type { IPayeeMatch, IReceiptActualApi } from './Index.js';
import {
  findReceiptPayeeMatch,
  importReceipt,
  presentAccountMenu,
  presentCategoryMenu,
  presentSmartMatch,
  ReceiptPhotoOcrPipeline,
} from './Index.js';
import type { IReceiptFlowContext } from './Types.js';

/** Dependencies for constructing a {@link ReceiptImportFlow}. */
export interface IReceiptFlowDeps {
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

/** Drives receipt menus, smart-match, and transaction import. */
export class ReceiptImportFlow {
  private readonly _apiFactory?: () => Promise<IReceiptActualApi>;
  private _api?: IReceiptActualApi;
  private readonly _notifier: INotifier;
  private readonly _telegramNotifier: TelegramNotifier;
  private readonly _photoPipeline: ReceiptPhotoOcrPipeline;
  private readonly _ctx: IReceiptFlowContext;

  /**
   * Creates a ReceiptImportFlow.
   * @param deps - OCR, notifiers, and optional Actual Budget API.
   * @param ctx - Live conversation-state bridge from the handler.
   */
  constructor(deps: IReceiptFlowDeps, ctx: IReceiptFlowContext) {
    this._notifier = deps.notifier;
    this._telegramNotifier = deps.telegramNotifier;
    this._api = deps.api;
    this._apiFactory = deps.apiFactory;
    this._photoPipeline = new ReceiptPhotoOcrPipeline(deps.ocr, deps.telegramNotifier);
    this._ctx = ctx;
  }

  /**
   * Sets the Actual Budget API after connection is established.
   * @param api - The Actual Budget API instance.
   */
  public setApi(api: IReceiptActualApi): void { this._api = api; }

  /**
   * Sends a text reply via the notifier.
   * @param text - HTML text to send.
   * @returns Procedure indicating the reply result.
   */
  public async reply(text: string): Promise<Procedure<{ status: string }>> {
    try { await this._notifier.sendMessage(text); }
    catch (error: unknown) { getLogger().debug(`Reply error: ${errorMessage(error)}`); return succeed({ status: 'reply-failed' }); }
    return succeed({ status: 'reply-sent' });
  }

  /**
   * Downloads, OCRs, parses the photo, then continues into match/menu display.
   * @param fileId - Telegram file_id to download.
   * @returns Procedure indicating processing result.
   */
  public async processPhoto(fileId: string): Promise<Procedure<{ status: string }>> {
    const flowId = this._ctx.state.flowId;
    const result = await this._photoPipeline.process(
      fileId,
      () => this._ctx.state.flowId !== flowId,
    );
    if (this._ctx.state.flowId !== flowId) return fail('flow cancelled');
    if (isFail(result)) {
      if (result.message === 'flow cancelled') return fail('flow cancelled');
      return await this.failWithMessage(result.message);
    }
    this._ctx.state.receipt = result.data.receipt;
    return await this.showReceiptAndMatch(result.data.receipt);
  }

  /**
   * Shows account selection inline keyboard.
   * @returns Procedure indicating menu was sent.
   */
  public async showAccountMenu(): Promise<Procedure<{ status: string }>> {
    const hasApi = await this.ensureApi();
    if (!hasApi || !this._api) { this._ctx.reset(); await this.reply('❌ Actual Budget API not connected'); return fail('API not available'); }
    try {
      const accounts = await this._api.getAccounts();
      return await presentAccountMenu(this._telegramNotifier, accounts);
    } catch (error: unknown) { getLogger().debug(`API error: ${errorMessage(error)}`); this._ctx.reset(); await this.reply('❌ Cannot reach Actual Budget'); return fail('API error'); }
  }

  /**
   * Shows category selection inline keyboard.
   * @returns Procedure indicating menu was sent.
   */
  public async showCategoryMenu(): Promise<Procedure<{ status: string }>> {
    const hasApi = await this.ensureApi();
    if (!hasApi || !this._api) { this._ctx.reset(); await this.reply('❌ Actual Budget API not connected'); return fail('API not available'); }
    try {
      const categories = await this._api.getCategories();
      return await presentCategoryMenu(this._telegramNotifier, categories);
    } catch (error: unknown) { getLogger().debug(`Category fetch error: ${errorMessage(error)}`); this._ctx.reset(); await this.reply('❌ Cannot fetch categories'); return fail('API error'); }
  }

  /**
   * Imports the receipt transaction into Actual Budget.
   * @returns Procedure indicating the import result.
   */
  public async executeImport(): Promise<Procedure<{ status: string }>> {
    const st = this._ctx.state;
    if (!st.receipt || !st.selectedAccount || !st.selectedCategory) {
      this._ctx.reset(); return fail('incomplete receipt state');
    }
    if (!this._api) {
      await this.reply('❌ API not connected — cannot write to budget');
      this._ctx.reset(); return fail('API not connected — cannot write to budget');
    }
    const result = await importReceipt(this._api, this._notifier, {
      date: st.receipt.date,
      amount: st.receipt.amount,
      merchant: st.receipt.merchant,
      memo: st.receipt.memo,
      accountId: st.selectedAccount,
      categoryId: st.selectedCategory,
    });
    this._ctx.reset();
    return result;
  }

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
   * Shows extracted receipt data and tries smart matching.
   * @param receipt - Parsed receipt data.
   * @returns Procedure indicating menu display result.
   */
  private async showReceiptAndMatch(receipt: IReceiptData): Promise<Procedure<{ status: string }>> {
    const header = ReceiptPhotoOcrPipeline.buildReceiptHeader(receipt);
    await this.reply(header);
    this._ctx.state.phase = 'awaiting_selection';
    const isApiReady = await this.ensureApi();
    if (!isApiReady) {
      getLogger().info('Smart matching unavailable — API not connected');
      return await this.showAccountMenu();
    }
    const api = this._api;
    if (api) {
      const match = await findReceiptPayeeMatch(api, receipt.merchant);
      if (match) return await this.showSmartMatch(match);
    }
    return await this.showAccountMenu();
  }

  /**
   * Shows smart match buttons (confirm / choose different / cancel).
   * @param match - The suggested account and category match.
   * @returns Procedure indicating menu was sent.
   */
  private async showSmartMatch(match: IPayeeMatch): Promise<Procedure<{ status: string }>> {
    this._ctx.state.selectedAccount = match.accId;
    this._ctx.state.selectedCategory = match.catId;
    return await presentSmartMatch(this._telegramNotifier, match);
  }

  /**
   * Resets state, sends error to Telegram, returns failure.
   * @param msg - The error message to display and return.
   * @returns Procedure failure with the message.
   */
  private async failWithMessage(msg: string): Promise<Procedure<{ status: string }>> {
    this._ctx.reset(); await this.reply(`❌ ${escapeHtml(msg)}`); return fail(msg);
  }
}
