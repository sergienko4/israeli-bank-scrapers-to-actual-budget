/**
 * Index — public entry point for the Ocr/ receipt-parsing sub-cluster.
 * Orchestrates DateExtractor, AmountExtractor, MerchantExtractor, and MemoExtractor
 * to produce an `IReceiptData` from raw OCR text.
 *
 * PII note: only structured fields (date, amount, merchant) are logged — never
 * the raw OCR text — so no receipt content leaks into debug logs.
 */

import { getLogger } from '../../../Logger/Index.js';
import type { IReceiptData, Procedure } from '../../../Types/Index.js';
import { fail, succeed } from '../../../Types/Index.js';
import extractAmount from './AmountExtractor.js';
import extractDate from './DateExtractor.js';
import buildMemo from './MemoExtractor.js';
import extractMerchant from './MerchantExtractor.js';
import { ALL_INVISIBLE_CHARS } from './Patterns.js';

/**
 * Parses raw OCR text to extract receipt transaction fields.
 * Strips bidirectional control characters, splits into lines, then runs
 * each field extractor. Returns `fail` when no text lines are present.
 * @param text - Raw OCR text from a receipt image.
 * @returns `Procedure` resolved with extracted `IReceiptData` fields, or failed when empty.
 */
export default function parseReceipt(text: string): Procedure<IReceiptData> {
  const cleaned = text.replaceAll(ALL_INVISIBLE_CHARS, '');
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return fail('No text lines to parse');
  const fields = extractAllFields(cleaned, lines);
  logParsed(fields);
  return succeed(fields);
}

/**
 * Builds an `IReceiptData` by running every extractor against the input.
 * Fields that return `false` are omitted, preserving the optional-field contract.
 * @param cleaned - Whole-text OCR output with invisible chars stripped.
 * @param lines - Same text split into trimmed, non-empty lines.
 * @returns `IReceiptData` with `memo` always present; other fields optional.
 */
function extractAllFields(cleaned: string, lines: string[]): IReceiptData {
  const data: IReceiptData = { memo: buildMemo(lines) };
  const date = extractDate(cleaned);
  const amount = extractAmount(cleaned);
  const merchant = extractMerchant(lines);
  if (date !== false) data.date = date;
  if (amount !== false) data.amount = amount;
  if (merchant !== false) data.merchant = merchant;
  return data;
}

/**
 * Emits a debug log line summarising the structured fields parsed from a receipt.
 * Raw OCR text is never included to avoid PII leakage.
 * @param fields - The `IReceiptData` returned by `extractAllFields`.
 * @returns `true` always (non-void per project architecture rule).
 */
function logParsed(fields: IReceiptData): boolean {
  const dStr = fields.date ?? 'N/A';
  const aStr = String(fields.amount ?? 'N/A');
  const mStr = fields.merchant ?? 'N/A';
  getLogger().debug(`Receipt parsed: date=${dStr}, amount=${aStr}, merchant=${mStr}`);
  return true;
}
