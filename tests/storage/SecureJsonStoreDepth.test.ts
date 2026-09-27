/**
 * {@link SecureJsonStore} commits at depth: the rules the top level of a
 * record set follows hold for every value nested inside it.
 *
 * <p>Threat 27 was closed at the top level only. The store copied each record
 * into an object with no prototype but kept the values inside by reference, so
 * a `toJSON` inherited from a polluted prototype still rewrote a nested object
 * in the bytes, while the commit reported success. Getters, functions, symbol
 * keys and class instances at depth reached `JSON.stringify` the same way.
 */

import { describe, expect, it } from 'vitest';

import ownRequest from '../../src/Storage/OwnedRecords.js';
import SecureJsonStore from '../../src/Storage/SecureJsonStore.js';
import FakeFileSystem from './FakeFileSystem.js';

/** The record set a commit request carries. */
type RecordSet = Readonly<Record<string, unknown>>;

/** What one commit did, captured before any assertion runs. */
interface ICommitOutcome {
  readonly success: boolean;
  readonly message: string;
  readonly names: readonly string[];
  readonly written: string;
}

/** Path every case commits to. */
const STORE_PATH = '/data/tokens.json';

/** A credential value no error message may ever repeat. */
const SECRET = 'nested-secret-marker';

/** What a polluting `toJSON` puts in the bytes, so its reach is visible. */
const HIJACKED = { hijacked: true };

/**
 * Builds a store over a fresh in-memory filesystem.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  return { store: new SecureJsonStore(fileSystem, STORE_PATH), fileSystem };
}

/**
 * Runs an action while a shared prototype carries a planted `toJSON`, as
 * prototype pollution would leave it.
 *
 * <p>Restored before returning, not in a hook: an assertion that fails while
 * the prototype is polluted cannot even be reported, because the test runner
 * serialises the failure with the same `JSON` the pollution hijacks.
 * @param prototype - The prototype every value of a kind inherits from.
 * @param action - What to run while it is polluted.
 * @returns What the action returned.
 */
function withPollutedToJson<T>(prototype: object, action: () => T): T {
  Object.defineProperty(prototype, 'toJSON', {
    value: (): object => HIJACKED, configurable: true, writable: true,
  });
  try {
    return action();
  } finally {
    Reflect.deleteProperty(prototype, 'toJSON');
  }
}

/**
 * Commits records and reports what reached the disk.
 * @param records - The record set to commit.
 * @returns The outcome, the names the filesystem now holds, and the store's text.
 */
function commitAndList(records: RecordSet): ICommitOutcome {
  const { store, fileSystem } = makeStore();
  const committed = store.commit({ records, shouldQuarantine: false });
  const message = committed.success ? '' : committed.message;
  const names = fileSystem.names();
  const written = fileSystem.hasEntry(STORE_PATH) ? fileSystem.contentsOf(STORE_PATH) : '';
  return { success: committed.success, message, names, written };
}

/**
 * Commits records that must be written, and returns the text written.
 * @param records - The record set to commit.
 * @returns The store's contents.
 */
function commitAndRead(records: RecordSet): string {
  const outcome = commitAndList(records);
  if (!outcome.success) throw new Error(`expected the commit to succeed: ${outcome.message}`);
  return outcome.written;
}

/**
 * Asserts a commit failed before anything was staged.
 * @param outcome - What a commit the store must refuse did.
 * @returns The failure message, for further checks.
 */
function expectNothingStaged(outcome: ICommitOutcome): string {
  expect(outcome.success).toBe(false);
  expect(outcome.names).toEqual([]);
  return outcome.message;
}

/**
 * Asserts the store refuses a record set before anything is staged.
 * @param records - The record set the store must refuse.
 * @returns The failure message, for further checks.
 */
function expectRefusedBeforeStaging(records: RecordSet): string {
  const outcome = commitAndList(records);
  return expectNothingStaged(outcome);
}

describe('SecureJsonStore commits at depth: inherited toJSON', () => {
  it('threat 27: a toJSON inherited by nested objects cannot reach the bytes', () => {
    const records = { tokens: [{ token: SECRET }], entry: { token: SECRET } };
    const outcome = withPollutedToJson(Object.prototype, () => commitAndList(records));
    expect(outcome.success).toBe(true);
    expect(JSON.parse(outcome.written)).toEqual(records);
  });

  it('threat 27: a toJSON inherited by nested lists cannot reach the bytes', () => {
    const records = { tokens: [SECRET, 'second'], nested: { list: [[1, 2]] } };
    const outcome = withPollutedToJson(Array.prototype, () => commitAndList(records));
    expect(outcome.success).toBe(true);
    expect(JSON.parse(outcome.written)).toEqual(records);
  });

  it('threat 27: refuses a bigint, which only an inherited toJSON would write', () => {
    const top = withPollutedToJson(BigInt.prototype, () => commitAndList({ amount: 10n }));
    expectNothingStaged(top);
    const nested = { entry: { amount: 10n } };
    const deep = withPollutedToJson(BigInt.prototype, () => commitAndList(nested));
    expectNothingStaged(deep);
  });
});

describe('SecureJsonStore commits at depth: the top-level rules hold at every depth', () => {
  it('refuses a nested accessor without ever invoking it', () => {
    let reads = 0;
    const entry = { token: SECRET };
    Object.defineProperty(entry, 'expiry', {
      enumerable: true,
      get: (): number => {
        reads += 1;
        return reads;
      },
    });
    expectRefusedBeforeStaging({ entry });
    expect(reads).toBe(0);
  });

  it('refuses a nested function, which JSON would drop', () => {
    expectRefusedBeforeStaging({ entry: { token: SECRET, refresh: (): string => SECRET } });
    expectRefusedBeforeStaging({ list: [(): string => SECRET] });
  });

  it('refuses a nested own toJSON, which would rewrite the value', () => {
    expectRefusedBeforeStaging({ entry: { toJSON: (): object => HIJACKED } });
  });

  it('refuses a nested symbol key or symbol value, which JSON would drop', () => {
    expectRefusedBeforeStaging({ entry: { token: SECRET, [Symbol('hidden')]: SECRET } });
    expectRefusedBeforeStaging({ list: Object.assign(['a'], { [Symbol('hidden')]: SECRET }) });
    expectRefusedBeforeStaging({ entry: { token: Symbol(SECRET) } });
  });

  it('refuses a nested hidden property, which JSON would leave out', () => {
    const entry = { token: SECRET };
    Object.defineProperty(entry, 'hidden', { value: SECRET, enumerable: false });
    expectRefusedBeforeStaging({ entry });
  });

  it('refuses a nested class instance, which JSON would not copy as it is', () => {
    expectRefusedBeforeStaging({ entry: { issuedAt: new Date(0) } });
    expectRefusedBeforeStaging({ entry: { seen: new Map([['a', 1]]) } });
    class Sublist extends Array<string> {}
    expectRefusedBeforeStaging({ entry: Sublist.from(['a']) });
  });

  it('refuses a list with a named entry or a hole, which JSON would not write as given', () => {
    const named = Object.assign(['a'], { extra: SECRET });
    expectRefusedBeforeStaging({ list: named });
    const holed: string[] = [];
    holed[1] = SECRET;
    expectRefusedBeforeStaging({ list: holed });
    const holedAndNamed: string[] = ['a'];
    holedAndNamed[2] = 'c';
    expectRefusedBeforeStaging({ list: Object.assign(holedAndNamed, { extra: SECRET }) });
  });

  it('refuses a nested cycle as a failure, never a throw', () => {
    const entry: Record<string, unknown> = { token: SECRET };
    entry['self'] = entry;
    expectRefusedBeforeStaging({ entry });
    const records: Record<string, unknown> = { token: SECRET };
    records['all'] = { records };
    expect(expectRefusedBeforeStaging(records)).toContain('cycle');
  });

  it('refuses a nested key the caller lists but will not describe', () => {
    const liar = new Proxy({}, { ownKeys: (): string[] => ['token'] });
    expect(expectRefusedBeforeStaging({ entry: liar })).toContain('will not describe itself');
  });

  it('fails closed on a value too deep to copy, never throwing', () => {
    let deep: Record<string, unknown> = { token: SECRET };
    for (let depth = 0; depth < 100_000; depth += 1) deep = { deep };
    expectRefusedBeforeStaging({ entry: deep });
  });

  it('never repeats a nested key or value in the failure message', () => {
    const message = expectRefusedBeforeStaging({ entry: { [SECRET]: (): string => SECRET } });
    expect(message).toContain('entry');
    expect(message).not.toContain(SECRET);
  });
});

describe('SecureJsonStore commits at depth: ordinary records are unchanged', () => {
  it('writes nested records byte-for-byte as JSON would', () => {
    const records = {
      tokens: [{ id: 'a', token: SECRET, scopes: ['read', 'write'] }],
      settings: { enabled: true, retries: 3, note: null, nested: { depth: [1, [2]] } },
    };
    expect(commitAndRead(records)).toBe(JSON.stringify(records, undefined, 2));
  });

  it('writes a value shared twice within a record, which is no cycle', () => {
    const shared = { token: SECRET };
    const records = { entry: { first: shared, second: { again: shared } }, other: shared };
    expect(JSON.parse(commitAndRead(records))).toEqual(records);
  });

  it('leaves an undefined nested field out, as an absent optional field reads', () => {
    const records = { entries: [{ name: 'leumi', duration: undefined, txns: 3 }] };
    expect(JSON.parse(commitAndRead(records))).toEqual({ entries: [{ name: 'leumi', txns: 3 }] });
  });

  it('keeps a nested "__proto__" key as data, as a read returns it', () => {
    const records: unknown = JSON.parse('{"entry":{"__proto__":{"a":1},"token":"t"}}');
    const reread: unknown = JSON.parse(commitAndRead(records as RecordSet));
    expect(reread).toEqual(records);
    const entry = (reread as { entry: object }).entry;
    expect(Object.hasOwn(entry, '__proto__')).toBe(true);
  });

  it('accepts nested objects and lists that already have no prototype', () => {
    const bare = Object.assign(Object.create(null) as object, { token: SECRET });
    const bareList = Object.setPrototypeOf(['a'], null) as unknown;
    const records = { entry: bare, list: bareList };
    expect(JSON.parse(commitAndRead(records))).toEqual({ entry: { token: SECRET }, list: ['a'] });
  });
});

describe('ownRequest at depth', () => {
  it('owns every nested value: a frozen copy with no prototype', () => {
    const entry = { scopes: ['read'] };
    const owned = ownRequest({ records: { entry }, shouldQuarantine: false });
    if (!owned.success) throw new Error(owned.message);
    const copied = owned.data.records.values['entry'] as { scopes: unknown };
    expect(copied).not.toBe(entry);
    expect(copied.scopes).not.toBe(entry.scopes);
    expect(Object.getPrototypeOf(copied)).toBeNull();
    expect(Object.getPrototypeOf(copied.scopes)).toBeNull();
    expect(Object.isFrozen(copied)).toBe(true);
    expect(Object.isFrozen(copied.scopes)).toBe(true);
  });
});
