/**
 * The store's own copy of what a caller asked it to write.
 *
 * <p>Six review rounds found the same bug in six disguises: a getter deleting
 * a sibling mid-copy, a `toJSON` erasing itself, one injecting a record, one
 * swapping every value, symbol keys JSON drops in silence, an array root
 * reappearing as `{"0":…}`, a proxy answering differently on the second read,
 * a `toJSON` inherited from `Object.prototype`. Each got its own check, and
 * the next round found another.
 *
 * <p>They were never separate bugs. The store kept *re-reading* an object it
 * did not own — validating it, then reading it again to copy it, then reading
 * the request again to decide about quarantine — and every one of those reads
 * was a fresh chance for the caller's object to say something different.
 * Checking harder cannot fix that; each new check is just one more read.
 *
 * <p>So this module reads everything exactly once and hands back a value the
 * store owns outright: keys and values lifted straight out of property
 * descriptors, copied into a frozen object with no prototype. Nothing
 * downstream ever touches the caller's object again, and
 * {@link IOwnedRecords} is a type only this module can produce, so the
 * compiler enforces that rather than a convention.
 *
 * <p>What that buys, by construction rather than by inspection:
 *
 * <ul>
 * <li>Values cannot change after validation — there is no second read.</li>
 * <li>No accessor can run during serialisation — none survived the copy.</li>
 * <li>No inherited `toJSON` can intercept `JSON.stringify` — the copy has no
 * prototype to inherit one from, even if `Object.prototype` is polluted.</li>
 * <li>A request that refuses to be read fails instead of throwing, and fails
 * before anything is staged.</li>
 * </ul>
 * @module
 */

import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';
import { POLLUTING_KEY } from './StoreRecords.js';
import type { ICommitRequest, IOwnedRecords, IOwnedRequest } from './StoreTypes.js';

/**
 * Checks that a value can be copied key-for-key into JSON.
 *
 * <p>An array or a class instance would serialise to something that is not a
 * record set at all, so refusing them here removes every later question about
 * what the text might describe.
 * @param candidate - Value the caller offered as a record set.
 * @returns The value as an object, or why it cannot be one.
 */
function checkRoot(candidate: unknown): Procedure<object> {
  if (typeof candidate !== 'object' || candidate === null) {
    return fail('Records must be an object of records', { status: 'EINVAL' });
  }
  if (Array.isArray(candidate)) {
    return fail('Records must not be an array, whose entries JSON renumbers', {
      status: 'EINVAL',
    });
  }
  const ancestor: unknown = Object.getPrototypeOf(candidate);
  if (ancestor !== Object.prototype && ancestor !== null) {
    return fail('Records must be a plain object, not an instance of a class', {
      status: 'EINVAL',
    });
  }
  return succeed(candidate);
}

/**
 * Lifts one record out of its descriptor, or explains why it cannot be.
 *
 * <p>Reads the descriptor rather than the property, so an accessor is
 * identified without ever being invoked and the value is taken without a
 * second `[[Get]]`. Anything JSON would quietly discard is refused instead,
 * because a commit that reports success must mean a read can return it.
 * @param key - Own key the descriptor belongs to.
 * @param descriptor - Descriptor captured in the single reflection pass.
 * @returns The value to copy, or why the record cannot be stored.
 */
function ownOneRecord(key: string, descriptor: PropertyDescriptor): Procedure<unknown> {
  if (key === POLLUTING_KEY) {
    return fail(`Records cannot include ${POLLUTING_KEY}: it is stripped on read`, {
      status: 'EINVAL',
    });
  }
  if (!Object.hasOwn(descriptor, 'value')) {
    return fail(`Record ${key} is not a plain data property`, { status: 'EINVAL' });
  }
  if (descriptor.enumerable !== true) {
    return fail(`Record ${key} is hidden, and JSON would leave it out`, { status: 'EINVAL' });
  }
  const value: unknown = descriptor.value;
  if (typeof value === 'function') {
    return fail(`Record ${key} is a function, which JSON cannot carry`, { status: 'EINVAL' });
  }
  return succeed(value);
}

/**
 * Copies every record the caller listed into an object the store owns.
 *
 * <p>Keys are taken once and each is described once — the same two reflection
 * steps `Object.getOwnPropertyDescriptors` would take, spelled out because
 * that helper silently omits a key it could not describe, and a key the
 * caller listed but will not describe has to be refused rather than dropped.
 * @param source - The caller's object, already checked for shape.
 * @param keys - Own keys, read once.
 * @returns Owned records, or the first record that could not be copied.
 */
function ownEveryRecord(source: object, keys: readonly string[]): Procedure<IOwnedRecords> {
  const values = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined) {
      return fail(`Record ${key} was listed but will not describe itself`, { status: 'EINVAL' });
    }
    const owned = ownOneRecord(key, descriptor);
    if (!owned.success) return owned;
    values[key] = owned.data;
  }
  Object.freeze(values);
  return succeed({ values } as IOwnedRecords);
}

/**
 * Splits own keys into the string keys JSON can carry, refusing symbols.
 * @param source - The caller's object, already checked for shape.
 * @returns Own string keys, or why the key set cannot be stored.
 */
function ownKeysOf(source: object): Procedure<readonly string[]> {
  const keys = Reflect.ownKeys(source);
  const symbols = keys.filter((key) => typeof key === 'symbol');
  if (symbols.length > 0) {
    return fail(`Records hold ${String(symbols.length)} symbol keys, which JSON would drop`, {
      status: 'EINVAL',
    });
  }
  return succeed(keys as readonly string[]);
}

/**
 * Reads a commit request once, in full, and copies what it holds.
 *
 * <p>Both properties are read here and nowhere else, and the order matters
 * twice over. `shouldQuarantine` is read last because it is caller code: a
 * getter there can edit the very object `records` just handed over, so
 * reading it first let a caller supply one record set and have a different
 * one written. It is still read before the filesystem is touched, which is
 * what stops a getter that throws from orphaning a staged credential.
 * @param request - The caller's request object, still untrusted.
 * @returns An owned request, or why the caller's could not be read.
 */
function readRequestOnce(request: ICommitRequest): Procedure<IOwnedRequest> {
  const candidate: unknown = request.records;
  const rooted = checkRoot(candidate);
  if (!rooted.success) return rooted;
  const keys = ownKeysOf(rooted.data);
  if (!keys.success) return keys;
  const owned = ownEveryRecord(rooted.data, keys.data);
  if (!owned.success) return owned;
  return succeed({ records: owned.data, shouldQuarantine: request.shouldQuarantine });
}

/**
 * Takes ownership of everything a commit request carries.
 *
 * <p>The only way to obtain an {@link IOwnedRequest}. Every read of the
 * caller's object happens inside this call, and inside one `try`: an object
 * that refuses inspection — a proxy whose `ownKeys` throws, a getter that
 * raises — comes back as an ordinary failure rather than an exception thrown
 * out of a method that promises to return a result.
 * @param request - Records to persist and whether to quarantine first.
 * @returns A request the store owns, or why the caller's could not be used.
 */
export default function ownRequest(request: ICommitRequest): Procedure<IOwnedRequest> {
  try {
    return readRequestOnce(request);
  } catch {
    return fail('Commit request could not be read', { status: 'EINVAL' });
  }
}
