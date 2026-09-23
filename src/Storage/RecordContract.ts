/**
 * The shape a caller must hand the store before anything is written.
 *
 * <p>Every earlier attempt to make the write path safe worked the other way
 * round: take whatever object arrives, copy it, serialise it, then try to
 * notice each way the copy had lied. That list only ever grew — a getter that
 * deletes a sibling during the copy, a `toJSON` that erases itself, one that
 * injects a record, one that keeps the key set and swaps the values beneath
 * it, keys held on symbols that JSON silently drops, an array whose entries
 * reappear as `"0"` and `"1"`. Each is a different mechanism and each needed
 * its own detector.
 *
 * <p>They share a cause: a record set is data, and the store was accepting
 * behaviour. Refusing behaviour at the door replaces all of those detectors
 * with one rule, and the rule is checkable before any copy is taken, so no
 * hostile code runs at all.
 * @module
 */

import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';

/**
 * Key that turns a later `target[key] = value` into prototype pollution.
 *
 * <p>Survives `JSON.parse` as an ordinary own property, so copying entries
 * into a null-prototype object is not on its own enough to neutralise it.
 * Accepting one on write would also report a credential stored that no read
 * could return, because the read path strips it.
 */
export const POLLUTING_KEY = '__proto__';

/**
 * Reports whether a value is a direct instance of `Object`, or has no
 * prototype at all.
 * @param records - Value handed in as a record set.
 * @returns True when nothing sits between the value and plain data.
 */
function isPlainRoot(records: Readonly<Record<string, unknown>>): boolean {
  if (Array.isArray(records)) return false;
  const ancestor: unknown = Object.getPrototypeOf(records);
  return ancestor === Object.prototype || ancestor === null;
}

/**
 * Reports whether a property holds a value rather than running code.
 *
 * <p>Reads the descriptor instead of the property, so an accessor is
 * identified without ever being invoked. A missing descriptor counts as a
 * failure too: the key was listed a moment ago, so an object that now
 * declines to describe it is answering differently on each call and cannot
 * be copied faithfully.
 * @param records - Record set being checked.
 * @param key - Own enumerable key of that set.
 * @returns True when reading the key cannot execute anything.
 */
function isDataProperty(records: Readonly<Record<string, unknown>>, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(records, key);
  if (descriptor === undefined) return false;
  return Object.hasOwn(descriptor, 'value');
}

/**
 * Checks each key of a record set in turn.
 * @param records - Record set whose keys are all own and enumerable.
 * @returns The set, or the first key that breaks the contract.
 */
function checkEveryKey(
  records: Readonly<Record<string, unknown>>,
): Procedure<Readonly<Record<string, unknown>>> {
  const keys = Object.keys(records);
  for (const key of keys) {
    if (!isDataProperty(records, key)) {
      return fail(`Record ${key} is not a plain data property`, { status: 'EINVAL' });
    }
    if (typeof records[key] === 'function') {
      return fail(`Record ${key} is a function, which JSON cannot carry`, { status: 'EINVAL' });
    }
  }
  return succeed(records);
}

/**
 * Checks the key carriers JSON cannot represent.
 * @param records - Value handed in as a record set.
 * @returns The set, or the reason a key would not survive.
 */
function checkKeyCarriers(
  records: Readonly<Record<string, unknown>>,
): Procedure<Readonly<Record<string, unknown>>> {
  const symbols = Object.getOwnPropertySymbols(records);
  if (symbols.length > 0) {
    return fail(`Records hold ${String(symbols.length)} symbol keys, which JSON would drop`, {
      status: 'EINVAL',
    });
  }
  if (Object.hasOwn(records, POLLUTING_KEY)) {
    return fail(`Records cannot include ${POLLUTING_KEY}: it is stripped on read`, {
      status: 'EINVAL',
    });
  }
  return succeed(records);
}

/**
 * Checks the record set itself, before any of its keys.
 * @param records - Value handed in as a record set.
 * @returns The set, or the reason the shape is unusable.
 */
function checkRoot(
  records: Readonly<Record<string, unknown>>,
): Procedure<Readonly<Record<string, unknown>>> {
  if (!isPlainRoot(records)) {
    return fail('Records must be a plain object, because JSON keeps nothing else faithfully', {
      status: 'EINVAL',
    });
  }
  return checkKeyCarriers(records);
}

/**
 * Accepts a record set only when writing it can hold no surprises.
 *
 * <p>Requires a plain object of plain data: no array or class instance at the
 * root, no keys on symbols, no `__proto__`, no accessors and no functions.
 * Rejecting accessors is what makes the rest of the write path honest — with
 * no code to run, copying, serialising and re-reading the set are all
 * guaranteed to see the same thing the caller passed.
 * @param records - Value handed in as a record set.
 * @returns The same set, or the reason it cannot be stored.
 */
export function acceptRecordSet(
  records: Readonly<Record<string, unknown>>,
): Procedure<Readonly<Record<string, unknown>>> {
  const root = checkRoot(records);
  if (!root.success) return root;
  return checkEveryKey(records);
}
