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
import type { IPayeeMatch, IReceiptActualApi } from './Receipt/Index.js';
import {
  findReceiptPayeeMatch,
  importReceipt,
  presentAccountMenu,
  presentCategoryMenu,
  presentSmartMatch,
  ReceiptPhotoOcrPipeline,
} from './Receipt/Index.js';
import type ReceiptOcrService from './ReceiptOcrService.js';

export type { IReceiptActualApi } from './Receipt/Index.js';

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

const RECEIPT_TIMEOUT_MS = 120000;

/** Handles the multi-step receipt import conversation via Telegram. */
export class ReceiptImportHandler {
  private static _nextFlowId = 1;
  private _state: IReceiptState = { phase: 'idle', flowId: 0 };
  private readonly _apiFactory?: () => Promise<IReceiptActualApi>;
  private _api?: IReceiptActualApi;
  private readonly _notifier: INotifier;
  private readonly _telegramNotifier: TelegramNotifier;
  private readonly _photoPipeline: ReceiptPhotoOcrPipeline;

  /**
   * Creates a ReceiptImportHandler.
   * @param opts - Handler options with OCR, notifier, and optional API.
   */
  constructor(opts: IReceiptHandlerOptions) {
    this._notifier = opts.notifier;
    this._telegramNotifier = opts.telegramNotifier;
    this._api = opts.api;
    this._apiFactory = opts.apiFactory;
    this._photoPipeline = new ReceiptPhotoOcrPipeline(opts.ocr, opts.telegramNotifier);
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
    return await this.processPhoto(fileId);
  }

  /**
   * Handles account selection callback.
   * @param accountId - Selected Actual Budget account UUID.
   * @returns Procedure indicating the next step.
   */
  public async onAccountSelected(accountId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedAccount = accountId;
    return await this.showCategoryMenu();
  }

  /**
   * Handles category selection and triggers import.
   * @param categoryId - Selected Actual Budget category UUID.
   * @returns Procedure indicating the import result.
   */
  public async onCategorySelected(categoryId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedCategory = categoryId;
    return await this.executeImport();
  }

  /**
   * Confirms smart match and imports.
   * @returns Import result Procedure.
   */
  public async onConfirm(): Promise<Procedure<{ status: string }>> {
    return await this.executeImport();
  }

  /**
   * Shows full menus instead of smart match.
   * @returns Menu result Procedure.
   */
  public async onChooseDifferent(): Promise<Procedure<{ status: string }>> {
    return await this.showAccountMenu();
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
   * Downloads, OCRs, parses the photo, then continues into match/menu display.
   * @param fileId - Telegram file_id to download.
   * @returns Procedure indicating processing result.
   */
  private async processPhoto(fileId: string): Promise<Procedure<{ status: string }>> {
    const flowId = this._state.flowId;
    const result = await this._photoPipeline.process(fileId, () => this._state.flowId !== flowId);
    if (this._state.flowId !== flowId) return fail('flow cancelled');
    if (isFail(result)) {
      if (result.message === 'flow cancelled') return fail('flow cancelled');
      return await this.failWithMessage(result.message);
    }
    this._state.receipt = result.data.receipt;
    return await this.showReceiptAndMatch(result.data.receipt);
  }

  /**
   * Shows extracted receipt data and tries smart matching.
   * @param receipt - Parsed receipt data.
   * @returns Procedure indicating menu display result.
   */
  private async showReceiptAndMatch(receipt: IReceiptData): Promise<Procedure<{ status: string }>> {
    const header = ReceiptPhotoOcrPipeline.buildReceiptHeader(receipt);
    await this.reply(header);
    this._state.phase = 'awaiting_selection';
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
    this._state.selectedAccount = match.accId;
    this._state.selectedCategory = match.catId;
    return await presentSmartMatch(this._telegramNotifier, match);
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
      return await presentAccountMenu(this._telegramNotifier, accounts);
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
      return await presentCategoryMenu(this._telegramNotifier, categories);
    } catch (error: unknown) { getLogger().debug(`Category fetch error: ${errorMessage(error)}`); this.reset(); await this.reply('❌ Cannot fetch categories'); return fail('API error'); }
  }

  /**
   * Imports the receipt transaction into Actual Budget.
   * @returns Procedure indicating the import result.
   */
  /**
   * Imports the receipt transaction into Actual Budget.
   * @returns Procedure indicating the import result.
   */
  private async executeImport(): Promise<Procedure<{ status: string }>> {
    const st = this._state;
    if (!st.receipt || !st.selectedAccount || !st.selectedCategory) {
      this.reset(); return fail('incomplete receipt state');
    }
    if (!this._api) {
      await this.reply('❌ API not connected — cannot write to budget');
      this.reset(); return fail('API not connected — cannot write to budget');
    }
    const result = await importReceipt(this._api, this._notifier, {
      date: st.receipt.date,
      amount: st.receipt.amount,
      merchant: st.receipt.merchant,
      memo: st.receipt.memo,
      accountId: st.selectedAccount,
      categoryId: st.selectedCategory,
    });
    this.reset();
    return result;
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
