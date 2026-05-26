/**
 * AuditQuery — read-only accessor consolidating every audit-log access pattern
 * used by the Telegram command router. Unwraps Procedure<T> returns to plain
 * readonly arrays / strings / Procedure-of-entry so callers do not repeat
 * success-checking boilerplate.
 */

import type { IBatchResult, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import type { IAuditEntry, IAuditLog } from '../AuditLogService.js';
import { isFreshEntry } from '../TelegramCommandFormatters.js';

/** Read-only audit-log accessor consolidating every read pattern used by the router. */
export interface IAuditQuery {
  /**
   * Returns the n most-recent audit entries.
   * @param n - Number of most-recent entries to fetch.
   * @returns Up to n entries (newest first). Empty array on failure.
   */
  getRecent(n: number): readonly IAuditEntry[];
  /**
   * Returns the names of banks that failed in the most recent run.
   * @returns Failed bank names; empty array when none.
   */
  getLastFailedBanks(): readonly string[];
  /**
   * Returns the audit entry recorded during the batch window.
   * @param batch - Recently completed batch.
   * @returns Procedure carrying the fresh entry, or a `fail` when none.
   */
  getFreshEntryFor(batch: IBatchResult): Procedure<IAuditEntry>;
  /**
   * Returns the consecutive failure count for a bank.
   * @param bankName - Bank to check.
   * @returns Consecutive failure count for that bank (0 if none / on failure).
   */
  getConsecutiveFailures(bankName: string): number;
}

/**
 * Builds an IAuditQuery that delegates to the provided audit log.
 * When `auditLog` is omitted, every method returns an empty/zero value.
 * @param auditLog - Optional audit log to read from.
 * @returns An IAuditQuery wrapper.
 */
export function createAuditQuery(auditLog?: IAuditLog): IAuditQuery {
  return {
    /**
     * Reads the n most-recent entries from the audit log.
     * @param n - Number of entries to fetch.
     * @returns Up to n entries; empty array when no log or read fails.
     */
    getRecent(n: number): readonly IAuditEntry[] {
      return readRecent(n, auditLog);
    },
    /**
     * Reads the failed bank names from the most recent run.
     * @returns Failed bank names; empty array when unavailable.
     */
    getLastFailedBanks(): readonly string[] {
      return readLastFailed(auditLog);
    },
    /**
     * Picks the fresh audit entry recorded during this batch's window.
     * @param batch - Recently completed batch.
     * @returns Procedure carrying the entry, or a `fail` when none / stale.
     */
    getFreshEntryFor(batch: IBatchResult): Procedure<IAuditEntry> {
      return pickFreshEntry(batch, auditLog);
    },
    /**
     * Reads the consecutive failure count for a bank.
     * @param bankName - Bank to check.
     * @returns Consecutive failure count; 0 when unavailable.
     */
    getConsecutiveFailures(bankName: string): number {
      return readStreak(bankName, auditLog);
    },
  };
}

/**
 * Reads the n most-recent entries, normalising Procedure / absence to [].
 * @param n - Number of entries.
 * @param log - Optional audit log.
 * @returns Entries array (possibly empty).
 */
function readRecent(
  n: number, log?: IAuditLog,
): readonly IAuditEntry[] {
  if (!log) return [];
  const result = log.getRecent(n);
  return result.success ? result.data : [];
}

/**
 * Reads the failed bank names, normalising Procedure / absence to [].
 * @param log - Optional audit log.
 * @returns Failed bank names array (possibly empty).
 */
function readLastFailed(log?: IAuditLog): readonly string[] {
  if (!log) return [];
  const result = log.getLastFailedBanks();
  return result.success ? result.data : [];
}

/**
 * Reads the consecutive failure count, normalising to 0 when missing.
 * @param bankName - Bank to check.
 * @param log - Optional audit log.
 * @returns Consecutive failure count.
 */
function readStreak(
  bankName: string, log?: IAuditLog,
): number {
  if (!log) return 0;
  const result = log.getConsecutiveFailures(bankName);
  return result.success ? result.data : 0;
}

/**
 * Picks the freshest audit entry that falls within the supplied batch window.
 * @param batch - Recently completed batch.
 * @param log - Optional audit log.
 * @returns succeed(entry) when fresh, fail otherwise.
 */
function pickFreshEntry(
  batch: IBatchResult, log?: IAuditLog,
): Procedure<IAuditEntry> {
  const recent = readRecent(1, log);
  if (recent.length === 0) return fail('no-recent-entry');
  const [entry] = recent;
  if (!isFreshEntry(entry, batch)) return fail('stale-entry');
  return succeed(entry);
}
