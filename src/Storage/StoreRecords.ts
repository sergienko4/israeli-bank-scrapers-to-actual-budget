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

/** Value kinds `JSON.stringify` omits, taking their key with them. */
const OMITTED_KINDS = new Set(['undefined', 'function', 'symbol']);

/**
 * Names the records JSON would silently drop on the way to disk.
 *
 * <p>Without this the commit report counts keys that were never written, so
 * a caller is told a credential was stored when it was not.
 * @param records - Records the caller asked to persist.
 * @returns The offending keys, which are names rather than secrets.
 */
function unwritableKeys(records: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(records).filter((key) => OMITTED_KINDS.has(typeof records[key]));
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
  const dropped = unwritableKeys(snapshot.data);
  if (dropped.length > 0) {
    return fail(`Records cannot be stored as JSON: ${dropped.join(', ')}`, { status: 'EINVAL' });
  }
  try {
    const json = JSON.stringify(snapshot.data, undefined, 2);
    return succeed({ json, count: Object.keys(snapshot.data).length });
  } catch {
    return fail('Records could not be serialised as JSON', { status: 'EINVAL' });
  }
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
