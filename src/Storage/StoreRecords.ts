/**
 * Turning file contents into records, and records back into file contents.
 *
 * <p>Split from the store itself because these are pure functions over
 * values: nothing here touches a descriptor or makes a decision about what
 * to do with a damaged file. Keeping them separate is what lets the store
 * read as a sequence of filesystem decisions rather than a mix of both.
 */

import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';
import type { IOwnedRecords, IStoreSnapshot, StoreState } from './StoreTypes.js';

/**
 * Key that turns a later `target[key] = value` into prototype pollution.
 *
 * <p>Survives `JSON.parse` as an ordinary own property, so copying entries
 * into a null-prototype object is not on its own enough to neutralise it.
 * Defined here, with the read path that strips it: the write path refuses it
 * only because this is what a read would do to it.
 */
export const POLLUTING_KEY = '__proto__';

/**
 * Largest store this will read into memory.
 *
 * <p>Without a cap, anything that can grow the file — or plant a large one —
 * turns a read into an out-of-memory crash.
 */
export const MAX_STORE_BYTES = 8 * 1024 * 1024;

/**
 * Builds a snapshot with no records.
 * @param state - State to report.
 * @param summary - Operator-facing explanation, free of stored values.
 * @returns An empty snapshot in that state.
 */
export function emptySnapshot(state: StoreState, summary: string): IStoreSnapshot {
  return { state, records: Object.create(null) as Record<string, unknown>, summary };
}

/**
 * Copies parsed entries into a null-prototype object, dropping hostile keys.
 * @param parsed - Object produced by `JSON.parse`.
 * @returns Records that cannot carry pollution into a caller's object.
 */
function toSafeRecords(parsed: Record<string, unknown>): Record<string, unknown> {
  const records = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (key !== POLLUTING_KEY) records[key] = value;
  }
  return records;
}

/**
 * Reports whether a parsed value is a keyed record rather than an array.
 * @param value - Value produced by `JSON.parse`.
 * @returns True when the value can be treated as records.
 */
function isKeyedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns file contents into records, treating anything unexpected as damage.
 *
 * <p>The parse error is never included: a truncated JSON error message can
 * quote the surrounding bytes, and those bytes are credentials.
 * @param contents - Raw file contents.
 * @returns A healthy snapshot, or a damaged one explaining why.
 */
export function parseSnapshot(contents: string): IStoreSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return emptySnapshot('damaged', 'Store is not valid JSON');
  }
  if (!isKeyedRecord(parsed)) {
    return emptySnapshot('damaged', 'Store is valid JSON but not an object of records');
  }
  const records = toSafeRecords(parsed);
  const count = String(Object.keys(records).length);
  return { state: 'healthy', records, summary: `Loaded ${count} records` };
}

/**
 * Names the ways the serialised text differs from the records asked for.
 *
 * <p>Missing keys are named: they come from the caller's own record set, so
 * they are identifiers the caller already knows. Unexpected keys are only
 * counted. They come out of the serialisation rather than the caller, and a
 * record set that rewrites itself can promote a credential into a key name —
 * naming those would print the secret into the very error an operator logs.
 * @param expected - Keys read before serialisation.
 * @param written - Object the serialised text parses back to.
 * @returns One note per kind of difference, naming no value the text invented.
 */
function keyDifferences(
  expected: readonly string[],
  written: Record<string, unknown>,
): readonly string[] {
  const asked = new Set(expected);
  const missing = expected.filter((key) => !Object.hasOwn(written, key));
  const present = Object.keys(written);
  const unexpected = present.filter((key) => !asked.has(key));
  const notes: string[] = [];
  if (missing.length > 0) notes.push(`missing ${missing.join(', ')}`);
  if (unexpected.length > 0) notes.push(`${String(unexpected.length)} it never gave`);
  return notes;
}

/**
 * Accepts serialised text only when it holds exactly the records asked for.
 *
 * <p>Checking that nothing was dropped is half a check. A record set able to
 * rewrite itself during serialisation can add records as easily as lose
 * them, and a subset test calls both a faithful write, so the comparison has
 * to run in both directions against a key set captured beforehand.
 *
 * <p>Ownership now makes that cheap. What arrives is a frozen, prototype-less
 * copy the store took itself, so nothing here can run code or change between
 * reads. The remaining live case is a *nested* value whose own `toJSON`
 * returns `undefined`, which is ordinary JSON semantics and quietly drops
 * the record.
 *
 * <p>The unexpected-key half therefore has no way to fire today. It is kept
 * because it costs one comparison and it is the check that would notice if
 * serialisation were ever pointed back at a caller's object.
 *
 * <p>Value fidelity at depth is still not promised: a nested `Date` is meant
 * to serialise as a string. The caller owns values; this owns the set.
 * @param expected - Keys read before serialisation.
 * @param json - Text `JSON.stringify` produced for them.
 * @returns The text and its record count, or a failure naming no values.
 */
function confirmExactRoundTrip(
  expected: readonly string[],
  json: string,
): Procedure<ISerialised> {
  const written: unknown = JSON.parse(json);
  // Narrowing `JSON.parse`, which is typed `any`. A copy of a validated plain
  // object always parses back to one, so the branch below is unreachable.
  if (!isKeyedRecord(written)) {
    return fail('Records serialise to something that is not an object of records', {
      status: 'EINVAL',
    });
  }
  const differences = keyDifferences(expected, written);
  if (differences.length > 0) {
    const notes = differences.join('; ');
    return fail(`Records did not survive JSON unchanged: ${notes}`, { status: 'EINVAL' });
  }
  return succeed({ json, count: expected.length });
}

/** Serialised records, with the count that was actually written. */
export interface ISerialised {
  /** The JSON text to stage. */
  readonly json: string;

  /** How many top-level records that text contains. */
  readonly count: number;
}

/**
 * Serialises records the store already owns.
 *
 * <p>Takes {@link IOwnedRecords} rather than anything the caller still holds
 * a reference to. That is the whole defence: there is no copy step here to
 * get wrong and no second read to disagree with the first, because the value
 * arriving was read once, frozen, and stripped of its prototype before it
 * ever reached this module.
 * @param owned - Records the store copied out of the request.
 * @returns The JSON text and its record count, or why it cannot be written.
 */
export function serialiseRecords(owned: IOwnedRecords): Procedure<ISerialised> {
  return stringifyAndVerify(owned.values);
}

/**
 * Serialises the copy and proves the text still holds all of it.
 *
 * <p>The key set is read before `JSON.stringify`, not after. That ordering
 * cost nothing and is what closed the original hole, where keys read
 * afterwards described the serialisation rather than the request.
 * @param records - Private copy cleared for writing.
 * @returns The JSON text and its record count, or a failure naming no values.
 */
function stringifyAndVerify(records: Record<string, unknown>): Procedure<ISerialised> {
  const expected = Object.keys(records);
  let json: string;
  try {
    json = JSON.stringify(records, undefined, 2);
  } catch {
    return fail('Records could not be serialised as JSON', { status: 'EINVAL' });
  }
  return confirmExactRoundTrip(expected, json);
}

/**
 * Describes a store too large to read, without reading any of it.
 *
 * <p>Damage rather than failure: something is at the canonical path, so
 * calling it absent would license overwriting it.
 * @param sizeBytes - Size reported for the open descriptor.
 * @returns A damaged snapshot naming the size but no contents.
 */
export function oversizedSnapshot(sizeBytes: number): IStoreSnapshot {
  const size = String(sizeBytes);
  return emptySnapshot('damaged', `Store is ${size} bytes, above the cap`);
}

/**
 * Refuses a payload the store would be unable to read back.
 * @param json - Serialised records about to be staged.
 * @returns Success when the payload is within the read cap.
 */
export function checkWritableSize(json: string): Procedure<number> {
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_STORE_BYTES) return succeed(bytes);
  return fail(`Records serialise to ${String(bytes)} bytes, above the cap`, { status: 'EFBIG' });
}

/**
 * Rejects a stage the filesystem reported as successful but incomplete.
 *
 * <p>The port returns a byte count for exactly this reason. Trusting the
 * success flag alone would publish truncated JSON, which reads back as a
 * damaged store and loses every credential the file used to hold.
 * @param bytesWritten - What the filesystem said it staged.
 * @param bytesExpected - What the payload actually measures.
 * @returns The byte count when the two agree, a failure when they do not.
 */
export function checkWholeWrite(
  bytesWritten: number,
  bytesExpected: number,
): Procedure<number> {
  if (bytesWritten === bytesExpected) return succeed(bytesWritten);
  const staged = String(bytesWritten);
  const expected = String(bytesExpected);
  return fail(`Staged ${staged} of ${expected} bytes`, { status: 'EIO' });
}

/**
 * Read failures that describe the file rather than the attempt to read it.
 *
 * <p>A `Map` rather than an object literal: the errno is untrusted input, and
 * a plain object would answer `constructor` or `toString` out of its
 * prototype and report inherited nonsense as a damage summary.
 */
const DAMAGED_READ_SUMMARIES = new Map<string, string>([
  ['EFBIG', 'Store grew past the cap while being read'],
  ['EILSEQ', 'Store is not valid UTF-8'],
]);

/**
 * Describes a read the file itself defeated, rather than the attempt.
 *
 * <p>Both cases are damage: the bytes on disk are wrong, so reporting an
 * error would stall the caller where reporting damage lets it quarantine and
 * start cold. `EFBIG` means the file was within the cap when it was measured
 * and grew past it before it could be read, which is exactly what an attacker
 * would produce. `EILSEQ` means it is not valid UTF-8, and decoding it
 * leniently would hand back a silently altered credential.
 * @param status - Errno reported by the read.
 * @returns A damaged snapshot, or a failure when the file is not at fault.
 */
export function damagedReadSnapshot(status: string): Procedure<IStoreSnapshot> {
  const summary = DAMAGED_READ_SUMMARIES.get(status);
  if (summary === undefined) return fail(`Read failed with ${status}`, { status });
  const damaged = emptySnapshot('damaged', summary);
  return succeed(damaged);
}
