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
 *
 * NOTE on duplicate charges: a content hash alone cannot tell two identical
 * charges apart, so the second copy was silently dropped as a duplicate.
 * `buildImportedIdAt` adds a per-batch occurrence index to separate them,
 * with occurrence 0 hashing the bare content key so previously-written ids
 * keep matching.
 */

import { createHash } from 'node:crypto';

import type { IBankTransaction, ITransactionRecord } from '../../Types/Index.js';
import { formatDate, toCents } from '../../Utils/Index.js';

/**
 * Builds the content key identifying a charge by its visible fields.
 *
 * Shared by {@link buildImportedIdAt}'s callers and the batch importer's
 * duplicate counter so the two can never drift: the key that decides "is
 * this the same charge again?" is byte-identical to the seed that is hashed.
 * @param accountKey - Combined bank-account string used as a namespace.
 * @param txn - The raw IBankTransaction from the scraper.
 * @param parsed - The parsed ITransactionRecord with formatted date.
 * @returns Pipe-delimited key over (accountKey, date, amount, description).
 */
export function buildContentKey(
  accountKey: string, txn: IBankTransaction, parsed: ITransactionRecord
): string {
  const description = txn.description ?? '';
  return `${accountKey}|${parsed.date}|${String(parsed.amount)}|${description}`;
}

/**
 * Hashes a fully-composed seed into the id Actual Budget stores.
 * @param seed - Fully-composed seed string.
 * @returns A 16-char lowercase hex string.
 */
function hashSeed(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

/**
 * Builds the `imported_id` for the Nth identical charge within one batch.
 *
 * Two genuinely distinct transactions can share date, amount and description
 * — an ordinary double charge at the same merchant. Hashing content alone
 * gave both the same id, so Actual Budget rejected the second as a duplicate
 * and the user silently lost a real transaction.
 *
 * Occurrence 0 deliberately hashes the bare content key, so every id ever
 * written stays valid: rows already in a ledger keep matching and no history
 * is re-imported.
 *
 * Later copies hash `${hash(contentKey)}|#N` rather than `${contentKey}|#N`.
 * Suffixing the raw key would be ambiguous: a charge whose description ends
 * in `|#1` would, at occurrence 0, produce the same seed as its neighbour at
 * occurrence 1. Hashing first removes that overlap by construction — a
 * content key always carries the three pipes of its four fields, while the
 * derived seed carries exactly one.
 * @param contentKey - Key from {@link buildContentKey}.
 * @param occurrence - Zero-based index among identical charges in the batch.
 * @returns A 16-char lowercase hex string for Actual's importTransactions API.
 */
export function buildImportedIdAt(contentKey: string, occurrence: number): string {
  const base = hashSeed(contentKey);
  if (occurrence <= 0) return base;
  return hashSeed(`${base}|#${String(occurrence)}`);
}

/**
 * Builds a content-hash `imported_id` stable across runs.
 * Independent of `txn.identifier` which the upstream scraper does not
 * guarantee to be stable between scrapes — using a SHA-256 prefix over
 * `(accountKey, date, amount, description)` makes re-runs deterministic.
 *
 * Delegates to {@link buildImportedIdAt} at occurrence 0, which is what makes
 * the occurrence suffix backward compatible by construction rather than by
 * coincidence.
 * @param accountKey - Combined bank-account string used as a namespace.
 * @param txn - The raw IBankTransaction from the scraper.
 * @param parsed - The parsed ITransactionRecord with formatted date.
 * @returns A 16-char lowercase hex string for use with Actual's importTransactions API.
 */
export function buildImportedId(
  accountKey: string, txn: IBankTransaction, parsed: ITransactionRecord
): string {
  const contentKey = buildContentKey(accountKey, txn, parsed);
  return buildImportedIdAt(contentKey, 0);
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
