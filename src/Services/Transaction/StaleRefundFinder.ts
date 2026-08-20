/**
 * StaleRefundFinder — locates credit-card refund rows this importer wrote
 * with an inverted sign before the israeli-bank-scrapers 8.6.7 upgrade.
 *
 * WHY THIS EXISTS
 * Up to and including scraper 8.6.6 the card banks used
 * `signPolicy: 'flip-credit'` because the scraper emitted unsigned
 * magnitudes. VisaCal is the one issuer that already signed refunds
 * negative at source, so the flip turned a +50 credit into -50 — booking
 * a refund as a spend. Scraper 8.6.7 signs at source and the importer now
 * uses 'preserve', so a re-scrape writes that refund again with the
 * correct +50. Because dedup is hash-based over the signed amount, the
 * wrong -50 row is never matched and stays behind forever.
 *
 * This module is pure — it takes rows already read from Actual Budget and
 * returns suspected stale rows. All I/O lives in CardRefundCleanup.ts.
 *
 * KNOWN AMBIGUITY (not solvable from stored data): a genuine same-day,
 * same-merchant purchase and refund of an identical amount produces the
 * exact same two-row shape as a stale pair. Callers MUST show candidates
 * to a human before deleting. Groups holding anything other than one
 * negative + one positive row are rejected as too ambiguous to judge.
 */

import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';

/** Subset of an Actual Budget transaction row this matcher reads. */
export interface IStaleRefundRow {
  /** Actual Budget row UUID. */
  readonly id: string;
  /** Transaction date in YYYY-MM-DD form. */
  readonly date: string;
  /** Signed amount in minor units (agorot). */
  readonly amount: number;
  /** Dedup hash written by this importer; null for hand-entered rows. */
  readonly imported_id: string | null;
  /** Original payee string as imported; used as the merchant key. */
  readonly imported_payee: string | null;
}

/** A suspected stale row paired with the correctly-signed row that replaced it. */
export interface IStaleRefundCandidate {
  /** Row UUID of the wrongly-signed row that should be removed. */
  readonly staleRowId: string;
  /** Row UUID of the correctly-signed row written after the upgrade. */
  readonly correctedRowId: string;
  /** Shared transaction date. */
  readonly date: string;
  /** Shared merchant description. */
  readonly description: string;
  /** Signed amount of the stale row, in minor units. */
  readonly staleAmount: number;
  /** Signed amount of the corrected row, in minor units. */
  readonly correctedAmount: number;
}

/**
 * Reports whether a row was written by this importer rather than by hand.
 *
 * @param row - The Actual Budget row to inspect.
 * @returns True when the row carries a non-empty dedup hash.
 */
function isImporterWritten(row: IStaleRefundRow): boolean {
  return typeof row.imported_id === 'string' && row.imported_id.length > 0;
}

/**
 * Builds the bucket key that pairs a stale row with its corrected twin.
 *
 * Uses absolute amount so the two opposite-signed rows collide, and
 * includes date + merchant so unrelated transactions never share a bucket.
 *
 * @param row - The Actual Budget row to key.
 * @returns A stable grouping key.
 */
function groupKey(row: IStaleRefundRow): string {
  const magnitude = Math.abs(row.amount);
  const merchant = row.imported_payee ?? '';
  return `${row.date}|${merchant}|${String(magnitude)}`;
}

/**
 * Appends a row to its bucket, creating the bucket on first sight.
 *
 * @param groups - The bucket map being built.
 * @param row - The row to file.
 * @returns The bucket's size after the append.
 */
function addToBucket(groups: Map<string, IStaleRefundRow[]>, row: IStaleRefundRow): number {
  const key = groupKey(row);
  const bucket = groups.get(key) ?? [];
  bucket.push(row);
  groups.set(key, bucket);
  return bucket.length;
}

/**
 * Buckets importer-written rows by date, merchant and absolute amount.
 *
 * @param rows - All rows read from a single Actual Budget account.
 * @returns Map of grouping key to the rows that share it.
 */
function groupRows(rows: readonly IStaleRefundRow[]): Map<string, IStaleRefundRow[]> {
  const groups = new Map<string, IStaleRefundRow[]>();
  const written = rows.filter(isImporterWritten);
  for (const row of written) {
    addToBucket(groups, row);
  }
  return groups;
}

/**
 * Assembles the candidate record for a confirmed stale/corrected pair.
 *
 * @param stale - The negative row believed to be the pre-upgrade artefact.
 * @param corrected - The positive row written after the upgrade.
 * @returns The populated candidate.
 */
function buildCandidate(
  stale: IStaleRefundRow, corrected: IStaleRefundRow,
): IStaleRefundCandidate {
  return {
    staleRowId: stale.id, correctedRowId: corrected.id, date: stale.date,
    description: stale.imported_payee ?? '', staleAmount: stale.amount,
    correctedAmount: corrected.amount,
  };
}

/**
 * Converts one bucket into a candidate, or rejects it as ambiguous.
 *
 * Requires exactly two rows that sum to zero — one negative, one
 * positive. Any other shape (a lone row, a same-signed pair, three rows
 * where a genuine purchase also exists) is deliberately rejected.
 *
 * @param bucket - Rows sharing a date, merchant and absolute amount.
 * @returns Procedure carrying the candidate, or a failure explaining the skip.
 */
function toCandidate(bucket: readonly IStaleRefundRow[]): Procedure<IStaleRefundCandidate> {
  if (bucket.length !== 2) return fail('Bucket is not a clean two-row pair');
  const stale = bucket.find((row) => row.amount < 0);
  const corrected = bucket.find((row) => row.amount > 0);
  if (!stale || !corrected) return fail('Bucket lacks one row of each sign');
  const net = stale.amount + corrected.amount;
  if (net !== 0) return fail('Bucket amounts do not cancel out');
  const candidate = buildCandidate(stale, corrected);
  return succeed(candidate);
}

/**
 * Orders candidates by date then merchant so reports are stable.
 *
 * @param left - First candidate to compare.
 * @param right - Second candidate to compare.
 * @returns Negative, zero or positive per the Array.prototype.sort contract.
 */
function compareCandidates(
  left: IStaleRefundCandidate, right: IStaleRefundCandidate,
): number {
  const byDate = left.date.localeCompare(right.date);
  return byDate === 0 ? left.description.localeCompare(right.description) : byDate;
}

/**
 * Reduces every bucket to the candidates it yields, skipping ambiguous ones.
 *
 * @param buckets - The grouped rows produced by {@link groupRows}.
 * @returns Candidates in bucket-iteration order.
 */
function collectFromBuckets(
  buckets: Iterable<IStaleRefundRow[]>,
): IStaleRefundCandidate[] {
  const candidates: IStaleRefundCandidate[] = [];
  for (const bucket of buckets) {
    const result = toCandidate(bucket);
    if (result.success) candidates.push(result.data);
  }
  return candidates;
}

/**
 * Finds refund rows left behind with an inverted sign by scraper 8.6.6.
 *
 * @param rows - All rows read from a single Actual Budget account.
 * @returns Suspected stale rows, each paired with its corrected twin.
 */
export default function findStaleRefundCandidates(
  rows: readonly IStaleRefundRow[],
): IStaleRefundCandidate[] {
  const buckets = groupRows(rows).values();
  const candidates = collectFromBuckets(buckets);
  return candidates.sort(compareCandidates);
}
