/**
 * The store's own copy of one record's value, at every depth.
 *
 * <p>`ownRequest` lifts each record out of its descriptor into an object with
 * no prototype. That closed threat 27 for the record set and left it open one
 * level down: the values inside were kept by reference, so an object nested
 * in a record still inherited from `Object.prototype`, a list from
 * `Array.prototype`, and `JSON.stringify` still ran whatever `toJSON` a
 * polluted prototype carried, a getter, or a class's own method, while the
 * commit reported success.
 *
 * <p>This walks a value once and rebuilds it from descriptors, holding it to
 * the rules the record set follows: plain objects and lists only, string
 * keys, enumerable data properties, nothing JSON cannot carry, and no cycle.
 * Every container comes back frozen with no prototype, so the text
 * `JSON.stringify` writes depends only on data the store read itself.
 *
 * <p>Values stay the caller's. An `undefined` field is left out, as an absent
 * optional field reads back, and a number JSON cannot write becomes `null`,
 * exactly as before. What changed is that nothing can run while the text is
 * produced, and nothing leaves the shape without a failure.
 *
 * <p>A failure names the record only. A nested key can be data the caller
 * would never log, so no message repeats one.
 * @module
 */

import type { IProcedureFailure, Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';

/** One walk over a record's value. */
interface IWalk {
  /** The record the value belongs to: the only name a failure uses. */
  readonly record: string;

  /** Containers on the path down from the record set, to refuse a cycle. */
  readonly ancestors: Set<object>;
}

/** One container being copied. */
interface ICopy {
  /** The caller's container, read once per key. */
  readonly source: object;

  /** The store's container, filled from the descriptors. */
  readonly copy: object;

  /** The walk the container belongs to. */
  readonly walk: IWalk;
}

/** Types JSON has no text for, which only an inherited `toJSON` would write. */
const UNWRITABLE_TYPES = new Set(['function', 'symbol', 'bigint']);

/** Why a class instance is refused: JSON writes what its methods say. */
const NOT_PLAIN = 'an instance of a class, which JSON would not copy as it is';

/**
 * Explains why a value cannot be stored, naming only its record.
 * @param walk - The walk that found it.
 * @param reason - What the value holds and why that cannot be stored.
 * @returns A failure for the commit.
 */
function refuse(walk: IWalk, reason: string): IProcedureFailure {
  return fail(`Record ${walk.record} holds ${reason}`, { status: 'EINVAL' });
}

/**
 * Reports whether a container has the prototype its kind usually has, or none.
 * @param source - The caller's container.
 * @param usual - `Object.prototype` for an object, `Array.prototype` for a list.
 * @returns True for a plain object or list.
 */
function isPlain(source: object, usual: object): boolean {
  const ancestor: unknown = Object.getPrototypeOf(source);
  return ancestor === usual || ancestor === null;
}

/**
 * Reads a container's own keys once, refusing symbols JSON would drop.
 * @param source - The caller's container.
 * @param walk - The walk it belongs to.
 * @returns Its string keys, or why they cannot be stored.
 */
function stringKeysOf(source: object, walk: IWalk): Procedure<readonly string[]> {
  const keys = Reflect.ownKeys(source);
  const isSymbolFree = keys.every((key) => typeof key === 'string');
  if (!isSymbolFree) return refuse(walk, 'a symbol key, which JSON would drop');
  return succeed(keys as readonly string[]);
}

/**
 * Reports whether a list's entries are exactly its indices, with no hole.
 * @param source - The caller's list.
 * @param indices - Its own string keys other than `length`.
 * @returns True when JSON would write every entry as it is.
 */
function isDenseList(source: object, indices: readonly string[]): boolean {
  const length: unknown = Object.getOwnPropertyDescriptor(source, 'length')?.value;
  if (length !== indices.length) return false;
  return indices.every((key, position) => key === String(position));
}

/**
 * Lifts one entry out of its descriptor and owns its value.
 *
 * <p>Reads the descriptor rather than the property, so an accessor is found
 * without ever being invoked and the value is taken without a second read.
 * @param target - The container being copied.
 * @param key - The entry's own key.
 * @returns The owned value, or why the entry cannot be stored.
 */
function ownEntry(target: ICopy, key: string): Procedure<unknown> {
  const { source, walk } = target;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) return refuse(walk, 'a property that will not describe itself');
  if (!Object.hasOwn(descriptor, 'value')) return refuse(walk, 'an accessor, not plain data');
  if (descriptor.enumerable !== true) {
    return refuse(walk, 'a hidden property, which JSON would leave out');
  }
  const value: unknown = descriptor.value;
  return ownValue(value, walk);
}

/**
 * Copies every listed entry into the store's container, then freezes it.
 * @param target - The container being copied.
 * @param keys - The keys to copy, each read once.
 * @returns The frozen copy, or the first entry that could not be stored.
 */
function copyEntries(target: ICopy, keys: readonly string[]): Procedure<unknown> {
  for (const key of keys) {
    const owned = ownEntry(target, key);
    if (!owned.success) return owned;
    Object.defineProperty(target.copy, key, { value: owned.data, enumerable: true });
  }
  Object.freeze(target.copy);
  return succeed(target.copy);
}

/**
 * Copies a plain object into one with no prototype.
 * @param source - The caller's object.
 * @param walk - The walk it belongs to.
 * @returns The owned object, or why it cannot be stored.
 */
function ownObject(source: object, walk: IWalk): Procedure<unknown> {
  if (!isPlain(source, Object.prototype)) return refuse(walk, NOT_PLAIN);
  const keys = stringKeysOf(source, walk);
  if (!keys.success) return keys;
  const copy = Object.create(null) as object;
  return copyEntries({ source, copy, walk }, keys.data);
}

/**
 * Copies a plain list into one with no prototype, which JSON still writes as a list.
 * @param source - The caller's list.
 * @param walk - The walk it belongs to.
 * @returns The owned list, or why it cannot be stored.
 */
function ownList(source: object, walk: IWalk): Procedure<unknown> {
  if (!isPlain(source, Array.prototype)) return refuse(walk, NOT_PLAIN);
  const keys = stringKeysOf(source, walk);
  if (!keys.success) return keys;
  const indices = keys.data.filter((key) => key !== 'length');
  if (!isDenseList(source, indices)) {
    return refuse(walk, 'a list with a hole or a named entry, which JSON would not write as given');
  }
  const copy: unknown[] = [];
  Object.setPrototypeOf(copy, null);
  return copyEntries({ source, copy, walk }, indices);
}

/**
 * Owns a value of any kind: a primitive as it is, a container by copying it.
 * @param value - A value read out of a descriptor.
 * @param walk - The walk it belongs to.
 * @returns The owned value, or why it cannot be stored.
 */
function ownValue(value: unknown, walk: IWalk): Procedure<unknown> {
  const kind = typeof value;
  if (UNWRITABLE_TYPES.has(kind)) return refuse(walk, `a ${kind}, which JSON cannot carry`);
  if (typeof value !== 'object' || value === null) return succeed(value);
  if (walk.ancestors.has(value)) return refuse(walk, 'a cycle, which JSON cannot write');
  walk.ancestors.add(value);
  const owned = Array.isArray(value) ? ownList(value, walk) : ownObject(value, walk);
  walk.ancestors.delete(value);
  return owned;
}

/**
 * Owns one record's value, at every depth.
 * @param record - The record's key, the only name a failure may use.
 * @param value - The value, already lifted out of the record's descriptor.
 * @returns A frozen, prototype-less copy, or why the value cannot be stored.
 */
export default function ownRecordValue(record: string, value: unknown): Procedure<unknown> {
  const walk: IWalk = { record, ancestors: new Set() };
  return ownValue(value, walk);
}
