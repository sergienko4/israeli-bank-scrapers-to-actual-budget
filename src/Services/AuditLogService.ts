/**
 * AuditLogService - Persists import run history to a local JSON file
 * Enables debugging, trend analysis, and /status command history
 */

import { existsSync,readFileSync, writeFileSync } from 'node:fs';

import type { Procedure } from '../Types/Index.js';
import { fail,succeed } from '../Types/Index.js';
import type { IBankMetrics,IImportSummary } from './MetricsService.js';

export interface IAuditEntry {
  timestamp: string;
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  successRate: number;
  banks: {
    name: string; status: string; duration?: number; txns: number;
    error?: string; reconciliationStatus?: string; reconciliationAmount?: number
  }[];
}

export interface IAuditLog {
  record(summary: IImportSummary): Procedure<{ status: 'recorded' }>;
  getRecent(count: number): Procedure<IAuditEntry[]>;
  getLastFailedBanks(): Procedure<string[]>;
  getConsecutiveFailures(bankName: string): Procedure<number>;
}

const DEFAULT_MAX_ENTRIES = 90;

/** Persists import run history to a local JSON file for debugging and /status history. */
export class AuditLogService implements IAuditLog {
  /**
   * Creates an AuditLogService writing to the given file path.
   * @param filePath - Absolute path to the JSON audit log file.
   * @param maxEntries - Maximum number of entries to retain in the log.
   */
  constructor(
    private readonly filePath = '/app/data/audit-log.json',
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  /**
   * Appends a new audit entry built from the given import summary.
   * @param summary - The IImportSummary from the completed import run.
   * @returns Procedure indicating the entry was recorded or describing the write failure.
   */
  public record(summary: IImportSummary): Procedure<{ status: 'recorded' }> {
    try {
      const entry = AuditLogService.buildEntry(summary);
      const entries = this.loadEntries();
      entries.push(entry);
      const trimmed = entries.slice(-this.maxEntries);
      this.saveEntries(trimmed);
      return succeed({ status: 'recorded' as const });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return fail('audit write failed', { error: error instanceof Error ? error : new Error(msg) });
    }
  }

  /**
   * Returns the most recent audit entries up to the requested count.
   * @param count - Maximum number of entries to return.
   * @returns Procedure containing an array of IAuditEntry objects, most recent last.
   */
  public getRecent(count: number): Procedure<IAuditEntry[]> {
    const entries = this.loadEntries();
    const sliced = entries.slice(-count);
    return succeed(sliced);
  }

  /**
   * Returns the names of banks that failed in the most recent audit entry.
   * @returns Procedure containing an array of failed bank names, or empty if last run was successful.
   */
  public getLastFailedBanks(): Procedure<string[]> {
    const recentResult = this.getRecent(1);
    if (!recentResult.success) return succeed([]);
    const recent = recentResult.data;
    if (!recent.length) return succeed([]);
    const failedBanks = recent[0].banks
      .filter(b => b.status === 'failure')
      .map(b => b.name);
    return succeed(failedBanks);
  }

  /**
   * Counts how many consecutive recent entries have a failure for the given bank.
   * @param bankName - The bank name to check for consecutive failures.
   * @returns Procedure containing the number of consecutive failures from the most recent entry.
   */
  public getConsecutiveFailures(bankName: string): Procedure<number> {
    const recentResult = this.getRecent(10);
    if (!recentResult.success) return succeed(0);
    const entries = [...recentResult.data].reverse();
    let count = 0;
    for (const entry of entries) {
      const bank = entry.banks.find(b => b.name === bankName);
      if (bank?.status === 'failure') count++;
      else break;
    }
    return succeed(count);
  }

  /**
   * Constructs an IAuditEntry from an IImportSummary.
   * @param summary - The import summary to convert.
   * @returns A new IAuditEntry with a timestamp and per-bank details.
   */
  private static buildEntry(summary: IImportSummary): IAuditEntry {
    return {
      timestamp: new Date().toISOString(),
      totalBanks: summary.totalBanks,
      successfulBanks: summary.successfulBanks,
      failedBanks: summary.failedBanks,
      totalTransactions: summary.totalTransactions,
      totalDuplicates: summary.totalDuplicates,
      totalDuration: summary.totalDuration,
      successRate: summary.successRate,
      banks: summary.banks.map(b => AuditLogService.mapBank(b)),
    };
  }

  /**
   * Maps a BankMetrics object to the compact shape stored in the audit log.
   * @param b - The BankMetrics to map.
   * @returns A flat object with name, status, duration, txns, and optional fields.
   */
  private static mapBank(b: IBankMetrics): IAuditEntry['banks'][number] {
    return {
      name: b.bankName, status: b.status,
      duration: b.duration, txns: b.transactionsImported,
      ...(b.error ? { error: b.error } : {}),
      ...(b.reconciliationStatus ? { reconciliationStatus: b.reconciliationStatus } : {}),
      ...(b.reconciliationAmount === undefined
        ? {} : { reconciliationAmount: b.reconciliationAmount }),
    };
  }

  /**
   * Reads and parses the audit log file, returning an empty array if absent or corrupt.
   * @returns Array of IAuditEntry objects from the log file.
   */
  private loadEntries(): IAuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const fileContent = readFileSync(this.filePath, 'utf8');
      return JSON.parse(fileContent) as IAuditEntry[];
    }
    catch { return []; }
  }

  /**
   * Serialises the audit entry array and writes it to the log file.
   * Throws on write failure so the caller's try/catch can produce a fail() result.
   * @param entries - The full list of IAuditEntry objects to persist.
   */
  private saveEntries(entries: IAuditEntry[]): void {
    const serialized = JSON.stringify(entries, null, 2);
    writeFileSync(this.filePath, serialized);
  }
}
