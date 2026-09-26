/**
 * AuditLogService - Persists import run history to a local JSON file
 * Enables debugging, trend analysis, and /status command history
 *
 * <p>The file sits on {@link SecureJsonStore}: it is owner-only, a write
 * replaces it whole, and a file holding anything the log would not write back
 * is moved aside on the next record instead of being overwritten. The runs
 * are stored as one `entries` record; a bare list an older release wrote is
 * read as that record and written back in the records form. A run the readers
 * skip is still written back, so it never makes the file look damaged.
 */

import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { RUN_BANK, RUN_ENTRY } from '../Contract/Status.js';
import StorageError from '../Errors/StorageError.js';
import redactSecrets from '../Logger/SecretRedaction.js';
import type { IFileSystem } from '../Storage/FileSystemPort.js';
import SecureJsonStore from '../Storage/SecureJsonStore.js';
import type { IStoreSnapshot } from '../Storage/StoreTypes.js';
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

type AuditBank = IAuditEntry['banks'][number];

const DEFAULT_MAX_ENTRIES = 90;

/** The record the runs are stored under. */
const ENTRIES_RECORD = 'entries';

/** The runs as read, and whether the file holds only what the log writes. */
interface ILoadedEntries {
  readonly entries: IAuditEntry[];
  readonly isIntact: boolean;
}

/**
 * Reports whether a snapshot holds exactly what the log writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * record does not look for something to move aside. The runs are not checked
 * one by one; every stored run is written back, readable or not.
 * @param snapshot - The store's snapshot.
 * @returns True when the file is absent, or holds only a list of runs.
 */
function isIntactSnapshot(snapshot: IStoreSnapshot): boolean {
  if (snapshot.state !== 'healthy') return snapshot.state === 'absent';
  const isOnlyRecord = Object.keys(snapshot.records).length === 1;
  return isOnlyRecord && Array.isArray(snapshot.records[ENTRIES_RECORD]);
}

// What /api/status promises for a run, less its bank rows, which are checked one by one.
const ENTRY_FIELDS = Type.Omit(RUN_ENTRY, ['banks']);

/** Persists import run history to a local JSON file for debugging and /status history. */
export class AuditLogService implements IAuditLog {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the log to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path to the JSON audit log file.
   * @param maxEntries - Maximum number of entries to retain in the log.
   */
  constructor(
    fileSystem: IFileSystem,
    filePath: string,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {
    this._store = new SecureJsonStore(fileSystem, filePath, { legacyList: ENTRIES_RECORD });
  }

  /**
   * Appends a new audit entry built from the given import summary.
   * @param summary - The IImportSummary from the completed import run.
   * @returns Procedure indicating the entry was recorded or describing the write failure.
   */
  public record(summary: IImportSummary): Procedure<{ status: 'recorded' }> {
    try {
      const built = AuditLogService.buildEntry(summary);
      const entry = AuditLogService.maskEntry(built);
      const loaded = this.loadForWrite();
      const trimmed = [...loaded.entries, entry].slice(-this.maxEntries);
      this.save(trimmed, loaded.isIntact);
      return succeed({ status: 'recorded' as const });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return fail('audit write failed', { error: error instanceof Error ? error : new Error(msg) });
    }
  }

  /**
   * Returns the readable entries among the most recent ones stored, up to the
   * requested count. An unreadable entry still takes its place in the count.
   * A file that cannot be read yields no entries.
   * @param count - Maximum number of stored entries to read.
   * @returns Procedure containing an array of IAuditEntry objects, most recent last.
   */
  public getRecent(count: number): Procedure<IAuditEntry[]> {
    const loaded = this.load();
    const stored = loaded.success ? loaded.data.entries : [];
    const sliced = stored.slice(-count);
    const readable = AuditLogService.readableEntries(sliced);
    return succeed(readable);
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
   * Reads the file once: the runs, masked, and whether it holds only what the
   * log writes. A file without a list of runs yields none.
   * @returns The loaded runs, or why the file could not be assessed.
   */
  private load(): Procedure<ILoadedEntries> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const stored: unknown = snapshot.data.records[ENTRIES_RECORD];
    const list = Array.isArray(stored) ? (stored as IAuditEntry[]) : [];
    const entries = list.map(entry => AuditLogService.maskEntry(entry));
    return succeed({ entries, isIntact: isIntactSnapshot(snapshot.data) });
  }

  /**
   * Reads the file before a record, refusing to write over one it cannot read.
   * @returns The loaded runs.
   * @throws StorageError when the file cannot be assessed.
   */
  private loadForWrite(): ILoadedEntries {
    const loaded = this.load();
    if (!loaded.success) {
      throw new StorageError(`Could not read the audit log before saving: ${loaded.message}`);
    }
    return loaded.data;
  }

  /**
   * Keeps the entries every reader can use: those whose fields match what
   * /api/status promises for a run, with a list of banks. Rows that do not
   * match its bank row are left out. A hand edit or an older release can leave
   * anything in the file, and one such entry or row used to break /status,
   * /retry, the failure reply and the portal. The file itself is not changed.
   * @param entries - Entries as parsed from the file, which may be malformed.
   * @returns The readable entries in stored order.
   */
  private static readableEntries(entries: readonly IAuditEntry[]): IAuditEntry[] {
    const readable = entries.filter(entry => AuditLogService.isReadableEntry(entry));
    return readable.map(entry => {
      const banks = entry.banks.filter(bank => Value.Check(RUN_BANK, bank));
      return { ...entry, banks };
    });
  }

  /**
   * Tells whether a parsed entry has the fields every reader relies on.
   * @param entry - An entry as parsed from the file, which may be malformed.
   * @returns True when the run's fields match the contract and it has a list of banks.
   */
  private static isReadableEntry(entry: IAuditEntry): boolean {
    return Value.Check(ENTRY_FIELDS, entry) && Array.isArray(entry.banks);
  }

  /**
   * Masks secrets in an entry's stored failure reasons. Older releases masked
   * them less thoroughly, and every reader (the portal, the app, Telegram)
   * sends them on, so each read masks them again and the next record saves
   * them masked. A new entry is masked before it is saved too, whoever built
   * the summary it came from.
   * @param entry - An entry as parsed from the file, which may be malformed.
   * @returns The entry with each bank's error masked, or as stored without banks.
   */
  private static maskEntry(entry: IAuditEntry): IAuditEntry {
    const banks: unknown = (entry as Partial<IAuditEntry> | null)?.banks;
    if (!Array.isArray(banks)) return entry;
    return { ...entry, banks: entry.banks.map(bank => AuditLogService.maskBank(bank)) };
  }

  /**
   * Masks secrets in one bank row's stored failure reason.
   * @param bank - A bank row as parsed from the file, which may be malformed.
   * @returns The row with its error masked, or as stored when it has no error text.
   */
  private static maskBank(bank: AuditBank): AuditBank {
    const error: unknown = (bank as Partial<AuditBank> | null)?.error;
    if (typeof error !== 'string') return bank;
    return { ...bank, error: redactSecrets(error) };
  }

  /**
   * Replaces the file with the given runs.
   * Throws on failure so the caller's try/catch can produce a fail() result.
   * @param entries - The full list of IAuditEntry objects to persist.
   * @param isIntact - Whether the file being replaced held only what the log writes.
   * @throws StorageError when the new file cannot be saved.
   */
  private save(entries: IAuditEntry[], isIntact: boolean): void {
    const request = { records: { [ENTRIES_RECORD]: entries }, shouldQuarantine: !isIntact };
    const committed = this._store.commit(request);
    if (!committed.success) {
      throw new StorageError(`Could not save the audit log: ${committed.message}`);
    }
  }
}
