/**
 * ReceiptImportHandler — multi-step conversation for importing receipt photos.
 * State machine: idle -> awaiting_photo -> awaiting_selection -> importing.
 *
 * Thin Telegram conversation adapter: owns the state machine (phase, flow id,
 * timeout) and the public callback surface, and delegates all Actual Budget
 * API, menu rendering, smart-match, and import work to {@link ReceiptImportFlow}.
 */

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import type { INotifier } from './Notifications/INotifier.js';
import type TelegramNotifier from './Notifications/TelegramNotifier.js';
import type { IReceiptActualApi } from './Receipt/Index.js';
import { ReceiptImportFlow } from './Receipt/ReceiptImportFlow.js';
import type { IReceiptFlowContext, IReceiptState } from './Receipt/Types.js';
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

const RECEIPT_TIMEOUT_MS = 120000;

/** Handles the multi-step receipt import conversation via Telegram. */
export class ReceiptImportHandler {
  private static _nextFlowId = 1;
  private _state: IReceiptState = { phase: 'idle', flowId: 0 };
  private readonly _flow: ReceiptImportFlow;

  /**
   * Creates a ReceiptImportHandler.
   * @param opts - Handler options with OCR, notifier, and optional API.
   */
  constructor(opts: IReceiptHandlerOptions) {
    /**
     * Reads the handler's live conversation state.
     * @returns The handler's current receipt state object.
     */
    const getState = (): IReceiptState => this._state;
    const ctx: IReceiptFlowContext = {
      /**
       * Live conversation state, read fresh on each access so the engine
       * always sees the current state object (replaced on reset).
       * @returns The handler's current receipt state object.
       */
      get state(): IReceiptState { return getState(); },
      /**
       * Resets the handler's conversation state machine to idle.
       */
      reset: (): void => { this.reset(); },
    };
    this._flow = new ReceiptImportFlow(
      {
        ocr: opts.ocr,
        notifier: opts.notifier,
        telegramNotifier: opts.telegramNotifier,
        api: opts.api,
        apiFactory: opts.apiFactory,
      },
      ctx,
    );
  }

  /**
   * Sets the Actual Budget API after connection is established.
   * @param api - The Actual Budget API instance.
   */
  public setApi(api: IReceiptActualApi): void { this._flow.setApi(api); }

  /**
   * Starts the receipt import flow.
   * @returns Procedure indicating the prompt was sent.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this.reset();
    const flowId = ReceiptImportHandler._nextFlowId++;
    this._state = { phase: 'awaiting_photo', flowId };
    this.startTimeout();
    await this._flow.reply('📸 Send a photo of your receipt (timeout: 2 min)');
    return succeed({ status: 'awaiting-photo' });
  }

  /**
   * Processes an incoming photo during the receipt import flow.
   * @param fileId - Telegram file_id of the largest photo resolution.
   * @returns Procedure indicating the processing result.
   */
  public async handlePhoto(fileId: string): Promise<Procedure<{ status: string }>> {
    if (this._state.phase !== 'awaiting_photo') {
      await this._flow.reply('💡 Use /import_receipt first, then send a photo.');
      return succeed({ status: 'unexpected-photo' });
    }
    const flowId = this._state.flowId;
    await this._flow.reply('⏳ Processing receipt...');
    if (this._state.flowId !== flowId) return fail('flow cancelled');
    return await this._flow.processPhoto(fileId);
  }

  /**
   * Handles account selection callback.
   * @param accountId - Selected Actual Budget account UUID.
   * @returns Procedure indicating the next step.
   */
  public async onAccountSelected(accountId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedAccount = accountId;
    return await this._flow.showCategoryMenu();
  }

  /**
   * Handles category selection and triggers import.
   * @param categoryId - Selected Actual Budget category UUID.
   * @returns Procedure indicating the import result.
   */
  public async onCategorySelected(categoryId: string): Promise<Procedure<{ status: string }>> {
    this._state.selectedCategory = categoryId;
    return await this._flow.executeImport();
  }

  /**
   * Confirms smart match and imports.
   * @returns Import result Procedure.
   */
  public async onConfirm(): Promise<Procedure<{ status: string }>> {
    return await this._flow.executeImport();
  }

  /**
   * Shows full menus instead of smart match.
   * @returns Menu result Procedure.
   */
  public async onChooseDifferent(): Promise<Procedure<{ status: string }>> {
    return await this._flow.showAccountMenu();
  }

  /**
   * Cancels the receipt import flow.
   * @returns Procedure indicating cancellation.
   */
  public async onCancel(): Promise<Procedure<{ status: string }>> {
    this.reset();
    await this._flow.reply('❌ Receipt import cancelled.');
    return succeed({ status: 'cancelled' });
  }

  /**
   * Whether the handler is currently awaiting a photo.
   * @returns True when the state machine is waiting for a photo.
   */
  public get isAwaitingPhoto(): boolean { return this._state.phase === 'awaiting_photo'; }

  // ─── Private ───

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
        this._flow.reply('⏰ Receipt import timed out.').catch((_err: unknown) => { /* non-critical */ });
      }
    }, RECEIPT_TIMEOUT_MS);
  }
}
