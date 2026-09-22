/**
 * File-backed store of the durable long-term tokens API-direct banks mint.
 *
 * <p>OneZero, Pepper and PayBox return a long-lived re-login artifact after a
 * successful SMS login. Replaying it skips the SMS on every subsequent run, so
 * it is the difference between one 2FA prompt and one per scrape. It is a
 * standing bypass of the second factor and is stored with the same care as a
 * password: owner-only permissions, never logged, never placed in config.
 *
 * <p>Writes are atomic (temp file plus rename) because a scrape interrupted
 * mid-write would otherwise leave a truncated token that fails every future
 * warm start. Every operation is total: an unreadable store yields "no token"
 * and an unwritable store yields a typed failure, so a broken store degrades
 * the run to a cold login rather than failing it.
 *
 * <p>One writer is assumed. The read-modify-write is synchronous, so banks
 * scraped within a single importer cannot interleave, but two importer
 * processes sharing one file can still lose an update. That is bounded and
 * self-correcting rather than destructive: the loser's bank keeps its
 * previous token, the provider rejects it, and the scraper falls back to a
 * cold login that re-mints and overwrites. The cost is one SMS, which is why
 * no lock is taken — a lock able to wedge a scheduled scrape would be worse
 * than the failure it prevents. Running two importers against one account is
 * unsupported for a stronger reason anyway: each mint revokes the last.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import resolveBankTokensPath from './BankTokenPath.js';

/** Absence of a token, shared by every "nothing stored" outcome. */
const NO_TOKEN = '';

/** One bank's durable token together with the moment it was captured. */
interface IBankTokenRecord {
  readonly token: string;
  readonly capturedAt: string;
}

/** On-disk shape of the store: one record per bank id. */
interface IBankTokenFile {
  readonly banks: Record<string, IBankTokenRecord>;
}

/** Outcome of reading the store file: its records and whether it parsed. */
interface IStoreRead {
  readonly records: Map<string, IBankTokenRecord>;
  readonly isReadable: boolean;
}

/** Outcome of a write: whether a token was actually persisted. */
export interface IBankTokenWrite {
  readonly written: boolean;
}

/** Read/write access to the durable long-term tokens, keyed by bank id. */
export interface IBankTokenStore {
  /**
   * Returns the stored long-term token for a bank.
   * @param bankId - Bank identifier used as the store key.
   * @returns The stored token, or an empty string when none is available.
   */
  read: (bankId: string) => string;

  /**
   * Persists a bank's long-term token, replacing any previous value.
   * @param bankId - Bank identifier used as the store key.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written.
   */
  write: (bankId: string, token: string) => Procedure<IBankTokenWrite>;
}

/**
 * Extracts the token from one parsed store entry.
 *
 * <p>An entry of any other shape yields the empty token, which the caller
 * treats as "this bank has nothing stored".
 * @param entry - Candidate value read from the store file.
 * @returns The token carried by a well-formed entry, else an empty string.
 */
function readEntryToken(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) return NO_TOKEN;
  const fields = entry as Record<string, unknown>;
  const token = fields.token;
  return typeof token === 'string' ? token : NO_TOKEN;
}

/**
 * Extracts the capture timestamp from one entry's fields.
 *
 * <p>Takes the already-narrowed fields rather than the raw entry so the
 * "this is an object" precondition is carried by the type system: reading
 * `capturedAt` straight off an unnarrowed `null` entry throws, and that throw
 * used to be caught as "the whole store is corrupt", discarding every other
 * bank's token on the next write.
 * @param fields - Fields of an entry already proven to be an object.
 * @returns The recorded ISO timestamp, or an empty string when absent.
 */
function readCapturedAt(fields: Record<string, unknown>): string {
  const capturedAt = fields.capturedAt;
  return typeof capturedAt === 'string' ? capturedAt : '';
}

/**
 * Keeps only the entries that carry a usable token.
 *
 * <p>Entries are judged one at a time: a single malformed entry costs that
 * bank its token and nothing more, because the siblings are the only copy of
 * credentials the bank will not re-issue without another SMS.
 * @param banks - Raw bank entries read from the store file.
 * @returns Well-formed records by bank id.
 */
function collectRecords(banks: Record<string, unknown>): Map<string, IBankTokenRecord> {
  const kept = new Map<string, IBankTokenRecord>();
  const entries = Object.entries(banks);
  for (const [bankId, entry] of entries) {
    const token = readEntryToken(entry);
    if (token.length === 0) continue;
    const fields = entry as Record<string, unknown>;
    const capturedAt = readCapturedAt(fields);
    kept.set(bankId, { token, capturedAt });
  }
  return kept;
}

/**
 * Moves an unparseable store aside before it is overwritten.
 *
 * <p>The file holds credentials valid for years that the bank re-issues only
 * by SMS, and re-issuing revokes whatever is still live. Overwriting a file
 * nobody has inspected therefore destroys the only salvageable copy, so it is
 * renamed next to the store for an operator to examine.
 *
 * <p>Only a regular file is moved. A directory at the store path means the
 * deployment mounted something unexpected there, and silently relocating a
 * mount point would do more damage than refusing the write.
 * @param filePath - Store path whose contents could not be parsed.
 * @returns True when a quarantine copy was kept.
 */
function quarantineStore(filePath: string): boolean {
  const stamp = new Date();
  const iso = stamp.toISOString();
  // Colons are legal on Linux but not on a Windows bind mount, and the data
  // volume is routinely one; a name that cannot be created saves nothing.
  const suffix = iso.replaceAll(':', '-');
  const target = `${filePath}.${suffix}.corrupt`;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return false;
    renameSync(filePath, target);
    return true;
  } catch {
    // Losing the quarantine copy must not stop the fresh token being stored.
    return false;
  }
}

/**
 * Narrows parsed JSON to the bank map, dropping entries of any other shape.
 * @param parsed - Value produced by `JSON.parse` on the store file.
 * @returns Well-formed records by bank id; empty when nothing is recognisable.
 */
function readBankMap(parsed: unknown): Map<string, IBankTokenRecord> {
  if (typeof parsed !== 'object' || parsed === null) return new Map();
  const container = parsed as Record<string, unknown>;
  const banks = container.banks;
  if (typeof banks !== 'object' || banks === null) return new Map();
  return collectRecords(banks as Record<string, unknown>);
}

/**
 * Converts the in-memory records back to the serialisable file shape.
 * @param records - Records to persist, keyed by bank id.
 * @returns The complete file contents.
 */
function toFile(records: Map<string, IBankTokenRecord>): IBankTokenFile {
  const banks: Record<string, IBankTokenRecord> = {};
  for (const [bankId, record] of records) banks[bankId] = record;
  return { banks };
}

/**
 * Stages the payload then renames it into place, cleaning up on failure.
 * @param tempPath - Sibling temp file staged before the rename.
 * @param serialized - Complete JSON payload to persist.
 * @param target - Final path the temp file is renamed onto.
 * @returns True once the rename into place has completed.
 * @throws Error when staging or renaming fails.
 */
function commitTemp(tempPath: string, serialized: string, target: string): boolean {
  try {
    writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, target);
    return true;
  } catch (error: unknown) {
    rmSync(tempPath, { force: true });
    const detail = errorMessage(error);
    throw error instanceof Error ? error : new Error(detail);
  }
}

/** Durable long-term bank tokens persisted on the shared data volume. */
export default class BankTokenStore implements IBankTokenStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the bank-token JSON file.
   */
  constructor(private readonly filePath: string = resolveBankTokensPath()) {}

  /**
   * Returns the stored long-term token for a bank.
   *
   * <p>A missing, unreadable or malformed store is indistinguishable from
   * "never captured": both mean the next run must perform a cold login.
   * @param bankId - Bank identifier used as the store key.
   * @returns The stored token, or an empty string when none is available.
   */
  public read(bankId: string): string {
    const store = this.readStore();
    const record = store.records.get(bankId);
    return record ? record.token : NO_TOKEN;
  }

  /**
   * Persists a bank's long-term token, replacing any previous value.
   *
   * <p>Blank tokens are ignored rather than stored: the provider returns an
   * empty string when a run produced no durable artifact, and writing it would
   * erase a working token.
   * @param bankId - Bank identifier used as the store key.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written, or a typed failure.
   */
  public write(bankId: string, token: string): Procedure<IBankTokenWrite> {
    const trimmed = token.trim();
    if (trimmed.length === 0) return succeed({ written: false });
    try {
      const contents = this.merge(bankId, trimmed);
      this.commit(contents);
      return succeed({ written: true });
    } catch (error: unknown) {
      const detail = errorMessage(error);
      return fail(`Failed to persist the long-term token for ${bankId}: ${detail}`);
    }
  }

  /**
   * Reads the current records from disk.
   *
   * <p>Reports whether the file parsed at all, because "no tokens yet" and
   * "this file is damaged" call for different handling on the write path: the
   * first is routine, the second must not be overwritten unrecorded.
   * @returns The stored records and whether the file was parseable.
   */
  private readStore(): IStoreRead {
    if (!existsSync(this.filePath)) return { records: new Map(), isReadable: true };
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return { records: readBankMap(parsed), isReadable: true };
    } catch {
      // A corrupt store is treated as absent so the run falls back to a cold
      // login instead of failing; the write path quarantines it first.
      return { records: new Map(), isReadable: false };
    }
  }

  /**
   * Builds the next file contents with one bank's token replaced.
   * @param bankId - Bank identifier used as the store key.
   * @param token - Non-blank token to record for that bank.
   * @returns The complete file contents to persist.
   */
  private merge(bankId: string, token: string): IBankTokenFile {
    const store = this.readStore();
    if (!store.isReadable) quarantineStore(this.filePath);
    const now = new Date();
    const capturedAt = now.toISOString();
    store.records.set(bankId, { token, capturedAt });
    return toFile(store.records);
  }

  /**
   * Writes the file atomically with owner-only permissions.
   *
   * <p>The 0600 file mode is the protection that matters and holds on every
   * write, including one that replaces a file left behind with looser
   * permissions. The 0700 directory mode applies only when this code creates
   * the directory: the shipped image already provisions `/app/data` as 0755,
   * and re-chmod'ing a shared mount point to suit one file would be a
   * surprise for everything else living there. A listable directory is
   * harmless while the file itself stays unreadable.
   * @param contents - The complete file contents to persist.
   * @returns True once the rename into place has completed.
   * @throws Error when the directory cannot be created or the file written.
   */
  private commit(contents: IBankTokenFile): boolean {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const unique = randomUUID();
    const tempPath = `${this.filePath}.${unique}.tmp`;
    const serialized = JSON.stringify(contents, null, 2);
    return commitTemp(tempPath, serialized, this.filePath);
  }
}
