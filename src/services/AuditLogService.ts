/**
 * AuditLogService - Persists import run history to a local JSON file
 * Enables debugging, trend analysis, and /status command history
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ImportSummary, BankMetrics } from './MetricsService.js';
import { getLogger } from '../logger/index.js';

export interface AuditEntry {
  timestamp: string;
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  successRate: number;
  banks: Array<{ name: string; status: string; duration?: number; txns: number; error?: string }>;
}

export interface IAuditLog {
  record(summary: ImportSummary): void;
  getRecent(count: number): AuditEntry[];
}

const DEFAULT_MAX_ENTRIES = 90;

export class AuditLogService implements IAuditLog {
  constructor(
    private readonly filePath: string = '/app/data/audit-log.json',
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  record(summary: ImportSummary): void {
    const entry = this.buildEntry(summary);
    const entries = this.loadEntries();
    entries.push(entry);
    this.saveEntries(entries.slice(-this.maxEntries));
  }

  getRecent(count: number): AuditEntry[] {
    return this.loadEntries().slice(-count);
  }

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

  private mapBank(b: BankMetrics): AuditEntry['banks'][number] {
    return {
      name: b.bankName, status: b.status,
      duration: b.duration, txns: b.transactionsImported,
      ...(b.error ? { error: b.error } : {}),
    };
  }

  private loadEntries(): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    try { return JSON.parse(readFileSync(this.filePath, 'utf8')); }
    catch { return []; }
  }

  private saveEntries(entries: AuditEntry[]): void {
    try { writeFileSync(this.filePath, JSON.stringify(entries, null, 2)); }
    catch (error: unknown) { getLogger().error(`Failed to write audit log: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
