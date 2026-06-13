/**
 * ReceiptOcrService — thin orchestrator that owns the tesseract.js
 * worker lifecycle and delegates pure work to Receipt/ sub-modules:
 *
 *  - {@link preprocessForOcr} (Receipt/OcrImagePreprocess) for image
 *    pipeline (upscale + greyscale + threshold).
 *  - {@link parseReceiptFromText} (Receipt/OcrParsing) for pure text
 *    field extraction (date / amount / merchant / memo).
 *
 * Static method `parseReceipt` is preserved as a back-compat shim
 * so existing call sites (ReceiptPhotoOcrPipeline + tests) keep
 * working byte-identically.
 */

import { createWorker } from 'tesseract.js';

import { getLogger } from '../Logger/Index.js';
import type { IReceiptData, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import preprocessForOcr from './Receipt/OcrImagePreprocess.js';
import parseReceiptFromText from './Receipt/OcrParsing.js';

const DEFAULT_LANGUAGES = 'heb+eng';
const TESSERACT_CACHE = './data/tesseract';

/** Extracts transaction data from receipt photos via OCR. */
export default class ReceiptOcrService {
  private readonly _languages: string;

  /**
   * Creates a ReceiptOcrService with the specified OCR language.
   * @param languages - Tesseract language codes (default: 'heb+eng').
   */
  constructor(languages?: string) {
    this._languages = languages ?? DEFAULT_LANGUAGES;
  }

  /**
   * Runs OCR on an image buffer and returns the recognized text.
   * Preprocesses the image (upscale, greyscale, threshold) for accuracy.
   * @param imageBuffer - Raw image bytes (JPEG/PNG).
   * @returns Procedure with recognized text or failure.
   */
  public async recognize(
    imageBuffer: Buffer
  ): Promise<Procedure<{ text: string }>> {
    try {
      const processed = await preprocessForOcr(imageBuffer);
      return await runWorker(this._languages, processed);
    } catch (error: unknown) {
      return fail(`OCR failed: ${errorMessage(error)}`);
    }
  }

  /**
   * Parses OCR text to extract receipt transaction fields.
   * Delegates to the pure module function for SRP + testability.
   * Retained as a static method for back-compat with existing callers.
   * @param text - Raw OCR text from a receipt image.
   * @returns Procedure with extracted IReceiptData fields.
   */
  public static parseReceipt(text: string): Procedure<IReceiptData> {
    return parseReceiptFromText(text);
  }
}

/**
 * Runs a tesseract.js worker over a preprocessed image buffer.
 * Owns the worker lifecycle (create → recognize → terminate).
 * @param languages - Tesseract language codes (e.g. 'heb+eng').
 * @param processed - Preprocessed image buffer (PNG).
 * @returns Procedure with recognized text or failure.
 */
async function runWorker(
  languages: string,
  processed: Buffer
): Promise<Procedure<{ text: string }>> {
  const worker = await createWorker(languages, undefined, {
    cachePath: TESSERACT_CACHE,
  });
  try {
    const result = await worker.recognize(processed);
    const text = result.data.text.trim();
    if (!text) return fail('OCR produced no text');
    getLogger().info(`OCR extracted ${String(text.length)} characters`);
    return succeed({ text });
  } finally {
    await worker.terminate();
  }
}
