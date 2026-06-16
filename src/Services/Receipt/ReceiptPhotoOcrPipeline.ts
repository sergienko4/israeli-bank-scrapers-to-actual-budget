/**
 * ReceiptPhotoOcrPipeline — downloads a Telegram photo, runs OCR, and parses
 * the recognized text into a structured receipt. Pure data pipeline with
 * no state-machine ownership; the caller threads a cancellation closure to
 * short-circuit work when the orchestrator's flow id has moved on.
 */

import type { IReceiptData, Procedure } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import { escapeHtml } from '../Notifications/TelegramFormatter.js';
import type TelegramNotifier from '../Notifications/TelegramNotifier.js';
import parseReceiptFromText from './OcrParsing.js';
import type { IReceiptOcr } from './Types.js';

/** Photo-to-receipt pipeline: download → OCR → parse. */
export default class ReceiptPhotoOcrPipeline {
  /**
   * Creates a ReceiptPhotoOcrPipeline.
   * @param _ocr - OCR abstraction that recognizes text from raw image bytes.
   * @param _telegramNotifier - Telegram notifier used to download photos by file_id.
   */
  constructor(
    private readonly _ocr: IReceiptOcr,
    private readonly _telegramNotifier: TelegramNotifier,
  ) {}

  /**
   * Downloads the photo and runs OCR + parsing.
   * @param fileId - Telegram file_id of the photo to process.
   * @param isCancelled - Returns true if the caller's flow has been cancelled.
   * @returns Procedure containing the parsed receipt, or a failure.
   */
  public async process(
    fileId: string, isCancelled: () => boolean,
  ): Promise<Procedure<{ receipt: IReceiptData }>> {
    const photoResult = await this._telegramNotifier.downloadPhoto(fileId);
    if (isCancelled()) return fail('flow cancelled');
    if (isFail(photoResult)) return fail(photoResult.message);
    return await this.ocrAndParse(photoResult.data, isCancelled);
  }

  /**
   * Builds the HTML header showing extracted receipt fields.
   * @param receipt - Parsed receipt data.
   * @returns HTML-escaped header string for Telegram display.
   */
  public static buildReceiptHeader(receipt: IReceiptData): string {
    const d = escapeHtml(receipt.date ?? 'N/A');
    const a = receipt.amount === undefined ? 'N/A' : String(receipt.amount);
    const m = escapeHtml(receipt.merchant ?? 'N/A');
    return `📸 <b>Receipt detected:</b>\n📅 Date: ${d}\n💰 Amount: ${escapeHtml(a)}\n🏪 Payee: ${m}`;
  }

  /**
   * Runs OCR on the image and parses the recognized text into a receipt.
   * @param buffer - Raw image bytes from the downloaded photo.
   * @param isCancelled - Returns true if the caller's flow has been cancelled.
   * @returns Procedure containing the parsed receipt, or a failure.
   */
  private async ocrAndParse(
    buffer: Buffer, isCancelled: () => boolean,
  ): Promise<Procedure<{ receipt: IReceiptData }>> {
    const ocrResult = await this._ocr.recognize(buffer);
    if (isCancelled()) return fail('flow cancelled');
    if (isFail(ocrResult)) return fail(ocrResult.message);
    const parseResult = parseReceiptFromText(ocrResult.data.text);
    if (isFail(parseResult)) return fail(parseResult.message);
    return succeed({ receipt: parseResult.data });
  }
}
