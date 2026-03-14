/**
 * AuditLogService - Persists import run history to a local JSON file
 * Enables debugging, trend analysis, and /status command history
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { ImportSummary, BankMetrics } from './MetricsService.js';
import { getLogger } from '../Logger/Index.js';

export interface AuditEntry {
  timestamp: string;
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  successRate: number;
  banks: Array<{
    name: string; status: string; duration?: number; txns: number;
    error?: string; reconciliationStatus?: string; reconciliationAmount?: number
  }>;
}

export interface IAuditLog {
  record(summary: ImportSummary): void;
  getRecent(count: number): AuditEntry[];
  getLastFailedBanks(): string[];
  getConsecutiveFailures(bankName: string): number;
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
    private readonly filePath: string = '/app/data/audit-log.json',
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  /**
   * Appends a new audit entry built from the given import summary.
   * @param summary - The ImportSummary from the completed import run.
   */
  record(summary: ImportSummary): void {
    const entry = this.buildEntry(summary);
    const entries = this.loadEntries();
    entries.push(entry);
    this.saveEntries(entries.slice(-this.maxEntries));
  }

  /**
   * Returns the most recent audit entries up to the requested count.
   * @param count - Maximum number of entries to return.
   * @returns Array of AuditEntry objects, most recent last.
   */
  getRecent(count: number): AuditEntry[] {
    return this.loadEntries().slice(-count);
  }

  /**
   * Returns the names of banks that failed in the most recent audit entry.
   * @returns Array of failed bank names, or empty if last run was successful or no entries.
   */
  getLastFailedBanks(): string[] {
    const recent = this.getRecent(1);
    if (!recent.length) return [];
    return recent[0].banks.filter(b => b.status === 'failure').map(b => b.name);
  }

  /**
   * Counts how many consecutive recent entries have a failure for the given bank.
   * @param bankName - The bank name to check for consecutive failures.
   * @returns Number of consecutive failures from the most recent entry backwards.
   */
  getConsecutiveFailures(bankName: string): number {
    const entries = this.getRecent(10).reverse();
    let count = 0;
    for (const entry of entries) {
      const bank = entry.banks.find(b => b.name === bankName);
      if (bank?.status === 'failure') count++;
      else break;
    }
    return count;
  }

  /**
   * Constructs an AuditEntry from an ImportSummary.
   * @param summary - The import summary to convert.
   * @returns A new AuditEntry with a timestamp and per-bank details.
   */
  private buildEntry(summary: ImportSummary): AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      totalBanks: summary.totalBanks,
      successfulBanks: summary.successfulBanks,
      failedBanks: summary.failedBanks,
      totalTransactions: summary.totalTransactions,
      totalDuplicates: summary.totalDuplicates,
      totalDuration: summary.totalDuration,
      successRate: summary.successRate,
      banks: summary.banks.map(b => this.mapBank(b)),
    };
  }

  /**
   * Maps a BankMetrics object to the compact shape stored in the audit log.
   * @param b - The BankMetrics to map.
   * @returns A flat object with name, status, duration, txns, and optional fields.
   */
  private mapBank(b: BankMetrics): AuditEntry['banks'][number] {
    return {
      name: b.bankName, status: b.status,
      duration: b.duration, txns: b.transactionsImported,
      ...(b.error ? { error: b.error } : {}),
      ...(b.reconciliationStatus ? { reconciliationStatus: b.reconciliationStatus } : {}),
      ...(b.reconciliationAmount !== undefined
        ? { reconciliationAmount: b.reconciliationAmount } : {}),
    };
  }

  /**
   * Reads and parses the audit log file, returning an empty array if absent or corrupt.
   * @returns Array of AuditEntry objects from the log file.
   */
  private loadEntries(): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    try { return JSON.parse(readFileSync(this.filePath, 'utf8')) as AuditEntry[]; }
    catch { return []; }
  }

  /**
   * Serialises the audit entry array and writes it to the log file.
   * @param entries - The full list of AuditEntry objects to persist.
   */
  private saveEntries(entries: AuditEntry[]): void {
    try { writeFileSync(this.filePath, JSON.stringify(entries, null, 2)); }
    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      getLogger().error(`Failed to write audit log: ${msg}`);
    }
  }
}
