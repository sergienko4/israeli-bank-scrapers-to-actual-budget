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
import type { IStoreSnapshot, StoreState } from './StoreTypes.js';

/**
 * Largest store this will read into memory.
 *
 * <p>Without a cap, anything that can grow the file — or plant a large one —
 * turns a read into an out-of-memory crash.
 */
export const MAX_STORE_BYTES = 8 * 1024 * 1024;

/**
 * Key that turns a later `target[key] = value` into prototype pollution.
 *
 * <p>Survives `JSON.parse` as an ordinary own property, so copying entries
 * into a null-prototype object is not on its own enough to neutralise it.
 */
const POLLUTING_KEY = '__proto__';

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
 * Names the records that did not survive the round trip through JSON.
 *
 * <p>A shallow `typeof` check is not enough. A value whose `toJSON` returns
 * `undefined` is an ordinary object on the way in and absent on the way out,
 * so the only count that can be trusted is the one taken from the text that
 * will actually be written. Without this the report claims a credential was
 * stored when the staged file never contained it.
 *
 * <p>The text is not assumed to describe an object either: a `toJSON` on the
 * record set itself can turn the whole store into `null` or an array.
 * @param expected - Keys the caller asked to persist.
 * @param json - Text `JSON.stringify` produced for them.
 * @returns The omitted keys, which are names rather than secrets.
 */
function droppedKeys(expected: readonly string[], json: string): readonly string[] {
  const written: unknown = JSON.parse(json);
  if (!isKeyedRecord(written)) return expected;
  return expected.filter((key) => !Object.hasOwn(written, key));
}

/** Serialised records, with the count that was actually written. */
export interface ISerialised {
  /** The JSON text to stage. */
  readonly json: string;

  /** How many top-level records that text contains. */
  readonly count: number;
}

/**
 * Takes a private copy of the caller's records.
 *
 * <p>Every property is read exactly once, here, behind a guard. Reading them
 * twice would let an accessor return a value to be inspected and a different
 * one to be written, and reading them unguarded would let a throwing accessor
 * escape the commit as an exception instead of a failure.
 * @param records - Records the caller asked to persist.
 * @returns A plain copy, or a failure naming no values.
 */
function snapshotRecords(
  records: Readonly<Record<string, unknown>>,
): Procedure<Record<string, unknown>> {
  try {
    const copy = { ...records };
    return succeed(copy);
  } catch {
    return fail('Records could not be read', { status: 'EINVAL' });
  }
}

/**
 * Serialises records, treating an unserialisable graph as a caller error.
 *
 * <p>The thrown message is discarded: it can quote the offending property
 * path, and those properties hold credentials.
 * @param records - Records to persist.
 * @returns The JSON text and its record count, or a failure naming no values.
 */
export function serialiseRecords(
  records: Readonly<Record<string, unknown>>,
): Procedure<ISerialised> {
  const snapshot = snapshotRecords(records);
  if (!snapshot.success) return snapshot;
  let json: unknown;
  try {
    json = JSON.stringify(snapshot.data, undefined, 2);
  } catch {
    return fail('Records could not be serialised as JSON', { status: 'EINVAL' });
  }
  if (typeof json !== 'string') {
    return fail('Records serialise to nothing at all', { status: 'EINVAL' });
  }
  const expected = Object.keys(snapshot.data);
  return confirmNothingDropped(expected, json);
}

/**
 * Accepts serialised text only when every record the caller gave survived it.
 * @param expected - Keys the caller asked to persist.
 * @param json - Text about to be staged.
 * @returns The text and its record count, or a failure naming the losses.
 */
function confirmNothingDropped(
  expected: readonly string[],
  json: string,
): Procedure<ISerialised> {
  const dropped = droppedKeys(expected, json);
  if (dropped.length > 0) {
    const names = dropped.join(', ');
    return fail(`Records cannot be stored as JSON: ${names}`, { status: 'EINVAL' });
  }
  return succeed({ json, count: expected.length });
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
