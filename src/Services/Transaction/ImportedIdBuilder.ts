/**
 * ImportedIdBuilder — pure functions for building Actual Budget `imported_id` values.
 *
 * Pulled out of TransactionService so the SHA-256 content-hash logic + legacy
 * formula + IBankTransaction → ITransactionRecord parsing are testable in
 * isolation without instantiating the full transaction-import orchestrator.
 *
 * NOTE on dual-format dedup: new writes use the SHA-based `buildImportedId`,
 * but `buildImportedIdLegacy` reproduces the pre-2026-05 formula so existing
 * rows in Actual Budget (inserted before the hash migration) still match in
 * the dual-check dedup pass. Never used for new writes.
 */

import { createHash } from 'node:crypto';

import type { IBankTransaction, ITransactionRecord } from '../../Types/Index.js';
import { formatDate, toCents } from '../../Utils/Index.js';

/**
 * Builds a content-hash `imported_id` stable across runs.
 * Independent of `txn.identifier` which the upstream scraper does not
 * guarantee to be stable between scrapes — using a SHA-256 prefix over
 * `(accountKey, date, amount, description)` makes re-runs deterministic.
 * @param accountKey - Combined bank-account string used as a namespace.
 * @param txn - The raw IBankTransaction from the scraper.
 * @param parsed - The parsed ITransactionRecord with formatted date.
 * @returns A 16-char lowercase hex string for use with Actual's importTransactions API.
 */
export function buildImportedId(
  accountKey: string, txn: IBankTransaction, parsed: ITransactionRecord
): string {
  const description = txn.description ?? '';
  const seed = `${accountKey}|${parsed.date}|${String(parsed.amount)}|${description}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/**
 * Reproduces the pre-2026-05 `imported_id` formula so existing rows in
 * Actual Budget (inserted before the hash migration) can still be
 * recognised by the dual-check dedup. Never used for new writes.
 * @param accountKey - Combined bank-account string used as a namespace.
 * @param txn - The raw IBankTransaction from the scraper.
 * @param parsed - The parsed ITransactionRecord with formatted date.
 * @returns The legacy `${accountKey}-${identifier || fallback}` string.
 */
export function buildImportedIdLegacy(
  accountKey: string, txn: IBankTransaction, parsed: ITransactionRecord
): string {
  const fallback =
    `${parsed.date}-${String(txn.chargedAmount ?? txn.originalAmount)}`;
  return `${accountKey}-${String(txn.identifier || fallback)}`;
}

/**
 * Converts a raw IBankTransaction from the scraper into a normalised
 * ITransactionRecord with a formatted date and amount in cents.
 * @param txn - The raw IBankTransaction to convert.
 * @returns A ITransactionRecord with formatted date and amount in cents.
 */
export function parseTransaction(txn: IBankTransaction): ITransactionRecord {
  return {
    date: formatDate(txn.date),
    description: txn.description ?? 'Unknown',
    amount: toCents(txn.chargedAmount ?? txn.originalAmount ?? 0),
  };
}
