/**
 * ReceiptOcrService — OCR receipt photos using tesseract.js and parse transaction fields.
 * Supports Hebrew + English receipts. Runs locally with no cloud dependency.
 * Uses sharp for image preprocessing (upscale, greyscale, threshold) to improve OCR accuracy.
 */

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

import { getLogger } from '../Logger/Index.js';
import type { IReceiptData, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const MIN_WIDTH_PX = 1500;

const DEFAULT_LANGUAGES = 'heb+eng';

/** Regex patterns for Israeli receipt parsing. */
const DATE_PATTERN = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;
/** Matches Hebrew "total" variants (סה"כ, סה"ג OCR misread). */
const TOTAL_HEB = 'סה.{1,2}[כגך]';
/** Hebrew "to pay" / "total due" patterns. */
const PAY_HEB = String.raw`לתשלום|יתרה\s*לתשלום|שולם|נותר\s*לתשלום`;
const AMOUNT_PATTERNS = [
  // לתשלום (to pay) — highest priority (final total)
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*=?(?:${PAY_HEB})`),
  new RegExp(String.raw`(?:${PAY_HEB})[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`),
  // סה"כ (subtotal/total) — second priority
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*(?:${TOTAL_HEB}|total|סכום)`, 'i'),
  new RegExp(String.raw`(?:${TOTAL_HEB}|total|סכום|amount)[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`, 'i'),
  // Currency symbol patterns
  /₪\s*(\d[\d,]*(?:\.\d+)?)/,
  /(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:₪|ILS|ש"ח)/,
];

/** Lines to skip when extracting merchant name. */
const SKIP_LINE_PATTERNS = [
  /^\d{7,}/, // business reg number (7+ digits)
  /חשבונית/i, // "invoice"
  /קבלה\s*מס/i, // "receipt number"
  /העתק/i, // "copy"
  /עוסק\s*(מורשה|פטור)/i, // "authorized/exempt dealer"
  /ע[.\s]*מ[.\s]|ח[.\s]*פ[.\s]/i, // entity abbreviations
  /מספר[:\s]*\d/i, // "number: NNN"
  /תאריך/i, // "date" header line
  /טלפו?ן/i, // "phone"
  /פקס/i, // "fax"
  /כתובת/i, // "address" label
  /לכבוד/i, // "to:" salutation
  /^[-–—\s*]+$/, // separator lines
  /^\s*\d+\s*$/, // lines with only digits
  /^\d{2,3}[-\s]?\d{7}$/, // phone numbers (050-1234567)
];


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
   * Preprocesses the image (upscale, greyscale, threshold) for better accuracy.
   * @param imageBuffer - Raw image bytes (JPEG/PNG).
   * @returns Procedure with recognized text or failure.
   */
  public async recognize(
    imageBuffer: Buffer
  ): Promise<Procedure<{ text: string }>> {
    try {
      const processed = await ReceiptOcrService.preprocess(imageBuffer);
      const worker = await createWorker(this._languages, undefined, { cachePath: './data/tesseract' });
      try {
        const result = await worker.recognize(processed);
        const text = result.data.text.trim();
        if (!text) return fail('OCR produced no text');
        getLogger().info(`OCR extracted ${String(text.length)} characters`);
        return succeed({ text });
      } finally {
        await worker.terminate();
      }
    } catch (error: unknown) {
      return fail(`OCR failed: ${errorMessage(error)}`);
    }
  }

  /**
   * Parses OCR text to extract receipt transaction fields.
   * @param text - Raw OCR text from a receipt image.
   * @returns Procedure with extracted IReceiptData fields.
   */
  public static parseReceipt(text: string): Procedure<IReceiptData> {
    const cleaned = text.replaceAll(/[\u200F\u200E\u202A-\u202E]/g, '');
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return fail('No text lines to parse');
    const rawDate = ReceiptOcrService.extractDate(cleaned);
    const rawAmount = ReceiptOcrService.extractAmount(cleaned);
    const rawMerchant = ReceiptOcrService.extractMerchant(lines);
    const memo = ReceiptOcrService.buildMemo(lines);
    const date = rawDate || void 0;
    const amount = rawAmount || void 0;
    const merchant = rawMerchant || void 0;
    getLogger().debug(
      `Receipt parsed: date=${date ?? 'N/A'}, ` +
      `amount=${String(amount ?? 'N/A')}, merchant=${merchant ?? 'N/A'}`
    );
    return succeed({ date, amount, merchant, memo });
  }

  /**
   * Extracts a date from receipt text using common date patterns.
   * @param text - Raw OCR text to search for dates.
   * @returns Formatted date string (YYYY-MM-DD) or false if not found.
   */
  private static extractDate(text: string): string | false {
    const match = DATE_PATTERN.exec(text);
    if (!match) return false;
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  /**
   * Extracts the total amount, searching line-by-line with priority.
   * Checks לתשלום first across all lines, then סה"כ, then ₪.
   * @param text - Raw OCR text to search for amounts.
   * @returns Amount as a number or false if not found.
   */
  private static extractAmount(text: string): number | false {
    const lines = text.split('\n');
    // Priority search: labeled amounts first
    for (const pattern of AMOUNT_PATTERNS) {
      for (const line of lines) {
        if (line.length > 200) continue;
        const match = pattern.exec(line);
        if (!match) continue;
        const cleaned = match[1].replaceAll(',', '');
        const parsed = Number.parseFloat(cleaned);
        if (!Number.isNaN(parsed) && parsed >= 1) return parsed;
      }
    }
    // Fallback: find the largest comma-formatted number (likely the total)
    return ReceiptOcrService.findLargestAmount(lines);
  }

  /**
   * Finds the largest comma-formatted amount across all lines.
   * @param lines - Array of text lines to search.
   * @returns The largest amount found, or false if none.
   */
  private static findLargestAmount(lines: string[]): number | false {
    let largest = 0;
    for (const line of lines) {
      if (line.length > 200) continue;
      const pattern = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;
      let match = pattern.exec(line);
      while (match) {
        const cleaned = match[1].replaceAll(',', '');
        const val = Number.parseFloat(cleaned);
        if (val > largest) largest = val;
        match = pattern.exec(line);
      }
    }
    return largest > 0 ? largest : false;
  }

  /**
   * Extracts the merchant name, skipping registration and invoice lines.
   * @param lines - Array of non-empty text lines from the receipt.
   * @returns Merchant name or false if not found.
   */
  private static extractMerchant(lines: string[]): string | false {
    // First: check for "לכבוד:" (to:) — extract recipient name
    const toLine = lines.find(l => /לכבוד\s*[;:]/.test(l));
    if (toLine) {
      const idx = toLine.indexOf('לכבוד');
      const afterLabel = toLine.slice(idx + 'לכבוד'.length);
      const name = afterLabel.replace(/^[\s;:]*/, '').replaceAll('\u200F', '').replaceAll('\u200E', '').trim();
      const isLabel = /מספר|טלפון|כתובת|דף|מתוך/.test(name);
      if (name.length >= 3 && !isLabel) return name;
    }
    // Fallback: first meaningful non-skip line
    for (const line of lines) {
      if (line.length < 2) continue;
      if (DATE_PATTERN.test(line)) continue;
      if (ReceiptOcrService.isSkipLine(line)) continue;
      return line.replaceAll(/[\u200F\u200E]/g, '').trim();
    }
    return false;
  }

  /**
   * Checks whether a line should be skipped for merchant extraction.
   * @param line - The text line to check.
   * @returns True if the line matches a skip pattern.
   */
  private static isSkipLine(line: string): boolean {
    return SKIP_LINE_PATTERNS.some(p => p.test(line));
  }

  /**
   * Builds a memo string from the first few lines of the receipt.
   * @param lines - Array of non-empty text lines from the receipt.
   * @returns Truncated memo string.
   */
  private static buildMemo(lines: string[]): string {
    return lines.slice(0, 5).join(' | ').substring(0, 200);
  }

  /**
   * Preprocesses an image for better Hebrew OCR accuracy.
   * Upscales small images, converts to greyscale, and applies threshold.
   * @param imageBuffer - Raw image bytes.
   * @returns Preprocessed image buffer (PNG).
   */
  private static async preprocess(imageBuffer: Buffer): Promise<Buffer> {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 0;
    let pipeline = sharp(imageBuffer);
    if (width < MIN_WIDTH_PX) {
      pipeline = pipeline.resize(MIN_WIDTH_PX);
    }
    return pipeline.greyscale().threshold(140).png().toBuffer();
  }
}
