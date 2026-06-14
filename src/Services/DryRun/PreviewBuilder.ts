import type { IBankTransaction } from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import type { IAccountPreview, IPreviewInput } from './Types.js';

type DateRange = IAccountPreview['dateRange'];
interface ITimestampRange { min: number; max: number }
/** Builds an account preview.
 * @param input scraped account payload.
 * @returns normalized preview. */
export function buildPreview(input: IPreviewInput): IAccountPreview {
  const { bankName, accountNumber, balance, currency, txns } = input;
  return {
    bankName, accountNumber, balance, currency,
    transactionCount: txns.length,
    dateRange: computeDateRange(txns),
    samples: txns.slice(0, 3).map(tx => parseSample(tx)),
  };
}
/** Computes a valid transaction date range.
 * @param txns transactions.
 * @returns preview date range. */
export function computeDateRange(txns: IBankTransaction[]): DateRange {
  const dates = txns.map(transactionTimestamp).filter(isValidTimestamp);
  if (dates.length === 0) return { from: 'N/A', to: 'N/A' };
  const initial = initialRange(dates[0]);
  const range = dates.reduce(mergeTimestampRange, initial);
  return { from: formatTimestamp(range.min), to: formatTimestamp(range.max) };
}
/** Extracts a compact transaction sample.
 * @param tx source transaction.
 * @returns preview sample. */
export function parseSample(tx: IBankTransaction): IAccountPreview['samples'][number] {
  const date = formatDate(tx.date);
  const description = tx.description ?? tx.memo ?? '';
  return { date, description, amount: tx.chargedAmount ?? 0 };
}
/** Gets comparable time.
 * @param tx source transaction.
 * @returns epoch milliseconds. */
function transactionTimestamp(tx: IBankTransaction): number { return new Date(tx.date).getTime(); }
/** Accepts valid times.
 * @param value timestamp candidate.
 * @returns validation result. */
function isValidTimestamp(value: number): boolean { return !Number.isNaN(value); }
/** Creates a range.
 * @param value timestamp value.
 * @returns initialized range. */
function initialRange(value: number): ITimestampRange { return { min: value, max: value }; }
/** Formats a timestamp.
 * @param value timestamp value.
 * @returns formatted date. */
function formatTimestamp(value: number): string { return formatDate(new Date(value)); }
/** Merges one timestamp.
 * @param range existing range.
 * @param value next timestamp.
 * @returns range. */
function mergeTimestampRange(range: ITimestampRange, value: number): ITimestampRange {
  return { min: Math.min(range.min, value), max: Math.max(range.max, value) };
}