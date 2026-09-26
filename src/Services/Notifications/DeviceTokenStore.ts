/**
 * File-backed registry of Expo push tokens. The portal writes tokens as devices
 * register; the importer's Expo push notifier reads them to broadcast import
 * results. Tokens are deduplicated and stored as one `tokens` record.
 *
 * <p>The file sits on {@link SecureJsonStore}: it is owner-only, a write
 * replaces it whole, and a file holding anything this store would not write
 * back is moved aside on the next write instead of being overwritten. A bare
 * list an older release wrote is read as the `tokens` record and written back
 * in the records form.
 */
import StorageError from '../../Errors/StorageError.js';
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { IStoreSnapshot } from '../../Storage/StoreTypes.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/ProcedureHelpers.js';

/** The record the tokens are stored under. */
const TOKENS_RECORD = 'tokens';

/** The tokens as read, and whether the file holds only what this store writes. */
interface ILoadedTokens {
  readonly tokens: string[];
  readonly isIntact: boolean;
}

/**
 * Keeps the string tokens of a stored list.
 * @param value - The stored `tokens` record.
 * @returns The string tokens, or none when the record is not a list.
 */
function toTokens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Reports whether a snapshot holds exactly what this store writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * write does not look for something to move aside.
 * @param snapshot - The store's snapshot.
 * @param tokens - The string tokens read from it.
 * @returns True when the file is absent, or holds only a list of strings.
 */
function isIntactSnapshot(snapshot: IStoreSnapshot, tokens: readonly string[]): boolean {
  if (snapshot.state !== 'healthy') return snapshot.state === 'absent';
  const stored = snapshot.records[TOKENS_RECORD];
  const isOnlyRecord = Object.keys(snapshot.records).length === 1;
  return isOnlyRecord && Array.isArray(stored) && stored.length === tokens.length;
}

/** Persists Expo push tokens to a JSON file on a shared volume. */
export default class DeviceTokenStore {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the store to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path of the device-tokens JSON file.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._store = new SecureJsonStore(fileSystem, filePath, { legacyList: TOKENS_RECORD });
  }

  /**
   * Lists the registered push tokens.
   * @returns The stored tokens, or an empty array when absent or unreadable.
   */
  public list(): string[] {
    const loaded = this.load();
    return loaded.success ? loaded.data.tokens : [];
  }

  /**
   * Registers a token (no-op when already present).
   * @param token - The Expo push token to add.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public add(token: string): void {
    const loaded = this.loadForWrite();
    if (loaded.tokens.includes(token)) return;
    this.save([...loaded.tokens, token], loaded.isIntact);
  }

  /**
   * Unregisters a token.
   * @param token - The Expo push token to remove.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public remove(token: string): void {
    const loaded = this.loadForWrite();
    const remaining = loaded.tokens.filter((existing) => existing !== token);
    this.save(remaining, loaded.isIntact);
  }

  /**
   * Reads the file once: the tokens, and whether it holds only what this store writes.
   * @returns The loaded tokens, or why the file could not be assessed.
   */
  private load(): Procedure<ILoadedTokens> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const tokens = toTokens(snapshot.data.records[TOKENS_RECORD]);
    const isIntact = isIntactSnapshot(snapshot.data, tokens);
    return succeed({ tokens, isIntact });
  }

  /**
   * Reads the file before a write, refusing to write over one it cannot read.
   * @returns The loaded tokens.
   * @throws StorageError when the file cannot be assessed.
   */
  private loadForWrite(): ILoadedTokens {
    const loaded = this.load();
    if (!loaded.success) {
      throw new StorageError(`Could not read the device tokens before saving: ${loaded.message}`);
    }
    return loaded.data;
  }

  /**
   * Replaces the file with the given tokens.
   * @param tokens - The full token list to persist.
   * @param isIntact - Whether the file being replaced held only what this store writes.
   * @throws StorageError when the new file cannot be saved.
   */
  private save(tokens: string[], isIntact: boolean): void {
    const request = { records: { [TOKENS_RECORD]: tokens }, shouldQuarantine: !isIntact };
    const committed = this._store.commit(request);
    if (!committed.success) {
      throw new StorageError(`Could not save the device tokens: ${committed.message}`);
    }
  }
}
