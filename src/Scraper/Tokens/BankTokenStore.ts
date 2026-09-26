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
 *
 * <p>Every token read from the file, and every token about to be written, is
 * handed to the value masker first, so no output shows one even when a bank
 * quotes it back with no key in front of it. That includes tokens the file
 * holds but this layer cannot use, since the file still carries them.
 *
 * <p>Each token is bound to the fingerprint of the login that minted it, and
 * the file never binds one token to two logins: a write that would do so is
 * refused, and a file that does so is read as damaged. A Pepper or PayBox
 * token logs in by itself, so a binding that could move would let one
 * config entry import another's account.
 */

import { registerSecretValues } from '../../Logger/SecretValues.js';
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/ProcedureHelpers.js';
import type { IBankTokenRecord } from './BankTokenRecords.js';
import {
  isLoginFingerprint, NO_LOGIN, NO_RECORD, readTokenRecords, toStoreRecords,
} from './BankTokenRecords.js';

/** Outcome of a write: whether the file on disk was replaced. */
export interface IBankTokenWrite {
  readonly written: boolean;
}

/**
 * What the file says about one bank account, for deciding which token to send.
 *
 * <p>It carries this account's record and nothing else a caller could send:
 * another account's token can only be asked about, never listed.
 */
export interface ITokenView {
  /** This key's record, or {@link NO_RECORD} when the file holds none for it. */
  readonly record: IBankTokenRecord;
  /** False when the file was damaged or held any entry that could not be used. */
  readonly isIntact: boolean;
  /**
   * Names the login the file binds a token to, under any key.
   * @param token - Token to look up; surrounding whitespace is ignored.
   * @returns The login fingerprint, or {@link NO_LOGIN} when no entry binds it.
   */
  readonly loginOf: (token: string) => string;
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
   * Returns what the file says about one bank account.
   * @param storeKey - Opaque key identifying one bank account.
   * @returns The account's view of the file, or why the store is unreadable.
   */
  read: (storeKey: string) => Procedure<ITokenView>;

  /**
   * Persists one bank account's long-term token, bound to the login that minted it.
   * @param storeKey - Opaque key identifying one bank account.
   * @param token - The long-term token to persist.
   * @param login - Fingerprint of the login that minted the token.
   * @returns Whether the file was replaced, or why it was not.
   */
  write: (storeKey: string, token: string, login: string) => Procedure<IBankTokenWrite>;

  /**
   * Deletes staged token files an earlier run was killed before cleaning up.
   * @returns How many were removed, or why the directory could not be read.
   */
  sweepStagedLeftovers: () => Procedure<ISweepReport>;
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
  readonly loginOf: ITokenView['loginOf'];
  readonly contestedTokens: ReadonlySet<string>;
}

/** A non-blank token and the login it is to be bound to. */
interface ITokenBinding {
  readonly token: string;
  readonly login: string;
}

/** Why a write with no login fingerprint is refused. */
const NO_LOGIN_TO_BIND = fail('there is no login to bind it to');

/** Why a write that would move a token to another login is refused. */
const BOUND_ELSEWHERE = fail('the token file binds it to another login');

/**
 * Reports whether the file already holds exactly what a write would leave.
 *
 * <p>Intactness is part of the question. A file can hold this account's token
 * unchanged while another entry is unusable, and skipping the write then would
 * leave the damage on disk with no copy set aside and no sign it was seen.
 * The login needs no comparison: a token bound to another login is refused
 * before this is asked, so a matching token is already bound to this one.
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
 * Indexes the login each usable token is bound to.
 *
 * <p>The records carry each token at most once per login, and a token bound
 * to two logins never reaches here, so each token maps to one login.
 * @param tokens - Usable records by store key.
 * @returns The login of each token.
 */
function loginsByToken(tokens: ReadonlyMap<string, IBankTokenRecord>): ReadonlyMap<string, string> {
  const records = [...tokens.values()];
  const pairs = records.map(({ token, login }) => [token, login] as const);
  return new Map(pairs);
}

/**
 * Builds the lookup a view answers "whose token is this?" with.
 * @param tokens - Usable records by store key.
 * @returns A lookup that trims the token it is asked about.
 */
function loginLookup(tokens: ReadonlyMap<string, IBankTokenRecord>): ITokenView['loginOf'] {
  const logins = loginsByToken(tokens);
  return (token: string): string => {
    const trimmed = token.trim();
    return logins.get(trimmed) ?? NO_LOGIN;
  };
}

/**
 * Tells whether storing a binding would move its token to another login.
 *
 * <p>A token the file binds to two logins was dropped from the usable
 * records, so {@link ILoadedTokens.loginOf} cannot see it; it counts as bound
 * elsewhere for every login, since none of its bindings can be trusted.
 * @param loaded - Tokens read from the file.
 * @param binding - Token about to be stored and its login.
 * @returns True when some entry binds the token to a different login.
 */
function isBoundElsewhere(loaded: ILoadedTokens, binding: ITokenBinding): boolean {
  if (loaded.contestedTokens.has(binding.token)) return true;
  const bound = loaded.loginOf(binding.token);
  return bound !== NO_LOGIN && bound !== binding.login;
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
   * Returns what the file says about one bank account.
   *
   * <p>No file, no entry and an unusable entry all read as {@link NO_RECORD};
   * `isIntact` tells the caller whether the file vouches for everything else
   * it holds. A file that could not be read at all is reported as a failure,
   * so the caller can say why the run went cold instead of hiding it.
   * @param storeKey - Opaque key identifying one bank account.
   * @returns The account's view of the file, or why the store is unreadable.
   */
  public read(storeKey: string): Procedure<ITokenView> {
    const loaded = this.load();
    if (!loaded.success) return loaded;
    const { tokens, isIntact, loginOf } = loaded.data;
    const record = tokens.get(storeKey) ?? NO_RECORD;
    return succeed({ record, isIntact, loginOf });
  }

  /**
   * Persists one account's token, bound to its login, merging it into what is stored.
   *
   * <p>Every write reads the file afresh, so it merges into what is on disk
   * now rather than a copy that may be stale. A blank token, which is what a
   * run minting none returns, and a binding the intact file already holds
   * write nothing. Three are refused: a login that is not a fingerprint; a
   * token the file binds to another login, under any key, since the first
   * binding is the one the bank issued; and a file that could not be read,
   * which is never replaced — overwriting what cannot be read would destroy
   * every other account's token along with any evidence.
   * @param storeKey - Opaque key identifying one bank account.
   * @param token - The long-term token to persist.
   * @param login - Fingerprint of the login that minted the token.
   * @returns Whether the file was replaced, or why it was not.
   */
  public write(storeKey: string, token: string, login: string): Procedure<IBankTokenWrite> {
    const trimmed = token.trim();
    if (trimmed.length === 0) return succeed({ written: false });
    registerSecretValues([trimmed]);
    if (!isLoginFingerprint(login)) return tokenNotStored(storeKey, NO_LOGIN_TO_BIND);
    const loaded = this.load();
    if (!loaded.success) return tokenNotStored(storeKey, loaded);
    return this.merge(loaded.data, storeKey, { token: trimmed, login });
  }

  /**
   * Deletes staged token files an earlier run was killed before cleaning up.
   *
   * <p>Each one holds a live credential, and a crashed process never returns
   * to remove it. Whoever owns the store should call this on every run, not
   * only after a restart: a file staged just before a restart is still inside
   * the grace period when the process comes back, and a warm run that writes
   * nothing never commits. The store itself only collects leftovers after its
   * own commits.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return this._store.sweepStagedLeftovers();
  }

  /**
   * Stores a binding unless the file already holds it or binds its token elsewhere.
   * @param loaded - Tokens read from the file, reused as the merge base.
   * @param storeKey - Opaque key identifying one bank account.
   * @param binding - Non-blank token to store and its login.
   * @returns Whether the file was replaced, or why it was not.
   */
  private merge(
    loaded: ILoadedTokens,
    storeKey: string,
    binding: ITokenBinding,
  ): Procedure<IBankTokenWrite> {
    if (isBoundElsewhere(loaded, binding)) return tokenNotStored(storeKey, BOUND_ELSEWHERE);
    if (isAlreadyStored(loaded, storeKey, binding.token)) return succeed({ written: false });
    return this.replace(loaded, storeKey, binding);
  }

  /**
   * Replaces the file with one account's token merged in.
   *
   * <p>A file that is not intact is quarantined first rather than dropped;
   * {@link ILoadedTokens.isIntact} says which parts of a file that covers.
   * @param loaded - Tokens read from the file, reused as the merge base.
   * @param storeKey - Opaque key identifying one bank account.
   * @param binding - Non-blank token to store and its login.
   * @returns Confirmation of the write, or why it did not happen.
   */
  private replace(
    loaded: ILoadedTokens,
    storeKey: string,
    binding: ITokenBinding,
  ): Procedure<IBankTokenWrite> {
    const now = new Date();
    const tokens = new Map(loaded.tokens);
    tokens.set(storeKey, { ...binding, capturedAt: now.toISOString() });
    const records = toStoreRecords(tokens);
    const committed = this._store.commit({ records, shouldQuarantine: !loaded.isIntact });
    if (!committed.success) return tokenNotStored(storeKey, committed);
    return succeed({ written: true });
  }

  /**
   * Reads every usable token, noting whether anything else was on disk.
   * @returns The tokens, whether the file was intact and whose each token is,
   *          or why it is unreadable.
   */
  private load(): Procedure<ILoadedTokens> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const { state, records } = snapshot.data;
    const { tokens, droppedCount, seenTokens, contestedTokens } = readTokenRecords(records);
    registerSecretValues(seenTokens);
    const isIntact = state !== 'damaged' && droppedCount === 0;
    const loginOf = loginLookup(tokens);
    return succeed({ tokens, isIntact, loginOf, contestedTokens });
  }
}
