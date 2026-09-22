/**
 * On-disk shape of the bank token store and the rules for reading it.
 *
 * <p>Pure: nothing here touches the filesystem. Separating the shape from the
 * I/O keeps the question "is this file intact?" answerable from a string, and
 * that question drives the store's most destructive decision — whether
 * overwriting would lose a credential the bank re-issues only by SMS.
 *
 * <p>Every reader is total and pessimistic. A value that cannot be understood
 * is reported as damage rather than as an empty store, because the two call
 * for opposite handling: the first must be quarantined, the second is the
 * routine first run.
 */

/** Absence of a token, shared by every "nothing stored" outcome. */
export const NO_TOKEN = '';

/** One bank's durable token together with the moment it was captured. */
export interface IBankTokenRecord {
  readonly token: string;
  readonly capturedAt: string;
}

/** On-disk shape of the store: one record per bank id. */
export interface IBankTokenFile {
  readonly banks: Record<string, IBankTokenRecord>;
}

/** Outcome of reading the store file: its records and whether it was intact. */
export interface IStoreRead {
  readonly records: Map<string, IBankTokenRecord>;
  readonly isIntact: boolean;
}

/**
 * Extracts the token from one parsed store entry.
 *
 * <p>An entry of any other shape yields the empty token, which the caller
 * treats as "this bank has nothing stored".
 *
 * <p>The value is trimmed, so a hand-edited or damaged entry holding only
 * whitespace collapses to "nothing stored" rather than to a token of
 * non-zero length. Left untrimmed it counted as a usable credential and
 * outranked a working config seed, sending blanks to the provider.
 * @param entry - Candidate value read from the store file.
 * @returns The token carried by a well-formed entry, else an empty string.
 */
function readEntryToken(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) return NO_TOKEN;
  const fields = entry as Record<string, unknown>;
  const token = fields.token;
  if (typeof token !== 'string') return NO_TOKEN;
  return token.trim();
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
 * Reports a store whose contents could not be understood.
 *
 * <p>Returns a fresh map each call: the caller writes the new token into it,
 * so a shared instance would leak one bank's token into another's read.
 * @returns An empty, non-intact read.
 */
export function damagedRead(): IStoreRead {
  return { records: new Map(), isIntact: false };
}

/**
 * Reports whether a parsed value can hold bank entries.
 *
 * <p>Arrays are rejected explicitly. `typeof [] === 'object'` and `[] !== null`,
 * so an array passed the earlier shape check and an empty one then counted as
 * an intact store with no banks — which meant `{"banks": []}` was overwritten
 * without the quarantine the write path promises.
 * @param banks - Candidate value found under the `banks` key.
 * @returns True when the value can be read as a map of bank entries.
 */
function isBankContainer(banks: unknown): boolean {
  if (typeof banks !== 'object' || banks === null) return false;
  return !Array.isArray(banks);
}

/**
 * Narrows parsed JSON to the bank map, reporting whether all of it was read.
 *
 * <p>A file can parse as JSON and still be damaged — `{}`, `{"banks": null}`,
 * `{"banks": []}`, or an entry whose token field was mistyped. Those are
 * reported as not intact rather than as an empty store, because the write
 * path uses that distinction to decide whether overwriting would destroy
 * something an operator could still salvage.
 * @param parsed - Value produced by `JSON.parse` on the store file.
 * @returns The records understood, and whether anything was lost reading them.
 */
export function readBankMap(parsed: unknown): IStoreRead {
  if (typeof parsed !== 'object' || parsed === null) return damagedRead();
  const container = parsed as Record<string, unknown>;
  const banks = container.banks;
  if (!isBankContainer(banks)) return damagedRead();
  const entries = banks as Record<string, unknown>;
  const records = collectRecords(entries);
  const present = Object.keys(entries).length;
  return { records, isIntact: records.size === present };
}

/**
 * Converts the in-memory records back to the serialisable file shape.
 * @param records - Records to persist, keyed by bank id.
 * @returns The complete file contents.
 */
export function toFile(records: Map<string, IBankTokenRecord>): IBankTokenFile {
  const banks: Record<string, IBankTokenRecord> = {};
  for (const [bankId, record] of records) banks[bankId] = record;
  return { banks };
}
