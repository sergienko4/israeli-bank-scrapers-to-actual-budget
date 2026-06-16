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
import type { IReceiptOcr } from './Receipt/Types.js';

const DEFAULT_LANGUAGES = 'heb+eng';
const TESSERACT_CACHE = './data/tesseract';

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type OcrTextResult = Procedure<{ text: string }>;

/** Extracts transaction data from receipt photos via OCR. */
export default class ReceiptOcrService implements IReceiptOcr {
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
async function runWorker(languages: string, processed: Buffer): Promise<OcrTextResult> {
  const worker = await createOcrWorker(languages);
  try {
    return await readWorkerText(worker, processed);
  } finally {
    await safeTerminate(worker);
  }
}

/**
 * Creates a tesseract.js worker with the standard cache path.
 * @param languages - Tesseract language codes (e.g. 'heb+eng').
 * @returns Initialized tesseract worker.
 */
async function createOcrWorker(languages: string): Promise<OcrWorker> {
  return await createWorker(languages, undefined, { cachePath: TESSERACT_CACHE });
}

/**
 * Terminates a tesseract worker, swallowing any cleanup error.
 *
 * Prevents `worker.terminate()` rejection from masking a successful
 * OCR result (or the original failure) in `runWorker()`'s finally
 * block. The cleanup error is warn-logged for observability but does
 * not propagate.
 * @param worker - Tesseract worker to terminate.
 * @returns True once the termination attempt completed.
 */
async function safeTerminate(worker: OcrWorker): Promise<boolean> {
  try {
    await worker.terminate();
  } catch (error: unknown) {
    getLogger().warn(`Failed to terminate OCR worker: ${errorMessage(error)}`);
  }
  return true;
}

/**
 * Reads recognized text from a tesseract worker and wraps it in a Procedure.
 * @param worker - Tesseract worker instance.
 * @param processed - Preprocessed image buffer (PNG).
 * @returns Procedure with recognized text or failure.
 */
async function readWorkerText(worker: OcrWorker, processed: Buffer): Promise<OcrTextResult> {
  const text = await extractTrimmedText(worker, processed);
  if (!text) return fail('OCR produced no text');
  getLogger().info(`OCR extracted ${String(text.length)} characters`);
  return succeed({ text });
}

/**
 * Recognizes text on the worker and returns the trimmed result.
 * @param worker - Tesseract worker instance.
 * @param processed - Preprocessed image buffer (PNG).
 * @returns Trimmed recognized text (may be empty).
 */
async function extractTrimmedText(worker: OcrWorker, processed: Buffer): Promise<string> {
  const result = await worker.recognize(processed);
  return result.data.text.trim();
}
