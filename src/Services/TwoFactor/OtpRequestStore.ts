/**
 * File-backed registry of pending app-OTP requests, shared across the process
 * boundary between the import child (which needs an OTP during a 2FA bank login)
 * and the portal (which receives the code the user enters in the mobile app).
 *
 * The import child {@link create}s a request and polls {@link get} until the
 * portal {@link submit}s a code; it then {@link remove}s the entry. Codes live
 * in the file only briefly, between submit and consumption, and are never logged
 * by this module. A missing or unreadable file reads as no requests.
 *
 * <p>The file sits on {@link SecureJsonStore}: it is owner-only, a write
 * replaces it whole so a concurrent reader never observes a partial file, and
 * a file holding anything this store would not write back (including a
 * malformed request it skips) is moved aside on the next write instead of
 * being overwritten. The requests are stored as one `requests` record; a bare
 * list an older release wrote is read as that record and written back in the
 * records form. A write that cannot read the current file, or cannot save the
 * new one, throws.
 *
 * The importer scrapes banks sequentially, so at most one OTP request is active
 * per importer at a time, and the portal attaches a code only once per request;
 * concurrent read-modify-write conflicts on the shared file therefore do not
 * arise in normal single-importer operation.
 */
import { randomUUID } from 'node:crypto';

import StorageError from '../../Errors/StorageError.js';
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { IStoreSnapshot,ISweepReport } from '../../Storage/StoreTypes.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/ProcedureHelpers.js';

/** A single pending (or code-carrying) OTP request. */
export interface IOtpRequest {
  /** Opaque request id the app submits its code against. */
  id: string;
  /** Bank id the OTP is for (shown to the user). */
  bankId: string;
  /** Creation time, epoch ms. */
  createdAt: number;
  /** Expiry time, epoch ms; the request is dead once now exceeds it. */
  deadline: number;
  /** The submitted OTP code, present only after the app submits it. */
  code?: string;
}

/** The record the requests are stored under. */
const REQUESTS_RECORD = 'requests';

/** The requests as read, and whether the file holds only what this store writes. */
interface ILoadedRequests {
  readonly requests: IOtpRequest[];
  readonly isIntact: boolean;
}

/**
 * Reports whether a snapshot holds exactly what this store writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * write does not look for something to move aside.
 * @param snapshot - The store's snapshot.
 * @param requests - The well-formed requests read from it.
 * @returns True when the file is absent, or holds only well-formed requests.
 */
function isIntactSnapshot(snapshot: IStoreSnapshot, requests: readonly IOtpRequest[]): boolean {
  if (snapshot.state !== 'healthy') return snapshot.state === 'absent';
  const stored = snapshot.records[REQUESTS_RECORD];
  const isOnlyRecord = Object.keys(snapshot.records).length === 1;
  return isOnlyRecord && Array.isArray(stored) && stored.length === requests.length;
}

/** Persists pending OTP requests to a JSON file on a shared volume. */
export default class OtpRequestStore {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the store to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path of the OTP-requests JSON file.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._store = new SecureJsonStore(fileSystem, filePath, { legacyList: REQUESTS_RECORD });
  }

  /**
   * Creates a new pending OTP request and persists it.
   * @param bankId - The bank the OTP is for.
   * @param ttlMs - Time-to-live in milliseconds before the request expires.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The created request (without a code).
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public create(bankId: string, ttlMs: number, now: number = Date.now()): IOtpRequest {
    const request: IOtpRequest = {
      id: randomUUID(), bankId, createdAt: now, deadline: now + ttlMs,
    };
    const loaded = this.loadForWrite();
    const kept = loaded.requests.filter((entry) => entry.deadline > now);
    this.save([...kept, request], loaded.isIntact);
    return request;
  }

  /**
   * Lists the pending requests that have not expired and have no code yet.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The live pending requests (codes are never populated here).
   */
  public pending(now: number = Date.now()): IOtpRequest[] {
    return this.readAll().filter((entry) => entry.code === undefined && entry.deadline > now);
  }

  /**
   * Reads a single request by id.
   * @param id - The request id.
   * @returns The request, or null when it is absent.
   */
  public get(id: string): IOtpRequest | null {
    return this.readAll().find((entry) => entry.id === id) ?? null;
  }

  /**
   * Attaches a submitted code to a live pending request.
   * @param id - The request id to submit against.
   * @param code - The OTP code entered by the user.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns True when a live pending request was updated, else false.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public submit(id: string, code: string, now: number = Date.now()): boolean {
    const loaded = this.loadForWrite();
    const target = loaded.requests.find((entry) => entry.id === id);
    if (!target || target.code !== undefined || target.deadline <= now) {
      return false;
    }
    const next = loaded.requests.map((entry) => (entry.id === id ? { ...entry, code } : entry));
    this.save(next, loaded.isIntact);
    return true;
  }

  /**
   * Removes a request (used after a code is consumed or the request expires).
   * @param id - The request id to remove.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public remove(id: string): void {
    const loaded = this.loadForWrite();
    const remaining = loaded.requests.filter((entry) => entry.id !== id);
    this.save(remaining, loaded.isIntact);
  }

  /**
   * Deletes staged files a killed write left beside the file.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return this._store.sweepStagedLeftovers();
  }

  /**
   * Reads the stored requests for a reader.
   * @returns The well-formed requests, or none when the file cannot be read.
   */
  private readAll(): IOtpRequest[] {
    const loaded = this.load();
    return loaded.success ? loaded.data.requests : [];
  }

  /**
   * Reads the file once: the well-formed requests, and whether it holds only
   * what this store writes.
   * @returns The loaded requests, or why the file could not be assessed.
   */
  private load(): Procedure<ILoadedRequests> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const stored: unknown = snapshot.data.records[REQUESTS_RECORD];
    const list: unknown[] = Array.isArray(stored) ? stored : [];
    const requests = list.filter((entry) => OtpRequestStore.isRequest(entry));
    return succeed({ requests, isIntact: isIntactSnapshot(snapshot.data, requests) });
  }

  /**
   * Reads the file before a write, refusing to write over one it cannot read.
   * @returns The loaded requests.
   * @throws StorageError when the file cannot be assessed.
   */
  private loadForWrite(): ILoadedRequests {
    const loaded = this.load();
    if (!loaded.success) {
      throw new StorageError(`Could not read the OTP requests before saving: ${loaded.message}`);
    }
    return loaded.data;
  }

  /**
   * Replaces the file with the given requests.
   * @param requests - The full request list to persist.
   * @param isIntact - Whether the file being replaced held only what this store writes.
   * @throws StorageError when the new file cannot be saved.
   */
  private save(requests: IOtpRequest[], isIntact: boolean): void {
    const request = { records: { [REQUESTS_RECORD]: requests }, shouldQuarantine: !isIntact };
    const committed = this._store.commit(request);
    if (!committed.success) {
      throw new StorageError(`Could not save the OTP requests: ${committed.message}`);
    }
  }

  /**
   * Type guard for a well-formed persisted request.
   * @param value - A parsed array entry.
   * @returns True when the entry has the required request shape.
   */
  private static isRequest(value: unknown): value is IOtpRequest {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.id === 'string'
      && typeof entry.bankId === 'string'
      && typeof entry.createdAt === 'number'
      && typeof entry.deadline === 'number'
      && (entry.code === undefined || typeof entry.code === 'string');
  }
}
