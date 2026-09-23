/**
 * The durable long-term tokens API-direct banks mint, one per bank account.
 *
 * <p>OneZero, Pepper and PayBox return a long-lived re-login token after a
 * successful SMS login. Replaying it skips the SMS on later runs, so it is a
 * standing bypass of the second factor and is stored like a password.
 *
 * <p>This is a thin adapter. {@link SecureJsonStore} owns every filesystem
 * guarantee — no-follow reads, owner-only files, exclusive staging, atomic
 * publish, quarantine and the size cap — and the threat model behind them is
 * `docs/architecture/secure-json-store.md`. What lives here is only what makes
 * the records bank tokens: which key, what a usable token is, how one account
 * is merged into the file, and when damage must be set aside first.
 *
 * <p>One writer is assumed. Two importers sharing one file can lose an update;
 * the loser's account keeps its previous token, the bank rejects it, and the
 * next cold login re-mints it at the cost of one SMS. No lock is taken, because
 * a lock able to wedge a scheduled scrape would cost more than that.
 */

import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/ProcedureHelpers.js';
import type { IBankTokenRecord } from './BankTokenRecords.js';
import { NO_TOKEN, readTokenRecords, toStoreRecords } from './BankTokenRecords.js';

/** Outcome of a write: whether the file on disk was replaced. */
export interface IBankTokenWrite {
  readonly written: boolean;
}

/**
 * Read/write access to the durable long-term tokens, keyed by store key.
 *
 * <p>The key is opaque and stored verbatim. Production passes
 * `bankId:accountKey`, so two accounts at one bank keep separate tokens; an
 * implementation that normalised the key would collapse them onto one entry,
 * and since each mint revokes the token it replaces, both accounts would then
 * cost an SMS on every run.
 */
export interface IBankTokenStore {
  /**
   * Returns the stored long-term token for one bank account.
   * @param storeKey - Opaque key identifying one bank account.
   * @returns The token or an empty string, or why the store is unreadable.
   */
  read: (storeKey: string) => Procedure<string>;

  /**
   * Persists one bank account's long-term token, replacing any previous one.
   * @param storeKey - Opaque key identifying one bank account.
   * @param token - The long-term token to persist.
   * @returns Whether the file was replaced, or why it was not.
   */
  write: (storeKey: string, token: string) => Procedure<IBankTokenWrite>;
}

/**
 * Tokens read from the store, and whether the file held nothing else.
 *
 * <p>`isIntact` is false when {@link SecureJsonStore} reported the file damaged
 * or an entry it returned could not be used as a token. The write path
 * quarantines such a file before replacing it, because the replacement would
 * otherwise erase the only copy. Two things never reach this layer, so they are
 * not counted: a `__proto__` key, which the store strips on read, and an earlier
 * duplicate of a key, which `JSON.parse` discards. This store writes neither.
 */
interface ILoadedTokens {
  readonly tokens: ReadonlyMap<string, IBankTokenRecord>;
  readonly isIntact: boolean;
}

/**
 * Reports whether the file already holds exactly what a write would leave.
 *
 * <p>Intactness is part of the question. A file can hold this account's token
 * unchanged while another entry is unusable, and skipping the write then would
 * leave the damage on disk with no copy set aside and no sign it was seen.
 * @param loaded - Tokens read from the file, with their intactness.
 * @param storeKey - Opaque key identifying one bank account.
 * @param token - Non-blank token about to be stored.
 * @returns True when the file is intact and already holds that token.
 */
function isAlreadyStored(loaded: ILoadedTokens, storeKey: string, token: string): boolean {
  if (!loaded.isIntact) return false;
  return loaded.tokens.get(storeKey)?.token === token;
}

/**
 * Explains a write that did not happen, naming the account but not the token.
 * @param storeKey - Opaque key identifying one bank account.
 * @param failure - Why the store refused.
 * @returns The same failure, with the account it cost.
 */
function tokenNotStored(storeKey: string, failure: IProcedureFailure): IProcedureFailure {
  const message = `Could not store the long-term token for ${storeKey}: ${failure.message}`;
  return fail(message, { status: failure.status, details: failure.details });
}

/** Durable long-term bank tokens, keyed by an opaque store key. */
export default class BankTokenStore implements IBankTokenStore {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the store to one file.
   * @param fileSystem - Filesystem the file lives on.
   * @param filePath - Absolute path of the token file.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._store = new SecureJsonStore(fileSystem, filePath);
  }

  /**
   * Returns the stored token for one bank account.
   *
   * <p>No file, no entry and a damaged file all mean the same thing to the
   * caller — log in cold — so they all read as {@link NO_TOKEN}. A file that
   * could not be read at all is different: it is reported as a failure, so the
   * caller can say why the run went cold instead of hiding it.
   * @param storeKey - Opaque key identifying one bank account.
   * @returns The stored token or {@link NO_TOKEN}, or why the store is unreadable.
   */
  public read(storeKey: string): Procedure<string> {
    const loaded = this.load();
    if (!loaded.success) return loaded;
    const record = loaded.data.tokens.get(storeKey);
    return succeed(record?.token ?? NO_TOKEN);
  }

  /**
   * Persists one account's token, merging it into what is already stored.
   *
   * <p>Every write reads the file afresh, so it merges into what is on disk
   * now rather than a copy that may be stale. Three outcomes write nothing:
   * a blank token, which is what a run minting none returns and would erase a
   * working one; a token the intact file already holds; and a file that could
   * not be read, which is never replaced — overwriting what cannot be read
   * would destroy every other account's token along with any evidence.
   * @param storeKey - Opaque key identifying one bank account.
   * @param token - The long-term token to persist.
   * @returns Whether the file was replaced, or why it was not.
   */
  public write(storeKey: string, token: string): Procedure<IBankTokenWrite> {
    const trimmed = token.trim();
    if (trimmed.length === 0) return succeed({ written: false });
    const loaded = this.load();
    if (!loaded.success) return tokenNotStored(storeKey, loaded);
    if (isAlreadyStored(loaded.data, storeKey, trimmed)) return succeed({ written: false });
    return this.replace(loaded.data, storeKey, trimmed);
  }

  /**
   * Deletes staged token files an earlier run was killed before cleaning up.
   *
   * <p>Each one holds a live credential, and a crashed process never returns
   * to remove it. Whoever constructs the store at startup should call this;
   * the store itself only collects leftovers after its own commits.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return this._store.sweepStagedLeftovers();
  }

  /**
   * Replaces the file with one account's token merged in.
   *
   * <p>A file that is not intact is quarantined first rather than dropped;
   * {@link ILoadedTokens.isIntact} says which parts of a file that covers.
   * @param loaded - Tokens read from the file, reused as the merge base.
   * @param storeKey - Opaque key identifying one bank account.
   * @param token - Non-blank token to store.
   * @returns Confirmation of the write, or why it did not happen.
   */
  private replace(
    loaded: ILoadedTokens,
    storeKey: string,
    token: string,
  ): Procedure<IBankTokenWrite> {
    const now = new Date();
    const tokens = new Map(loaded.tokens);
    tokens.set(storeKey, { token, capturedAt: now.toISOString() });
    const records = toStoreRecords(tokens);
    const committed = this._store.commit({ records, shouldQuarantine: !loaded.isIntact });
    if (!committed.success) return tokenNotStored(storeKey, committed);
    return succeed({ written: true });
  }

  /**
   * Reads every usable token, noting whether anything else was on disk.
   * @returns The tokens and whether the file was intact, or why it is unreadable.
   */
  private load(): Procedure<ILoadedTokens> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const { state, records } = snapshot.data;
    const read = readTokenRecords(records);
    const isIntact = state !== 'damaged' && read.droppedCount === 0;
    return succeed({ tokens: read.tokens, isIntact });
  }
}
